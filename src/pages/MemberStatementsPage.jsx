import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiSend, FiDownload, FiFileText, FiHeart, FiGift, FiLayers } from 'react-icons/fi';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { formatMoney, formatCurrency } from '../utils/format.js';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// Treasurer-facing side of the monthly statement (client spec §10): pick a
// member + month/year, view it, download the PDF, or send it by SMS. Uses
// the exact same GET /contributors/:id/statement the member portal's own
// dashboard calls, just with a contributor picker instead of the session's
// own identity.
//
// SMS result messages here are deliberately their OWN i18n keys
// (memberStatements.sms.*), not a reuse of contributions.sms.* — sending a
// monthly statement is a different action from confirming a just-recorded
// contribution, and reusing the contribution wording ("the contribution
// was still saved") on this page made an unrelated action look like a
// contribution-recording error.
export default function MemberStatementsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [contributors, setContributors] = useState([]);
  const [contributorId, setContributorId] = useState('');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadContributors = useCallback(async () => {
    try {
      setContributors(await contributorsApi.list());
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadContributors();
  }, [loadContributors]);

  const handleGenerate = useCallback(async () => {
    if (!contributorId) return;
    setLoading(true);
    setError(null);
    try {
      setStatement(await contributorsApi.statement(contributorId, year, month));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [contributorId, year, month]);

  const handleDownload = async () => {
    setBusy(true);
    try {
      await contributorsApi.openStatementPdf(contributorId, year, month, locale);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendSms = async () => {
    setBusy(true);
    try {
      const result = await contributorsApi.sendStatementSms(contributorId, year, month);
      const tone = { sent: 'success', failed: 'warning', skipped_no_provider: 'info' }[result.sms.status] ?? 'info';
      const message =
        result.sms.status === 'failed' && result.sms.errorMessage
          ? `${t('memberStatements.sms.failed')} ${t('contributions.sms.reason', { reason: result.sms.errorMessage })}`
          : t(`memberStatements.sms.${result.sms.status}`);
      toast[tone](message);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('memberStatements.title')} subtitle={t('memberStatements.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <div className="field">
            <label>{t('pledges.contributor')}</label>
            <select value={contributorId} onChange={(e) => setContributorId(e.target.value)}>
              <option value="">—</option>
              {contributors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name} {c.member_number ? `(${c.member_number})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('member.history.year')}</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('member.statement.month')}</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--primary" onClick={handleGenerate} disabled={!contributorId || loading}>
            <FiFileText aria-hidden="true" /> {loading ? t('common.loading') : t('memberStatements.generate')}
          </button>
        </div>
      </div>

      {!statement && !loading && (
        <div className="card">
          <EmptyState icon={FiFileText} message={t('memberStatements.selectPrompt')} />
        </div>
      )}

      {statement && (
        <motion.div
          className="hero-card"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
        >
          <div className="hero-card__label">{t('member.statement.grandTotal')}</div>
          <div className="hero-card__value tabular-nums">{formatCurrency(statement.total)}</div>
          <div className="hero-card__breakdown">
            <div className="hero-card__breakdown-item">
              <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FiHeart aria-hidden="true" /> {t('categories.tithe')}
              </span>
              <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement.tithe)}</span>
            </div>
            <div className="hero-card__breakdown-item">
              <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FiGift aria-hidden="true" /> {t('categories.offering')}
              </span>
              <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement.offering)}</span>
            </div>
            <div className="hero-card__breakdown-item">
              <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FiLayers aria-hidden="true" /> {t('categories.other')}
              </span>
              <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement.other)}</span>
            </div>
          </div>
        </motion.div>
      )}

      {statement && (
        <div className="form-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
          <button type="button" className="btn btn--accent" onClick={handleDownload} disabled={busy}>
            <FiDownload aria-hidden="true" /> {t('member.statement.download')}
          </button>
          <button type="button" className="btn btn--secondary" onClick={handleSendSms} disabled={busy}>
            <FiSend aria-hidden="true" /> {t('memberStatements.sendSms')}
          </button>
        </div>
      )}
    </div>
  );
}
