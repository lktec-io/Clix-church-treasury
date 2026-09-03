import { memberApiClient } from './memberClient.js';
// Shared with the staff client so both portals save files identically —
// a member on a phone gets a real download, not a new tab, exactly like a
// treasurer on a desktop.
import { triggerDownload, filenameFromResponse } from './endpoints.js';

const unwrap = (res) => res.data.data;

export const memberAuthApi = {
  login: (body) => memberApiClient.post('/member/auth/login', body).then(unwrap),
  logout: () => memberApiClient.post('/member/auth/logout').then(unwrap),
  changePin: (body) => memberApiClient.post('/member/auth/change-pin', body).then(unwrap),
};

export const memberApi = {
  listContributions: (params) => memberApiClient.get('/member/contributions', { params }).then(unwrap),
  statement: (year, month) => memberApiClient.get('/member/statement', { params: { year, month } }).then(unwrap),
  yearTotal: (year) => memberApiClient.get('/member/year-total', { params: { year } }).then(unwrap),
  async openStatementPdf(year, month, locale) {
    const res = await memberApiClient.get('/member/statement/pdf', {
      params: { year, month, ...(locale ? { locale } : {}) },
      responseType: 'blob',
    });
    triggerDownload(res.data, filenameFromResponse(res, `statement-${year}-${month}.pdf`));
  },
  async openReceiptPdf(receiptId, locale) {
    const res = await memberApiClient.get(`/member/receipts/${receiptId}/pdf`, {
      params: locale ? { locale } : {},
      responseType: 'blob',
    });
    triggerDownload(res.data, filenameFromResponse(res, `receipt-${receiptId}.pdf`));
  },
};
