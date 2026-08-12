import { useCallback, useEffect, useMemo, useState } from 'react';
import { reportsApi, accountsApi, fundsApi, categoriesApi, financialPeriodsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];

// Each report declares only the filters it actually uses (docs/MASTER_TODO.md
// Phase 9: "only show filters relevant to each report") and the permission
// that gates it server-side — reports.routes.js enforces the same
// permission, this list only controls what's offered in the picker.
const REPORT_DEFS = [
  { key: 'income', labelKey: 'reports.income', permission: 'income.view', dateRange: true, account: true, fund: true, category: 'income' },
  { key: 'expense', labelKey: 'reports.expense', permission: 'expense.view', dateRange: true, account: true, fund: true, category: 'expense' },
  { key: 'transactionJournal', labelKey: 'reports.transactionJournal', permission: 'reports.view', dateRange: true, account: true, fund: true, status: true },
  { key: 'contributions', labelKey: 'reports.contributions', permission: 'income.view', dateRange: true, fund: true, paymentMethod: true },
  { key: 'accountStatement', labelKey: 'reports.accountStatement', permission: 'accounts.view', dateRange: true, account: 'required' },
  { key: 'fundStatement', labelKey: 'reports.fundStatement', permission: 'funds.view', dateRange: true, fund: 'required' },
  { key: 'budgetVsActual', labelKey: 'reports.budgetVsActual', permission: 'budget.view', financialPeriod: 'required' },
  { key: 'pledges', labelKey: 'reports.pledgeReport', permission: 'pledges.view', fund: true, pledgeStatus: true },
  { key: 'financialSummary', labelKey: 'reports.financialSummary', permission: 'reports.view', financialPeriod: 'required' },
];

const TRANSACTION_COLUMNS = [
  { key: 'posted_at', labelKey: 'common.date', render: (r) => formatDate(r.posted_at) },
  { key: 'transaction_number', labelKey: 'common.reference' },
  { key: 'description', labelKey: 'expenses.description' },
  { key: 'payment_method', labelKey: 'contributions.paymentMethod', render: (r, t) => t(`paymentMethod.${r.payment_method}`) },
  { key: 'amount', labelKey: 'common.amount', render: (r) => formatMoney(r.amount), align: 'right' },
];

const CONTRIBUTION_COLUMNS = [
  { key: 'contribution_date', labelKey: 'common.date', render: (r) => formatDate(r.contribution_date) },
  { key: 'contributor', labelKey: 'contributions.contributor', render: (r) => r.contributor?.full_name ?? '—' },
  { key: 'amount', labelKey: 'common.amount', render: (r) => formatMoney(r.amount), align: 'right' },
  { key: 'payment_method', labelKey: 'contributions.paymentMethod', render: (r, t) => t(`paymentMethod.${r.payment_method}`) },
  { key: 'status', labelKey: 'common.status' },
];

const PLEDGE_COLUMNS = [
  { key: 'pledge_number', labelKey: 'common.reference' },
  { key: 'contributor', labelKey: 'pledges.contributor', render: (r) => r.contributor?.full_name ?? '—' },
  { key: 'pledged_amount', labelKey: 'pledges.pledgedAmount', render: (r) => formatMoney(r.pledged_amount), align: 'right' },
  { key: 'fulfilled_amount', labelKey: 'pledges.fulfilled', render: (r) => formatMoney(r.fulfilled_amount), align: 'right' },
  { key: 'remaining_amount', labelKey: 'pledges.remaining', render: (r) => formatMoney(r.remaining_amount), align: 'right' },
  { key: 'status', labelKey: 'common.status', render: (r, t) => t(`pledges.status.${r.status}`) },
];

function buildBudgetColumns(funds, categories, t) {
  return [
    { key: 'fund', labelKey: 'budgets.fund', render: (r) => funds.find((f) => f.id === r.fund_id)?.name ?? '—' },
    { key: 'category', labelKey: 'budgets.category', render: (r) => categories.find((c) => c.id === r.category_id)?.name ?? '—' },
    { key: 'type', labelKey: 'budgets.type', render: (r) => (r.type === 'income' ? t('nav.contributions') : t('nav.expenses')) },
    { key: 'budget_amount', labelKey: 'budgets.budgetAmount', render: (r) => formatMoney(r.budget_amount), align: 'right' },
    { key: 'actual_amount', labelKey: 'budgets.actual', render: (r) => formatMoney(r.actual_amount), align: 'right' },
    { key: 'variance', labelKey: 'budgets.variance', render: (r) => formatMoney(r.variance), align: 'right' },
  ];
}

function columnsFor(reportKey, funds, categories, t) {
  switch (reportKey) {
    case 'income':
    case 'expense':
    case 'transactionJournal':
    case 'accountStatement':
    case 'fundStatement':
      return TRANSACTION_COLUMNS;
    case 'contributions':
      return CONTRIBUTION_COLUMNS;
    case 'pledges':
      return PLEDGE_COLUMNS;
    case 'budgetVsActual':
      return buildBudgetColumns(funds, categories, t);
    default:
      return [];
  }
}

