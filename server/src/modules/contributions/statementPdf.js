import PDFDocument from 'pdfkit';
import { formatMoney } from '../financial/moneyFormat.js';
import { statementLabels } from './statementLabels.js';

// Same church-header + simple-rule layout as receipts/receiptPdf.js, for
// visual consistency between the two documents a member/treasurer sees.
// Matches "SMS Example 2" from the client's spec: Zaka/Sadaka/Matoleo
// Mengine subtotals + one grand total for one member, one calendar month.
export function renderStatementPdf(data, stream, locale = 'en') {
  const t = statementLabels(locale);
  const { tenant, churchSettings, contributor, year, month, tithe, offering, other, total, contributions, categoriesById } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);

  doc.fontSize(16).font('Helvetica-Bold').text(tenant.name, { align: 'left' });
  doc.fontSize(9).font('Helvetica').fillColor('#555555');
  if (churchSettings?.address) doc.text(churchSettings.address);
  const contactLine = [churchSettings?.phone, churchSettings?.email].filter(Boolean).join('  ·  ');
  if (contactLine) doc.text(contactLine);
  doc.fillColor('#000000');

  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(1);

  doc.fontSize(18).font('Helvetica-Bold').text(t.statement.toUpperCase(), { align: 'center' });
  doc.moveDown(1);

  const row = (label, value) => {
    doc.fontSize(10).font('Helvetica-Bold').text(`${label}:`, { continued: true, width: 200 });
    doc.font('Helvetica').text(` ${value ?? '—'}`);
  };

  const periodLabel = `${String(month).padStart(2, '0')}-${year}`;
  row(t.member, contributor.full_name);
  if (contributor.member_number) row(t.memberNumber, contributor.member_number);
  row(t.period, periodLabel);

  doc.moveDown(1);
  const currency = tenant.base_currency ?? '';
  row(t.tithe, `${currency} ${formatMoney(tithe)}`.trim());
  row(t.offering, `${currency} ${formatMoney(offering)}`.trim());
  row(t.other, `${currency} ${formatMoney(other)}`.trim());
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica-Bold').text(`${t.grandTotal}: ${currency} ${formatMoney(total)}`.trim());

  doc.moveDown(1.5);
  if (!contributions || contributions.length === 0) {
    doc.fontSize(10).font('Helvetica-Oblique').text(t.noContributions);
  } else {
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text(t.date, 50, doc.y, { continued: true, width: 100 });
    doc.text(t.category, 150, doc.y, { continued: true, width: 250 });
    doc.text(t.amount, 400, doc.y);
    doc.moveDown(0.3);
    doc.font('Helvetica');
    for (const c of contributions) {
      const y = doc.y;
      doc.text(c.contribution_date, 50, y, { continued: true, width: 100 });
      doc.text(categoriesById?.get(c.category_id) ?? '—', 150, y, { continued: true, width: 250 });
      doc.text(formatMoney(c.amount), 400, y);
    }
  }

  doc.fontSize(8).font('Helvetica').fillColor('#888888');
  doc.text(`${t.generatedOn}: ${new Date().toISOString().slice(0, 10)}`, 50, 780, { align: 'left' });

  doc.end();
}
