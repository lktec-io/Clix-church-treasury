import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiHeart, FiGift, FiLayers, FiClock } from 'react-icons/fi';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCard, SkeletonStatGrid } from '../../components/ui/Skeleton.jsx';
import { formatMoney, formatCurrency, formatDate } from '../../utils/format.js';

const now = new Date();

const cardEntrance = {
  initial: { opacity: 0, y: 10 },
  animate: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.28, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] } }),
};

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

  if (loading) {
    return (
      <div>
        <SkeletonStatGrid count={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    );
  }

  return (
    <div>
      {error && <div className="alert alert--error">{error}</div>}

      <motion.div className="hero-card" custom={0} variants={cardEntrance} initial="initial" animate="animate">
        <div className="hero-card__label">{t('member.dashboard.thisYear')}</div>
        <div className="hero-card__value tabular-nums">{formatCurrency(yearTotal?.total)}</div>
        <div className="hero-card__meta">{t('member.dashboard.thisMonth')}: {formatMoney(statement?.total)}</div>
      </motion.div>

      <motion.div className="card" custom={1} variants={cardEntrance} initial="initial" animate="animate">
        <div className="card__header">
          <h2>{t('member.dashboard.breakdown')}</h2>
        </div>
        <div className="stat-grid">
          <div className="stat-tile">
            <span className="stat-tile__icon"><FiHeart aria-hidden="true" /></span>
            <div className="stat-tile__label">{t('categories.tithe')}</div>
            <div className="stat-tile__value tabular-nums">{formatMoney(statement?.tithe)}</div>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__icon"><FiGift aria-hidden="true" /></span>
            <div className="stat-tile__label">{t('categories.offering')}</div>
            <div className="stat-tile__value tabular-nums">{formatMoney(statement?.offering)}</div>
          </div>
          <div className="stat-tile">
            <span className="stat-tile__icon"><FiLayers aria-hidden="true" /></span>
            <div className="stat-tile__label">{t('categories.other')}</div>
            <div className="stat-tile__value tabular-nums">{formatMoney(statement?.other)}</div>
          </div>
        </div>
      </motion.div>

      <motion.div className="card" custom={2} variants={cardEntrance} initial="initial" animate="animate">
        <div className="card__header">
          <h2>{t('member.dashboard.recent')}</h2>
        </div>
        {recent.length === 0 ? (
          <EmptyState icon={FiClock} title={t('member.dashboard.emptyTitle')} message={t('member.dashboard.emptyMessage')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('contributions.category')}</th>
                  <th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contribution_date)}</td>
                    <td>{c.category_name ?? '—'}</td>
                    <td className="is-amount">{formatMoney(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}
