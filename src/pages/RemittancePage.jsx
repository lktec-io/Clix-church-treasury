import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiSend, FiUpload, FiCheckCircle, FiClock, FiX, FiInfo, FiSettings, FiPlus, FiPercent } from 'react-icons/fi';
import { remittanceApi, accountsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useActivity } from '../context/ActivityContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, sanitizeAmountInput } from '../utils/format.js';

// The Remittance Hub: what the church currently owes its Conference/Diocese,
// and the single action that settles it.
//
// Every figure shown is read from the accrual buckets the server maintains
// (remittance_ledgers) — this page never recomputes an obligation from
// contributions, because a second calculation is a second answer that can
// disagree with the first.

const STATUS_BADGE = {
  pending_transfer: 'badge--warning',
  partially_remitted: 'badge--warning',
  fully_remitted: 'badge--success',
};

const drawerVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
  exit: { opacity: 0, y: 16, transition: { duration: 0.18 } },
};

export default function RemittancePage() {
  const { t } = useLocale();
  const toast = useToast();
  const { recordActivity } = useActivity();
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The ledger row currently being remitted — also what drives the drawer.
  const [remitting, setRemitting] = useState(null);
  const [payAccountId, setPayAccountId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 'hub' = the obligations tracker, 'rules' = the configuration surface.
  // A plain toggle rather than a route: the two views share the same loaded
  // data and a treasurer moves between them constantly while setting up.
  const [tab, setTab] = useState('hub');
  const [rules, setRules] = useState([]);
  const [funds, setFunds] = useState([]);
  const [ruleForm, setRuleForm] = useState({ fundId: '', higherBodyName: '', percentageToRemit: '' });
  // Field-level messages keyed exactly as the server returns them in
  // `fields`, so a validation failure lands on the input that caused it
  // instead of in a banner at the top of the page.
  const [ruleErrors, setRuleErrors] = useState({});
  const [savingRule, setSavingRule] = useState(false);
  const [justSavedRuleId, setJustSavedRuleId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, accountData, ruleData, fundData] = await Promise.all([
        remittanceApi.overview(),
        accountsApi.list(),
        remittanceApi.listRules(),
        fundsApi.list(),
      ]);
      setOverview(data);
      setAccounts(accountData);
      setRules(ruleData);
      setFunds(fundData);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const outstandingOf = (row) => {
    const accrued = Number(row.amount_accrued) || 0;
    const paid = Number(row.amount_paid) || 0;
    return Math.max(accrued - paid, 0).toFixed(2);
  };

  const openDrawer = (row) => {
    setError(null);
    setRemitting(row);
    // Pre-filled with the full outstanding balance: remitting everything owed
    // is overwhelmingly the intended action, and a partial payment is the
    // exception the treasurer edits down to.
    setPayAmount(outstandingOf(row));
    setPayAccountId(accounts[0]?.id ?? '');
  };

  const closeDrawer = () => {
    setRemitting(null);
    setPayAmount('');
    setSubmitting(false);
  };

  const handleRemit = async (e) => {
    e.preventDefault();
    if (!remitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await remittanceApi.remit(remitting.id, {
        accountId: Number(payAccountId),
        amount: sanitizeAmountInput(payAmount),
      });
      closeDrawer();
      await load();
      toast.success(t('remittance.paidToast'));
      recordActivity({ kind: 'expense', message: `${t('remittance.paidToast')} — ${remitting.higher_body_name}` });
    } catch (err) {
      setError(unwrapApiError(err).message);
      setSubmitting(false);
    }
  };

  const handleRuleChange = (field) => (e) => {
    setRuleForm((f) => ({ ...f, [field]: e.target.value }));
    // Clear this field's error as soon as it is edited — leaving a stale
    // red message under an input the user is actively fixing reads as
    // though the fix did not register.
    setRuleErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    setSavingRule(true);
    setRuleErrors({});
    setError(null);
    try {
      const created = await remittanceApi.createRule({
        fundId: Number(ruleForm.fundId),
        higherBodyName: ruleForm.higherBodyName.trim(),
        // Sent as a string: the server stores it in a DECIMAL(5,2) and
        // multiplies real money by it, so it must not round-trip a float.
        percentageToRemit: ruleForm.percentageToRemit.trim(),
      });
      setRuleForm({ fundId: '', higherBodyName: '', percentageToRemit: '' });
      await load();
      // Drives the row's confirmation flash; cleared so a later re-render
      // does not replay it.
      setJustSavedRuleId(created?.id ?? null);
      setTimeout(() => setJustSavedRuleId(null), 2200);
      toast.success(t('remittance.rules.created'));
      recordActivity({ kind: 'general', message: t('remittance.rules.created') });
    } catch (err) {
      const apiError = unwrapApiError(err);
      // The server returns per-field detail in `fields`; surface it under
      // the inputs and fall back to a banner only for errors it cannot
      // attribute to one (a duplicate rule for the fund, say).
      if (apiError.fields) setRuleErrors(apiError.fields);
      else setError(apiError.message);
    } finally {
      setSavingRule(false);
    }
  };

  const ledgers = overview?.ledgers ?? [];
  // A fund may carry at most one rule (uq_remittance_rules_tenant_fund), so
  // funds already configured are removed from the picker rather than
  // offered and then rejected by the database.
  const availableFunds = funds.filter((f) => !rules.some((r) => r.fund_id === f.id));

  return (
    <div>
      <PageHeader title={t('remittance.title')} subtitle={t('remittance.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      {/* Hub / Rules toggle. Rendered as tabs with role="tab" so the two
          views are reachable and announced correctly, not just visually
          switched. */}
      <div className="seg-tabs" role="tablist" aria-label={t('remittance.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'hub'}
          className={`seg-tabs__tab${tab === 'hub' ? ' is-active' : ''}`}
          onClick={() => setTab('hub')}
        >
          <FiUpload aria-hidden="true" /> {t('remittance.tab.hub')}
        </button>
        <PermissionGate permission="remittance.manage">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rules'}
            className={`seg-tabs__tab${tab === 'rules' ? ' is-active' : ''}`}
            onClick={() => setTab('rules')}
          >
            <FiSettings aria-hidden="true" /> {t('remittance.tab.rules')}
          </button>
        </PermissionGate>
      </div>

      {tab === 'hub' && (
      <>
      {/* The three figures a treasurer is asked for at every board meeting. */}
      <div className="stat-grid">
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiUpload aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('remittance.totalAccrued')}</div>
          <div className="stat-tile__value tabular-nums">{formatMoney(overview?.totalAccrued ?? '0.00')}</div>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiCheckCircle aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('remittance.totalRemitted')}</div>
          <div className="stat-tile__value tabular-nums">{formatMoney(overview?.totalPaid ?? '0.00')}</div>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiClock aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('remittance.outstanding')}</div>
          {/* The liability is the one figure that is bad news when large, so
              it is the only one coloured. */}
          <div className={`stat-tile__value tabular-nums${Number(overview?.outstanding ?? 0) > 0 ? ' is-negative' : ''}`}>
            {formatMoney(overview?.outstanding ?? '0.00')}
          </div>
        </div>
      </div>

      <p className="approval-note">
        <FiInfo aria-hidden="true" />
        <span>{t('remittance.accrualNote')}</span>
      </p>

      <div className="card">
        <div className="card__header">
          <h2>{t('remittance.obligations')}</h2>
        </div>

        {loading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : ledgers.length === 0 ? (
          <EmptyState icon={FiSend} title={t('remittance.empty.title')} message={t('remittance.empty.message')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('remittance.higherBody')}</th>
                  <th>{t('contributions.fund')}</th>
                  <th>{t('remittance.period')}</th>
                  <th className="is-numeric">{t('remittance.accrued')}</th>
                  <th className="is-numeric">{t('remittance.paid')}</th>
                  <th className="is-numeric">{t('remittance.outstanding')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {ledgers.map((row) => {
                  const outstanding = outstandingOf(row);
                  const settled = Number(outstanding) <= 0;
                  return (
                    <tr key={row.id}>
                      <td>{row.higher_body_name}</td>
                      <td>{row.fund_name}</td>
                      <td>{row.period_label}</td>
                      <td className="is-numeric tabular-nums">{formatMoney(row.amount_accrued)}</td>
                      <td className="is-numeric tabular-nums">{formatMoney(row.amount_paid)}</td>
                      <td className="is-numeric tabular-nums">{formatMoney(outstanding)}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[row.status_flag] ?? 'badge--neutral'}`}>
                          {t(`remittance.status.${row.status_flag}`)}
                        </span>
                      </td>
                      <td>
                        <PermissionGate permission="remittance.pay">
                          <button
                            type="button"
                            className="btn btn--success btn--sm"
                            disabled={settled}
                            onClick={() => openDrawer(row)}
                          >
                            <FiSend aria-hidden="true" /> {t('remittance.remitAction')}
                          </button>
                        </PermissionGate>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>
      )}

      {tab === 'rules' && (
        <PermissionGate permission="remittance.manage">
          <div className="card">
            <div className="card__header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FiPlus aria-hidden="true" /> {t('remittance.rules.addTitle')}
              </h2>
            </div>
            <p className="field-hint" style={{ margin: '0 0 16px' }}>{t('remittance.rules.hint')}</p>

            <form onSubmit={handleCreateRule} noValidate>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="rule-fund">{t('contributions.fund')}</label>
                  <select
                    id="rule-fund"
                    value={ruleForm.fundId}
                    onChange={handleRuleChange('fundId')}
                    aria-invalid={Boolean(ruleErrors.fundId)}
                    required
                  >
                    <option value="" disabled>—</option>
                    {availableFunds.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  {ruleErrors.fundId && <span className="field-error">{ruleErrors.fundId}</span>}
                  {availableFunds.length === 0 && funds.length > 0 && (
                    <span className="field-hint">{t('remittance.rules.allFundsConfigured')}</span>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="rule-body">{t('remittance.higherBody')}</label>
                  <input
                    id="rule-body"
                    value={ruleForm.higherBodyName}
                    onChange={handleRuleChange('higherBodyName')}
                    placeholder={t('remittance.rules.bodyPlaceholder')}
                    aria-invalid={Boolean(ruleErrors.higherBodyName)}
                    maxLength={150}
                    required
                  />
                  {ruleErrors.higherBodyName && <span className="field-error">{ruleErrors.higherBodyName}</span>}
                </div>

                <div className="field">
                  <label htmlFor="rule-percent">{t('remittance.rules.percentage')}</label>
                  {/* inputMode="decimal" rather than type="number": a number
                      input silently drops a trailing "." mid-typing and its
                      spinners are noise for a value entered once. */}
                  <input
                    id="rule-percent"
                    type="text"
                    inputMode="decimal"
                    value={ruleForm.percentageToRemit}
                    onChange={handleRuleChange('percentageToRemit')}
                    placeholder="100.00"
                    aria-invalid={Boolean(ruleErrors.percentageToRemit)}
                    required
                  />
                  {ruleErrors.percentageToRemit ? (
                    <span className="field-error">{ruleErrors.percentageToRemit}</span>
                  ) : (
                    <span className="field-hint">{t('remittance.rules.percentageHint')}</span>
                  )}
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn--success"
                  disabled={savingRule || !ruleForm.fundId || !ruleForm.higherBodyName || !ruleForm.percentageToRemit}
                >
                  <FiPlus aria-hidden="true" /> {savingRule ? t('common.loading') : t('remittance.rules.save')}
                </button>
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card__header">
              <h2>{t('remittance.rules.existing')}</h2>
            </div>
            {loading ? (
              <SkeletonTable rows={2} columns={3} />
            ) : rules.length === 0 ? (
              <EmptyState
                icon={FiPercent}
                title={t('remittance.rules.empty.title')}
                message={t('remittance.rules.empty.message')}
              />
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('contributions.fund')}</th>
                      <th>{t('remittance.higherBody')}</th>
                      <th className="is-numeric">{t('remittance.rules.percentage')}</th>
                      <th>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <motion.tr
                        key={rule.id}
                        // A just-created rule flashes green once, so the new
                        // row is findable in a list the treasurer did not
                        // scroll to.
                        animate={
                          justSavedRuleId === rule.id
                            ? { backgroundColor: ['rgba(16,185,129,0.22)', 'rgba(16,185,129,0)'] }
                            : {}
                        }
                        transition={{ duration: 2 }}
                      >
                        <td>{rule.fund_name}</td>
                        <td>{rule.higher_body_name}</td>
                        <td className="is-numeric tabular-nums">{rule.percentage_to_remit}%</td>
                        <td>
                          <span className={`badge ${rule.status === 'active' ? 'badge--success' : 'badge--neutral'}`}>
                            {t(rule.status === 'active' ? 'common.active' : 'common.inactive')}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </PermissionGate>
      )}

      {/* Confirmation drawer. Shows the exact breakdown being settled before
          the money moves — this posts a real ledger entry and cannot be
          undone except by a reversal. */}
      <AnimatePresence>
        {remitting && (
          <motion.div
            className="sms-pop-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={closeDrawer}
          >
            <motion.form
              className="remit-drawer"
              variants={drawerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              role="dialog"
              aria-modal="true"
              aria-label={t('remittance.confirmTitle')}
              onMouseDown={(e) => e.stopPropagation()}
              onSubmit={handleRemit}
            >
              <div className="remit-drawer__head">
                <h2>{t('remittance.confirmTitle')}</h2>
                <button type="button" className="btn btn--ghost btn--sm" onClick={closeDrawer} aria-label={t('common.close')}>
                  <FiX aria-hidden="true" />
                </button>
              </div>

              <dl className="remit-drawer__rows">
                <div><dt>{t('remittance.higherBody')}</dt><dd>{remitting.higher_body_name}</dd></div>
                <div><dt>{t('contributions.fund')}</dt><dd>{remitting.fund_name}</dd></div>
                <div><dt>{t('remittance.period')}</dt><dd>{remitting.period_label}</dd></div>
                <div><dt>{t('remittance.rate')}</dt><dd>{remitting.percentage_to_remit}%</dd></div>
                <div><dt>{t('remittance.accrued')}</dt><dd className="tabular-nums">{formatMoney(remitting.amount_accrued)}</dd></div>
                <div><dt>{t('remittance.paid')}</dt><dd className="tabular-nums">{formatMoney(remitting.amount_paid)}</dd></div>
                <div className="remit-drawer__total">
                  <dt>{t('remittance.outstanding')}</dt>
                  <dd className="tabular-nums">{formatMoney(outstandingOf(remitting))}</dd>
                </div>
              </dl>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="remit-account">{t('remittance.payFrom')}</label>
                  <select
                    id="remit-account"
                    value={payAccountId}
                    onChange={(e) => setPayAccountId(e.target.value)}
                    required
                  >
                    <option value="" disabled>—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="remit-amount">{t('common.amount')}</label>
                  <input
                    id="remit-amount"
                    type="text"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                  />
                  <span className="field-hint">{t('remittance.partialHint')}</span>
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn--success" disabled={submitting || !payAccountId}>
                  <FiSend aria-hidden="true" /> {submitting ? t('common.loading') : t('remittance.confirmAction')}
                </button>
                <button type="button" className="btn btn--secondary" onClick={closeDrawer} disabled={submitting}>
                  {t('common.cancel')}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
