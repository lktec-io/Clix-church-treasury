import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiDollarSign, FiLayers, FiPlus, FiX, FiRefreshCw, FiCheck, FiArrowLeft, FiArrowRight } from 'react-icons/fi';
import { contributionsApi, accountsApi, fundsApi, categoriesApi, contributorsApi, pledgesApi, receiptsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, formatDate, sanitizeAmountInput } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];
const PAGE_SIZE = 50;

// The recording form is a 4-step wizard rather than one long page: a
// treasurer entering a Sunday's collections is doing three genuinely
// different things (how much / where it belongs / how it splits) and the
// last step exists so money is never posted without the person seeing the
// final figure first. The steps are presentation only — the submit path,
// idempotency key, amount sanitising and validation underneath are
// unchanged.
const STEPS = [
  { id: 1, labelKey: 'contributions.wizard.step.amount' },
  { id: 2, labelKey: 'contributions.wizard.step.details' },
  { id: 3, labelKey: 'contributions.wizard.step.breakdown' },
  { id: 4, labelKey: 'contributions.wizard.step.review' },
];
const LAST_STEP = STEPS.length;

const stepVariants = {
  enter: { opacity: 0, x: 16 },
  center: { opacity: 1, x: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: -16, transition: { duration: 0.15 } },
};

function emptyForm() {
  return {
    amount: '',
    accountId: '',
    fundId: '',
    categoryId: '',
    contributorId: '',
    pledgeId: '',
    paymentMethod: 'cash',
    contributionDate: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
  };
}

