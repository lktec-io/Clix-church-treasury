import { memberApiClient } from './memberClient.js';

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
    const url = URL.createObjectURL(res.data);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  async openReceiptPdf(receiptId, locale) {
    const res = await memberApiClient.get(`/member/receipts/${receiptId}/pdf`, {
      params: locale ? { locale } : {},
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