function emptyFilters() {
  return { dateFrom: '', dateTo: '', accountId: '', fundId: '', categoryId: '', paymentMethod: '', status: '', financialPeriodId: '' };
}

function buildParams(def, filters) {
  const p = {};
  if (def.dateRange) {
    if (filters.dateFrom) p.dateFrom = filters.dateFrom;
    if (filters.dateTo) p.dateTo = filters.dateTo;
  }
  if (def.account && filters.accountId) p.accountId = Number(filters.accountId);
  if (def.fund && filters.fundId) p.fundId = Number(filters.fundId);
  if (def.category && filters.categoryId) p.categoryId = Number(filters.categoryId);
  if (def.paymentMethod && filters.paymentMethod) p.paymentMethod = filters.paymentMethod;
  if (def.status && filters.status) p.status = filters.status;
  if (def.pledgeStatus && filters.status) p.status = filters.status;
  if (def.financialPeriod && filters.financialPeriodId) p.financialPeriodId = Number(filters.financialPeriodId);
  return p;
}

export default function ReportsPage() {
  const { t } = useLocale();
  const { hasPermission } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [reportKey, setReportKey] = useState('');
  const [filters, setFilters] = useState(emptyFilters());
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [exportingFormat, setExportingFormat] = useState(null);

  const availableReports = useMemo(() => REPORT_DEFS.filter((r) => hasPermission(r.permission)), [hasPermission]);
  const def = useMemo(() => REPORT_DEFS.find((r) => r.key === reportKey), [reportKey]);

  const loadStatic = useCallback(async () => {
    try {
      const [accountData, fundData, periodData] = await Promise.all([
        accountsApi.list(),
        fundsApi.list(),
        financialPeriodsApi.list(),
      ]);
      setAccounts(accountData);
      setFunds(fundData);
      setPeriods(periodData);
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    if (!availableReports.some((r) => r.key === reportKey) && availableReports.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReportKey(availableReports[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableReports]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    setError(null);
    setFilters(emptyFilters());
    if (def?.category) {
      categoriesApi.list(def.category).then(setCategories).catch((err) => setError(unwrapApiError(err).message));
    } else {
      setCategories([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  const handleFilterChange = (field) => (e) => setFilters((f) => ({ ...f, [field]: e.target.value }));

  const handleRun = async (e) => {
    e.preventDefault();
    if (!def) return;
    setError(null);
    setRunning(true);
    setResult(null);
    try {
      const params = buildParams(def, filters);
      const data = await reportsApi.run(def.key, params);
      setResult(data);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setRunning(false);
    }
  };

  const handleExport = async (format) => {
    if (!def) return;
    setError(null);
    setExportingFormat(format);
    try {
      const params = buildParams(def, filters);
      await reportsApi.export(def.key, params, format);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setExportingFormat(null);
    }
  };

  const columns = def ? columnsFor(def.key, funds, categories, t) : [];
  const canExport = def?.key !== 'financialSummary';

  return (
    <div>
      <h1>{t('reports.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <form onSubmit={handleRun}>
          <div className="form-grid">
            <div className="field">
              <label>{t('reports.selectReport')}</label>
              <select value={reportKey} onChange={(e) => setReportKey(e.target.value)}>
                {availableReports.map((r) => (
                  <option key={r.key} value={r.key}>{t(r.labelKey)}</option>
                ))}
              </select>
            </div>

            {def?.dateRange && (
              <>
                <div className="field">
                  <label>{t('reports.dateFrom')}</label>
                  <input type="date" value={filters.dateFrom} onChange={handleFilterChange('dateFrom')} />
                </div>
                <div className="field">
                  <label>{t('reports.dateTo')}</label>
                  <input type="date" value={filters.dateTo} onChange={handleFilterChange('dateTo')} />
                </div>
              </>
            )}

            {def?.account && (
              <div className="field">
                <label>{t('reports.account')}</label>
                <select value={filters.accountId} onChange={handleFilterChange('accountId')} required={def.account === 'required'}>
                  {def.account !== 'required' && <option value="">{t('reports.allAccounts')}</option>}
                  {def.account === 'required' && <option value="" disabled>—</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}

            {def?.fund && (
              <div className="field">
                <label>{t('budgets.fund')}</label>
                <select value={filters.fundId} onChange={handleFilterChange('fundId')} required={def.fund === 'required'}>
                  {def.fund !== 'required' && <option value="">{t('reports.allFunds')}</option>}
                  {def.fund === 'required' && <option value="" disabled>—</option>}
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}

            {def?.category && (
              <div className="field">
                <label>{t('contributions.category')}</label>
                <select value={filters.categoryId} onChange={handleFilterChange('categoryId')}>
                  <option value="">{t('reports.allCategories')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            {def?.paymentMethod && (
              <div className="field">
                <label>{t('contributions.paymentMethod')}</label>
                <select value={filters.paymentMethod} onChange={handleFilterChange('paymentMethod')}>
                  <option value="">{t('reports.allMethods')}</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{t(`paymentMethod.${m}`)}</option>
                  ))}
                </select>
              </div>
            )}

            {def?.status && (
              <div className="field">
                <label>{t('common.status')}</label>
                <select value={filters.status} onChange={handleFilterChange('status')}>
                  <option value="">{t('reports.allStatuses')}</option>
                  <option value="posted">{t('common.active')}</option>
                  <option value="reversed">{t('contributions.reversed')}</option>
                </select>
              </div>
            )}

            {def?.pledgeStatus && (
              <div className="field">
                <label>{t('common.status')}</label>
                <select value={filters.status} onChange={handleFilterChange('status')}>
                  <option value="">{t('reports.allStatuses')}</option>
                  <option value="active">{t('pledges.status.active')}</option>
                  <option value="completed">{t('pledges.status.completed')}</option>
                  <option value="cancelled">{t('pledges.status.cancelled')}</option>
                </select>
              </div>
            )}

            {def?.financialPeriod && (
              <div className="field">
                <label>{t('budgets.financialPeriod')}</label>
                <select value={filters.financialPeriodId} onChange={handleFilterChange('financialPeriodId')} required>
                  <option value="" disabled>—</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={running || !def}>
              {running ? t('common.loading') : t('reports.run')}
            </button>
            {canExport && (
              <PermissionGate permission="reports.export">
                <button type="button" className="btn btn--secondary" disabled={!!exportingFormat} onClick={() => handleExport('pdf')}>
                  {exportingFormat === 'pdf' ? t('common.loading') : t('reports.exportPdf')}
                </button>
                <button type="button" className="btn btn--secondary" disabled={!!exportingFormat} onClick={() => handleExport('xlsx')}>
                  {exportingFormat === 'xlsx' ? t('common.loading') : t('reports.exportExcel')}
                </button>
                <button type="button" className="btn btn--secondary" disabled={!!exportingFormat} onClick={() => handleExport('csv')}>
                  {exportingFormat === 'csv' ? t('common.loading') : t('reports.exportCsv')}
                </button>
              </PermissionGate>
            )}
          </div>
        </form>
      </div>

      {result && def?.key === 'financialSummary' && (
        <div className="card">
          <div className="card__header">
            <h2>{result.period?.label}</h2>
          </div>
          <div className="form-grid">
            <div><strong>{t('financialPeriods.openingBalance')}:</strong> {formatMoney(result.openingBalance)}</div>
            <div><strong>{t('financialPeriods.totalIncome')}:</strong> {formatMoney(result.totalIncome)}</div>
            <div><strong>{t('financialPeriods.totalExpenses')}:</strong> {formatMoney(result.totalExpenses)}</div>
            <div><strong>{t('reports.transferVolume')}:</strong> {formatMoney(result.transferVolume)}</div>
            <div><strong>{t('reports.netAdjustments')}:</strong> {formatMoney(result.netAdjustments)}</div>
            <div><strong>{t('financialPeriods.closingBalance')}:</strong> {formatMoney(result.closingBalance)}</div>
          </div>

          <h3>{t('reports.fundBalances')}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t('budgets.fund')}</th><th>{t('common.amount')}</th></tr></thead>
              <tbody>
                {result.fundSummaries?.map((f) => (
                  <tr key={f.fundId}><td>{f.name}</td><td>{formatMoney(f.balance)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>{t('reports.accountBalances')}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>{t('reports.account')}</th><th>{t('common.amount')}</th></tr></thead>
              <tbody>
                {result.accountSummaries?.map((a) => (
                  <tr key={a.accountId}><td>{a.name}</td><td>{formatMoney(a.balance)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && def && def.key !== 'financialSummary' && (
        <div className="card">
          {(result.account || result.fund) && (
            <div style={{ marginBottom: 12 }}>
              <strong>{(result.account ?? result.fund).name}</strong>
              {' — '}{t('financialPeriods.openingBalance')}: {formatMoney(result.openingBalance)}
            </div>
          )}
          {result.rows.length === 0 ? (
            <div className="empty-state">{t('common.noResults')}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>{t(c.labelKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={row.id ?? i}>
                      {columns.map((c) => (
                        <td key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                          {c.render ? c.render(row, t) : (row[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {result.totals && (
                  <tfoot>
                    <tr>
                      {columns.map((c, i) => (
                        <td key={c.key} style={{ fontWeight: 600, textAlign: c.align === 'right' ? 'right' : undefined }}>
                          {i === 0 ? t('reports.total') : (result.totals[c.key] !== undefined ? formatMoney(result.totals[c.key]) : '')}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
