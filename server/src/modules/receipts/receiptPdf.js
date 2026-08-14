import PDFDocument from 'pdfkit';
import { formatMoney } from '../financial/moneyFormat.js';
import { receiptLabels } from './receiptLabels.js';

// Pure layout — no data access here, everything comes in as `data`
// (see receipts.service.js#getReceiptRenderData). A4, printable, no
// decorative elements beyond a simple rule under the header
// (docs/MASTER_TODO.md Phase 7: "avoid unnecessarily decorative design").
export function renderReceiptPdf(data, stream, locale = 'en') {
  const t = receiptLabels(locale);
  const { receipt, contribution, transaction, tenant, churchSettings, account, fund, category, issuedBy, contributor, items } = data;

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(stream);

  // Header — church identity.
  doc.fontSize(16).font('Helvetica-Bold').text(tenant.name, { align: 'left' });
  doc.fontSize(9).font('Helvetica').fillColor('#555555');
  if (churchSettings?.address) doc.text(churchSettings.address);
  const contactLine = [churchSettings?.phone, churchSettings?.email].filter(Boolean).join('  ·  ');
  if (contactLine) doc.text(contactLine);
  doc.fillColor('#000000');

  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(1);

  doc.fontSize(18).font('Helvetica-Bold').text(t.receipt.toUpperCase(), { align: 'center' });
  doc.moveDown(1);

  const row = (label, value) => {
    doc.fontSize(10).font('Helvetica-Bold').text(`${label}:`, { continued: true, width: 200 });
    doc.font('Helvetica').text(` ${value ?? '—'}`);
  };

  row(t.receiptNumber, receipt.receipt_number);
  row(t.date, contribution.contribution_date);
  row(t.transactionNumber, transaction?.transaction_number);
  row(t.receivedFrom, contributor?.full_name ?? t.anonymous);
  row(t.amount, `${tenant.base_currency} ${formatMoney(contribution.amount)}`);
  row(t.fund, fund?.name);
  row(t.category, category?.name);
  row(t.paymentMethod, contribution.payment_method);
  row(t.account, account?.name);
  if (contribution.reference) row(t.reference, contribution.reference);
  if (contribution.notes) row(t.description, contribution.notes);
  row(t.recordedBy, issuedBy?.full_name);

  // Optional itemized breakdown (contribution_items, migration 0028) — the
  // client's own sample receipt ("Sadaka ya Kambi = 5,000 / Ujenzi wa
  // Kambi = 5,000") is exactly this layout. Omitted entirely when the
  // contribution has no items, so a plain contribution's receipt is
  // unchanged from before.
  if (items && items.length > 0) {
    doc.moveDown(1);
    doc.fontSize(10).font('Helvetica-Bold').text(t.breakdown ?? 'Breakdown');
    doc.moveDown(0.3);
    for (const item of items) {
      doc.fontSize(10).font('Helvetica').text(`${item.purpose}  =  ${formatMoney(item.amount)}`);
    }
  }

  doc.moveDown(2);
  doc.fontSize(10).font('Helvetica-Oblique').text(t.thankYou, { align: 'center' });

  doc.fontSize(8).font('Helvetica').fillColor('#888888');
  doc.text(`${t.generatedOn}: ${new Date().toISOString().slice(0, 10)}`, 50, 780, { align: 'left' });

  doc.end();
}
