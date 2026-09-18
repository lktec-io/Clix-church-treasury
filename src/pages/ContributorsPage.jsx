import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { FiSearch, FiUsers, FiUserPlus, FiKey, FiRotateCcw, FiTrash2, FiUpload } from 'react-icons/fi';
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
import { formatDate } from '../utils/format.js';

// Registration asks for exactly three things: who the member is, the number
// on their church envelope / card, and a mobile number to reach them on.
function emptyForm() {
  return { fullName: '', memberNumber: '', phone: '' };
}

// Tithe status (server contributors.service.js#tithe_compliance) as the
// treasurer reads it: paid this month, pending (last paid the month before),
// lapsed. A member with no tithe on record is shown as such, not as lapsed.
const PAYMENT_STATUS_BADGE = {
  current: 'badge--success',
  due: 'badge--warning',
  lapsed: 'badge--danger',
  none: 'badge--neutral',
};

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
      await contributorsApi.create({
        fullName: form.fullName.trim(),
        memberNumber: form.memberNumber.trim(),
        phone: form.phone.trim(),
      });
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
  // purpose: the message embeds the member's PIN, which
  // enrollment.service.js#withoutPinPreview strips before the response
  // leaves the server.
  const showSmsPop = (sms) => {
    if (!sms) return;
    // A monotonic counter, not Date.now(): two dispatches inside the same
    // millisecond would collide and skip the dialog's replay.
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
    // confirm() resolves to a bare boolean unless `requireReason` is set.
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

  // Permanent removal, refused by the server (409) for a member who has
  // giving or a pledge on record — their receipts and statements point at
  // this row.
  const handleHardDelete = async (contributor) => {
    const ok = await confirm({
      title: t('common.deletePermanently'),
      message: `${t('common.deleteConfirm')} — ${contributor.full_name}`,
      tone: 'danger',
      confirmLabel: t('common.deletePermanently'),
    });
    if (!ok) return;
    setActioningId(contributor.id);
    setError(null);
    try {
      await contributorsApi.remove(contributor.id);
      await load();
      toast.success(t('contributors.deletedToast'));
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
    <div className="page">
      <PageHeader title={t('contributors.title')} subtitle={t('contributors.subtitle')} />

      <AnimatePresence>
        {smsPop && <SmsPopCenter key={smsPop.dispatchId} dispatch={smsPop} onClose={() => setSmsPop(null)} />}
      </AnimatePresence>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="contributors.manage">
        {/* Bulk import expands in place above the single-add form: two ways
            of doing the same job on one surface. */}
        <BulkImportPanel open={importOpen} onClose={() => setImportOpen(false)} onImported={load} />

        <div className="card form-card">
          <div className="card__header">
            <h2 className="card__title-icon">
              <FiUserPlus aria-hidden="true" /> {t('contributors.addNew')}
            </h2>
            {!importOpen && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setImportOpen(true)}>
                <FiUpload aria-hidden="true" /> {t('contributors.import.open')}
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="member-full-name">{t('contributors.fullName')}</label>
                <input
                  id="member-full-name"
                  autoComplete="name"
                  value={form.fullName}
                  onChange={handleChange('fullName')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="member-number">{t('contributors.cardNumber')}</label>
                <input
                  id="member-number"
                  autoComplete="off"
                  value={form.memberNumber}
                  onChange={handleChange('memberNumber')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="member-phone">{t('contributors.mobile')}</label>
                <input
                  id="member-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="07XX XXX XXX"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  required
                />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('contributors.save')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card ledger-card">
        <div className="ledger-toolbar">
          <div className="ledger-toolbar__title">
            <h2>{t('contributors.directory')}</h2>
            {!loading && (
              <span className="ledger-toolbar__count tabular-nums">
                {t('contributors.count', { shown: filteredContributors.length, total: contributors.length })}
              </span>
            )}
          </div>
          <label className="ledger-search">
            <FiSearch aria-hidden="true" className="ledger-search__icon" />
            <input
              type="search"
              placeholder={t('contributors.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('contributors.searchPlaceholder')}
            />
          </label>
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
            <table className="data-table data-table--dense">
              <thead>
                <tr>
                  <th>{t('contributors.fullName')}</th>
                  <th>{t('contributors.cardNumber')}</th>
                  <th>{t('contributors.mobile')}</th>
                  <th>{t('contributors.paymentStatus')}</th>
                  <th>{t('contributors.portalAccess')}</th>
                  <PermissionGate permission="contributors.manage">
                    <th className="col-actions">{t('common.actions')}</th>
                  </PermissionGate>
                </tr>
              </thead>
              <tbody>
                {filteredContributors.map((c) => {
                  const status = c.tithe_compliance?.status;
                  return (
                    <tr key={c.id}>
                      <td className="cell-strong">{c.full_name}</td>
                      <td className="tabular-nums">{c.member_number ?? '—'}</td>
                      <td className="tabular-nums">{c.phone ?? '—'}</td>
                      <td>
                        {status ? (
                          <span
                            className={`badge badge--dot ${PAYMENT_STATUS_BADGE[status] ?? 'badge--neutral'}`}
                            title={
                              c.tithe_compliance.last_tithe_date
                                ? t('compliance.lastTithe', { date: formatDate(c.tithe_compliance.last_tithe_date) })
                                : undefined
                            }
                          >
                            {t(`compliance.status.${status}`)}
                          </span>
                        ) : (
                          <span className="cell-muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${c.portal_enabled_at ? 'badge--success' : 'badge--neutral'}`}>
                          {c.portal_enabled_at ? t('contributors.portalEnabled') : t('contributors.portalNotEnabled')}
                        </span>
                      </td>
                      <PermissionGate permission="contributors.manage">
                        <td className="col-actions">
                          <div className="row-actions">
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
                                className="btn btn--ghost btn--sm"
                                disabled={actioningId === c.id}
                                onClick={() => handleResetPin(c)}
                              >
                                <FiRotateCcw aria-hidden="true" /> {t('contributors.resetPin')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="icon-btn icon-btn--danger"
                              disabled={actioningId === c.id}
                              aria-label={t('common.deletePermanently')}
                              title={t('common.deletePermanently')}
                              onClick={() => handleHardDelete(c)}
                            >
                              <FiTrash2 aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </PermissionGate>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filteredContributors.length > 0 && <p className="ledger-footnote">{t('compliance.legend')}</p>}
      </div>
    </div>
  );
}
