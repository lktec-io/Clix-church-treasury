import { useCallback, useEffect, useState } from 'react';
import { usersApi, rolesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';

function emptyForm() {
  return { email: '', fullName: '' };
}

const STATUS_BADGE = {
  active: 'badge--success',
  invited: 'badge--warning',
  disabled: 'badge--neutral',
};

export default function UsersPage() {
  const { t } = useLocale();
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [roleChoice, setRoleChoice] = useState({});
  const [devInviteToken, setDevInviteToken] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userData, roleData] = await Promise.all([usersApi.list(), rolesApi.list()]);
      setUsers(userData);
      setRoles(roleData);
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

  const handleInvite = async (e) => {
    e.preventDefault();
    setError(null);
    setDevInviteToken(null);
    setSubmitting(true);
    try {
      const result = await usersApi.invite(form);
      setForm(emptyForm());
      await load();
      toast.success(t('users.invited'));
      if (result.devInviteToken) setDevInviteToken(result.devInviteToken);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignRole = async (user) => {
    const roleId = Number(roleChoice[user.id]);
    if (!roleId) return;
    try {
      await usersApi.assignRole(user.id, roleId);
      await load();
      toast.success(t('users.roleAssigned'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleRemoveRole = async (user, roleId) => {
    try {
      await usersApi.removeRole(user.id, roleId);
      await load();
      toast.success(t('users.roleRemoved'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleDisable = async (user) => {
    const ok = await confirm({
      title: t('users.disable'),
      message: t('users.disableConfirm'),
      tone: 'danger',
      confirmLabel: t('users.disable'),
    });
    if (!ok) return;
    try {
      await usersApi.disable(user.id);
      await load();
      toast.success(t('users.disabledToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <PageHeader title={t('users.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="users.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('users.invite')}</h2>
          </div>
          <form onSubmit={handleInvite}>
            <div className="form-grid">
              <div className="field">
                <label>{t('contributors.fullName')}</label>
                <input value={form.fullName} onChange={handleChange('fullName')} required />
              </div>
              <div className="field">
                <label>{t('auth.login.email')}</label>
                <input type="email" value={form.email} onChange={handleChange('email')} required />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('users.invite')}
              </button>
            </div>
          </form>
          {devInviteToken && (
            <div className="alert alert--success" style={{ marginTop: 12, wordBreak: 'break-all' }}>
              {t('users.devTokenHint')}: <code>{devInviteToken}</code>
            </div>
          )}
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : users.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('contributors.fullName')}</th>
                  <th>{t('auth.login.email')}</th>
                  <th>{t('users.roles')}</th>
                  <th>{t('common.status')}</th>
                  <PermissionGate permission="users.manage">
                    <th>{t('common.actions')}</th>
                  </PermissionGate>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>
                      {u.roles.length === 0
                        ? '—'
                        : u.roles.map((r) => (
                            <span key={r.id} className="badge badge--neutral" style={{ marginRight: 4 }}>
                              {r.name}
                              <PermissionGate permission="users.manage">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRole(u, r.id)}
                                  aria-label={`${t('common.deactivate')} ${r.name}`}
                                  style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                                >
                                  ×
                                </button>
                              </PermissionGate>
                            </span>
                          ))}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[u.status]}`}>{t(`users.status.${u.status}`)}</span>
                    </td>
                    <PermissionGate permission="users.manage">
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <select
                          value={roleChoice[u.id] ?? ''}
                          onChange={(e) => setRoleChoice((c) => ({ ...c, [u.id]: e.target.value }))}
                          style={{ maxWidth: 160 }}
                        >
                          <option value="">—</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleAssignRole(u)}>
                          {t('users.assignRole')}
                        </button>
                        {u.status !== 'disabled' && u.id !== session?.user?.id && (
                          <button type="button" className="btn btn--danger btn--sm" onClick={() => handleDisable(u)}>
                            {t('users.disable')}
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
