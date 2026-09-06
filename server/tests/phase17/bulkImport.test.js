// Pure-unit coverage for the bulk contributor import parser. No DB, no
// network — these assert what a clerk's spreadsheet turns into before it
// ever reaches contributors.service.js.
import { describe, it, expect } from 'vitest';
import {
  parseContributorImport,
  buildImportTemplateWorkbook,
  normalizeGender,
  parseCsv,
  TEMPLATE_COLUMNS,
  MAX_IMPORT_ROWS,
} from '../../src/modules/contributors/bulkImport.js';

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const HEADER = 'Full Name,Phone Number,Email,Gender';

describe('parseCsv', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
  });

  it('handles CRLF and drops blank lines', () => {
    expect(parseCsv('a,b\r\n\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
  });
});

describe('normalizeGender', () => {
  it.each([
    ['M', 'male'],
    ['male', 'male'],
    ['Mwanaume', 'male'],
    ['F', 'female'],
    ['KE', 'female'],
    ['Mwanamke', 'female'],
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeGender(input)).toBe(expected);
  });

  // A stray value in one cell must not fail the whole import.
  it('returns null for anything unrecognised or blank', () => {
    expect(normalizeGender('yes')).toBeNull();
    expect(normalizeGender('')).toBeNull();
    expect(normalizeGender(undefined)).toBeNull();
  });
});

describe('parseContributorImport', () => {
  it('parses rows and reports spreadsheet-accurate row numbers', async () => {
    const rows = await parseContributorImport(b64(`${HEADER}\nNeema Joseph,0712345678,neema@example.com,Female\n`));
    expect(rows).toEqual([
      { rowNumber: 2, fullName: 'Neema Joseph', phone: '0712345678', email: 'neema@example.com', gender: 'female' },
    ]);
  });

  // Clerks retype headers. Matching is case- and punctuation-insensitive,
  // and accepts the Swahili names too.
  it.each([
    'full name,phone,email,gender',
    'FULL NAME,PHONE NUMBER,EMAIL,GENDER',
    'Jina,Simu,Barua,Jinsia',
  ])('accepts the header variant "%s"', async (header) => {
    const rows = await parseContributorImport(b64(`${header}\nAsha Ally,0755111222,a@b.com,ke\n`));
    expect(rows[0].fullName).toBe('Asha Ally');
    expect(rows[0].gender).toBe('female');
  });

  // Excel writes a BOM when saving as CSV; unstripped it becomes part of the
  // first header cell and every import would be rejected as headerless.
  it('strips a UTF-8 BOM before matching headers', async () => {
    // The BOM is built from its code point rather than typed literally:
    // a literal U+FEFF in source is invisible in a diff and trips
    // eslint no-irregular-whitespace.
    const BOM = String.fromCharCode(0xfeff);
    const rows = await parseContributorImport(b64([`${BOM}${HEADER}`, 'BOM Test,0712345678,,M', ''].join('\n')));
    expect(rows[0].fullName).toBe('BOM Test');
  });

  // AppError puts the actionable detail in `fields`, not `message` (which is
  // always the generic 'Invalid payload'), so these assert on the field the
  // client actually renders.
  const rejectionFields = async (promise) => {
    try {
      await promise;
    } catch (error) {
      return error.fields;
    }
    throw new Error('expected the import to be rejected');
  };

  it('rejects a file with no Full Name column', async () => {
    const fields = await rejectionFields(parseContributorImport(b64('Phone,Email\n0712345678,a@b.com\n')));
    expect(fields.file).toMatch(/Full Name/);
  });

  it('rejects an empty or non-base64 payload', async () => {
    await expect(parseContributorImport('')).rejects.toThrow();
    await expect(parseContributorImport('   ')).rejects.toThrow();
  });

  it(`refuses more than ${MAX_IMPORT_ROWS} rows rather than half-applying them`, async () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `Member ${i},,,`).join('\n');
    const fields = await rejectionFields(parseContributorImport(b64(`${HEADER}\n${many}\n`)));
    expect(fields.file).toMatch(/maximum/);
  });

  // A .xlsx renamed to .csv (or the reverse) is common; the format is
  // decided by the actual bytes, never the filename.
  it('round-trips the generated .xlsx template through the parser', async () => {
    const workbook = await buildImportTemplateWorkbook();
    const rows = await parseContributorImport(Buffer.from(workbook).toString('base64'));
    expect(rows).toHaveLength(1); // the single worked example row
    expect(rows[0].fullName).toBe(TEMPLATE_COLUMNS[0].example);
    expect(rows[0].gender).toBe('female');
  });

  it('produces a real xlsx (ZIP magic), not a CSV with an xlsx name', async () => {
    const workbook = Buffer.from(await buildImportTemplateWorkbook());
    expect(workbook.subarray(0, 4).toString('hex')).toBe('504b0304');
  });
});
