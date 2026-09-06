import ExcelJS from 'exceljs';
import { validationError } from '../../errors/AppError.js';

// Parsing half of the bulk contributor import. Pure input handling — no
// database access and no tenant awareness; contributors.service.js owns the
// transaction, the deduplication and the inserts.
//
// TRANSPORT: the file arrives base64-encoded inside the ordinary JSON body,
// not as multipart/form-data. That is a deliberate choice to avoid adding
// multer (and a second body-parsing path, with its own upload directory and
// its own disk-write failure modes) for the single upload feature in this
// product. express.json's 1MB cap therefore applies, which after base64's
// ~33% inflation leaves roughly 750KB of file — several thousand member
// rows, far past what MAX_IMPORT_ROWS allows anyway.

// The exact headers the downloadable template ships with. Matching is
// case- and space-insensitive (normalizeHeader) so a clerk who retypes
// "full name" or "Phone number" in Excel is not punished for it.
export const TEMPLATE_COLUMNS = [
  { key: 'fullName', header: 'Full Name', width: 28, example: 'Neema Joseph' },
  { key: 'phone', header: 'Phone Number', width: 20, example: '0712345678' },
  { key: 'email', header: 'Email', width: 28, example: 'neema@example.com' },
  { key: 'gender', header: 'Gender', width: 14, example: 'Female' },
];

// A guard on the work one request can ask for, not on what the format can
// express. Beyond this the request is refused outright rather than half-
// applied: a clerk importing a 10,000-row spreadsheet should be told to
// split it, not left guessing which rows landed.
export const MAX_IMPORT_ROWS = 2000;

const HEADER_ALIASES = new Map([
  ['fullname', 'fullName'],
  ['name', 'fullName'],
  ['jina', 'fullName'],
  ['phonenumber', 'phone'],
  ['phone', 'phone'],
  ['simu', 'phone'],
  ['email', 'email'],
  ['barua', 'email'],
  ['emailaddress', 'email'],
  ['gender', 'gender'],
  ['jinsia', 'gender'],
  ['sex', 'gender'],
]);

function normalizeHeader(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// Accepts what a Tanzanian clerk actually types, in either language, and
// maps it onto the contributors.gender ENUM. Anything unrecognised becomes
// null ("never recorded") rather than an error — a spreadsheet with a
// stray value in one cell must not fail the whole import.
const GENDER_VALUES = new Map([
  ['m', 'male'],
  ['male', 'male'],
  ['me', 'male'],
  ['mume', 'male'],
  ['mwanaume', 'male'],
  ['f', 'female'],
  ['female', 'female'],
  ['ke', 'female'],
  ['mke', 'female'],
  ['mwanamke', 'female'],
  ['unspecified', 'unspecified'],
  ['other', 'unspecified'],
  ['nyingine', 'unspecified'],
]);

export function normalizeGender(raw) {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (key.length === 0) return null;
  return GENDER_VALUES.get(key) ?? null;
}

// XLSX files are ZIP archives — they always begin with the local file header
// signature "PK\x03\x04". Sniffing the bytes rather than trusting the
// filename means a .xlsx renamed to .csv (or the reverse, which clerks do
// constantly) is still parsed as what it actually is.
function isXlsx(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

// Hand-rolled, matching reports/exporters.js#toCsv's own "CSV is a handful
// of lines, not a dependency" stance — but this is the reading direction, so
// it has to handle quoted fields containing commas, newlines and escaped
// quotes, which the writing direction never had to.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM: Excel writes one when saving CSV, and it would
  // otherwise become part of the first header cell, so the "Full Name"
  // column would not match and every import would be rejected as headerless.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Ignore blank trailing lines rather than importing empty members.
    if (row.some((cell) => cell.trim().length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        // "" inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

async function parseXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow((excelRow) => {
    const values = [];
    // ExcelJS row.values is 1-indexed with a leading hole at [0].
    for (let i = 1; i < excelRow.values.length; i += 1) {
      const cell = excelRow.values[i];
      // A cell may be a rich-text object or a formula result rather than a
      // primitive; take the displayed text in those cases.
      if (cell === null || cell === undefined) values.push('');
      else if (typeof cell === 'object') values.push(String(cell.text ?? cell.result ?? ''));
      else values.push(String(cell));
    }
    if (values.some((v) => v.trim().length > 0)) rows.push(values);
  });
  return rows;
}

/**
 * Decodes the uploaded file and returns its data rows as plain objects keyed
 * by TEMPLATE_COLUMNS' keys, with a 1-based `rowNumber` matching what the
 * clerk sees in Excel so an error can point at a real line.
 */
export async function parseContributorImport(contentBase64) {
  if (typeof contentBase64 !== 'string' || contentBase64.trim().length === 0) {
    throw validationError('Invalid payload', { contentBase64: 'a file is required' });
  }

  let buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch {
    buffer = Buffer.alloc(0);
  }
  if (buffer.length === 0) {
    throw validationError('Invalid payload', { contentBase64: 'file is empty or not valid base64' });
  }

  let grid;
  try {
    grid = isXlsx(buffer) ? await parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  } catch {
    // ExcelJS throws on a corrupt archive. Surface it as a 422 the clerk can
    // act on, never a 500 — a bad upload is user input, not a server fault.
    throw validationError('Invalid payload', { file: 'could not be read as a CSV or Excel file' });
  }

  if (grid.length === 0) {
    throw validationError('Invalid payload', { file: 'contains no rows' });
  }

  const [headerRow, ...dataRows] = grid;
  const columnIndex = {};
  headerRow.forEach((cell, i) => {
    const key = HEADER_ALIASES.get(normalizeHeader(cell));
    // First occurrence wins, so a duplicated column doesn't silently
    // shadow the one the clerk filled in.
    if (key && columnIndex[key] === undefined) columnIndex[key] = i;
  });

  if (columnIndex.fullName === undefined) {
    throw validationError('Invalid payload', {
      file: `missing a "Full Name" column — expected headers: ${TEMPLATE_COLUMNS.map((c) => c.header).join(', ')}`,
    });
  }

  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw validationError('Invalid payload', {
      file: `contains ${dataRows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}`,
    });
  }

  const at = (row, key) => (columnIndex[key] === undefined ? '' : String(row[columnIndex[key]] ?? '').trim());

  return dataRows.map((row, i) => ({
    // +2 = one for the header row, one because spreadsheets are 1-based.
    rowNumber: i + 2,
    fullName: at(row, 'fullName'),
    phone: at(row, 'phone'),
    email: at(row, 'email'),
    gender: normalizeGender(at(row, 'gender')),
  }));
}

/** The downloadable starter file, generated rather than checked in as a binary. */
export async function buildImportTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Contributors');
  sheet.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  // One filled-in example row, so the expected shape of a phone number and
  // gender value is visible rather than described. A clerk deletes this row
  // and types over it.
  sheet.addRow(Object.fromEntries(TEMPLATE_COLUMNS.map((c) => [c.key, c.example])));
  return workbook.xlsx.writeBuffer();
}