// Integer-cents sum for the live "items must add up to the total" check —
// same reasoning as utils/format.js#sumMoneyStrings, kept local here since
// it's only ever applied to the handful of rows a treasurer is actively
// typing into, not a general-purpose report total.
function sumItems(items) {
  const cents = items.reduce((sum, item) => {
    const [whole, frac = ''] = sanitizeAmountInput(item.amount || '0').split('.');
    return sum + (Number(whole) || 0) * 100 + Number(frac.padEnd(2, '0').slice(0, 2) || '0');
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export default function ContributionsPage() {
  const { t } = useLocale();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [contributions, setContributions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [items, setItems] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [smsNotice, setSmsNotice] = useState(null); // { contributionId, status } | null
  const [resendingSms, setResendingSms] = useState(false);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState(null);
  const stepPanelRef = useRef(null);
  // One key per logical attempt, not per click — regenerated only after a
  // successful save, so a double-click, a slow-network retry, or resubmitting
  // after an ambiguous timeout all carry the SAME key and the backend
  // (contributions.service.js#recordContribution) returns the original
  // contribution instead of posting the payment twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [contribData, accountData, fundData, categoryData] = await Promise.all([
        contributionsApi.list({ limit: PAGE_SIZE }),
        accountsApi.list(),
        fundsApi.list(),
        categoriesApi.list('income'),
      ]);
      setContributions(contribData);
      setHasMore(contribData.length === PAGE_SIZE);
      setAccounts(accountData);
      setFunds(fundData);
      setCategories(categoryData);
      if (hasPermission('contributors.view')) {
        setContributors(await contributorsApi.list());
      }
      if (hasPermission('pledges.view')) {
        setPledges((await pledgesApi.list({ status: 'active' })).filter((p) => p.status === 'active'));
      }
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = await contributionsApi.list({ limit: PAGE_SIZE, offset: contributions.length });
      setContributions((rows) => [...rows, ...nextPage]);
      setHasMore(nextPage.length === PAGE_SIZE);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const addItem = () => setItems((rows) => [...rows, { purpose: '', amount: '' }]);
  const removeItem = (index) => setItems((rows) => rows.filter((_, i) => i !== index));
  const updateItem = (index, field) => (e) =>
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: e.target.value } : row)));
  const itemsTotal = items.length > 0 ? sumItems(items) : null;
  const itemsMismatch =
    items.length > 0 && form.amount && itemsTotal !== Number(sanitizeAmountInput(form.amount)).toFixed(2);

  // Per-step gate. Returns null when the step is complete, otherwise the
  // translated reason — shown inline rather than letting the treasurer
  // reach the review step with a half-filled entry.
  const stepProblem = (which) => {
    if (which === 1) {
      const amount = sanitizeAmountInput(form.amount);
      if (!amount || Number(amount) <= 0) return t('contributions.wizard.error.amount');
      if (!form.contributionDate) return t('contributions.wizard.error.date');
      return null;
    }
    if (which === 2) {
      if (!form.accountId) return t('contributions.wizard.error.account');
      if (!form.fundId) return t('contributions.wizard.error.fund');
      if (!form.categoryId) return t('contributions.wizard.error.category');
      return null;
    }
    if (which === 3) {
      if (!showBreakdown) return null;
      if (items.some((i) => !i.purpose.trim() || !sanitizeAmountInput(i.amount))) {
        return t('contributions.wizard.error.breakdownIncomplete');
      }
      if (itemsMismatch) return t('contributions.itemsMismatch');
      return null;
    }
    return null;
  };

  const goToStep = (next) => {
    setStepError(null);
    setStep(next);
  };

  const goNext = () => {
    const problem = stepProblem(step);
    if (problem) {
      setStepError(problem);
      return;
    }
    goToStep(Math.min(step + 1, LAST_STEP));
  };

  const goBack = () => goToStep(Math.max(step - 1, 1));

  // Move focus into each new step so keyboard and screen-reader users land
  // in the panel that just appeared instead of staying on the (now
  // replaced) button they pressed.
  useEffect(() => {
    const panel = stepPanelRef.current;
    if (!panel) return;
    const firstField = panel.querySelector('input, select, textarea, button');
    if (firstField) firstField.focus({ preventScroll: true });
  }, [step]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Enter anywhere in an earlier step advances rather than posting money.
    // Submission is only ever reachable from the review step.
    if (step !== LAST_STEP) {
      goNext();
      return;
    }
    setError(null);
    setSmsNotice(null);
    setSubmitting(true);
    try {
      const result = await contributionsApi.create({
        ...form,
        amount: sanitizeAmountInput(form.amount),
        accountId: Number(form.accountId),
        fundId: Number(form.fundId),
        categoryId: Number(form.categoryId),
        contributorId: form.contributorId ? Number(form.contributorId) : null,
        pledgeId: form.pledgeId ? Number(form.pledgeId) : null,
        items:
          items.length > 0 ? items.map((item) => ({ ...item, amount: sanitizeAmountInput(item.amount) })) : undefined,
        idempotencyKey,
      });
      setForm(emptyForm());
      setItems([]);
      setShowBreakdown(false);
      setStep(1); // wizard returns to the start, ready for the next entry
      setStepError(null);
      setIdempotencyKey(crypto.randomUUID()); // this logical attempt is done — the next Save is a new one
      await loadAll();
      toast.success(t('contributions.recorded'));
      // SMS delivery never blocks or reverses the save above (server/src/
      // modules/contributions/contributions.service.js) — the contribution
      // toast above already fired unconditionally. This is a *separate*,
      // secondary notice: an inline banner (not another toast, which would
      // auto-dismiss and hide the retry action) so a failed send is both
      // honest and recoverable without re-entering the whole contribution.
      if (result.sms) {
        setSmsNotice({
          contributionId: result.id,
          status: result.sms.status,
          reasonCode: result.sms.reasonCode,
          reason: result.sms.errorMessage,
        });
      }
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetrySms = async () => {
    if (!smsNotice) return;
    setResendingSms(true);
    try {
      const { sms } = await contributionsApi.resendSms(smsNotice.contributionId);
      setSmsNotice({
        contributionId: smsNotice.contributionId,
        status: sms.status,
        reasonCode: sms.reasonCode,
        reason: sms.errorMessage,
      });
      if (sms.status === 'sent') toast.success(t('contributions.sms.sent'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setResendingSms(false);
    }
  };

  const handleReverse = async (id) => {
    const result = await confirm({
      title: t('contributions.reverse'),
      message: t('contributions.reverseConfirm'),
      tone: 'danger',
      confirmLabel: t('contributions.reverse'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    try {
      await contributionsApi.reverse(id, result.reason);
      await loadAll();
      toast.success(t('contributions.reversedToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader title={t('contributions.title')} subtitle={t('contributions.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}
      {smsNotice && smsNotice.status !== 'sent' && (
        <div className={`alert ${smsNotice.status === 'failed' ? 'alert--warning' : 'alert--info'}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{t(`contributions.sms.${smsNotice.status}`)}</span>
            {smsNotice.status === 'failed' && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleRetrySms} disabled={resendingSms}>
                <FiRefreshCw aria-hidden="true" /> {resendingSms ? t('common.loading') : t('contributions.retrySms')}
              </button>
            )}
          </div>
          {/* Staff-only page — safe to show the concrete (non-secret) reason
              a treasurer would need to know whether this is a "contact IT
              about the SMS provider" situation vs. "this contributor's
              phone number is wrong" situation. */}
          {smsNotice.reasonCode ? (
            <span className="text-caption--inherit">{t(`contributions.sms.reasonCode.${smsNotice.reasonCode}`)}</span>
          ) : (
            smsNotice.reason && (
              <span className="text-caption--inherit">{t('contributions.sms.reason', { reason: smsNotice.reason })}</span>
            )
          )}
        </div>
      )}

      <PermissionGate permission="income.create">
        <div className="card wizard-canvas">
          <div className="card__header">
            <h2>{t('contributions.recordNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            {/* Stepper — also the progress indicator. Completed steps stay
                clickable so a treasurer can jump back to correct something
                without losing what they've typed; forward jumps go through
                goNext() so validation is never skipped. */}
            <ol className="wizard-steps" aria-label={t('contributions.wizard.progress')}>
              {STEPS.map((s) => (
                <li
                  key={s.id}
                  className={`wizard-steps__item${s.id === step ? ' is-current' : ''}${s.id < step ? ' is-done' : ''}`}
                >
                  <button
                    type="button"
                    className="wizard-steps__btn"
                    onClick={() => s.id < step && goToStep(s.id)}
                    disabled={s.id > step}
                    aria-current={s.id === step ? 'step' : undefined}
                  >
                    <span className="wizard-steps__marker">{s.id < step ? <FiCheck aria-hidden="true" /> : s.id}</span>
                    <span className="wizard-steps__label">{t(s.labelKey)}</span>
                  </button>
                </li>
              ))}
            </ol>

            {stepError && <div className="alert alert--warning">{stepError}</div>}

            <div ref={stepPanelRef}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={step} variants={stepVariants} initial="enter" animate="center" exit="exit">
                  {step === 1 && (
                    <>
                      <div className="form-section">
                        <div className="form-section__title"><FiDollarSign aria-hidden="true" /> {t('contributions.section.amount')}</div>
                      </div>
                      <div className="form-grid">
                        <div className="field field--full field--amount">
                          <label>{t('common.amount')}</label>
                          <div className="currency-input">
                            <span className="currency-input__prefix">TZS</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={form.amount}
                              onChange={handleChange('amount')}
                            />
                          </div>
                        </div>
                        <div className="field">
                          <label>{t('contributions.paymentMethod')}</label>
                          <select value={form.paymentMethod} onChange={handleChange('paymentMethod')}>
                            {PAYMENT_METHODS.map((m) => (
                              <option key={m} value={m}>
                                {t(`paymentMethod.${m}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>{t('contributions.contributionDate')}</label>
                          <input type="date" value={form.contributionDate} onChange={handleChange('contributionDate')} />
                        </div>
                      </div>
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="form-section">
                        <div className="form-section__title"><FiLayers aria-hidden="true" /> {t('contributions.section.details')}</div>
                      </div>
                      <div className="form-grid">
              <div className="field">
                <label>{t('contributions.account')}</label>
                <select value={form.accountId} onChange={handleChange('accountId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.fund')}</label>
                <select value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.category')}</label>
                <select value={form.categoryId} onChange={handleChange('categoryId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {categories.length === 0 && (
                  <span className="field-error">
                    {t('categories.emptyHint')} <Link to="/categories">{t('categories.title')}</Link>
                  </span>
                )}
              </div>
              {contributors.length > 0 && (
                <div className="field">
                  <label>{t('contributions.contributor')}</label>
                  <select value={form.contributorId} onChange={handleChange('contributorId')}>
                    <option value="">—</option>
                    {contributors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {pledges.length > 0 && (
                <div className="field">
                  <label>{t('pledges.title')}</label>
                  <select value={form.pledgeId} onChange={handleChange('pledgeId')}>
                    <option value="">—</option>
                    {pledges.map((p) => (
                      <option key={p.id} value={p.id}>
                        {(p.contributor?.full_name ?? `#${p.pledge_number}`)} — {t('pledges.remaining')}: {p.remaining_amount}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>{t('common.reference')}</label>
                <input value={form.reference} onChange={handleChange('reference')} />
              </div>
              <div className="field field--full">
                <label>{t('common.notes')}</label>
                <textarea rows={2} value={form.notes} onChange={handleChange('notes')} />
              </div>
                      </div>
                    </>
                  )}

                  {step === 3 && (
                    <>
            <div className="form-section">
              <div className="form-section__title"><FiLayers aria-hidden="true" /> {t('contributions.section.breakdown')}</div>
            </div>
            <label className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: showBreakdown ? 12 : 0 }}>
              <input
                type="checkbox"
                checked={showBreakdown}
                onChange={(e) => {
                  setShowBreakdown(e.target.checked);
                  if (!e.target.checked) setItems([]);
                  else if (items.length === 0) addItem();
                }}
              />
              {t('contributions.addBreakdown')}
            </label>
            {showBreakdown && (
              <div className="breakdown-panel">
                {items.map((item, index) => (
                  <div key={index} className="breakdown-row">
                    <input
                      placeholder={t('contributions.itemPurpose')}
                      value={item.purpose}
                      onChange={updateItem(index, 'purpose')}
                      className="breakdown-row__purpose"
                      required
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={updateItem(index, 'amount')}
                      className="breakdown-row__amount"
                      required
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeItem(index)}
                      aria-label={t('common.cancel')}
                    >
                      <FiX aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button type="button" className="btn btn--secondary btn--sm" onClick={addItem} style={{ marginTop: 4 }}>
                  <FiPlus aria-hidden="true" /> {t('contributions.addItem')}
                </button>
                {items.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: '1px solid var(--border)',
                      fontWeight: 700,
                    }}
                  >
                    <span>{t('reports.total')}</span>
                    <span className="tabular-nums">{itemsTotal ?? '0.00'}</span>
                  </div>
                )}
                {itemsMismatch && (
                  <div className="field-error" style={{ marginTop: 8 }}>
                    {t('contributions.itemsMismatch')} ({itemsTotal} ≠ {form.amount})
                  </div>
                )}
              </div>
            )}
                    </>
                  )}

                  {step === 4 && (
                    <>
                      <div className="form-section">
                        <div className="form-section__title">
                          <FiCheck aria-hidden="true" /> {t('contributions.wizard.step.review')}
                        </div>
                      </div>
                      {/* The figure being posted, shown once, large, before
                          anything is written. Everything below it is the
                          supporting detail in the same order it was entered. */}
                      <div className="wizard-review__amount">
                        <span className="wizard-review__amount-label">{t('common.amount')}</span>
                        <span className="wizard-review__amount-value tabular-nums">
                          TZS {formatMoney(sanitizeAmountInput(form.amount) || '0')}
                        </span>
                      </div>
                      <dl className="wizard-review">
                        <div className="wizard-review__row">
                          <dt>{t('contributions.contributionDate')}</dt>
                          <dd>{formatDate(form.contributionDate)}</dd>
                        </div>
                        <div className="wizard-review__row">
                          <dt>{t('contributions.paymentMethod')}</dt>
                          <dd>{t(`paymentMethod.${form.paymentMethod}`)}</dd>
                        </div>
                        <div className="wizard-review__row">
                          <dt>{t('contributions.account')}</dt>
                          <dd>{accounts.find((a) => String(a.id) === String(form.accountId))?.name ?? '—'}</dd>
                        </div>
                        <div className="wizard-review__row">
                          <dt>{t('contributions.fund')}</dt>
                          <dd>{funds.find((f) => String(f.id) === String(form.fundId))?.name ?? '—'}</dd>
                        </div>
                        <div className="wizard-review__row">
                          <dt>{t('contributions.category')}</dt>
                          <dd>{categories.find((c) => String(c.id) === String(form.categoryId))?.name ?? '—'}</dd>
                        </div>
                        <div className="wizard-review__row">
                          <dt>{t('contributions.contributor')}</dt>
                          <dd>
                            {contributors.find((c) => String(c.id) === String(form.contributorId))?.full_name ??
                              t('contributions.wizard.anonymous')}
                          </dd>
                        </div>
                        {form.reference && (
                          <div className="wizard-review__row">
                            <dt>{t('common.reference')}</dt>
                            <dd>{form.reference}</dd>
                          </div>
                        )}
                        {items.length > 0 && (
                          <div className="wizard-review__row">
                            <dt>{t('contributions.section.breakdown')}</dt>
                            <dd>
                              {items.map((item, i) => (
                                <div key={i}>
                                  {item.purpose} — <span className="tabular-nums">{formatMoney(sanitizeAmountInput(item.amount) || '0')}</span>
                                </div>
                              ))}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="form-actions wizard-actions">
              {step > 1 && (
                <button type="button" className="btn btn--secondary" onClick={goBack} disabled={submitting}>
                  <FiArrowLeft aria-hidden="true" /> {t('contributions.wizard.back')}
                </button>
              )}
              {step < LAST_STEP ? (
                <button type="button" className="btn btn--primary" onClick={goNext}>
                  {t('contributions.wizard.next')} <FiArrowRight aria-hidden="true" />
                </button>
              ) : (
                <button type="submit" className="btn btn--primary" disabled={submitting || itemsMismatch}>
                  {submitting ? t('common.loading') : t('common.record')}
                </button>
              )}
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        <div className="card__header">
          <h2>{t('contributions.title')}</h2>
        </div>
        {loading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : contributions.length === 0 ? (
          <EmptyState
            icon={FiDollarSign}
            title={t('contributions.empty.title')}
            message={t('contributions.empty.message')}
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
                  {contributions.some((c) => c.contributor) && <th>{t('contributions.contributor')}</th>}
                  <th>{t('contributions.paymentMethod')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contribution_date)}</td>
                    <td className="is-amount">{formatMoney(c.amount)}</td>
                    {contributions.some((row) => row.contributor) && <td>{c.contributor?.full_name ?? '—'}</td>}
                    <td>{t(`paymentMethod.${c.payment_method}`)}</td>
                    <td>
                      <span className={`badge ${c.status === 'reversed' ? 'badge--danger' : 'badge--success'}`}>
                        {c.status === 'reversed' ? t('contributions.reversed') : t('common.active')}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <PermissionGate permission="receipts.view">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => receiptsApi.openPdfForContribution(c.id).catch((err) => setError(unwrapApiError(err).message))}
                        >
                          {t('receipts.download')}
                        </button>
                      </PermissionGate>
                      {c.status === 'posted' && (
                        <PermissionGate permission="income.reverse">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleReverse(c.id)}>
                            {t('contributions.reverse')}
                          </button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
