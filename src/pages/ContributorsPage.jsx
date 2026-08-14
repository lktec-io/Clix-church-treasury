import { useCallback, useEffect, useState } from 'react';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';

function emptyForm() {
  return { fullName: '', phone: '', email: '', memberNumber: '' };
}

export default function ContributorsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [contributors, setContributors] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContributors(await contributorsApi.list());
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
      await contributorsApi.create(form);
      setForm(emptyForm());
      await load();
      toast.success(t('contributors.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnablePortal = async (contributor) => {
    setActioningId(contributor.id);
    setError(null);
    try {
      const result = await contributorsApi.enablePortalAccess(contributor.id);
      await load();
      toast.success(
        result.sms?.status === 'sent'
          ? t('contributors.portalEnabledSmsSent')
          : t('contributors.portalEnabledSmsPending')
      );
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setActioningId(null);
    }
  };

  const handleResetPin = async (contributor) => {
    const result = await confirm({
      title: t('contributors.resetPin'),
      message: t('contributors.resetPinConfirm'),
      tone: 'danger',
      confirmLabel: t('contributors.resetPin'),
    });
    if (!result.confirmed) return;
    setActioningId(contributor.id);
    setError(null);
    try {
      await contributorsApi.resetPin(contributor.id);
      toast.success(t('contributors.pinResetToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div>
      <h1>{t('contributors.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="contributors.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('contributors.addNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('contributors.fullName')}</label>
                <input value={form.fullName} onChange={handleChange('fullName')} required />
              </div>
              <div className="field">
                <label>{t('contributors.phone')}</label>
                <input value={form.phone} onChange={handleChange('phone')} />
              </div>
              <div className="field">
                <label>{t('contributors.email')}</label>
                <input type="email" value={form.email} onChange={handleChange('email')} />
              </div>
              <div className="field">
                <label>{t('contributors.memberNumber')}</label>
                <input value={form.memberNumber} onChange={handleChange('memberNumber')} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : contributors.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('contributors.fullName')}</th>
                  <th>{t('contributors.phone')}</th>
                  <th>{t('contributors.email')}</th>
                  <th>{t('contributors.memberNumber')}</th>
                  <th>{t('contributors.portalAccess')}</th>
                  <PermissionGate permission="contributors.manage">
                    <th>{t('common.actions')}</th>
                  </PermissionGate>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.full_name}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{c.email ?? '—'}</td>
                    <td>{c.member_number ?? '—'}</td>
                    <td>
                      <span className={`badge ${c.portal_enabled_at ? 'badge--success' : 'badge--neutral'}`}>
                        {c.portal_enabled_at ? t('contributors.portalEnabled') : t('contributors.portalNotEnabled')}
                      </span>
                    </td>
                    <PermissionGate permission="contributors.manage">
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!c.portal_enabled_at ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={actioningId === c.id || !c.phone}
                            title={!c.phone ? t('contributors.phoneRequiredHint') : undefined}
                            onClick={() => handleEnablePortal(c)}
                          >
                            {t('contributors.enablePortal')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={actioningId === c.id}
                            onClick={() => handleResetPin(c)}
                          >
                            {t('contributors.resetPin')}
                          </button>
                        )}
                      </td>
                    </PermissionGate>
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
