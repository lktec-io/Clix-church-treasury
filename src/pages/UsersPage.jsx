import { Fragment, useCallback, useEffect, useState } from 'react';
import { FiEdit2, FiSlash, FiTrash2, FiUserPlus, FiX, FiInfo } from 'react-icons/fi';
import { usersApi, rolesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useDeleteRefusal } from '../hooks/useDeleteRefusal.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';

function emptyForm() {
  return { fullName: '', email: '', roleId: '' };
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
  const explainRefusal = useDeleteRefusal();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [roleChoice, setRoleChoice] = useState({});
  // Which row has its role panel open. One at a time: this is a rare,
  // deliberate action, not something to leave expanded across the grid.
  const [editingUserId, setEditingUserId] = useState(null);
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
      const result = await usersApi.invite({ fullName: form.fullName.trim(), email: form.email.trim() });
      // The API creates the account and grants roles separately, so a role
      // chosen on the form is applied straight after the account exists.
      // A failure here must not read as "the user was not created".
      if (form.roleId && result?.user?.id) {
        try {
          await usersApi.assignRole(result.user.id, Number(form.roleId));
        } catch (roleErr) {
          setError(unwrapApiError(roleErr).message);
        }
      }
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
    // Clear any banner from a previous attempt, so a stale refusal does not
    // sit above a role change that has just succeeded.
    setError(null);
    try {
      await usersApi.assignRole(user.id, roleId);
      // Reset this row's picker: leaving the granted role selected invites a
      // second click the server treats as a no-op (assign is INSERT IGNORE).
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
    // confirm() resolves to a bare boolean unless `requireReason` is set.
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

  // Permanent removal. The server refuses (409) for an account that has
  // recorded or approved anything, and that refusal is shown as-is: it
  // explains why, and "Disable" is the action that always works.
  const handleHardDelete = async (user) => {
    const ok = await confirm({
      title: t('common.deletePermanently'),
      message: `${t('common.deleteConfirm')} — ${user.full_name} (${user.email})`,
      tone: 'danger',
      confirmLabel: t('common.deletePermanently'),
    });
    if (!ok) return;
    setError(null);
    try {
      await usersApi.remove(user.id);
      await load();
      toast.success(t('users.deletedToast'));
    } catch (err) {
      const failure = unwrapApiError(err);
      // A refusal is explained in a dialog; anything else is a genuine
      // error and belongs in the page's error strip.
      if (explainRefusal(failure, user.full_name)) return;
      setError(failure.message);
    }
  };

  const isSelf = (user) => user.id === session?.user?.id;

  // Roles the user does not already hold. Offering the full catalogue listed
  // roles where "Assign" is a no-op that still reports success.
  const assignableRoles = (user) => {
    const held = new Set(user.roles.map((r) => r.id));
    return roles.filter((r) => !held.has(r.id));
  };

  return (
    <div className="page">
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="split-view">
        <PermissionGate permission="users.manage">
          <section className="card form-card split-view__aside">
            <div className="card__header">
              <h2 className="card__title-icon">
                <FiUserPlus aria-hidden="true" /> {t('users.invite')}
              </h2>
            </div>
            <form onSubmit={handleInvite}>
              <div className="field">
                <label htmlFor="user-full-name">{t('contributors.fullName')}</label>
                <input
                  id="user-full-name"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={handleChange('fullName')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="user-email">{t('auth.login.email')}</label>
                <input
                  id="user-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={handleChange('email')}
                  required
                />
              </div>
              <div className="field">
                <Dropdown
                  id="user-role"
                  label={t('users.roles')}
                  options={[
                    { value: '', label: t('users.noRoleYet') },
                    ...roles.map((r) => ({ value: String(r.id), label: r.name })),
                  ]}
                  value={form.roleId}
                  onChange={(roleId) => setForm((f) => ({ ...f, roleId }))}
                  placeholder={t('users.noRoleYet')}
                />
              </div>

              {/* No password box: the account is created with an unusable
                  placeholder and the invitee sets their own password from the
                  invite link (users.service.js#inviteUser). A password typed
                  here would have nowhere to go. */}
              <p className="form-note">
                <FiInfo aria-hidden="true" /> {t('users.passwordNote')}
              </p>

              <div className="form-actions">
                <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
                  {submitting ? t('common.loading') : t('users.invite')}
                </button>
              </div>
            </form>
            {devInviteToken && (
              <div className="alert alert--success invite-token">
                {t('users.devTokenHint')}: <code>{devInviteToken}</code>
              </div>
            )}
          </section>
        </PermissionGate>

        <section className="card ledger-card split-view__main">
          <div className="ledger-toolbar">
            <div className="ledger-toolbar__title">
              <h2>{t('users.directory')}</h2>
              {!loading && (
                <span className="ledger-toolbar__count tabular-nums">{t('users.count', { count: users.length })}</span>
              )}
            </div>
          </div>
          {loading ? (
            <SkeletonTable rows={4} columns={4} />
          ) : users.length === 0 ? (
            <div className="empty-state">{t('common.noResults')}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table data-table--dense">
                <thead>
                  <tr>
                    <th>{t('users.member')}</th>
                    <th>{t('users.roles')}</th>
                    <th>{t('common.status')}</th>
                    <PermissionGate permission="users.manage">
                      <th className="col-actions">{t('common.actions')}</th>
                    </PermissionGate>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const editing = editingUserId === u.id;
                    return (
                      <Fragment key={u.id}>
                        <tr>
                          <td>
                            <span className="cell-stack">
                              <span className="cell-stack__primary">{u.full_name}</span>
                              <span className="cell-stack__secondary">{u.email}</span>
                            </span>
                          </td>
                          <td>
                            {u.roles.length === 0 ? (
                              <span className="badge badge--neutral">{t('users.noRoleYet')}</span>
                            ) : (
                              <span className="role-tags">
                                {u.roles.map((r) => (
                                  <span key={r.id} className="badge badge--accent">
                                    {r.name}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${STATUS_BADGE[u.status]}`}>{t(`users.status.${u.status}`)}</span>
                          </td>
                          <PermissionGate permission="users.manage">
                            <td className="col-actions">
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className={`icon-btn icon-btn--neutral${editing ? ' is-active' : ''}`}
                                  aria-label={t('users.manageRoles')}
                                  title={t('users.manageRoles')}
                                  aria-expanded={editing}
                                  onClick={() => setEditingUserId(editing ? null : u.id)}
                                >
                                  {editing ? <FiX aria-hidden="true" /> : <FiEdit2 aria-hidden="true" />}
                                </button>
                                {/* Disabling yourself would lock you out, and
                                    the server refuses it; the control is not
                                    offered rather than failing on click. */}
                                {u.status !== 'disabled' && !isSelf(u) && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label={t('users.disable')}
                                    title={t('users.disable')}
                                    onClick={() => handleDisable(u)}
                                  >
                                    <FiSlash aria-hidden="true" />
                                  </button>
                                )}
                                {!isSelf(u) && (
                                  <button
                                    type="button"
                                    className="icon-btn icon-btn--danger"
                                    aria-label={t('common.deletePermanently')}
                                    title={t('common.deletePermanently')}
                                    onClick={() => handleHardDelete(u)}
                                  >
                                    <FiTrash2 aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </PermissionGate>
                        </tr>
                        {editing && (
                          <tr className="role-editor">
                            <td colSpan={4}>
                              <div className="role-editor__body">
                                <div className="role-editor__assign">
                                  <Dropdown
                                    id={`user-${u.id}-role`}
                                    label={t('users.assignRole')}
                                    options={assignableRoles(u).map((r) => ({ value: String(r.id), label: r.name }))}
                                    value={roleChoice[u.id] ?? ''}
                                    onChange={(roleId) => setRoleChoice((c) => ({ ...c, [u.id]: roleId }))}
                                    disabled={assignableRoles(u).length === 0}
                                    placeholder={
                                      assignableRoles(u).length === 0 ? t('users.allRolesHeld') : t('users.chooseRole')
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="btn btn--secondary btn--sm"
                                    disabled={!roleChoice[u.id]}
                                    onClick={() => handleAssignRole(u)}
                                  >
                                    {t('users.assignRole')}
                                  </button>
                                </div>
                                {u.roles.length > 0 && (
                                  <div className="role-editor__current">
                                    <span className="role-editor__label">{t('users.currentRoles')}</span>
                                    <span className="role-tags">
                                      {u.roles.map((r) => (
                                        <span key={r.id} className="badge badge--accent">
                                          {r.name}
                                          {/* Self-removal is refused by the
                                              server (it would lock you out),
                                              so no control is offered. */}
                                          {!isSelf(u) && (
                                            <button
                                              type="button"
                                              className="badge__remove"
                                              onClick={() => handleRemoveRole(u, r.id)}
                                              aria-label={`${t('users.removeRole')} ${r.name}`}
                                            >
                                              ×
                                            </button>
                                          )}
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
