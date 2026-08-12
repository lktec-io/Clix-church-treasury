import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

// Shared export infrastructure — every report in reports.service.js renders
// through these three functions, never a bespoke exporter per report
// (docs/MASTER_TODO.md Phase 9: "create reusable report/export
// infrastructure", "do not create a separate export engine for every report").

function cellToString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// Hand-written rather than a dependency — CSV escaping is a handful of
// lines and doesn't warrant a new package (docs/DEVELOPMENT_RULES.md §1).
export function toCsv(rows, columns) {
  const escape = (value) => {
    const str = cellToString(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const header = columns.map((c) => escape(c.header)).join(',');
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(','));
  return [header, ...lines].join('\r\n');
}

export async function toExcelBuffer(rows, columns, sheetName = 'Report') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer();
}

// Generic tabular report layout — title, church context, filter summary,
// generated timestamp, a table, and a totals line if provided. A4,
// paginated automatically by pdfkit as content overflows a page
// (docs/MASTER_TODO.md Phase 9: "properly paginated").
export function streamPdfReport({ tenant, title, filterSummary, columns, rows, totals }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
  doc.pipe(stream);

  doc.fontSize(14).font('Helvetica-Bold').text(tenant.name);
  doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'left' });
  doc.fontSize(9).font('Helvetica').fillColor('#555555');
  if (filterSummary) doc.text(filterSummary);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`);
  doc.fillColor('#000000');
  doc.moveDown(0.5);
  doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  const colWidth = (doc.page.width - 80) / columns.length;
  const rowHeight = 18;

  const drawRow = (values, { bold = false } = {}) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    values.forEach((value, i) => {
      doc.text(cellToString(value), 40 + i * colWidth, y, { width: colWidth - 6, ellipsis: true });
    });
    doc.y = y + rowHeight;
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
    }
  };

  drawRow(columns.map((c) => c.header), { bold: true });
  doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.2);

  rows.forEach((row) => drawRow(columns.map((c) => row[c.key])));

  if (totals) {
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.2);
    drawRow(columns.map((c) => totals[c.key] ?? ''), { bold: true });
  }

  doc.end();
}
