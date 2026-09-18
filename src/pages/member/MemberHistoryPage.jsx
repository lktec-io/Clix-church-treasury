import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiDollarSign, FiCheckCircle, FiXCircle, FiClock } from 'react-icons/fi';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import Dropdown from '../../components/ui/Dropdown.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
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

const listEntrance = {
  initial: { opacity: 0, y: 8 },
  animate: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.22, delay: Math.min(i, 8) * 0.03, ease: [0.22, 1, 0.36, 1] } }),
};

export default function MemberHistoryPage() {
  const { t, locale } = useLocale();
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
  let rowIndex = 0;

  return (
    <div className="page">
      <div className="field member-filter">
        <Dropdown
          id="year"
          label={t('member.history.year')}
          options={YEAR_OPTIONS.map((y) => ({ value: String(y), label: String(y) }))}
          value={String(year)}
          onChange={(value) => setYear(Number(value))}
        />
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <SkeletonCard lines={4} />
      ) : groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={FiClock} title={t('member.history.emptyTitle')} message={t('member.history.emptyMessage')} />
        </div>
      ) : (
        groups.map(([monthKey, monthContributions]) => (
          <div className="timeline-group" key={monthKey}>
            <div className="timeline-group__label">
              {new Date(`${monthKey}-01`).toLocaleDateString(locale === 'sw' ? 'sw-TZ' : undefined, { month: 'long', year: 'numeric' })}
              {' · '}
              {formatMoney(sumMoneyStrings(monthContributions.map((c) => c.amount)))}
            </div>
            {monthContributions.map((c) => {
              const i = rowIndex++;
              const isReversed = c.status === 'reversed';
              return (
                <motion.div className="timeline-item" key={c.id} custom={i} variants={listEntrance} initial="initial" animate="animate">
                  <span className="timeline-item__icon" style={isReversed ? { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' } : undefined}>
                    {isReversed ? <FiXCircle aria-hidden="true" /> : <FiDollarSign aria-hidden="true" />}
                  </span>
                  <div className="timeline-item__body">
                    <div className="timeline-item__title">{c.category_name ?? t('contributions.category')}</div>
                    <div className="timeline-item__meta">
                      {formatDate(c.contribution_date)}
                      {' · '}
                      {isReversed ? (
                        <span className="is-reversed-note">{t('contributions.reversed')}</span>
                      ) : (
                        <span className="is-confirmed-note">
                          <FiCheckCircle aria-hidden="true" size={11} /> {t('member.history.confirmed')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="timeline-item__amount tabular-nums">{formatMoney(c.amount)}</div>
                </motion.div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
