import { useCallback, useEffect, useState } from 'react';
import { accountsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';

const TYPES = ['cash', 'bank', 'mobile_money'];

export default function AccountsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'cash' });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await accountsApi.list());
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-mount pattern (react.dev/learn/synchronizing-with-effects#fetching-data).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await accountsApi.create(form);
      setForm({ name: '', type: 'cash' });
      await load();
      toast.success(t('accounts.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const toggleActive = async (account) => {
    if (account.is_active) {
      const ok = await confirm({
        title: t('common.deactivate'),
        message: t('accounts.deactivateConfirm'),
        tone: 'danger',
        confirmLabel: t('common.deactivate'),
      });
      if (!ok) return;
    }
    try {
      await (account.is_active ? accountsApi.deactivate(account.id) : accountsApi.activate(account.id));
      await load();
      toast.success(account.is_active ? t('accounts.deactivatedToast') : t('accounts.activatedToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleRename = async (account) => {
    const name = window.prompt(t('common.rename'), account.name);
    if (!name || name === account.name) return;
    try {
      await accountsApi.rename(account.id, name);
      await load();
      toast.success(t('common.saved'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('accounts.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="accounts.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('accounts.addNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="account-name">{t('common.name')}</label>
                <input
                  id="account-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <Dropdown
                  id="account-type"
                  label={t('accounts.type')}
                  options={TYPES.map((ty) => ({ value: ty, label: t(`accounts.type.${ty}`) }))}
                  value={form.type}
                  onChange={(type) => setForm((f) => ({ ...f, type }))}
                />
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
          <SkeletonTable rows={4} columns={4} />
        ) : accounts.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('accounts.type')}</th>
                  <th>{t('common.status')}</th>
                  <PermissionGate permission="accounts.manage">
                    <th>{t('common.actions')}</th>
                  </PermissionGate>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{t(`accounts.type.${a.type}`)}</td>
                    <td>
                      <span className={`badge ${a.is_active ? 'badge--success' : 'badge--neutral'}`}>
                        {a.is_active ? t('common.active') : t('common.inactive')}
                      </span>
                    </td>
                    <PermissionGate permission="accounts.manage">
                      <td>
                        <div className="row-actions">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleRename(a)}>
                            {t('common.rename')}
                          </button>
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => toggleActive(a)}>
                            {a.is_active ? t('common.deactivate') : t('common.activate')}
                          </button>
                        </div>
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
