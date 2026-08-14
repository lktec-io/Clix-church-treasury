import { useCallback, useEffect, useState } from 'react';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatMoney } from '../utils/format.js';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// Treasurer-facing side of the monthly statement (client spec §10): pick a
// member + month/year, view it, download the PDF, or send it by SMS. Uses
// the exact same GET /contributors/:id/statement the member portal's own
// dashboard calls, just with a contributor picker instead of the session's
// own identity.
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

  useEffect(() => {
    contributorsApi
      .list()
      .then(setContributors)
      .catch((err) => setError(unwrapApiError(err).message));
  }, []);

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
      toast[tone](t(`contributions.sms.${result.sms.status}`));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>{t('memberStatements.title')}</h1>
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
            {loading ? t('common.loading') : t('memberStatements.generate')}
          </button>
        </div>
      </div>

      {statement && (
        <div className="card">
          <div className="card__header">
            <h2>{t('member.statement.title')}</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr>
                  <td>{t('categories.tithe')}</td>
                  <td>{formatMoney(statement.tithe)}</td>
                </tr>
                <tr>
                  <td>{t('categories.offering')}</td>
                  <td>{formatMoney(statement.offering)}</td>
                </tr>
                <tr>
                  <td>{t('categories.other')}</td>
                  <td>{formatMoney(statement.other)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('member.statement.grandTotal')}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(statement.total)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn--secondary" onClick={handleDownload} disabled={busy}>
              {t('member.statement.download')}
            </button>
            <button type="button" className="btn btn--secondary" onClick={handleSendSms} disabled={busy}>
              {t('memberStatements.sendSms')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
