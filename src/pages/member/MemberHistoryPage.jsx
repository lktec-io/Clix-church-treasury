import { useCallback, useEffect, useState } from 'react';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney, formatDate, sumMoneyStrings } from '../../utils/format.js';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

function groupByMonth(contributions) {
  const groups = new Map();
  for (const c of contributions) {
    const monthKey = c.contribution_date.slice(0, 7); // "YYYY-MM"
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(c);
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export default function MemberHistoryPage() {
  const { t } = useLocale();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [contributions, setContributions] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (selectedYear) => {
    setLoading(true);
    try {
      const data = await memberApi.listContributions({
        dateFrom: `${selectedYear}-01-01`,
        dateTo: `${selectedYear}-12-31`,
        limit: 200,
      });
      setContributions(data);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(year);
  }, [year, load]);

  const groups = groupByMonth(contributions);

  return (
    <div>
      <div className="field" style={{ maxWidth: 160 }}>
        <label htmlFor="year">{t('member.history.year')}</label>
        <select id="year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <div className="empty-state">{t('common.loading')}</div>
      ) : groups.length === 0 ? (
        <div className="empty-state">{t('common.noResults')}</div>
      ) : (
        groups.map(([monthKey, monthContributions]) => (
          <div className="card" key={monthKey}>
            <div className="card__header">
              <h2>{monthKey}</h2>
              <span className="badge badge--success">{formatMoney(sumMoneyStrings(monthContributions.map((c) => c.amount)))}</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('common.date')}</th>
                    <th>{t('contributions.category')}</th>
                    <th>{t('common.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {monthContributions.map((c) => (
                    <tr key={c.id}>
                      <td>{formatDate(c.contribution_date)}</td>
                      <td>{c.category_name ?? '—'}</td>
                      <td>{formatMoney(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
