import { useCallback, useEffect, useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { pledgesApi, contributorsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import RecordedStamp from '../components/ui/RecordedStamp.jsx';
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
  const [fieldErrors, setFieldErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pledgeData, fundData] = await Promise.all([pledgesApi.list(), fundsApi.list()]);
      setPledges(pledgeData);
      setFunds(fundData);
      try {
        setContributors(await contributorsApi.list());
      } catch {
        // Caller may lack contributors.view — the form then has no member to
        // pick, so such a role can view pledges but not create them.
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
  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  };
  const isRecurring = form.frequency !== 'once';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // The dropdowns are not native <select required>, so the browser does
    // not block an empty choice — checked here, and reported on the control
    // itself rather than as a banner at the top of the page.
    const errors = {};
    if (!form.contributorId) errors.contributorId = t('common.required');
    if (!form.fundId) errors.fundId = t('common.required');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
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
      setFieldErrors({});
      await load();
      toast.success(t('pledges.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Permanent removal, refused by the server (409) once any payment has
  // been recorded against the pledge.
  const handleHardDelete = async (pledge) => {
    const ok = await confirm({
      title: t('common.deletePermanently'),
      message: `${t('common.deleteConfirm')} — ${pledge.contributor?.full_name ?? ''} ${formatMoney(pledge.pledged_amount)}`,
      tone: 'danger',
      confirmLabel: t('common.deletePermanently'),
    });
    if (!ok) return;
    setError(null);
    try {
      await pledgesApi.remove(pledge.id);
      await load();
      toast.success(t('pledges.deletedToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
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
    <div className="page">
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
                <Dropdown
                  id="pledge-contributor"
                  label={t('pledges.contributor')}
                  options={contributors.map((c) => ({ value: String(c.id), label: c.full_name, meta: c.member_number ?? undefined }))}
                  value={form.contributorId}
                  onChange={setField('contributorId')}
                  invalid={Boolean(fieldErrors.contributorId)}
                  errorId="pledge-contributor-error"
                />
                {fieldErrors.contributorId && (
                  <span className="field-error" id="pledge-contributor-error">{fieldErrors.contributorId}</span>
                )}
              </div>
              <div className="field">
                <Dropdown
                  id="pledge-fund"
                  label={t('pledges.fund')}
                  options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
                  value={form.fundId}
                  onChange={setField('fundId')}
                  invalid={Boolean(fieldErrors.fundId)}
                  errorId="pledge-fund-error"
                />
                {fieldErrors.fundId && <span className="field-error" id="pledge-fund-error">{fieldErrors.fundId}</span>}
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
                <Dropdown
                  id="pledge-frequency"
                  label={t('pledges.frequency')}
                  options={FREQUENCIES.map((f) => ({ value: f, label: t(`pledges.frequency.${f}`) }))}
                  value={form.frequency}
                  onChange={setField('frequency')}
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
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('pledges.recordedAt')}</th>
                  <th>{t('pledges.contributor')}</th>
                  <th>{t('pledges.frequency')}</th>
                  <th className="is-amount">{t('pledges.installment')}</th>
                  <th className="is-amount">{t('pledges.pledgedAmount')}</th>
                  <th className="is-amount">{t('pledges.fulfilled')}</th>
                  <th className="is-amount">{t('pledges.remaining')}</th>
                  <th>{t('pledges.standing')}</th>
                  <th>{t('common.status')}</th>
                  <th className="col-actions">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pledges.map((p) => {
                  const behind = p.schedule && p.status === 'active' && Number(p.schedule.arrears) > 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <RecordedStamp value={p.created_at} />
                      </td>
                      <td>
                        <span className="cell-stack">
                          <span className="cell-stack__primary">{p.contributor?.full_name ?? '—'}</span>
                          <span className="cell-stack__secondary">{funds.find((f) => f.id === p.fund_id)?.name ?? '—'}</span>
                        </span>
                      </td>
                      <td>{t(`pledges.frequency.${p.frequency ?? 'once'}`)}</td>
                      <td className="is-numeric">
                        {p.schedule ? (
                          <>
                            {formatMoney(p.schedule.installment)} <span className="cell-unit">{t(`pledges.per.${p.schedule.frequency}`)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="is-amount">{formatMoney(p.pledged_amount)}</td>
                      <td className="is-amount is-income">{formatMoney(p.fulfilled_amount)}</td>
                      <td className={`is-amount${Number(p.remaining_amount) > 0 ? ' is-outstanding' : ''}`}>
                        {formatMoney(p.remaining_amount)}
                      </td>
                      <td>
                        {/* Only a live recurring pledge has a schedule to be behind on. */}
                        {p.schedule && p.status === 'active' ? (
                          behind ? (
                            <span className="badge badge--danger">{t('pledges.behind', { amount: formatMoney(p.schedule.arrears) })}</span>
                          ) : (
                            <span className="badge badge--success">{t('pledges.onTrack')}</span>
                          )
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[p.status]}`}>{t(`pledges.status.${p.status}`)}</span>
                      </td>
                      <td className="col-actions">
                        <PermissionGate permission="pledges.create">
                          <div className="row-actions">
                            {p.status === 'active' && (
                              <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleCancel(p)}>
                                {t('pledges.cancel')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-btn icon-btn--danger"
                              aria-label={t('common.deletePermanently')}
                              title={t('common.deletePermanently')}
                              onClick={() => handleHardDelete(p)}
                            >
                              <FiTrash2 aria-hidden="true" />
                            </button>
                          </div>
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
    </div>
  );
}
