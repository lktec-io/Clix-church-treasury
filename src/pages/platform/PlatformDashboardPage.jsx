import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiBriefcase, FiCheckCircle, FiPauseCircle, FiClock } from 'react-icons/fi';
import { platformApi } from '../../api/endpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { SkeletonStatGrid } from '../../components/ui/Skeleton.jsx';
import { formatDate } from '../../utils/format.js';

const RECENT_WINDOW_DAYS = 30;

const cardEntrance = {
  initial: { opacity: 0, y: 10 },
  animate: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.28, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] } }),
};

export default function PlatformDashboardPage() {
  const { t } = useLocale();
  const [tenants, setTenants] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Computed once at mount via a lazy initializer (same pattern used
  // elsewhere in this codebase, e.g. Layout.jsx's collapsed-state read) —
  // Date.now() may not be called directly in a component's render body,
  // and this hook must run unconditionally, before the early return below.
  const [recentCutoff] = useState(() => Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

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

  if (loading) {
    return (
      <div>
        <PageHeader title={t('platform.dashboard.title')} />
        <SkeletonStatGrid />
      </div>
    );
  }

  const total = tenants?.length ?? 0;
  const active = tenants?.filter((tn) => tn.status === 'active').length ?? 0;
  const suspended = total - active;
  const recent = tenants?.filter((tn) => new Date(tn.createdAt).getTime() >= recentCutoff).length ?? 0;

  return (
    <div>
      <PageHeader title={t('platform.dashboard.title')} subtitle={t('platform.dashboard.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <motion.div className="stat-grid" custom={0} variants={cardEntrance} initial="initial" animate="animate">
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiBriefcase aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('platform.dashboard.totalTenants')}</div>
          <div className="stat-tile__value tabular-nums">{total}</div>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiCheckCircle aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('platform.dashboard.activeTenants')}</div>
          <div className="stat-tile__value is-positive tabular-nums">{active}</div>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiPauseCircle aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('platform.dashboard.suspendedTenants')}</div>
          <div className={`stat-tile__value tabular-nums${suspended > 0 ? ' is-negative' : ''}`}>{suspended}</div>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__icon"><FiClock aria-hidden="true" /></span>
          <div className="stat-tile__label">{t('platform.dashboard.recentlyCreated')}</div>
          <div className="stat-tile__value tabular-nums">{recent}</div>
        </div>
      </motion.div>

      <motion.div className="card" custom={1} variants={cardEntrance} initial="initial" animate="animate">
        <div className="card__header">
          <h2>{t('platform.dashboard.recentTenants')}</h2>
        </div>
        {total === 0 ? (
          <div className="empty-state">{t('platform.tenants.empty.message')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('platform.tenants.name')}</th>
                  <th>{t('platform.tenants.admin')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('platform.tenants.created')}</th>
                </tr>
              </thead>
              <tbody>
                {tenants.slice(0, 5).map((tn) => (
                  <tr key={tn.id}>
                    <td style={{ fontWeight: 600 }}>{tn.name}</td>
                    <td>{tn.adminEmail ?? '—'}</td>
                    <td>
                      <span className={`badge ${tn.status === 'active' ? 'badge--success' : 'badge--neutral'}`}>
                        {t(`platform.tenants.status.${tn.status}`)}
                      </span>
                    </td>
                    <td>{formatDate(tn.createdAt)}</td>
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
