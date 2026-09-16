import { useCallback, useEffect, useState } from 'react';
import { pledgesApi, contributorsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import ChoiceTiles from '../components/ui/ChoiceTiles.jsx';
import { formatDate, formatMoney, sanitizeAmountInput } from '../utils/format.js';

// Paid share of the pledge, 0–100, for the progress bar. Display only.
function paidPercent(pledge) {
  const pledged = Number(pledge.pledged_amount);
  const paid = Number(pledge.fulfilled_amount);
  if (!Number.isFinite(pledged) || pledged <= 0 || !Number.isFinite(paid)) return 0;
  return Math.max(0, Math.min(100, Math.round((paid / pledged) * 100)));
}

const STATUS_BADGE = {
  active: 'badge--warning',
  completed: 'badge--success',
  cancelled: 'badge--neutral',
};

// Mirrors server pledgeSchedule.js#PLEDGE_FREQUENCIES.
const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly'];

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function emptyForm() {
  return { contributorId: '', fundId: '', pledgedAmount: '', pledgeDate: localToday(), targetDate: '', frequency: 'once' };
}

export default function PledgesPage() {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [pledges, setPledges] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [funds, setFunds] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pledgeData, fundData] = await Promise.all([pledgesApi.list(), fundsApi.list()]);
      setPledges(pledgeData);
      setFunds(fundData);
      try {
        setContributors(await contributorsApi.list());
      } catch {
        // Caller may lack contributors.view — the create form simply won't
        // offer a contributor picker in that case; pledges.create requires
        // choosing one, so a role without contributors.view can view but
        // not create pledges in practice.
      }
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

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const isRecurring = form.frequency !== 'once';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await pledgesApi.create({
        ...form,
        pledgedAmount: sanitizeAmountInput(form.pledgedAmount),
        contributorId: Number(form.contributorId),
        fundId: Number(form.fundId),
        targetDate: form.targetDate || null,
      });
      setForm(emptyForm());
      await load();
      toast.success(t('pledges.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (pledge) => {
    const ok = await confirm({
      title: t('pledges.cancel'),
      message: t('pledges.cancelConfirm'),
      tone: 'danger',
      confirmLabel: t('pledges.cancel'),
    });
    if (!ok) return;
    try {
      await pledgesApi.setStatus(pledge.id, 'cancelled');
      await load();
      toast.success(t('pledges.cancelledToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader title={t('pledges.title')} subtitle={t('pledges.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="pledges.create">
        <div className="card form-card">
          <div className="card__header">
            <h2>{t('pledges.new')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="pledge-contributor">{t('pledges.contributor')}</label>
                <select id="pledge-contributor" value={form.contributorId} onChange={handleChange('contributorId')} required>
                  <option value="" disabled>—</option>
                  {contributors.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pledge-fund">{t('pledges.fund')}</label>
                <select id="pledge-fund" value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pledge-amount">{t('pledges.pledgedAmount')}</label>
                <input
                  id="pledge-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.pledgedAmount}
                  onChange={handleChange('pledgedAmount')}
                  required
                />
              </div>
              <div className="field field--full">
                <ChoiceTiles
                  legend={t('pledges.frequency')}
                  options={FREQUENCIES.map((f) => ({ value: f, label: t(`pledges.frequency.${f}`) }))}
                  value={form.frequency}
                  onChange={(frequency) => setForm((current) => ({ ...current, frequency }))}
                />
              </div>
              <div className="field">
                <label htmlFor="pledge-date">{t('pledges.pledgeDate')}</label>
                <input id="pledge-date" type="date" value={form.pledgeDate} onChange={handleChange('pledgeDate')} required />
              </div>
              <div className="field">
                <label htmlFor="pledge-target">{isRecurring ? t('pledges.endDate') : t('pledges.targetDate')}</label>
                <input
                  id="pledge-target"
                  type="date"
                  value={form.targetDate}
                  min={form.pledgeDate || undefined}
                  onChange={handleChange('targetDate')}
                  // A recurring pledge needs an end to know how many installments it has.
                  required={isRecurring}
                />
                {isRecurring && <span className="field-hint">{t('pledges.endDateHint')}</span>}
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card ledger-card">
        <div className="ledger-toolbar">
          <div className="ledger-toolbar__title">
            <h2>{t('pledges.ledger.title')}</h2>
            {!loading && (
              <span className="ledger-toolbar__count tabular-nums">{t('pledges.ledger.count', { count: pledges.length })}</span>
            )}
          </div>
        </div>
        {loading ? (
          <SkeletonTable rows={4} columns={8} />
        ) : pledges.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--dense">
              <thead>
                <tr>
                  <th>{t('pledges.contributor')}</th>
                  <th className="is-amount">{t('pledges.pledgedAmount')}</th>
                  <th>{t('pledges.installment')}</th>
                  <th className="is-amount">{t('pledges.fulfilled')}</th>
                  <th className="is-amount">{t('pledges.remaining')}</th>
                  <th>{t('pledges.repayment')}</th>
                  <th>{t('pledges.progress')}</th>
                  <th>{t('common.status')}</th>
                  <th className="col-actions">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pledges.map((p) => {
                  const percent = paidPercent(p);
                  const behind = p.schedule && p.status === 'active' && Number(p.schedule.arrears) > 0;
                  return (
                    <tr key={p.id} className={behind ? 'is-behind' : undefined}>
                      <td>
                        <span className="cell-stack">
                          <span className="cell-stack__primary">{p.contributor?.full_name ?? '—'}</span>
                          <span className="cell-stack__secondary">
                            {funds.find((f) => f.id === p.fund_id)?.name ?? '—'}
                            {p.target_date ? ` · ${t('pledges.due', { date: formatDate(p.target_date) })}` : ''}
                          </span>
                        </span>
                      </td>
                      <td className="is-amount">
                        <span className="cell-stack is-end">
                          <span className="cell-stack__primary">{formatMoney(p.pledged_amount)}</span>
                          <span className="cell-stack__secondary">{t(`pledges.frequency.${p.frequency ?? 'once'}`)}</span>
                        </span>
                      </td>
                      <td>
                        {p.schedule ? (
                          <span className="cell-stack">
                            <span className="cell-stack__primary tabular-nums">
                              {formatMoney(p.schedule.installment)}{' '}
                              <span className="cell-unit">{t(`pledges.per.${p.schedule.frequency}`)}</span>
                            </span>
                            <span className="cell-stack__secondary tabular-nums">
                              {t('pledges.periodsElapsed', { elapsed: p.schedule.periodsElapsed, total: p.schedule.periods })}
                            </span>
                          </span>
                        ) : (
                          <span className="cell-muted">{t('pledges.lumpSum')}</span>
                        )}
                      </td>
                      <td className="is-amount">
                        <span className="cell-stack is-end">
                          <span className="cell-stack__primary">{formatMoney(p.fulfilled_amount)}</span>
                          <span className="cell-stack__secondary tabular-nums">
                            {t('pledges.paymentsCount', { count: p.payment_count ?? 0 })}
                          </span>
                        </span>
                      </td>
                      <td className={`is-amount${Number(p.remaining_amount) > 0 ? ' is-outstanding' : ''}`}>
                        {formatMoney(p.remaining_amount)}
                      </td>
                      <td>
                        {/* Only meaningful for a live recurring pledge: a one-off
                            or finished pledge has no schedule to be behind on. */}
                        {p.schedule && p.status === 'active' ? (
                          <span className="cell-stack">
                            {behind ? (
                              <span className="badge badge--dot badge--danger">
                                {t('pledges.behind', { amount: formatMoney(p.schedule.arrears) })}
                              </span>
                            ) : (
                              <span className="badge badge--dot badge--success">{t('pledges.onTrack')}</span>
                            )}
                            <span className="cell-stack__secondary tabular-nums">
                              {t('pledges.expectedToDate', { amount: formatMoney(p.schedule.expectedToDate) })}
                            </span>
                          </span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className="amortization-progress">
                          <span className="progress-meter progress-meter--income" role="img" aria-label={`${percent}%`}>
                            <span className="progress-meter__fill" style={{ width: `${percent}%` }} />
                          </span>
                          <span className="amortization-progress__value tabular-nums">{percent}%</span>
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge--dot ${STATUS_BADGE[p.status]}`}>{t(`pledges.status.${p.status}`)}</span>
                      </td>
                      <td className="col-actions">
                        {p.status === 'active' && (
                          <PermissionGate permission="pledges.create">
                            <div className="row-actions">
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleCancel(p)}>
                                {t('pledges.cancel')}
                              </button>
                            </div>
                          </PermissionGate>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
