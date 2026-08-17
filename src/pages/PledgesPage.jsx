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

function emptyForm() {
  return { contributorId: '', fundId: '', pledgedAmount: '', pledgeDate: new Date().toISOString().slice(0, 10), targetDate: '' };
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
                <label>{t('pledges.contributor')}</label>
                <select value={form.contributorId} onChange={handleChange('contributorId')} required>
                  <option value="" disabled>—</option>
                  {contributors.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('pledges.fund')}</label>
                <select value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('pledges.pledgedAmount')}</label>
                <input type="text" inputMode="decimal" placeholder="0.00" value={form.pledgedAmount} onChange={handleChange('pledgedAmount')} required />
              </div>
              <div className="field">
                <label>{t('pledges.pledgeDate')}</label>
                <input type="date" value={form.pledgeDate} onChange={handleChange('pledgeDate')} required />
              </div>
              <div className="field">
                <label>{t('pledges.targetDate')}</label>
                <input type="date" value={form.targetDate} onChange={handleChange('targetDate')} />
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
          <SkeletonTable rows={4} columns={6} />
        ) : pledges.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('pledges.contributor')}</th>
                  <th>{t('pledges.fund')}</th>
                  <th>{t('pledges.pledgedAmount')}</th>
                  <th>{t('pledges.fulfilled')}</th>
                  <th>{t('pledges.remaining')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pledges.map((p) => (
                  <tr key={p.id}>
                    <td>{p.contributor?.full_name ?? '—'}</td>
                    <td>{funds.find((f) => f.id === p.fund_id)?.name ?? '—'}</td>
                    <td>{formatMoney(p.pledged_amount)}</td>
                    <td>{formatMoney(p.fulfilled_amount)}</td>
                    <td>{formatMoney(p.remaining_amount)}</td>
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
