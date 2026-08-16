import { useCallback, useEffect, useState } from 'react';
import { fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';

export default function FundsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [funds, setFunds] = useState([]);
  const [form, setForm] = useState({ name: '', isRestricted: false });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFunds(await fundsApi.list());
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await fundsApi.create(form);
      setForm({ name: '', isRestricted: false });
      await load();
      toast.success(t('funds.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const toggleActive = async (fund) => {
    if (fund.is_active) {
      const ok = await confirm({
        title: t('common.deactivate'),
        message: t('funds.deactivateConfirm'),
        tone: 'danger',
        confirmLabel: t('common.deactivate'),
      });
      if (!ok) return;
    }
    try {
      await (fund.is_active ? fundsApi.deactivate(fund.id) : fundsApi.activate(fund.id));
      await load();
      toast.success(fund.is_active ? t('funds.deactivatedToast') : t('funds.activatedToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleRename = async (fund) => {
    const name = window.prompt(t('common.rename'), fund.name);
    if (!name || name === fund.name) return;
    try {
      await fundsApi.rename(fund.id, name);
      await load();
      toast.success(t('common.saved'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader title={t('funds.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="funds.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('funds.addNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('common.name')}</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={form.isRestricted}
                    onChange={(e) => setForm((f) => ({ ...f, isRestricted: e.target.checked }))}
                    style={{ marginRight: 6 }}
                  />
                  {t('funds.restricted')}
                </label>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary">{t('common.create')}</button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : funds.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('funds.restricted')}</th>
                  <th>{t('common.status')}</th>
                  <PermissionGate permission="funds.manage">
                    <th>{t('common.actions')}</th>
                  </PermissionGate>
                </tr>
              </thead>
              <tbody>
                {funds.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}</td>
                    <td>{f.is_restricted ? t('common.active') : '—'}</td>
                    <td>
                      <span className={`badge ${f.is_active ? 'badge--success' : 'badge--neutral'}`}>
                        {f.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <PermissionGate permission="funds.manage">
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleRename(f)}>
                          {t('common.rename')}
                        </button>
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => toggleActive(f)}>
                          {f.is_active ? t('common.deactivate') : t('common.activate')}
                        </button>
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
