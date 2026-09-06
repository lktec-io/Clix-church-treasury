import { apiClient } from './client.js';

const unwrap = (res) => res.data.data;

// Pulls the server's own filename out of Content-Disposition so a saved file
// is named "statement-M0042-2026-9.pdf" rather than a random blob id. Falls
// back to the caller's suggestion when the header is absent or unparseable
// (a CORS setup that doesn't expose the header, for instance).
export function filenameFromResponse(res, fallback) {
  const header = res?.headers?.['content-disposition'];
  if (typeof header !== 'string') return fallback;
  // Handles both filename="x.pdf" and RFC 5987 filename*=UTF-8''x.pdf
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  if (!match) return fallback;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

// Saves a blob to disk WITHOUT leaving the current page.
//
// These routes are authenticated, so a plain <a href> can't be used — it
// carries no Bearer token. The file is fetched through the API client as a
// blob and handed to a synthetic download link. Previously PDFs called
// window.open() on the object URL, which popped a new tab (and was silently
// swallowed by popup blockers); only CSV/XLSX took the download path. All
// formats now behave identically.
//
// The link is appended to the DOM before clicking: a detached <a> is a
// no-op in Firefox, so a download would simply never start there.
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay rather than immediately — some browsers read the URL
  // asynchronously after the click, and revoking too early aborts the save.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// No registerTenant — there is no public tenant-registration endpoint
// (see server/src/modules/auth/auth.routes.js's own comment). Every
// tenant is created by a Platform Administrator via platformApi.createTenant.
export const authApi = {
  login: (body) => apiClient.post('/auth/login', body).then(unwrap),
  // Platform-admin sign-in: email + password only — the server resolves
  // the internal platform tenant itself and rejects anyone without
  // platform.manage before a session is ever issued.
  platformLogin: (body) => apiClient.post('/auth/platform-login', body).then(unwrap),
  logout: () => apiClient.post('/auth/logout').then(unwrap),
};

export const platformApi = {
  listTenants: () => apiClient.get('/platform/tenants').then(unwrap),
  getTenant: (id) => apiClient.get(`/platform/tenants/${id}`).then(unwrap),
  createTenant: (body) => apiClient.post('/platform/tenants', body).then(unwrap),
  updateTenant: (id, body) => apiClient.patch(`/platform/tenants/${id}`, body).then(unwrap),
  setTenantStatus: (id, status) => apiClient.patch(`/platform/tenants/${id}/status`, { status }).then(unwrap),
  updateTenantAdmin: (id, body) => apiClient.patch(`/platform/tenants/${id}/admin`, body).then(unwrap),
  resetTenantAdminPassword: (id, body) => apiClient.post(`/platform/tenants/${id}/admin/reset-password`, body).then(unwrap),
  // DELETE carries a body ({ confirmationSlug }), which axios needs passed
  // as `data` rather than as a second positional argument the way post/patch
  // take it. The server re-checks the slug itself — this is not a
  // client-side-only confirmation.
  deleteTenant: (id, confirmationSlug) =>
    apiClient.delete(`/platform/tenants/${id}`, { data: { confirmationSlug } }).then(unwrap),
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
    triggerDownload(res.data, filenameFromResponse(res, `statement-${year}-${month}.pdf`));
  },

  // Same blob → triggerDownload path every other file download here uses,
  // so the template arrives through the authenticated axios client rather
  // than a bare <a href> that would miss the Authorization header.
  async downloadImportTemplate() {
    const res = await apiClient.get('/contributors/bulk-import/template', { responseType: 'blob' });
    triggerDownload(res.data, filenameFromResponse(res, 'contributors-import-template.xlsx'));
  },

  // The file is sent base64-encoded inside the ordinary JSON body rather
  // than as multipart/form-data — the server has no multipart parser, and
  // adding one for the single upload in this product was not worth a second
  // body-parsing path. FileReader gives us the data: URL; everything after
  // the comma is the payload.
  bulkImport: (fileName, contentBase64) =>
    apiClient.post('/contributors/bulk-import', { fileName, contentBase64 }).then(unwrap),
};

export const contributionsApi = {
  list: (params) => apiClient.get('/contributions', { params }).then(unwrap),
  create: (body) => apiClient.post('/contributions', body).then(unwrap),
  reverse: (id, reason) => apiClient.post(`/contributions/${id}/reverse`, { reason }).then(unwrap),
  resendSms: (id) => apiClient.post(`/contributions/${id}/resend-sms`).then(unwrap),
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
  // Fetched through the normal API client (Bearer header attached
  // automatically) as a blob, then saved via triggerDownload — never
  // window.open, which cost the user their place on the dashboard.
  async openPdf(receiptId, locale) {
    const res = await apiClient.get(`/receipts/${receiptId}/pdf`, {
      params: locale ? { locale } : {},
      responseType: 'blob',
    });
    triggerDownload(res.data, filenameFromResponse(res, `receipt-${receiptId}.pdf`));
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
  monthlyTrends: () => '/reports/monthly-trends',
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
    // One path for every format now — pdf used to branch into window.open.
    triggerDownload(res.data, filenameFromResponse(res, `${reportKey}.${format}`));
  },
};
