import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiCheckCircle, FiAlertTriangle, FiDownload, FiBookOpen } from 'react-icons/fi';
import { reportsApi, financialPeriodsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney } from '../utils/format.js';

// TRIAL BALANCE (Ulinganisho wa Hesabu)
//
// Reads the GENERAL LEDGER (chart_of_accounts + journal_lines), not the
// `transactions` cash ledger — a trial balance drawn from single-entry cash
// rows would be a restatement rather than a proof that the books balance.
//
// The integrity strip at the foot is the report's actual conclusion, which
// is why it is a banner rather than another table row: an auditor opens
// this page to answer one question, and it should be answerable without
// reading the table.

// Grouping order follows the conventional balance-sheet-then-P&L sequence a
// reader expects, rather than raw account-code order across types.
const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export default function TrialBalancePage() {
  const { t, locale } = useLocale();
  const [report, setReport] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = periodId ? { financialPeriodId: Number(periodId) } : {};
      const [data, periodList] = await Promise.all([
        reportsApi.run('trialBalance', params),
        // Periods are only fetched to populate the filter; a role without
        // financial_period.view still gets the report, just without it.
        financialPeriodsApi.list().catch(() => []),
      ]);
      setReport(data);
      setPeriods(periodList);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [periodId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleExport = async (format) => {
    setExporting(true);
    setError(null);
    try {
      await reportsApi.export('trialBalance', periodId ? { financialPeriodId: Number(periodId) } : {}, format);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setExporting(false);
    }
  };

  const rows = report?.rows ?? [];
  // Accounts that never moved are hidden: a trial balance listing a dozen
  // zero rows buries the ones that matter. The totals are unaffected —
  // they come from the server over every account.
  const activeRows = rows.filter((r) => Number(r.debit) !== 0 || Number(r.credit) !== 0);
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    rows: activeRows.filter((r) => r.accountType === type),
  })).filter((g) => g.rows.length > 0);

  // Swahili names come from the chart of accounts itself (name_sw), so a
  // church that renames an account sees its own wording in both languages.
  const accountName = (row) => (locale === 'sw' && row.nameSw ? row.nameSw : row.name);

  return (
    <div>
      <PageHeader title={t('reports.trialBalance')} subtitle={t('reports.trialBalance.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <div className="card__header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FiBookOpen aria-hidden="true" /> {t('reports.trialBalance')}
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              aria-label={t('budgets.financialPeriod')}
              style={{ maxWidth: 220 }}
            >
              <option value="">{t('reports.trialBalance.allPeriods')}</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <PermissionGate permission="reports.export">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => handleExport('pdf')}
                disabled={exporting || loading}
              >
                <FiDownload aria-hidden="true" /> PDF
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => handleExport('xlsx')}
                disabled={exporting || loading}
              >
                <FiDownload aria-hidden="true" /> Excel
              </button>
            </PermissionGate>
          </div>
        </div>

        {loading ? (
          <SkeletonTable rows={6} columns={4} />
        ) : activeRows.length === 0 ? (
          <EmptyState
            icon={FiBookOpen}
            title={t('reports.trialBalance.empty.title')}
            message={t('reports.trialBalance.empty.message')}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table trial-balance">
                <thead>
                  <tr>
                    <th className="trial-balance__code">{t('reports.trialBalance.code')}</th>
                    <th>{t('reports.trialBalance.account')}</th>
                    <th className="is-numeric">{t('reports.trialBalance.debit')}</th>
                    <th className="is-numeric">{t('reports.trialBalance.credit')}</th>
                  </tr>
                </thead>
                {grouped.map((group) => (
                  <tbody key={group.type}>
                    {/* Section heading inside the table so the grouping
                        survives horizontal scrolling on a phone. */}
                    <tr className="trial-balance__section">
                      <td colSpan={4}>{t(`reports.trialBalance.type.${group.type}`)}</td>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.code}>
                        <td className="trial-balance__code tabular-nums">{row.code}</td>
                        <td>
                          <span className="trial-balance__name">{accountName(row)}</span>
                          {/* The other language underneath, so a mixed
                              English/Swahili board reads one sheet. */}
                          {row.nameSw && row.nameSw !== row.name && (
                            <span className="trial-balance__name-alt">
                              {locale === 'sw' ? row.name : row.nameSw}
                            </span>
                          )}
                        </td>
                        <td className="is-numeric tabular-nums">
                          {Number(row.debit) === 0 ? '—' : formatMoney(row.debit)}
                        </td>
                        <td className="is-numeric tabular-nums">
                          {Number(row.credit) === 0 ? '—' : formatMoney(row.credit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <tr className="trial-balance__totals">
                    <td className="trial-balance__code" />
                    <td>{t('reports.trialBalance.total')}</td>
                    <td className="is-numeric tabular-nums">{formatMoney(report?.totals?.debit ?? '0.00')}</td>
                    <td className="is-numeric tabular-nums">{formatMoney(report?.totals?.credit ?? '0.00')}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* THE INTEGRITY VERIFICATION STRIP.
                The conclusion of the whole report. `isBalanced` is computed
                server-side from the journal totals — this only presents it.
                An unbalanced result is shown with its exact difference
                rather than hidden behind an error: an auditor needs to see
                the size of the discrepancy to start looking for it. */}
            <motion.div
              className={`integrity-strip${report?.isBalanced ? ' is-balanced' : ' is-unbalanced'}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              role="status"
            >
              <span className="integrity-strip__icon">
                {report?.isBalanced ? <FiCheckCircle aria-hidden="true" /> : <FiAlertTriangle aria-hidden="true" />}
              </span>
              <div className="integrity-strip__copy">
                <div className="integrity-strip__headline">
                  {report?.isBalanced ? t('reports.trialBalance.balanced') : t('reports.trialBalance.unbalanced')}
                </div>
                <div className="integrity-strip__detail">
                  {report?.isBalanced
                    ? t('reports.trialBalance.balancedDetail')
                    : t('reports.trialBalance.unbalancedDetail', {
                        difference: formatMoney(report?.difference ?? '0.00'),
                      })}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </div>
    </div>
  );
}
