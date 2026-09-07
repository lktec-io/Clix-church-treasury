import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FiSearch, FiUsers, FiUserPlus, FiKey, FiRotateCcw, FiUpload } from 'react-icons/fi';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import BulkImportPanel from '../components/ui/BulkImportPanel.jsx';
import SmsPopCenter from '../components/ui/SmsPopCenter.jsx';
import { useActivity } from '../context/ActivityContext.jsx';

function emptyForm() {
  return { fullName: '', phone: '', email: '', memberNumber: '' };
}

export default function ContributorsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const { recordActivity } = useActivity();
  const confirm = useConfirm();
  const [contributors, setContributors] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState(null);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [smsPop, setSmsPop] = useState(null);
  const dispatchSeq = useRef(0);

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

  // Both member SMS actions raise the same centred dispatch dialog the
  // contributions flow uses. `preview` arrives undefined for these two on
  // purpose: their message body embeds the member's raw PIN, and
  // enrollment.service.js#withoutPinPreview strips it before the response
  // leaves the server so the PIN is never handed back over HTTP. The dialog
  // renders the tick and outcome without a message preview in that case —
  // see SmsPopCenter's `pinWithheld` note.
  const showSmsPop = (sms) => {
    if (!sms) return;
    // A monotonic counter, not Date.now(): the id only has to remount
    // SmsPopCenter so its ticker replays, and two dispatches inside the same
    // millisecond would collide on a timestamp and silently skip the replay.
    dispatchSeq.current += 1;
    setSmsPop({
      dispatchId: dispatchSeq.current,
      status: sms.status,
      reasonCode: sms.reasonCode,
      reason: sms.errorMessage,
      preview: sms.preview,
      pinWithheld: !sms.preview && sms.status === 'sent',
    });
  };

  const handleEnablePortal = async (contributor) => {
    setActioningId(contributor.id);
    setError(null);
    try {
      const result = await contributorsApi.enablePortalAccess(contributor.id);
      await load();
      showSmsPop(result.sms);
      recordActivity({
        kind: 'member',
        message: t('contributors.activity.portalEnabled', { name: contributor.full_name }),
      });
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
    // confirm() resolves to a BARE BOOLEAN unless `requireReason` is set —
    // see ConfirmDialog.jsx. This branch used to read `result.confirmed`,
    // which is `undefined` on a plain boolean, so the guard was always true
    // and the reset silently returned without ever calling the API: the
    // button did nothing at all. No reason is required here, so the boolean
    // form is what must be tested.
    const confirmed = await confirm({
      title: t('contributors.resetPin'),
      message: t('contributors.resetPinConfirm'),
      tone: 'danger',
      confirmLabel: t('contributors.resetPin'),
    });
    if (!confirmed) return;
    setActioningId(contributor.id);
    setError(null);
    try {
      const result = await contributorsApi.resetPin(contributor.id);
      showSmsPop(result?.sms);
      recordActivity({
        kind: 'member',
        message: t('contributors.activity.pinReset', { name: contributor.full_name }),
      });
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

      {/* Same centred dispatch dialog the contributions flow raises — one
          component, so the confirmation a treasurer sees for a member SMS
          is identical to the one they see for a contribution SMS. */}
      <AnimatePresence>
        {smsPop && (
          <SmsPopCenter key={smsPop.dispatchId} dispatch={smsPop} onClose={() => setSmsPop(null)} />
        )}
      </AnimatePresence>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="contributors.manage">
        {/* The import panel expands in place, directly above the single-add
            form, rather than opening a modal — the two are alternative ways
            of doing the same job, so keeping them on one surface lets a
            clerk see both without losing their place. */}
        <BulkImportPanel open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />

        <div className="card">
          <div className="card__header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FiUserPlus aria-hidden="true" /> {t('contributors.addNew')}
            </h2>
            {/* Secondary to the form's own primary "Save" — importing is the
                bulk alternative to filling this form in, not the main
                action on the page. Hidden while the panel is open, since it
                would then just be a toggle for something already visible. */}
            {!importOpen && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setImportOpen(true)}>
                <FiUpload aria-hidden="true" /> {t('contributors.import.open')}
              </button>
            )}
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
