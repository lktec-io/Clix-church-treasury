import PDFDocument from 'pdfkit';
import { formatMoney } from '../financial/moneyFormat.js';
import { receiptLabels } from './receiptLabels.js';
import {
  PALETTE,
  drawMasthead,
  drawFieldRows,
  drawSectionHeading,
  drawTable,
  drawGrandTotal,
  drawFooter,
} from '../reports/pdfTheme.js';

// Pure layout — no data access here, everything comes in as `data`
// (see receipts.service.js#getReceiptRenderData). Shares its chrome with
// the statement and the report exports via reports/pdfTheme.js.
export function renderReceiptPdf(data, stream, locale = 'sw') {
  const t = receiptLabels(locale);
  const {
    receipt,
    contribution,
    transaction,
    tenant,
    churchSettings,
    account,
    fund,
    category,
    issuedBy,
    contributor,
    items,
  } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);

  const currency = tenant?.base_currency ?? '';
  const money = (value) => `${currency} ${formatMoney(value)}`.trim();

  const contactLine = [churchSettings?.address, churchSettings?.phone, churchSettings?.email]
    .filter(Boolean)
    .join('  ·  ');

  doc.y = drawMasthead(doc, {
    churchName: tenant?.name,
    documentTitle: t.receipt,
    subtitle: contactLine,
    metaLines: [`${t.receiptNumber}: ${receipt?.receipt_number ?? ''}`, contribution?.contribution_date],
  });

  // --- Who gave, and what for ---
  drawSectionHeading(doc, t.receivedFrom);
  drawFieldRows(doc, [
    [t.receivedFrom, contributor?.full_name ?? t.anonymous],
    [t.date, contribution?.contribution_date],
    [t.receiptNumber, receipt?.receipt_number],
    [t.transactionNumber, transaction?.transaction_number],
  ]);
  doc.y += 8;

  // --- Where it was posted ---
  drawSectionHeading(doc, t.fund);
  drawFieldRows(doc, [
    [t.fund, fund?.name],
    [t.category, category?.name],
    [t.account, account?.name],
    [t.paymentMethod, contribution?.payment_method],
    [t.reference, contribution?.reference ?? undefined],
    [t.description, contribution?.notes ?? undefined],
    [t.recordedBy, issuedBy?.full_name],
  ]);
  doc.y += 8;

  // Optional itemized breakdown (contribution_items, migration 0028) — the
  // client's own sample receipt ("Sadaka ya Kambi = 5,000 / Ujenzi wa
  // Kambi = 5,000") is exactly this layout. Omitted entirely when the
  // contribution has no items, so a plain contribution's receipt is just
  // the total.
  if (items && items.length > 0) {
    drawSectionHeading(doc, t.breakdown ?? 'Breakdown');
    drawTable(doc, {
      columns: [
        { key: 'purpose', header: t.description, width: 3 },
        { key: 'amount', header: t.amount, width: 2, align: 'right' },
      ],
      rows: items.map((item) => ({ purpose: item.purpose, amount: money(item.amount) })),
    });
  }

  drawGrandTotal(doc, t.amount, money(contribution?.amount));

  doc.y += 10;
  doc.font('Helvetica-Oblique').fontSize(10).fillColor(PALETTE.muted);
  doc.text(t.thankYou, doc.page.margins.left, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: 'center',
  });
  doc.fillColor(PALETTE.ink);

  drawFooter(doc, `${t.generatedOn}: ${new Date().toISOString().slice(0, 10)}`);
  doc.end();
}
