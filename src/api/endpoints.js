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
  update: (id, body) => apiClient.patch(`/categories/${id}`, body).then(unwrap),
};

export const contributorsApi = {
  list: () => apiClient.get('/contributors').then(unwrap),
  create: (body) => apiClient.post('/contributors', body).then(unwrap),
  enablePortalAccess: (id) => apiClient.post(`/contributors/${id}/portal-access`).then(unwrap),
  resetPin: (id) => apiClient.post(`/contributors/${id}/portal-access/reset-pin`).then(unwrap),
  statement: (id, year, month) =>
    apiClient.get(`/contributors/${id}/statement`, { params: { year, month } }).then(unwrap),
  sendStatementSms: (id, year, month) =>
    apiClient.post(`/contributors/${id}/statement/send-sms`, { year, month }).then(unwrap),
  async openStatementPdf(id, year, month, locale) {
    const res = await apiClient.get(`/contributors/${id}/statement/pdf`, {
      params: { year, month, ...(locale ? { locale } : {}) },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
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

export const usersApi = {
  list: () => apiClient.get('/users').then(unwrap),
  invite: (body) => apiClient.post('/users', body).then(unwrap),
  assignRole: (userId, roleId) => apiClient.post(`/users/${userId}/roles`, { roleId }).then(unwrap),
  removeRole: (userId, roleId) => apiClient.delete(`/users/${userId}/roles/${roleId}`).then(unwrap),
  disable: (userId) => apiClient.post(`/users/${userId}/disable`).then(unwrap),
};

export const rolesApi = {
  list: () => apiClient.get('/roles').then(unwrap),
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

// One path builder per report, keyed the same way ReportsPage.jsx keys its
// REPORT_DEFS — account/fund statements carry their id in the URL path, not
// the query string, everything else is a flat query string of filters.
const REPORT_PATHS = {
  income: () => '/reports/income',
  expense: () => '/reports/expense',
  transactionJournal: () => '/reports/transaction-journal',
  contributions: () => '/reports/contributions',
  accountStatement: (params) => `/reports/accounts/${params.accountId}/statement`,
  fundStatement: (params) => `/reports/funds/${params.fundId}/statement`,
  budgetVsActual: () => '/reports/budget-vs-actual',
  pledges: () => '/reports/pledges',
  financialSummary: () => '/reports/financial-summary',
};

export const reportsApi = {
  run: (reportKey, params = {}) => apiClient.get(REPORT_PATHS[reportKey](params), { params }).then(unwrap),
  // Exports go through the same endpoint as the on-screen run, just with a
  // ?format=csv|xlsx|pdf query param — one export path, not a bespoke
  // download route per report (docs/MASTER_TODO.md Phase 9).
  async export(reportKey, params, format) {
    const res = await apiClient.get(REPORT_PATHS[reportKey](params), {
      params: { ...params, format },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(res.data);
    if (format === 'pdf') {
      window.open(url, '_blank', 'noopener');
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportKey}.${format}`;
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
