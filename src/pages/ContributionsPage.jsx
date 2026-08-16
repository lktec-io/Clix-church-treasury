import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { FiDollarSign, FiLayers, FiPlus, FiX, FiRefreshCw } from 'react-icons/fi';
import { contributionsApi, accountsApi, fundsApi, categoriesApi, contributorsApi, pledgesApi, receiptsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { formatMoney, formatDate, sanitizeAmountInput } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];
const PAGE_SIZE = 50;

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

  const handleSubmit = async (e) => {
    e.preventDefault();
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
            <span style={{ fontSize: 12, opacity: 0.85 }}>{t(`contributions.sms.reasonCode.${smsNotice.reasonCode}`)}</span>
          ) : (
            smsNotice.reason && (
              <span style={{ fontSize: 12, opacity: 0.85 }}>{t('contributions.sms.reason', { reason: smsNotice.reason })}</span>
            )
          )}
        </div>
      )}

      <PermissionGate permission="income.create">
        <div className="card">
          <div className="card__header">
            <h2>{t('contributions.recordNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
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
                    required
                  />
                </div>
              </div>
            </div>

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
              <div className="field">
                <label>{t('contributions.paymentMethod')}</label>
                <select value={form.paymentMethod} onChange={handleChange('paymentMethod')} required>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`paymentMethod.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.contributionDate')}</label>
                <input type="date" value={form.contributionDate} onChange={handleChange('contributionDate')} required />
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
              <div className="card" style={{ background: 'var(--bg-muted)', boxShadow: 'none', padding: 14 }}>
                {items.map((item, index) => (
                  <div key={index} className="breakdown-row">
                    <input
                      placeholder={t('contributions.itemPurpose')}
                      value={item.purpose}
                      onChange={updateItem(index, 'purpose')}
                      className="breakdown-row__purpose"
                      style={{ background: 'var(--surface)' }}
                      required
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={updateItem(index, 'amount')}
                      className="breakdown-row__amount"
                      style={{ background: 'var(--surface)' }}
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
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting || itemsMismatch}>
                {submitting ? t('common.loading') : t('common.record')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        <div className="card__header">
          <h2>{t('contributions.title')}</h2>
        </div>
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
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
                    <td style={{ display: 'flex', gap: 6 }}>
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
