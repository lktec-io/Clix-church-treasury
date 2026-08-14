import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiCalendar,
  FiArrowUpRight,
  FiArrowDownRight,
  FiTarget,
  FiClock,
  FiPlus,
  FiUserPlus,
  FiFileText,
  FiBarChart2,
  FiSend,
} from 'react-icons/fi';
import { reportsApi, financialPeriodsApi, expensesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonCard, SkeletonStatGrid } from '../components/ui/Skeleton.jsx';
import { formatMoney, formatCurrency, formatDate } from '../utils/format.js';

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

const cardEntrance = {
  initial: { opacity: 0, y: 10 },
  animate: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.28, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] } }),
};

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const { t, locale } = useLocale();
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

  const todayLabel = new Date().toLocaleDateString(locale === 'sw' ? 'sw-TZ' : undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const firstName = session?.user?.full_name?.split(' ')[0];

  const quickActions = [
    { to: '/contributions', icon: FiPlus, labelKey: 'dashboard.quickActions.recordContribution', permission: 'income.create', primary: true },
    { to: '/contributors', icon: FiUserPlus, labelKey: 'dashboard.quickActions.addContributor', permission: 'contributors.manage' },
    { to: '/expenses', icon: FiFileText, labelKey: 'dashboard.quickActions.addExpense', permission: 'expense.create' },
    { to: '/member-statements', icon: FiSend, labelKey: 'dashboard.quickActions.generateStatement', permission: 'contributors.view' },
    { to: '/reports', icon: FiBarChart2, labelKey: 'dashboard.quickActions.viewReports', permission: 'reports.view' },
  ].filter((a) => hasPermission(a.permission));

  if (loading) {
    return (
      <div>
        <PageHeader title={t('dashboard.title')} />
        <SkeletonStatGrid />
        <SkeletonCard lines={4} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={todayLabel}
        title={firstName ? t('dashboard.greeting', { name: firstName }) : t('dashboard.title')}
        subtitle={t('dashboard.summarySubtitle')}
      />
      {error && <div className="alert alert--error">{error}</div>}

      {openPeriod === null ? (
        <div className="card">
          <EmptyState
            icon={FiCalendar}
            title={t('dashboard.noOpenPeriod')}
            action={
              <PermissionGate permission="financial_period.manage">
                <Link to="/financial-periods" className="btn btn--primary" style={{ marginTop: 4 }}>
                  {t('financialPeriods.new')}
                </Link>
              </PermissionGate>
            }
          />
        </div>
      ) : (
        <>
          <PermissionGate permission="reports.view">
            <motion.div className="hero-card" custom={0} variants={cardEntrance} initial="initial" animate="animate">
              <div className="hero-card__label">{t('dashboard.totalBalance')}</div>
              <div className="hero-card__value tabular-nums">{summary ? formatCurrency(summary.closingBalance) : '—'}</div>
              <div className="hero-card__meta">{t(`dashboard.period.${range}`)}</div>
              <div className="hero-card__breakdown">
                <div className="hero-card__breakdown-item">
                  <span className="hero-card__breakdown-label">{t('dashboard.income')}</span>
                  <span className="hero-card__breakdown-value tabular-nums">{incomeTotal !== null ? formatMoney(incomeTotal) : '—'}</span>
                </div>
                <div className="hero-card__breakdown-item">
                  <span className="hero-card__breakdown-label">{t('dashboard.expenses')}</span>
                  <span className="hero-card__breakdown-value tabular-nums">{expenseTotal !== null ? formatMoney(expenseTotal) : '—'}</span>
                </div>
                <div className="hero-card__breakdown-item">
                  <span className="hero-card__breakdown-label">{t('dashboard.transfers')}</span>
                  <span className="hero-card__breakdown-value tabular-nums">{summary ? formatMoney(summary.transferVolume) : '—'}</span>
                </div>
              </div>
            </motion.div>
          </PermissionGate>

          {quickActions.length > 0 && (
            <motion.div className="quick-actions" custom={1} variants={cardEntrance} initial="initial" animate="animate">
              {quickActions.map((action, i) => (
                <Link
                  key={action.to}
                  to={action.to}
                  className={`quick-action${i === 0 ? ' quick-action--primary' : ''}`}
                >
                  <span className="quick-action__icon">
                    <action.icon aria-hidden="true" />
                  </span>
                  <span className="quick-action__label">{t(action.labelKey)}</span>
                </Link>
              ))}
            </motion.div>
          )}

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

          <motion.div className="stat-grid" custom={2} variants={cardEntrance} initial="initial" animate="animate">
            <PermissionGate permission="income.view">
              <div className="stat-tile">
                <span className="stat-tile__icon"><FiArrowUpRight aria-hidden="true" /></span>
                <div className="stat-tile__label">{t('dashboard.income')}</div>
                <div className="stat-tile__value is-positive tabular-nums">{incomeTotal !== null ? formatMoney(incomeTotal) : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="expense.view">
              <div className="stat-tile">
                <span className="stat-tile__icon"><FiArrowDownRight aria-hidden="true" /></span>
                <div className="stat-tile__label">{t('dashboard.expenses')}</div>
                <div className="stat-tile__value is-negative tabular-nums">{expenseTotal !== null ? formatMoney(expenseTotal) : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="pledges.view">
              <div className="stat-tile">
                <span className="stat-tile__icon"><FiTarget aria-hidden="true" /></span>
                <div className="stat-tile__label">{t('dashboard.activePledges')}</div>
                <div className="stat-tile__value">{pledgeTotals ? pledgeTotals.count : '—'}</div>
              </div>
            </PermissionGate>
            <PermissionGate permission="pledges.view">
              <div className="stat-tile">
                <span className="stat-tile__icon"><FiTarget aria-hidden="true" /></span>
                <div className="stat-tile__label">{t('dashboard.outstandingPledges')}</div>
                <div className="stat-tile__value tabular-nums">{pledgeTotals ? formatMoney(pledgeTotals.remaining_amount) : '—'}</div>
              </div>
            </PermissionGate>
          </motion.div>

          <PermissionGate permission="expense.approve">
            <div className="stat-grid">
              <div className="stat-tile">
                <span className="stat-tile__icon"><FiClock aria-hidden="true" /></span>
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
                    <div className="stat-tile__value tabular-nums">{formatMoney(budgetTotals.budget_amount)}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-tile__label">{t('budgets.actual')}</div>
                    <div className="stat-tile__value tabular-nums">{formatMoney(budgetTotals.actual_amount)}</div>
                  </div>
                  <div className="stat-tile">
                    <div className="stat-tile__label">{t('budgets.variance')}</div>
                    <div className={`stat-tile__value tabular-nums ${Number(budgetTotals.variance) < 0 ? 'is-negative' : 'is-positive'}`}>
                      {formatMoney(budgetTotals.variance)}
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState icon={FiBarChart2} message={t('common.noResults')} />
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
                <EmptyState icon={FiClock} message={t('common.noResults')} />
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t('common.date')}</th>
                        <th>{t('common.reference')}</th>
                        <th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTransactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{formatDate(tx.posted_at)}</td>
                          <td>{tx.transaction_number}</td>
                          <td className="is-amount" style={{ color: tx.direction === 'in' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {tx.direction === 'in' ? '+' : '−'} {formatMoney(tx.amount)}
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
    </div>
  );
}
