import PDFDocument from 'pdfkit';
import { formatMoney } from '../financial/moneyFormat.js';
import { statementLabels } from './statementLabels.js';
import {
  PALETTE,
  drawMasthead,
  drawFieldRows,
  drawSectionHeading,
  drawTable,
  drawGrandTotal,
  drawFooter,
} from '../reports/pdfTheme.js';

// One member, one calendar month. Shares 100% of its chrome with the
// receipt and the tabular report exports (reports/pdfTheme.js) — the three
// documents a church hands out must look like they came from one system.
export function renderStatementPdf(data, stream, locale = 'sw') {
  const t = statementLabels(locale);
  const {
    tenant,
    churchSettings,
    contributor,
    year,
    month,
    tithe,
    offering,
    other,
    total,
    contributions,
    categoriesById,
  } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);

  const currency = tenant?.base_currency ?? '';
  const money = (value) => `${currency} ${formatMoney(value)}`.trim();
  const periodLabel = `${String(month).padStart(2, '0')}/${year}`;

  const contactLine = [churchSettings?.address, churchSettings?.phone, churchSettings?.email]
    .filter(Boolean)
    .join('  ·  ');

  doc.y = drawMasthead(doc, {
    churchName: tenant?.name,
    documentTitle: t.statement,
    subtitle: contactLine,
    metaLines: [`${t.period}: ${periodLabel}`, tenant?.slug],
  });

  // --- Who this statement is for ---
  drawSectionHeading(doc, t.member);
  drawFieldRows(doc, [
    [t.member, contributor?.full_name],
    [t.memberNumber, contributor?.member_number],
    [t.period, periodLabel],
  ]);
  doc.y += 8;

  // --- The three report-group subtotals ---
  drawSectionHeading(doc, t.summary);
  drawTable(doc, {
    columns: [
      { key: 'label', header: t.category, width: 3 },
      { key: 'amount', header: t.amount, width: 2, align: 'right' },
    ],
    rows: [
      { label: t.tithe, amount: money(tithe) },
      { label: t.offering, amount: money(offering) },
      { label: t.other, amount: money(other) },
    ],
  });
  drawGrandTotal(doc, t.grandTotal, money(total));

  // --- Every posted contribution behind those subtotals ---
  doc.y += 4;
  drawSectionHeading(doc, t.details);
  if (!contributions || contributions.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(PALETTE.muted);
    doc.text(t.noContributions, doc.page.margins.left, doc.y);
    doc.fillColor(PALETTE.ink);
  } else {
    drawTable(doc, {
      columns: [
        { key: 'date', header: t.date, width: 2 },
        { key: 'category', header: t.category, width: 3 },
        { key: 'amount', header: t.amount, width: 2, align: 'right' },
      ],
      rows: contributions.map((c) => ({
        date: c.contribution_date,
        category: categoriesById?.get(c.category_id) ?? '—',
        amount: money(c.amount),
      })),
    });
  }

  drawFooter(doc, `${t.generatedOn}: ${new Date().toISOString().slice(0, 10)}`);
  doc.end();
}
