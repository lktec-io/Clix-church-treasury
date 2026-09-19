import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCalendar } from 'react-icons/fi';
import { reportsApi, financialPeriodsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
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
  NetComparison,
  VarianceTracker,
} from '../components/dashboard/TreasuryInsights.jsx';
import { sumMoneyStrings } from '../utils/format.js';

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
  const [openPeriod, setOpenPeriod] = useState(undefined); // undefined = loading, null = none exists
  const [range, setRange] = useState('month');
  const [summary, setSummary] = useState(null);
  const [incomeTotal, setIncomeTotal] = useState(null);
  const [expenseTotal, setExpenseTotal] = useState(null);
  // Zaka/Sadaka split, department collections and Makato for the range.
  const [insights, setInsights] = useState(null);
  const [recentTransactions, setRecentTransactions] = useState([]);
  // Budget lines of the open period, for the variance tracker.
  const [budgetRows, setBudgetRows] = useState([]);
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
      if (current && hasPermission('budget.view')) {
        requests.push(
          reportsApi
            .run('budgetVsActual', { financialPeriodId: current.id })
            .then((data) => setBudgetRows(data.rows ?? []))
            .catch(() => setBudgetRows([]))
        );
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

  const firstName = session?.user?.full_name?.split(' ')[0];
  const collections = insights?.collections;
  // Display aggregation only (utils/format.js#sumMoneyStrings works in
  // integer cents): income less expenses over the selected range.
  const netForRange =
    incomeTotal !== null && expenseTotal !== null ? sumMoneyStrings([incomeTotal, `-${expenseTotal}`]) : null;
  const fundNameById = new Map((summary?.fundSummaries ?? []).map((fund) => [fund.fundId, fund.name]));
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

          <div className="dash-columns">
            <NetComparison
              income={incomeTotal}
              expenses={expenseTotal}
              net={netForRange}
              periodLabel={t(`dashboard.period.${range}`)}
            />
            <PermissionGate permission="budget.view">
              <VarianceTracker rows={budgetRows} fundNameById={fundNameById} />
            </PermissionGate>
          </div>

          {insights && (
            <div className="dash-columns">
              <DepartmentAccounts departments={insights.departments} />
              <MakatoWidget makato={insights.makato} />
            </div>
          )}

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
