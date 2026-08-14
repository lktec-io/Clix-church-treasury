import { useCallback, useEffect, useState } from 'react';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney, formatDate } from '../../utils/format.js';

const now = new Date();

export default function MemberDashboardPage() {
  const { t } = useLocale();
  const [statement, setStatement] = useState(null);
  const [yearTotal, setYearTotal] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statementData, yearData, recentData] = await Promise.all([
        memberApi.statement(now.getFullYear(), now.getMonth() + 1),
        memberApi.yearTotal(now.getFullYear()),
        memberApi.listContributions({ limit: 5 }),
      ]);
      setStatement(statementData);
      setYearTotal(yearData);
      setRecent(recentData);
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

  if (loading) return <div className="empty-state">{t('common.loading')}</div>;

  return (
    <div>
      {error && <div className="alert alert--error">{error}</div>}

      <div className="stat-grid">
        <div className="stat-tile">
          <div className="stat-tile__label">{t('member.dashboard.thisMonth')}</div>
          <div className="stat-tile__value">{formatMoney(statement?.total)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__label">{t('member.dashboard.thisYear')}</div>
          <div className="stat-tile__value">{formatMoney(yearTotal?.total)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h2>{t('member.dashboard.breakdown')}</h2>
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
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h2>{t('member.dashboard.recent')}</h2>
        </div>
        {recent.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
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
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contribution_date)}</td>
                    <td>{c.category_name ?? '—'}</td>
                    <td>{formatMoney(c.amount)}</td>
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
