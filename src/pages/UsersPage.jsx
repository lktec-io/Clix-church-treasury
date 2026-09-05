import { useCallback, useEffect, useState } from 'react';
import { usersApi, rolesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';

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
    // Clear any banner from a previous attempt before starting a new one —
    // otherwise a stale "you cannot remove a role from your own account"
    // sits above a role change that has just succeeded.
    setError(null);
    try {
      await usersApi.assignRole(user.id, roleId);
      // Reset this row's picker so it does not keep displaying the role that
      // has just been granted, which invites a second click that the server
      // treats as a silent no-op (assign is INSERT IGNORE).
      setRoleChoice((c) => ({ ...c, [user.id]: '' }));
      await load();
      toast.success(t('users.roleAssigned'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleRemoveRole = async (user, roleId) => {
    setError(null);
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
    // confirm() resolves to a bare boolean unless `requireReason` is set, in
    // which case it resolves to { confirmed, reason } — see ConfirmDialog.jsx.
    // No reason is required here, so this is the boolean form.
    if (!ok) return;
    setError(null);
    try {
      await usersApi.disable(user.id);
      await load();
      toast.success(t('users.disabledToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const isSelf = (user) => user.id === session?.user?.id;

  // Roles this user does not already hold. Offering the full catalog meant
  // the picker listed roles the member already had, where "Assign" is an
  // INSERT IGNORE no-op — a button that reports success and changes nothing.
  const assignableRoles = (user) => {
    const held = new Set(user.roles.map((r) => r.id));
    return roles.filter((r) => !held.has(r.id));
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
          <SkeletonTable rows={4} columns={4} />
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
                              {/* No remove control on your own roles: the
                                  server refuses self-removal outright
                                  (users.service.js guards against the
                                  self-lockout it would cause), so the button
                                  could only ever produce a 403. */}
                              {!isSelf(u) && (
                                <PermissionGate permission="users.manage">
                                  <button
                                    type="button"
                                    className="badge__remove"
                                    onClick={() => handleRemoveRole(u, r.id)}
                                    aria-label={`${t('common.deactivate')} ${r.name}`}
                                  >
                                    ×
                                  </button>
                                </PermissionGate>
                              )}
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
                          aria-label={t('users.assignRole')}
                          disabled={assignableRoles(u).length === 0}
                          style={{ maxWidth: 160 }}
                        >
                          <option value="">—</option>
                          {assignableRoles(u).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          // Nothing picked means the handler returns early;
                          // disabling says so before the click instead.
                          disabled={!roleChoice[u.id]}
                          onClick={() => handleAssignRole(u)}
                        >
                          {t('users.assignRole')}
                        </button>
                        {u.status !== 'disabled' && !isSelf(u) && (
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
