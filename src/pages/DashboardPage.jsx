import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { reportsApi, financialPeriodsApi, expensesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

// Every figure here is read from the existing Financial Engine / Phase 9
// report services — nothing on this page runs its own SQL or does its own
// arithmetic over raw rows (docs/FINANCIAL_ARCHITECTURE.md §6: "reporting
// must not recompute"). The period selector only changes which dateFrom/
// dateTo is sent to the Income/Expense reports; it is calendar math
// (computing "the 1st of this month"), never financial math.
const RANGE_OPTIONS = ['month', 'quarter', 'year', 'custom'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function computeRange(kind, customFrom, customTo) {
  const now = new Date();
  if (kind === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: todayIso() };
  }
  if (kind === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const from = new Date(now.getFullYear(), quarterStartMonth, 1);
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: todayIso() };
  }
  if (kind === 'year') {
    const from = new Date(now.getFullYear(), 0, 1);
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: todayIso() };
  }
  return { dateFrom: customFrom, dateTo: customTo };
}

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const { t } = useLocale();
  const [openPeriod, setOpenPeriod] = useState(undefined); // undefined = loading, null = none exists
  const [range, setRange] = useState('month');
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [summary, setSummary] = useState(null);
  const [incomeTotal, setIncomeTotal] = useState(null);
  const [expenseTotal, setExpenseTotal] = useState(null);
  const [pledgeTotals, setPledgeTotals] = useState(null);
  const [budgetTotals, setBudgetTotals] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [pendingCount, setPendingCount] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const { dateFrom, dateTo } = useMemo(() => computeRange(range, customFrom, customTo), [range, customFrom, customTo]);

  const loadPeriodScoped = useCallback(async (periodId) => {
    const requests = [];
    if (hasPermission('reports.view')) {
      requests.push(
        reportsApi.run('financialSummary', { financialPeriodId: periodId }).then(setSummary).catch(() => setSummary(null))
      );
    }
    if (hasPermission('budget.view')) {
      requests.push(
        reportsApi
          .run('budgetVsActual', { financialPeriodId: periodId })
          .then((data) => setBudgetTotals(data.totals))
          .catch(() => setBudgetTotals(null))
      );
    }
    await Promise.all(requests);
  }, [hasPermission]);

  const loadRangeScoped = useCallback(async () => {
    const requests = [];
    if (hasPermission('income.view')) {
      requests.push(
        reportsApi.run('income', { dateFrom, dateTo }).then((data) => setIncomeTotal(data.totals.amount)).catch(() => setIncomeTotal(null))
      );
    }
    if (hasPermission('expense.view')) {
      requests.push(
        reportsApi.run('expense', { dateFrom, dateTo }).then((data) => setExpenseTotal(data.totals.amount)).catch(() => setExpenseTotal(null))
      );
    }
    await Promise.all(requests);
  }, [hasPermission, dateFrom, dateTo]);

  const loadStatic = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const periods = await financialPeriodsApi.list();
      const current = periods.find((p) => p.status === 'open') ?? null;
      setOpenPeriod(current);

      const requests = [];
      if (hasPermission('pledges.view')) {
        requests.push(
          reportsApi.run('pledges', { status: 'active' }).then((data) => setPledgeTotals({ ...data.totals, count: data.rows.length })).catch(() => setPledgeTotals(null))
        );
      }
      if (hasPermission('reports.view')) {
        requests.push(
          reportsApi.run('transactionJournal', {}).then((data) => setRecentTransactions(data.rows.slice(0, 8))).catch(() => setRecentTransactions([]))
        );
      }
      if (hasPermission('expense.approve')) {
        requests.push(
          expensesApi.list({ status: 'submitted' }).then((rows) => setPendingCount(rows.length)).catch(() => setPendingCount(null))
        );
      }
      if (current) {
        requests.push(loadPeriodScoped(current.id));
      }
      await Promise.all(requests);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [hasPermission, loadPeriodScoped]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    if (openPeriod === undefined) return;
    loadRangeScoped();
  }, [openPeriod, loadRangeScoped]);

  if (loading) {
    return (
      <div>
        <h1>{t('dashboard.title')}</h1>
        <div className="card">
          <div className="empty-state">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      {openPeriod === null ? (
        <div className="card">
          <div className="empty-state">
            <p>{t('dashboard.noOpenPeriod')}</p>
            <PermissionGate permission="financial_period.manage">
              <Link to="/financial-periods" className="btn btn--primary" style={{ marginTop: 12 }}>
                {t('financialPeriods.new')}
              </Link>
            </PermissionGate>
          </div>
        </div>
      ) : (
        <>
          <PermissionGate permission="reports.view">
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.totalBalance')}</div>
                <div className="stat-tile__value">{summary ? formatMoney(summary.closingBalance) : '—'}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.transfers')}</div>
                <div className="stat-tile__value">{summary ? formatMoney(summary.transferVolume) : '—'}</div>
              </div>
            </div>
          </PermissionGate>

          <div className="card">
            <div className="card__header">
              <h2>{t('dashboard.periodFilter')}</h2>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>{t('dashboard.periodFilter')}</label>
                <select value={range} onChange={(e) => setRange(e.target.value)}>
                  {RANGE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{t(`dashboard.period.${opt}`)}</option>
                  ))}
                </select>
              </div>
              {range === 'custom' && (
                <>
                  <div className="field">
                    <label>{t('reports.dateFrom')}</label>
                    <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                  </div>
                  <div className="field">
                    <label>{t('reports.dateTo')}</label>
                    <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="stat-grid">
            <PermissionGate permission="income.view">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.income')}</div>
                <div className="stat-tile__value is-positive">{incomeTotal !== null ? formatMoney(incomeTotal) : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="expense.view">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.expenses')}</div>
                <div className="stat-tile__value is-negative">{expenseTotal !== null ? formatMoney(expenseTotal) : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="pledges.view">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.activePledges')}</div>
                <div className="stat-tile__value">{pledgeTotals ? pledgeTotals.count : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="pledges.view">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.outstandingPledges')}</div>
                <div className="stat-tile__value">{pledgeTotals ? formatMoney(pledgeTotals.remaining_amount) : '—'}</div>
              </div>
            </PermissionGate>
          </div>

          <PermissionGate permission="expense.approve">
            <div className="stat-grid">
              <div className="stat-tile">
                <div className="stat-tile__label">{t('dashboard.pendingApprovals')}</div>
                <div className="stat-tile__value">{pendingCount ?? '—'}</div>
              </div>
            </div>
          </PermissionGate>

          <PermissionGate permission="budget.view">
            <div className="card">
              <div className="card__header">
                <h2>{t('dashboard.budgetVsActual')}</h2>
                <Link to="/budgets" className="btn btn--secondary btn--sm">{t('dashboard.viewAll')}</Link>
              </div>
              {budgetTotals ? (
                <div className="stat-grid">
                  <div className="stat-tile">
                    <div className="stat-tile__label">{t('budgets.budgetAmount')}</div>
                    <div className="stat-tile__value">{formatMoney(budgetTotals.budget_amount)}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-tile__label">{t('budgets.actual')}</div>
                    <div className="stat-tile__value">{formatMoney(budgetTotals.actual_amount)}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-tile__label">{t('budgets.variance')}</div>
                    <div className={`stat-tile__value ${Number(budgetTotals.variance) < 0 ? 'is-negative' : 'is-positive'}`}>
                      {formatMoney(budgetTotals.variance)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">{t('common.noResults')}</div>
              )}
            </div>
          </PermissionGate>

          <PermissionGate permission="reports.view">
            <div className="card">
              <div className="card__header">
                <h2>{t('dashboard.recentTransactions')}</h2>
                <Link to="/reports" className="btn btn--secondary btn--sm">{t('dashboard.viewAll')}</Link>
              </div>
              {recentTransactions.length === 0 ? (
                <div className="empty-state">{t('common.noResults')}</div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('common.reference')}</th>
                        <th>{t('common.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{formatDate(tx.posted_at)}</td>
                          <td>{tx.transaction_number}</td>
                          <td style={{ fontWeight: 600, color: tx.direction === 'in' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {formatMoney(tx.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </PermissionGate>
        </>
      )}

      <div className="card">
        <h2>{session?.user?.full_name}</h2>
        <p style={{ color: 'var(--text-muted)' }}>{session?.roles?.join(', ')}</p>
      </div>
    </div>
  );
}
