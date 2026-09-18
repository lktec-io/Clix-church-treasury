import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCalendar, FiClock, FiInfo } from 'react-icons/fi';
import { reportsApi, financialPeriodsApi, expensesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useActivity } from '../context/ActivityContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonStatGrid, SkeletonTable } from '../components/ui/Skeleton.jsx';
import {
  ActivityTimeline,
  BalanceTile,
  DepartmentAccounts,
  MakatoWidget,
} from '../components/dashboard/TreasuryInsights.jsx';
import { formatMoney, sumMoneyStrings } from '../utils/format.js';

// Every figure here is read from the existing report services — nothing on
// this page runs its own SQL or recomputes over raw rows
// (docs/FINANCIAL_ARCHITECTURE.md §6). The period selector only changes which
// dateFrom/dateTo is sent; it is calendar math, never financial math.
const RANGE_OPTIONS = ['month', 'quarter', 'year'];

// Local calendar date as YYYY-MM-DD. NOT toISOString(): local midnight on the
// 1st is still the previous day in UTC for any zone east of Greenwich, so in
// Tanzania (UTC+3) "this month" would start on the last day of the month
// before.
function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function computeRange(kind) {
  const now = new Date();
  const dateTo = isoDate(now);
  if (kind === 'quarter') {
    return { dateFrom: isoDate(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), dateTo };
  }
  if (kind === 'year') {
    return { dateFrom: isoDate(new Date(now.getFullYear(), 0, 1)), dateTo };
  }
  return { dateFrom: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo };
}

