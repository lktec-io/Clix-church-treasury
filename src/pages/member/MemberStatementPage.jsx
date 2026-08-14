import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FiHeart, FiGift, FiLayers, FiDownload, FiFileText } from 'react-icons/fi';
import { memberApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { SkeletonCard } from '../../components/ui/Skeleton.jsx';
import { formatMoney, formatCurrency } from '../../utils/format.js';

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
      <div className="card">
        <div className="card__header">
          <h2>{t('member.statement.title')}</h2>
        </div>
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
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {loading ? (
        <SkeletonCard lines={4} />
      ) : (
        <>
          <motion.div
            className="hero-card"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
          >
            <div className="hero-card__label">{t('member.statement.grandTotal')}</div>
            <div className="hero-card__value tabular-nums">{formatCurrency(statement?.total)}</div>
            <div className="hero-card__breakdown">
              <div className="hero-card__breakdown-item">
                <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FiHeart aria-hidden="true" /> {t('categories.tithe')}
                </span>
                <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement?.tithe)}</span>
              </div>
              <div className="hero-card__breakdown-item">
                <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FiGift aria-hidden="true" /> {t('categories.offering')}
                </span>
                <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement?.offering)}</span>
              </div>
              <div className="hero-card__breakdown-item">
                <span className="hero-card__breakdown-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <FiLayers aria-hidden="true" /> {t('categories.other')}
                </span>
                <span className="hero-card__breakdown-value tabular-nums">{formatMoney(statement?.other)}</span>
              </div>
            </div>
          </motion.div>

          {statement?.contributions?.length === 0 && (
            <div className="card">
              <EmptyState icon={FiFileText} message={t('member.statement.empty')} />
            </div>
          )}

          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn btn--accent" onClick={handleDownload} disabled={downloading}>
              <FiDownload aria-hidden="true" /> {downloading ? t('common.loading') : t('member.statement.download')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
