import { apiClient } from './client.js';

const unwrap = (res) => res.data.data;

export const authApi = {
  login: (body) => apiClient.post('/auth/login', body).then(unwrap),
  logout: () => apiClient.post('/auth/logout').then(unwrap),
  registerTenant: (body) => apiClient.post('/auth/register-tenant', body).then(unwrap),
};

export const accountsApi = {
  list: () => apiClient.get('/accounts').then(unwrap),
  create: (body) => apiClient.post('/accounts', body).then(unwrap),
  rename: (id, name) => apiClient.patch(`/accounts/${id}`, { name }).then(unwrap),
  deactivate: (id) => apiClient.post(`/accounts/${id}/deactivate`).then(unwrap),
  activate: (id) => apiClient.post(`/accounts/${id}/activate`).then(unwrap),
};

export const fundsApi = {
  list: () => apiClient.get('/funds').then(unwrap),
  create: (body) => apiClient.post('/funds', body).then(unwrap),
  rename: (id, name) => apiClient.patch(`/funds/${id}`, { name }).then(unwrap),
  deactivate: (id) => apiClient.post(`/funds/${id}/deactivate`).then(unwrap),
  activate: (id) => apiClient.post(`/funds/${id}/activate`).then(unwrap),
};

export const categoriesApi = {
  list: (type) => apiClient.get('/categories', { params: type ? { type } : {} }).then(unwrap),
  create: (body) => apiClient.post('/categories', body).then(unwrap),
};

export const contributorsApi = {
  list: () => apiClient.get('/contributors').then(unwrap),
  create: (body) => apiClient.post('/contributors', body).then(unwrap),
};

export const contributionsApi = {
  list: (params) => apiClient.get('/contributions', { params }).then(unwrap),
  create: (body) => apiClient.post('/contributions', body).then(unwrap),
  reverse: (id, reason) => apiClient.post(`/contributions/${id}/reverse`, { reason }).then(unwrap),
};

export const expensesApi = {
  list: (params) => apiClient.get('/expenses', { params }).then(unwrap),
  get: (id) => apiClient.get(`/expenses/${id}`).then(unwrap),
  create: (body) => apiClient.post('/expenses', body).then(unwrap),
  update: (id, body) => apiClient.patch(`/expenses/${id}`, body).then(unwrap),
  submit: (id) => apiClient.post(`/expenses/${id}/submit`).then(unwrap),
  approve: (id) => apiClient.post(`/expenses/${id}/approve`).then(unwrap),
  reject: (id, reason) => apiClient.post(`/expenses/${id}/reject`, { reason }).then(unwrap),
  returnForCorrection: (id, reason) => apiClient.post(`/expenses/${id}/return`, { reason }).then(unwrap),
  pay: (id) => apiClient.post(`/expenses/${id}/pay`).then(unwrap),
};

export const transfersApi = {
  list: () => apiClient.get('/transfers').then(unwrap),
  create: (body) => apiClient.post('/transfers', body).then(unwrap),
};

export const pledgesApi = {
  list: (params) => apiClient.get('/pledges', { params }).then(unwrap),
  create: (body) => apiClient.post('/pledges', body).then(unwrap),
  setStatus: (id, status) => apiClient.post(`/pledges/${id}/status`, { status }).then(unwrap),
};

export const receiptsApi = {
  // A plain <a href> can't carry the Bearer token, and this route is
  // authenticated like every other — so the PDF is fetched through the
  // normal API client (auth header attached automatically) as a blob, then
  // opened via a local object URL.
  async openPdf(receiptId, locale) {
    const res = await apiClient.get(`/receipts/${receiptId}/pdf`, {
      params: locale ? { locale } : {},
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  async openPdfForContribution(contributionId, locale) {
    const receipt = await apiClient.get(`/receipts/by-contribution/${contributionId}`).then(unwrap);
    return receiptsApi.openPdf(receipt.id, locale);
  },
};

export const budgetsApi = {
  list: (params) => apiClient.get('/budgets', { params }).then(unwrap),
  create: (body) => apiClient.post('/budgets', body).then(unwrap),
  archive: (id) => apiClient.post(`/budgets/${id}/archive`).then(unwrap),
};

export const financialPeriodsApi = {
  list: () => apiClient.get('/financial-periods').then(unwrap),
  create: (body) => apiClient.post('/financial-periods', body).then(unwrap),
  summary: (id) => apiClient.get(`/financial-periods/${id}/summary`).then(unwrap),
  checklist: (id) => apiClient.get(`/financial-periods/${id}/checklist`).then(unwrap),
  close: (id) => apiClient.post(`/financial-periods/${id}/close`).then(unwrap),
  reopen: (id, reason) => apiClient.post(`/financial-periods/${id}/reopen`, { reason }).then(unwrap),
};
