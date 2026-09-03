import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiPlus, FiEdit2, FiPlayCircle, FiPauseCircle, FiX, FiTrash2, FiAlertTriangle } from 'react-icons/fi';
import { platformApi } from '../../api/endpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { useConfirm } from '../../components/ConfirmDialog.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../../components/ui/Skeleton.jsx';
import { formatDate } from '../../utils/format.js';

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};
const modalVariants = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15 } },
};

function emptyCreateForm() {
  return { churchName: '', adminFullName: '', adminEmail: '', adminPassword: '' };
}

// Create-tenant is deliberately a modal, not an inline card form (unlike
// most other "create X" pages in this app) — it's a rarer, more
// consequential platform-admin action, and keeping it out of the way of
// the tenant list keeps that list the actual focus of this page.
function CreateTenantModal({ onClose, onCreated }) {
  const { t } = useLocale();
  const toast = useToast();
  const [form, setForm] = useState(emptyCreateForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await platformApi.createTenant(form);
      toast.success(t('platform.tenants.createdToast'));
      onCreated();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div className="modal-overlay" variants={overlayVariants} initial="initial" animate="animate" exit="exit" onMouseDown={onClose}>
      <motion.div
        className="modal"
        variants={modalVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tenant-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card__header">
          <h2 id="create-tenant-title">{t('platform.tenants.createTitle')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
            <FiX aria-hidden="true" />
          </button>
        </div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field field--full">
              <label htmlFor="churchName">{t('platform.tenants.churchName')}</label>
              <input id="churchName" value={form.churchName} onChange={handleChange('churchName')} required />
            </div>
            <div className="field field--full">
              <label htmlFor="adminFullName">{t('platform.tenants.adminFullName')}</label>
              <input id="adminFullName" value={form.adminFullName} onChange={handleChange('adminFullName')} required />
            </div>
            <div className="field field--full">
              <label htmlFor="adminEmail">{t('platform.tenants.adminEmail')}</label>
              <input id="adminEmail" type="email" value={form.adminEmail} onChange={handleChange('adminEmail')} autoComplete="off" required />
            </div>
            <div className="field field--full">
              <label htmlFor="adminPassword">{t('platform.tenants.initialPassword')}</label>
              <input
                id="adminPassword"
                type="password"
                value={form.adminPassword}
                onChange={handleChange('adminPassword')}
                autoComplete="new-password"
                minLength={10}
                required
              />
              <span className="field-hint">{t('platform.tenants.initialPasswordHint')}</span>
            </div>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={`btn btn--primary${submitting ? ' btn--loading' : ''}`} disabled={submitting}>
              {t('platform.tenants.create')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function ResetAdminPasswordModal({ tenant, onClose, onDone }) {
  const { t } = useLocale();
  const toast = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await platformApi.resetTenantAdminPassword(tenant.id, { userId: tenant.adminUserId, newPassword });
      toast.success(t('platform.tenants.passwordResetToast'));
      onDone();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div className="modal-overlay" variants={overlayVariants} initial="initial" animate="animate" exit="exit" onMouseDown={onClose}>
      <motion.div
        className="modal"
        variants={modalVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card__header">
          <h2 id="reset-password-title">{t('platform.tenants.resetPasswordTitle')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
            <FiX aria-hidden="true" />
          </button>
        </div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field field--full">
            <label htmlFor="newAdminPassword">{t('platform.tenants.newPassword')}</label>
            <input
              id="newAdminPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
            <span className="field-hint">{t('platform.tenants.resetPasswordHint')}</span>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={`btn btn--danger${submitting ? ' btn--loading' : ''}`} disabled={submitting}>
              {t('platform.tenants.resetPassword')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

// Irreversible deletion. The operator must type the tenant's slug exactly —
// the submit button stays disabled until it matches, so "click through
// without reading" is not a path that exists here. The server re-checks the
// same slug (platform.service.js#deleteTenant); this modal is the
// affordance, not the control.
function DeleteTenantModal({ tenant, onClose, onDeleted }) {
  const { t } = useLocale();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const matches = typed.trim() === tenant.slug;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    setSubmitting(true);
    try {
      await platformApi.deleteTenant(tenant.id, typed.trim());
      toast.success(t('platform.tenants.deletedToast'));
      onDeleted();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      className="modal-overlay"
      variants={overlayVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      onMouseDown={onClose}
    >
      <motion.div
        className="modal"
        variants={modalVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-tenant-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card__header">
          <h2 id="delete-tenant-title">{t('platform.tenants.deleteTitle')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
            <FiX aria-hidden="true" />
          </button>
        </div>

        <div className="alert alert--error">
          <FiAlertTriangle aria-hidden="true" />
          <span>{t('platform.tenants.deleteWarning', { name: tenant.name })}</span>
        </div>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field field--full">
            <label htmlFor="deleteConfirm">{t('platform.tenants.deleteConfirmLabel', { slug: tenant.slug })}</label>
            <input
              id="deleteConfirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
              placeholder={tenant.slug}
            />
            <span className="field-hint">{t('platform.tenants.deleteConfirmHint')}</span>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={`btn btn--danger${submitting ? ' btn--loading' : ''}`}
              disabled={!matches || submitting}
            >
              <FiTrash2 aria-hidden="true" /> {t('platform.tenants.deleteConfirmAction')}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function EditTenantModal({ tenant, onClose, onSaved }) {
  const { t } = useLocale();
  const toast = useToast();
  const [form, setForm] = useState({
    name: tenant.name,
    baseCurrency: tenant.baseCurrency,
    localeDefault: tenant.localeDefault,
    adminFullName: tenant.adminFullName ?? '',
    adminEmail: tenant.adminEmail ?? '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Two separate resources (the tenant record itself, and its admin
      // user account) — deliberately two calls, not a combined endpoint,
      // matching how the backend keeps "edit tenant" and "edit tenant
      // admin" as genuinely separate operations (platform.service.js).
      await platformApi.updateTenant(tenant.id, {
        name: form.name,
        baseCurrency: form.baseCurrency,
        localeDefault: form.localeDefault,
      });
      if (tenant.adminUserId) {
        await platformApi.updateTenantAdmin(tenant.id, {
          userId: tenant.adminUserId,
          fullName: form.adminFullName,
          email: form.adminEmail,
        });
      }
      toast.success(t('common.saved'));
      onSaved();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <motion.div className="modal-overlay" variants={overlayVariants} initial="initial" animate="animate" exit="exit" onMouseDown={onClose}>
        <motion.div
          className="modal"
          variants={modalVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-tenant-title"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="card__header">
            <h2 id="edit-tenant-title">{t('platform.tenants.editTitle')}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.cancel')}>
              <FiX aria-hidden="true" />
            </button>
          </div>
          {error && <div className="alert alert--error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field field--full">
                <label htmlFor="editName">{t('platform.tenants.churchName')}</label>
                <input id="editName" value={form.name} onChange={handleChange('name')} required />
              </div>
              <div className="field">
                <label htmlFor="editCurrency">{t('platform.tenants.baseCurrency')}</label>
                <input id="editCurrency" value={form.baseCurrency} onChange={handleChange('baseCurrency')} maxLength={3} required />
              </div>
              <div className="field">
                <label htmlFor="editLocale">{t('platform.tenants.defaultLocale')}</label>
                <select id="editLocale" value={form.localeDefault} onChange={handleChange('localeDefault')}>
                  <option value="en">EN</option>
                  <option value="sw">SW</option>
                </select>
              </div>
            </div>

            {tenant.adminUserId && (
              <>
                <div className="form-section">
                  <div className="form-section__title">{t('platform.tenants.adminAccount')}</div>
                </div>
                <div className="form-grid">
                  <div className="field field--full">
                    <label htmlFor="editAdminFullName">{t('platform.tenants.adminFullName')}</label>
                    <input id="editAdminFullName" value={form.adminFullName} onChange={handleChange('adminFullName')} required />
                  </div>
                  <div className="field field--full">
                    <label htmlFor="editAdminEmail">{t('platform.tenants.adminEmail')}</label>
                    <input id="editAdminEmail" type="email" value={form.adminEmail} onChange={handleChange('adminEmail')} required />
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  style={{ marginTop: 4 }}
                  onClick={() => setResettingPassword(true)}
                >
                  {t('platform.tenants.resetPassword')}
                </button>
              </>
            )}

            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
                {t('common.cancel')}
              </button>
              <button type="submit" className={`btn btn--primary${submitting ? ' btn--loading' : ''}`} disabled={submitting}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </motion.div>
      </motion.div>
      <AnimatePresence>
        {resettingPassword && (
          <ResetAdminPasswordModal tenant={tenant} onClose={() => setResettingPassword(false)} onDone={() => setResettingPassword(false)} />
        )}
      </AnimatePresence>
    </>
  );
}

export default function PlatformTenantsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const [tenants, setTenants] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [deletingTenant, setDeletingTenant] = useState(null);
  const [actioningId, setActioningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTenants(await platformApi.listTenants());
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

  const handleCreated = async () => {
    setCreating(false);
    await load();
  };

  const handleSaved = async () => {
    setEditingTenant(null);
    await load();
  };

  const handleToggleStatus = async (tenant) => {
    const activating = tenant.status !== 'active';
    if (!activating) {
      const ok = await confirm({
        title: t('platform.tenants.deactivate'),
        message: t('platform.tenants.deactivateConfirm', { name: tenant.name }),
        tone: 'danger',
        confirmLabel: t('platform.tenants.deactivate'),
      });
      if (!ok) return;
    }
    setActioningId(tenant.id);
    try {
      await platformApi.setTenantStatus(tenant.id, activating ? 'active' : 'suspended');
      toast.success(activating ? t('platform.tenants.activatedToast') : t('platform.tenants.deactivatedToast'));
      await load();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('platform.tenants.title')}
        subtitle={t('platform.tenants.subtitle')}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <FiPlus aria-hidden="true" /> {t('platform.tenants.create')}
          </button>
        }
      />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        {loading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : tenants.length === 0 ? (
          <EmptyState
            icon={FiPlus}
            title={t('platform.tenants.empty.title')}
            message={t('platform.tenants.empty.message')}
            action={
              <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
                {t('platform.tenants.create')}
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('platform.tenants.name')}</th>
                  <th>{t('platform.tenants.admin')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('platform.tenants.created')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tn) => (
                  <tr key={tn.id}>
                    <td style={{ fontWeight: 600 }}>
                      {tn.name}
                      <div className="text-caption">#{tn.id} · {tn.slug}</div>
                    </td>
                    <td>{tn.adminEmail ?? '—'}</td>
                    <td>
                      <span className={`badge ${tn.status === 'active' ? 'badge--success' : 'badge--neutral'}`}>
                        {t(`platform.tenants.status.${tn.status}`)}
                      </span>
                    </td>
                    <td>{formatDate(tn.createdAt)}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditingTenant(tn)}>
                        <FiEdit2 aria-hidden="true" /> {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={actioningId === tn.id}
                        onClick={() => handleToggleStatus(tn)}
                      >
                        {tn.status === 'active' ? (
                          <>
                            <FiPauseCircle aria-hidden="true" /> {t('platform.tenants.deactivate')}
                          </>
                        ) : (
                          <>
                            <FiPlayCircle aria-hidden="true" /> {t('platform.tenants.activate')}
                          </>
                        )}
                      </button>
                      {/* Single-step deletion: available whatever the
                          tenant's status. The typed-slug modal is the only
                          confirmation, and the server re-checks that slug. */}
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => setDeletingTenant(tn)}
                      >
                        <FiTrash2 aria-hidden="true" /> {t('platform.tenants.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AnimatePresence>
        {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreated={handleCreated} />}
        {editingTenant && (
          <EditTenantModal tenant={editingTenant} onClose={() => setEditingTenant(null)} onSaved={handleSaved} />
        )}
        {deletingTenant && (
          <DeleteTenantModal
            tenant={deletingTenant}
            onClose={() => setDeletingTenant(null)}
            onDeleted={() => {
              setDeletingTenant(null);
              load();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
