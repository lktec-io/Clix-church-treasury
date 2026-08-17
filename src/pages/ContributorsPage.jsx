import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiSearch, FiUsers, FiUserPlus, FiKey, FiRotateCcw } from 'react-icons/fi';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';

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
  const [search, setSearch] = useState('');

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

  const filteredContributors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contributors;
    return contributors.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.member_number?.toLowerCase().includes(q)
    );
  }, [contributors, search]);

  return (
    <div>
      <PageHeader title={t('contributors.title')} subtitle={t('contributors.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="contributors.manage">
        <div className="card">
          <div className="card__header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiUserPlus aria-hidden="true" /> {t('contributors.addNew')}
            </h2>
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
        <div className="card__header">
          <h2>{t('contributors.title')}</h2>
        </div>
        <div className="field" style={{ position: 'relative', marginBottom: 16, maxWidth: 320 }}>
          <FiSearch
            aria-hidden="true"
            style={{ position: 'absolute', left: 12, top: 34, color: 'var(--text-muted)' }}
          />
          <input
            type="search"
            placeholder={t('contributors.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
            aria-label={t('contributors.searchPlaceholder')}
          />
        </div>
        {loading ? (
          <SkeletonTable rows={5} columns={5} />
        ) : filteredContributors.length === 0 ? (
          <EmptyState
            icon={FiUsers}
            title={t('contributors.empty.title')}
            message={search ? t('common.noResults') : t('contributors.empty.message')}
          />
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
                {filteredContributors.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.full_name}</td>
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
                            <FiKey aria-hidden="true" /> {t('contributors.enablePortal')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            disabled={actioningId === c.id}
                            onClick={() => handleResetPin(c)}
                          >
                            <FiRotateCcw aria-hidden="true" /> {t('contributors.resetPin')}
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