export default function DashboardPage() {
  const { session, hasPermission } = useAuth();
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const { recordActivity } = useActivity();
  const [openPeriod, setOpenPeriod] = useState(undefined); // undefined = loading, null = none exists
  const [range, setRange] = useState('month');
  const [summary, setSummary] = useState(null);
  const [incomeTotal, setIncomeTotal] = useState(null);
  const [expenseTotal, setExpenseTotal] = useState(null);
  // Zaka/Sadaka split, department collections and Makato for the range.
  const [insights, setInsights] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [pendingExpenses, setPendingExpenses] = useState([]);
  const [actioningExpenseId, setActioningExpenseId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const { dateFrom, dateTo } = useMemo(() => computeRange(range), [range]);

  const loadRangeScoped = useCallback(async () => {
    const requests = [];
    if (hasPermission('income.view')) {
      requests.push(
        reportsApi.run('income', { dateFrom, dateTo }).then((data) => setIncomeTotal(data.totals.amount)).catch(() => setIncomeTotal(null)),
        reportsApi.run('dashboardInsights', { dateFrom, dateTo }).then(setInsights).catch(() => setInsights(null))
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
      // Gated: a session without financial_period.view (a platform admin)
      // would otherwise fire a guaranteed 403 and paint an error banner.
      let current = null;
      if (hasPermission('financial_period.view')) {
        const periods = await financialPeriodsApi.list();
        current = periods.find((p) => p.status === 'open') ?? null;
      }
      setOpenPeriod(current);

      const requests = [];
      if (hasPermission('reports.view')) {
        requests.push(
          reportsApi.run('transactionJournal', {}).then((data) => setRecentTransactions(data.rows.slice(0, 8))).catch(() => setRecentTransactions([]))
        );
        if (current) {
          requests.push(
            reportsApi.run('financialSummary', { financialPeriodId: current.id }).then(setSummary).catch(() => setSummary(null))
          );
        }
      }
      if (hasPermission('expense.approve')) {
        requests.push(expensesApi.list({ status: 'submitted' }).then(setPendingExpenses).catch(() => setPendingExpenses([])));
      }
      await Promise.all(requests);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatic();
  }, [loadStatic]);

  useEffect(() => {
    if (openPeriod === undefined) return;
    loadRangeScoped();
  }, [openPeriod, loadRangeScoped]);

  // --- Expense approval gateway -------------------------------------------
  // Enforced server-side too (requirePermission + approveExpense re-checks
  // the approver is not the requester); these gates only decide what to show.
  const refreshPending = useCallback(async () => {
    try {
      setPendingExpenses(await expensesApi.list({ status: 'submitted' }));
    } catch {
      // Non-fatal: the action already succeeded and reported.
    }
  }, []);

  const runExpenseAction = async (expense, action, successKey) => {
    setActioningExpenseId(expense.id);
    setError(null);
    try {
      await action();
      // Drop the row locally first so <AnimatePresence> can play its exit.
      setPendingExpenses((rows) => rows.filter((row) => row.id !== expense.id));
      toast.success(t(successKey));
      recordActivity({ kind: 'expense', message: `${t(successKey)} — ${expense.payee}` });
      await refreshPending();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setActioningExpenseId(null);
    }
  };

  const handleApproveExpense = (expense) =>
    runExpenseAction(expense, () => expensesApi.approve(expense.id), 'expenses.approvedToast');

  const handleRejectExpense = async (expense) => {
    const result = await confirm({
      title: t('expenses.reject'),
      message: t('expenses.rejectConfirm'),
      tone: 'danger',
      confirmLabel: t('expenses.reject'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    await runExpenseAction(expense, () => expensesApi.reject(expense.id, result.reason), 'expenses.rejectedToast');
  };

  const firstName = session?.user?.full_name?.split(' ')[0];
  const collections = insights?.collections;
  // Display aggregation only (integer cents in sumMoneyStrings).
  const tithesAndOfferings = collections ? sumMoneyStrings([collections.tithe, collections.offering]) : null;

  const periodSelect = (
    <div className="period-select">
      <Dropdown
        id="dashboard-period"
        label={t('dashboard.periodFilter')}
        options={RANGE_OPTIONS.map((opt) => ({ value: opt, label: t(`dashboard.period.${opt}`) }))}
        value={range}
        onChange={setRange}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="page">
        <PageHeader title={t('dashboard.title')} />
        <SkeletonStatGrid />
        <SkeletonTable rows={4} columns={3} />
      </div>
    );
  }

  return (
    <div>
      <header className="dash-header">
        <div className="dash-header__text">
          <h1 className="dash-header__title">
            {firstName ? t('dashboard.greeting', { name: firstName }) : t('dashboard.welcomeFallback')}
          </h1>
          <p className="dash-header__subtitle">{t('dashboard.summarySubtitle')}</p>
        </div>
        {periodSelect}
      </header>
      {error && <div className="alert alert--error">{error}</div>}

      {/* "No open period" is only true if we actually looked: a session
          without financial_period.view never fetched the list. */}
      {hasPermission('financial_period.view') && openPeriod === null ? (
        <div className="card">
          <EmptyState
            icon={FiCalendar}
            title={t('dashboard.noOpenPeriod')}
            action={
              <PermissionGate permission="financial_period.manage">
                <Link to="/financial-periods" className="btn btn--primary">
                  {t('financialPeriods.new')}
                </Link>
              </PermissionGate>
            }
          />
        </div>
      ) : (
        <>
          <div className="balance-grid">
            <PermissionGate permission="income.view">
              <BalanceTile
                label={t('dashboard.tiles.tithesOfferings')}
                value={tithesAndOfferings}
                caption={t(`dashboard.period.${range}`)}
                lines={
                  collections
                    ? [
                        { label: t('insights.collections.tithe'), value: collections.tithe },
                        { label: t('insights.collections.offering'), value: collections.offering },
                      ]
                    : []
                }
              />
            </PermissionGate>
            <PermissionGate permission="reports.view">
              <BalanceTile
                emphasis
                label={t('dashboard.tiles.netTreasury')}
                value={summary?.closingBalance ?? null}
                caption={openPeriod?.label ?? t('dashboard.tiles.openPeriod')}
                lines={[
                  { label: t('dashboard.income'), value: incomeTotal, tone: 'in' },
                  { label: t('dashboard.expenses'), value: expenseTotal, tone: 'out' },
                ]}
              />
            </PermissionGate>
          </div>

          {insights && (
            <div className="dash-columns">
              <DepartmentAccounts departments={insights.departments} />
              <MakatoWidget makato={insights.makato} />
            </div>
          )}

          {/* Approval gateway. Approving does NOT move money: the ledger is
              touched only at "Mark paid" (expenses.service.js#payExpense). */}
          <PermissionGate permission="expense.approve">
            <section className="dash-section">
              <header className="dash-section__head">
                <h2 className="dash-section__title">
                  <FiClock aria-hidden="true" /> {t('dashboard.pendingApprovals')}
                  {pendingExpenses.length > 0 && <span className="badge badge--warning tabular-nums">{pendingExpenses.length}</span>}
                </h2>
                <Link to="/expenses" className="btn btn--ghost btn--sm">{t('dashboard.viewAll')}</Link>
              </header>
              {pendingExpenses.length === 0 ? (
                <p className="dash-section__empty">{t('expenses.noPending')}</p>
              ) : (
                <>
                  <p className="approval-note">
                    <FiInfo aria-hidden="true" />
                    <span>{t('expenses.approveStageNote')}</span>
                  </p>
                  <div className="approval-list">
                    <AnimatePresence initial={false}>
                      {pendingExpenses.map((expense) => {
                        const busy = actioningExpenseId === expense.id;
                        // An approver cannot approve their own request (also enforced server-side).
                        const isOwn = expense.requested_by_user_id === session?.user?.id;
                        return (
                          <motion.div
                            className="approval-row"
                            key={expense.id}
                            layout
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <div className="approval-row__detail">
                              <div className="approval-row__payee">{expense.payee}</div>
                              <div className="approval-row__meta">
                                {expense.expense_number}
                                {expense.description ? ` · ${expense.description}` : ''}
                              </div>
                            </div>
                            <div className="approval-row__amount tabular-nums">{formatMoney(expense.amount)}</div>
                            <div className="approval-row__actions">
                              {!isOwn && (
                                <button
                                  type="button"
                                  className="btn btn--success btn--sm"
                                  disabled={busy}
                                  title={t('expenses.approveOnlyTooltip')}
                                  onClick={() => handleApproveExpense(expense)}
                                >
                                  {busy ? t('common.loading') : t('expenses.approve')}
                                </button>
                              )}
                              <PermissionGate permission="expense.reject">
                                <button
                                  type="button"
                                  className="btn btn--danger btn--sm"
                                  disabled={busy}
                                  title={t('expenses.rejectTooltip')}
                                  onClick={() => handleRejectExpense(expense)}
                                >
                                  {t('expenses.reject')}
                                </button>
                              </PermissionGate>
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </section>
          </PermissionGate>

          <PermissionGate permission="reports.view">
            <section className="dash-section">
              <header className="dash-section__head">
                <h2 className="dash-section__title">{t('insights.timeline.title')}</h2>
                <Link to="/reports" className="btn btn--ghost btn--sm">{t('dashboard.viewAll')}</Link>
              </header>
              <ActivityTimeline transactions={recentTransactions} />
            </section>
          </PermissionGate>
        </>
      )}
    </div>
  );
}
