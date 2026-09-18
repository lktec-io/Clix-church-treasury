import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiDollarSign,
  FiLayers,
  FiPlus,
  FiX,
  FiCheck,
  FiArrowLeft,
  FiArrowRight,
  FiFileText,
  FiDownload,
  FiRotateCcw,
} from 'react-icons/fi';
import {
  contributionsApi,
  accountsApi,
  fundsApi,
  categoriesApi,
  contributorsApi,
  departmentsApi,
  pledgesApi,
  receiptsApi,
} from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import SmsDispatchIndicator from '../components/ui/SmsDispatchIndicator.jsx';
import SmsPopCenter from '../components/ui/SmsPopCenter.jsx';
import { useActivity } from '../context/ActivityContext.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import { formatMoney, formatDate, formatTime, sanitizeAmountInput } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];
// Mirrors server contributions.validator.js#MOBILE_PROVIDERS.
const MOBILE_PROVIDERS = ['mpesa', 'tigo_pesa', 'airtel_money', 'halopesa', 'other'];
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
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
    // Local calendar date, not toISOString(): between 00:00 and 03:00 in
    // Tanzania the UTC date is still yesterday.
    contributionDate: localToday(),
    reference: '',
    notes: '',
    departmentId: '',
    mobileProvider: '',
    transferFee: '',
  };
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// A typed money string ("10,000.5") as integer cents, or null when it is not
// a valid amount. Integer arithmetic so the net figure is never off by a
// floating-point cent.
function toCents(value) {
  const clean = sanitizeAmountInput(value);
  if (!MONEY_RE.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

function centsToMoney(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
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
  const { recordActivity } = useActivity();
  const [contributions, setContributions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [items, setItems] = useState([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [smsNotice, setSmsNotice] = useState(null); // { contributionId, status } | null
  // The centred dispatch dialog. Separate state from smsNotice because the
  // two have different lifetimes: the popup is the moment of sending and is
  // dismissed, while the inline banner stays on the page afterwards as the
  // record (and keeps the retry action reachable once the popup is closed).
  const [smsPop, setSmsPop] = useState(null);
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
      // Optional enrichment: a failure here (or a database not yet migrated)
      // must not stop anyone recording money.
      setDepartments(await departmentsApi.list().catch(() => []));
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

  const isMobileMoney = form.paymentMethod === 'mobile_money';
  const amountCents = toCents(form.amount);
  const feeTyped = form.transferFee.trim() !== '';
  const feeCents = isMobileMoney && feeTyped ? toCents(form.transferFee) : null;
  // What actually reaches the church account after the agent's Makato.
  const netCents = amountCents !== null && feeCents !== null && feeCents < amountCents ? amountCents - feeCents : null;
  const departmentName = departments.find((d) => String(d.id) === String(form.departmentId))?.name;
  const money = (cents) => (cents === null ? '—' : `TZS ${formatMoney(centsToMoney(cents))}`);
  const setField = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  // Live formula figures. Only mobile money carries an agent fee; for every
  // other method the fee is zero and the net equals the gross. An invalid
  // fee shows "—" rather than a wrong net.
  const formulaFee = isMobileMoney ? (feeCents ?? (feeTyped || amountCents === null ? null : 0)) : amountCents === null ? null : 0;
  const formulaNet = isMobileMoney ? (netCents ?? (feeTyped ? null : amountCents)) : amountCents;

  // Per-step gate. Returns null when the step is complete, otherwise the
  // translated reason — shown inline rather than letting the treasurer
  // reach the review step with a half-filled entry.
  const stepProblem = (which) => {
    if (which === 1) {
      const amount = sanitizeAmountInput(form.amount);
      if (!amount || Number(amount) <= 0) return t('contributions.wizard.error.amount');
      if (!form.contributionDate) return t('contributions.wizard.error.date');
      if (isMobileMoney && form.transferFee.trim()) {
        if (feeCents === null) return t('contributions.makato.error.invalid');
        if (amountCents !== null && feeCents >= amountCents) return t('contributions.makato.error.tooLarge');
      }
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
      const { departmentId, mobileProvider, transferFee, ...rest } = form;
      const result = await contributionsApi.create({
        ...rest,
        amount: sanitizeAmountInput(form.amount),
        departmentId: departmentId ? Number(departmentId) : null,
        // The server refuses provider/fee on any other payment method, so a
        // value left over from switching methods is dropped here.
        mobileProvider: isMobileMoney && mobileProvider ? mobileProvider : undefined,
        transferFee: isMobileMoney && transferFee.trim() ? sanitizeAmountInput(transferFee) : undefined,
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
      // Feeds the navbar's live counter. Fired only after the server
      // confirmed the save — the feed must never claim work that failed.
      recordActivity({ kind: 'contribution', message: t('contributions.activity.recorded') });
      // SMS delivery never blocks or reverses the save above (server/src/
      // modules/contributions/contributions.service.js) — the contribution
      // toast above already fired unconditionally. This is a *separate*,
      // secondary notice: an inline banner (not another toast, which would
      // auto-dismiss and hide the retry action) so a failed send is both
      // honest and recoverable without re-entering the whole contribution.
      if (result.sms) {
        const dispatch = {
          // Bumped on every dispatch so the indicator replays its sequence
          // for a resend instead of sitting on the previous result.
          dispatchId: Date.now(),
          contributionId: result.id,
          status: result.sms.status,
          reasonCode: result.sms.reasonCode,
          reason: result.sms.errorMessage,
          preview: result.sms.preview,
        };
        setSmsNotice(dispatch);
        setSmsPop(dispatch);
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
      const dispatch = {
        dispatchId: Date.now(),
        contributionId: smsNotice.contributionId,
        status: sms.status,
        reasonCode: sms.reasonCode,
        reason: sms.errorMessage,
        preview: sms.preview,
      };
      setSmsNotice(dispatch);
      // A manual resend replays the full dispatch sequence too — the
      // treasurer triggered it deliberately and needs the same confirmation
      // (and the same message preview) they get on the first send.
      setSmsPop(dispatch);
      // No success toast on resend — the indicator's tick already says it,
      // and two simultaneous success signals for one action reads as a bug.
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
    <div className="page">
      <PageHeader title={t('contributions.title')} subtitle={t('contributions.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}
      {/* Shown for EVERY outcome now, not just failures: a clerk who has
          just recorded someone's Zaka should be able to see that the
          confirmation actually went out, and see the exact text that was
          sent. Staff-only page, so the concrete (non-secret) failure reason
          is safe to surface — it's the difference between "contact IT about
          the SMS provider" and "this contributor's phone number is wrong". */}
      {/* Foreground dispatch dialog. key={dispatchId} remounts it on a
          resend so the ticker replays from 1% rather than sitting on the
          previous result. */}
      <AnimatePresence>
        {smsPop && (
          <SmsPopCenter
            key={smsPop.dispatchId}
            dispatch={smsPop}
            onClose={() => setSmsPop(null)}
            onRetry={handleRetrySms}
            retrying={resendingSms}
          />
        )}
      </AnimatePresence>

      {smsNotice && (
        <SmsDispatchIndicator
          key={smsNotice.dispatchId}
          status={smsNotice.status}
          reasonCode={smsNotice.reasonCode}
          reason={smsNotice.reason}
          preview={smsNotice.preview}
          onRetry={handleRetrySms}
          retrying={resendingSms}
        />
      )}

      <PermissionGate permission="income.create">
        <div className="card wizard-canvas">
          <div className="card__header">
            <h2 className="card__title-icon">
              <FiFileText aria-hidden="true" /> {t('contributions.recordNew')}
            </h2>
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
                          <label htmlFor="contribution-amount">{t('contributions.grossAmount')}</label>
                          <div className="currency-input">
                            <span className="currency-input__prefix">TZS</span>
                            <input
                              id="contribution-amount"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              placeholder="0.00"
                              value={form.amount}
                              onChange={handleChange('amount')}
                            />
                          </div>
                        </div>
                        <div className="field">
                          <Dropdown
                            id="contribution-method"
                            label={t('contributions.paymentMethod')}
                            options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))}
                            value={form.paymentMethod}
                            onChange={setField('paymentMethod')}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="contribution-date">{t('contributions.contributionDate')}</label>
                          <input id="contribution-date" type="date" value={form.contributionDate} onChange={handleChange('contributionDate')} />
                        </div>
                        {isMobileMoney && (
                          <>
                            <div className="field">
                              <Dropdown
                                id="contribution-provider"
                                label={t('contributions.makato.provider')}
                                options={MOBILE_PROVIDERS.map((provider) => ({ value: provider, label: t(`mobileProvider.${provider}`) }))}
                                value={form.mobileProvider}
                                onChange={setField('mobileProvider')}
                              />
                            </div>
                            <div className="field">
                              <label htmlFor="contribution-fee">{t('contributions.makato.fee')}</label>
                              <div className="currency-input">
                                <span className="currency-input__prefix">TZS</span>
                                <input
                                  id="contribution-fee"
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  placeholder="0.00"
                                  value={form.transferFee}
                                  onChange={handleChange('transferFee')}
                                />
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* The reactive total. aria-live so a screen-reader user
                          hears the net settle as the amount or fee changes. */}
                      <div className="entry-total" aria-live="polite">
                        <div className="entry-total__term">
                          <span className="entry-total__label">{t('contributions.formula.gross')}</span>
                          <span className="entry-total__value tabular-nums">{money(amountCents)}</span>
                        </div>
                        <span className="entry-total__op" aria-label={t('contributions.makato.minus')}>−</span>
                        <div className="entry-total__term is-fee">
                          <span className="entry-total__label">{t('contributions.formula.fee')}</span>
                          <span className="entry-total__value tabular-nums">{money(formulaFee)}</span>
                        </div>
                        <span className="entry-total__op" aria-label={t('contributions.makato.equals')}>=</span>
                        <div className="entry-total__term is-net">
                          <span className="entry-total__label">{t('contributions.formula.net')}</span>
                          <span className="entry-total__value tabular-nums">{money(formulaNet)}</span>
                        </div>
                      </div>
                      {isMobileMoney && <p className="entry-total__note">{t('contributions.makato.hint')}</p>}
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div className="form-section">
                        <div className="form-section__title"><FiLayers aria-hidden="true" /> {t('contributions.section.details')}</div>
                      </div>
                      <div className="form-grid">
              <div className="field">
                <Dropdown
                  id="contribution-account"
                  label={t('contributions.account')}
                  options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                  value={form.accountId}
                  onChange={setField('accountId')}
                />
              </div>
              <div className="field">
                <Dropdown
                  id="contribution-fund"
                  label={t('contributions.fund')}
                  options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
                  value={form.fundId}
                  onChange={setField('fundId')}
                />
              </div>
              <div className="field">
                <Dropdown
                  id="contribution-category"
                  label={t('contributions.category')}
                  options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                  value={form.categoryId}
                  onChange={setField('categoryId')}
                />
                {categories.length === 0 && (
                  <span className="field-error">
                    {t('categories.emptyHint')} <Link to="/categories">{t('categories.title')}</Link>
                  </span>
                )}
              </div>
              {departments.length > 0 && (
                <div className="field">
                  <Dropdown
                    id="contribution-department"
                    label={t('contributions.department')}
                    options={[
                      { value: '', label: t('contributions.department.none') },
                      ...departments.map((d) => ({ value: String(d.id), label: d.name })),
                    ]}
                    value={form.departmentId}
                    onChange={setField('departmentId')}
                  />
                </div>
              )}
              {contributors.length > 0 && (
                <div className="field">
                  <Dropdown
                    id="contribution-contributor"
                    label={t('contributions.contributor')}
                    options={[
                      { value: '', label: t('contributions.wizard.anonymous') },
                      ...contributors.map((c) => ({ value: String(c.id), label: c.full_name, meta: c.member_number ?? undefined })),
                    ]}
                    value={form.contributorId}
                    onChange={setField('contributorId')}
                  />
                </div>
              )}
              {pledges.length > 0 && (
                <div className="field">
                  <Dropdown
                    id="contribution-pledge"
                    label={t('pledges.title')}
                    options={[
                      { value: '', label: '—' },
                      ...pledges.map((p) => ({
                        value: String(p.id),
                        label: p.contributor?.full_name ?? `#${p.pledge_number}`,
                        meta: `${t('pledges.remaining')}: ${formatMoney(p.remaining_amount)}`,
                      })),
                    ]}
                    value={form.pledgeId}
                    onChange={setField('pledgeId')}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="contribution-reference">{t('common.reference')}</label>
                <input id="contribution-reference" value={form.reference} onChange={handleChange('reference')} />
              </div>
              <div className="field field--full">
                <label htmlFor="contribution-notes">{t('common.notes')}</label>
                <textarea id="contribution-notes" rows={2} value={form.notes} onChange={handleChange('notes')} />
              </div>
                      </div>
                    </>
                  )}

                  {step === 3 && (
                    <>
            <div className="form-section">
              <div className="form-section__title"><FiLayers aria-hidden="true" /> {t('contributions.section.breakdown')}</div>
            </div>
            <label className="check-row">
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
                <button type="button" className="btn btn--secondary btn--sm breakdown-panel__add" onClick={addItem}>
                  <FiPlus aria-hidden="true" /> {t('contributions.addItem')}
                </button>
                {items.length > 0 && (
                  <div className="breakdown-total">
                    <span>{t('reports.total')}</span>
                    <span className="tabular-nums">{formatMoney(itemsTotal ?? '0.00')}</span>
                  </div>
                )}
                {itemsMismatch && (
                  <div className="field-error breakdown-panel__error">
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
                          <dd>
                            {t(`paymentMethod.${form.paymentMethod}`)}
                            {isMobileMoney && form.mobileProvider && ` · ${t(`mobileProvider.${form.mobileProvider}`)}`}
                          </dd>
                        </div>
                        {feeCents !== null && (
                          <div className="wizard-review__row">
                            <dt>{t('contributions.makato.feeShort')}</dt>
                            <dd className="tabular-nums">
                              TZS {formatMoney(centsToMoney(feeCents))}
                              {netCents !== null && (
                                <span className="field-hint"> — {t('contributions.makato.net')}: TZS {formatMoney(centsToMoney(netCents))}</span>
                              )}
                            </dd>
                          </div>
                        )}
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
                        {departmentName && (
                          <div className="wizard-review__row">
                            <dt>{t('contributions.department')}</dt>
                            <dd>{departmentName}</dd>
                          </div>
                        )}
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

      <div className="card ledger-card">
        <div className="ledger-toolbar">
          <div className="ledger-toolbar__title">
            <h2>{t('contributions.ledger.title')}</h2>
          </div>
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
            <table className="data-table data-table--dense">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('contributions.ledger.source')}</th>
                  <th>{t('contributions.paymentMethod')}</th>
                  <th className="is-amount">{t('contributions.makato.feeShort')}</th>
                  <th className="is-amount">{t('common.amount')}</th>
                  <th>{t('common.status')}</th>
                  <th className="col-actions">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((c) => {
                  const reversed = c.status === 'reversed';
                  return (
                    <tr key={c.id} className={reversed ? 'is-reversed' : undefined}>
                      <td>
                        {/* Contribution date (the day the money was received) over
                            the local time it was entered. */}
                        <span className="ledger-stamp">
                          <span className="ledger-stamp__date">{formatDate(c.contribution_date)}</span>
                          {c.created_at && <span className="ledger-stamp__time">{formatTime(c.created_at)}</span>}
                        </span>
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span className="cell-stack__primary">
                            {c.contributor?.full_name ?? t('contributions.wizard.anonymous')}
                          </span>
                          {c.reference && <span className="cell-stack__secondary is-ref">{c.reference}</span>}
                        </span>
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span className="cell-stack__primary">{t(`paymentMethod.${c.payment_method}`)}</span>
                          {c.mobile_provider && (
                            <span className="cell-stack__secondary">{t(`mobileProvider.${c.mobile_provider}`)}</span>
                          )}
                        </span>
                      </td>
                      <td className="is-numeric ledger-fee">
                        {c.transfer_fee !== null && c.transfer_fee !== undefined ? `− ${formatMoney(c.transfer_fee)}` : '—'}
                      </td>
                      <td className="is-amount is-income">+ {formatMoney(c.amount)}</td>
                      <td>
                        <span className={`badge badge--dot ${reversed ? 'badge--danger' : 'badge--success'}`}>
                          {reversed ? t('contributions.reversed') : t('contributions.posted')}
                        </span>
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <PermissionGate permission="receipts.view">
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => receiptsApi.openPdfForContribution(c.id).catch((err) => setError(unwrapApiError(err).message))}
                            >
                              <FiDownload aria-hidden="true" /> {t('receipts.download')}
                            </button>
                          </PermissionGate>
                          {c.status === 'posted' && (
                            <PermissionGate permission="income.reverse">
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleReverse(c.id)}>
                                <FiRotateCcw aria-hidden="true" /> {t('contributions.reverse')}
                              </button>
                            </PermissionGate>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="ledger-more">
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
