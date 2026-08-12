import * as receiptsService from './receipts.service.js';
import { renderReceiptPdf } from './receiptPdf.js';

export async function get(req, res, next) {
  try {
    const receipt = await receiptsService.getReceipt(req.tenantId, req.params.id);
    res.json({ success: true, data: receipt });
  } catch (err) {
    next(err);
  }
}

export async function getForContribution(req, res, next) {
  try {
    const receipt = await receiptsService.getReceiptForContribution(req.tenantId, req.params.contributionId);
    res.json({ success: true, data: receipt });
  } catch (err) {
    next(err);
  }
}

export async function downloadPdf(req, res, next) {
  try {
    const canViewContributors = req.permissions?.includes('contributors.view') ?? false;
    const data = await receiptsService.getReceiptRenderData(req.tenantId, req.params.id, { canViewContributors });
    const locale = req.query.locale === 'sw' ? 'sw' : data.tenant.locale_default === 'sw' ? 'sw' : 'en';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.receipt.receipt_number}.pdf"`);
    renderReceiptPdf(data, res, locale);
  } catch (err) {
    next(err);
  }
}
