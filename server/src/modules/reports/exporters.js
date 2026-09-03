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
// The product's palette, mirrored from src/styles/themes.css so an exported
// PDF is recognisably the same system as the screen it came from.
const NAVY = '#0b1f4d';
const GREEN = '#10b981';
const INK = '#1e293b';
const MUTED = '#5b6b8c';
const HAIRLINE = '#dbe2ef';
const ZEBRA = '#f4f7fc';

export function streamPdfReport({ tenant, title, filterSummary, columns, rows, totals }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
  doc.pipe(stream);

  const left = 40;
  const right = doc.page.width - 40;
  const contentWidth = right - left;

  // --- Branded masthead: solid navy band with a green rule beneath it ---
  const drawMasthead = () => {
    doc.rect(0, 0, doc.page.width, 74).fill(NAVY);
    doc.rect(0, 74, doc.page.width, 3).fill(GREEN);

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15);
    doc.text(tenant?.name ?? '', left, 20, { width: contentWidth * 0.62, ellipsis: true });
    doc.font('Helvetica').fontSize(10).fillColor('#c7d2e8');
    doc.text(title, left, 42, { width: contentWidth * 0.62, ellipsis: true });

    // Right-aligned metadata block.
    doc.fontSize(8).fillColor('#c7d2e8');
    doc.text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, left, 24, {
      width: contentWidth,
      align: 'right',
    });
    if (tenant?.slug) {
      doc.text(tenant.slug, left, 38, { width: contentWidth, align: 'right' });
    }
    doc.fillColor(INK);
  };

  drawMasthead();
  doc.y = 92;

  if (filterSummary) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(filterSummary, left, doc.y, { width: contentWidth });
    doc.moveDown(0.4);
  }
  doc.fillColor(INK);

  const colWidth = contentWidth / columns.length;
  const rowHeight = 18;

  // Right-align anything that reads as money so figures line up on the
  // decimal — the single biggest legibility win in a financial table.
  const alignFor = (col) => (col.align === 'right' || /amount|total|balance|debit|credit/i.test(col.key ?? '') ? 'right' : 'left');

  const drawRow = (values, { bold = false, fill = null, color = INK } = {}) => {
    const y = doc.y;
    if (fill) doc.rect(left, y - 4, contentWidth, rowHeight).fill(fill);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color);
    values.forEach((value, i) => {
      doc.text(cellToString(value), left + i * colWidth, y, {
        width: colWidth - 8,
        ellipsis: true,
        align: alignFor(columns[i] ?? {}),
      });
    });
    doc.y = y + rowHeight;
    if (doc.y > doc.page.height - 56) {
      doc.addPage();
      drawMasthead();
      doc.y = 92;
      drawHeaderRow();
    }
  };

  // Navy header strip, repeated on every page so a multi-page export stays
  // readable rather than becoming anonymous columns of numbers.
  function drawHeaderRow() {
    const y = doc.y;
    doc.rect(left, y - 4, contentWidth, rowHeight + 2).fill(NAVY);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    columns.forEach((col, i) => {
      doc.text(String(col.header ?? '').toUpperCase(), left + i * colWidth, y, {
        width: colWidth - 8,
        ellipsis: true,
        align: alignFor(col),
      });
    });
    doc.y = y + rowHeight + 2;
    doc.fillColor(INK);
  }

  drawHeaderRow();

  rows.forEach((row, i) => {
    drawRow(
      columns.map((c) => row[c.key]),
      { fill: i % 2 === 1 ? ZEBRA : null }
    );
  });

  if (totals) {
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor(HAIRLINE).stroke();
    doc.moveDown(0.25);
    // Totals in green — the one figure a reader is usually looking for.
    drawRow(
      columns.map((c) => totals[c.key] ?? ''),
      { bold: true, color: GREEN }
    );
  }

  doc.end();
}
