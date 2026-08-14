import { useCallback, useEffect, useState } from 'react';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney } from '../../utils/format.js';

const now = new Date();
const CURRENT_YEAR = now.getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MemberStatementPage() {
  const { t, locale } = useLocale();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async (y, m) => {
    setLoading(true);
    setError(null);
    try {
      setStatement(await memberApi.statement(y, m));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(year, month);
  }, [year, month, load]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await memberApi.openStatementPdf(year, month, locale);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="year">{t('member.history.year')}</label>
          <select id="year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="month">{t('member.statement.month')}</label>
          <select id="month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <div className="empty-state">{t('common.loading')}</div>
      ) : (
        <div className="card">
          <div className="card__header">
            <h2>{t('member.statement.title')}</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                <tr>
                  <td>{t('categories.tithe')}</td>
                  <td>{formatMoney(statement?.tithe)}</td>
                </tr>
                <tr>
                  <td>{t('categories.offering')}</td>
                  <td>{formatMoney(statement?.offering)}</td>
                </tr>
                <tr>
                  <td>{t('categories.other')}</td>
                  <td>{formatMoney(statement?.other)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t('member.statement.grandTotal')}</strong>
                  </td>
                  <td>
                    <strong>{formatMoney(statement?.total)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={handleDownload} disabled={downloading}>
              {downloading ? t('common.loading') : t('member.statement.download')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
