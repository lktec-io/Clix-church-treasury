import { useCallback, useEffect, useState } from 'react';
import { pledgesApi, contributorsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, sanitizeAmountInput } from '../utils/format.js';

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
      <PageHeader title={t('pledges.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="pledges.create">
        <div className="card">
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
              <div className="field">
                <label htmlFor="pledge-frequency">{t('pledges.frequency')}</label>
                <select id="pledge-frequency" value={form.frequency} onChange={handleChange('frequency')}>
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>{t(`pledges.frequency.${f}`)}</option>
                  ))}
                </select>
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

      <div className="card">
        {loading ? (
          <SkeletonTable rows={4} columns={8} />
        ) : pledges.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('pledges.contributor')}</th>
                  <th>{t('pledges.fund')}</th>
                  <th className="is-amount">{t('pledges.pledgedAmount')}</th>
                  <th>{t('pledges.installment')}</th>
                  <th className="is-amount">{t('pledges.timesContributed')}</th>
                  <th className="is-amount">{t('pledges.fulfilled')}</th>
                  <th className="is-amount">{t('pledges.remaining')}</th>
                  <th>{t('pledges.progress')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pledges.map((p) => (
                  <tr key={p.id}>
                    <td>{p.contributor?.full_name ?? '—'}</td>
                    <td>{funds.find((f) => f.id === p.fund_id)?.name ?? '—'}</td>
                    <td className="is-amount">{formatMoney(p.pledged_amount)}</td>
                    <td>
                      {p.schedule ? (
                        <span className="pledge-installment">
                          <span className="tabular-nums">{formatMoney(p.schedule.installment)}</span>
                          <span className="field-hint">
                            {t(`pledges.per.${p.schedule.frequency}`)} · {t('pledges.periodsElapsed', { elapsed: p.schedule.periodsElapsed, total: p.schedule.periods })}
                          </span>
                        </span>
                      ) : (
                        <span className="field-hint">{t(`pledges.frequency.${p.frequency ?? 'once'}`)}</span>
                      )}
                    </td>
                    <td className="is-amount">{p.payment_count ?? 0}</td>
                    <td className="is-amount">{formatMoney(p.fulfilled_amount)}</td>
                    <td className="is-amount">{formatMoney(p.remaining_amount)}</td>
                    <td>
                      {/* Only meaningful for a live recurring pledge: a one-off
                          or finished pledge has no "behind" to be. */}
                      {p.schedule && p.status === 'active' ? (
                        Number(p.schedule.arrears) > 0 ? (
                          <span className="badge badge--danger">{t('pledges.behind', { amount: formatMoney(p.schedule.arrears) })}</span>
                        ) : (
                          <span className="badge badge--success">{t('pledges.onTrack')}</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[p.status]}`}>{t(`pledges.status.${p.status}`)}</span>
                    </td>
                    <td>
                      {p.status === 'active' && (
                        <PermissionGate permission="pledges.create">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleCancel(p)}>
                            {t('pledges.cancel')}
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
      </div>
    </div>
  );
}
