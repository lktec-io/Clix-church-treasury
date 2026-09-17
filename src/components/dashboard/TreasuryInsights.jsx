// Dashboard building blocks. Every money figure comes from the server's own
// aggregations (reports.service.js#getDashboardInsights, financialSummary,
// transactionJournal). The only arithmetic here is presentational: how much
// of a bar to fill.
import { FiArrowDownLeft, FiArrowUpRight, FiLayers, FiRepeat, FiRotateCcw, FiSliders, FiSmartphone } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { formatDate, formatMoney, formatTime } from '../../utils/format.js';

// Percent of `part` in `whole`, clamped to 0–100; 0 when there is no whole.
function percentOf(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.max(0, Math.min(100, (p / w) * 100));
}

function Bar({ percent, tone }) {
  return (
    <span className={`fin-bar${tone ? ` fin-bar--${tone}` : ''}`} aria-hidden="true">
      <span className="fin-bar__fill" style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * A headline balance: label, large figure, and up to two supporting lines.
 * `lines`: [{ label, value, tone? }] where tone is 'in' | 'out'.
 */
export function BalanceTile({ label, value, caption, lines = [], emphasis = false }) {
  return (
    <article className={`balance-tile${emphasis ? ' balance-tile--emphasis' : ''}`}>
      <div className="balance-tile__label">{label}</div>
      <div className="balance-tile__value tabular-nums">
        <span className="balance-tile__currency">TZS</span>
        {value === null || value === undefined ? '—' : formatMoney(value)}
      </div>
      {caption && <div className="balance-tile__caption">{caption}</div>}
      {lines.length > 0 && (
        <dl className="balance-tile__lines">
          {lines.map((line) => (
            <div key={line.label} className="balance-tile__line">
              <dt>{line.label}</dt>
              <dd className={`tabular-nums${line.tone ? ` is-${line.tone}` : ''}`}>
                {line.value === null || line.value === undefined ? '—' : formatMoney(line.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

/**
 * Department sub-accounts (Kwaya, Vijana, Huduma za Jamii, Watoto …).
 * These are collections received per department: expenses are not recorded
 * by department, so a figure here is money in, not a spendable balance.
 */
export function DepartmentAccounts({ departments }) {
  const { t } = useLocale();
  const rows = departments.rows ?? [];
  const total = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);

  return (
    <section className="dash-section">
      <header className="dash-section__head">
        <h2 className="dash-section__title">
          <FiLayers aria-hidden="true" /> {t('dashboard.departments.title')}
        </h2>
        <span className="dash-section__hint">{t('dashboard.departments.hint')}</span>
      </header>
      {!departments.available ? (
        <p className="dash-section__empty">{t('insights.migrationPending')}</p>
      ) : rows.length === 0 ? (
        <p className="dash-section__empty">{t('insights.departments.empty')}</p>
      ) : (
        <div className="subaccount-grid">
          {rows.map((row) => (
            <article className="subaccount" key={row.id}>
              <div className="subaccount__name">{row.name}</div>
              <div className="subaccount__value tabular-nums">{formatMoney(row.total)}</div>
              <Bar percent={percentOf(row.total, total)} />
              <div className="subaccount__meta tabular-nums">
                {t('insights.departments.count', { count: row.contributionCount })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Mobile-money agent fees. Three figures, each with a bar measured against
 * the amount received, so the fee's share is visible at a glance.
 */
export function MakatoWidget({ makato }) {
  const { t } = useLocale();
  const hasData = makato.available && makato.transactionCount > 0;

  const rows = hasData
    ? [
        { key: 'received', label: t('dashboard.makato.received'), value: makato.totalSent, tone: undefined },
        { key: 'fee', label: t('dashboard.makato.fee'), value: makato.totalFees, tone: 'out' },
        { key: 'net', label: t('dashboard.makato.net'), value: makato.netReceived, tone: 'in' },
      ]
    : [];

  return (
    <section className="dash-section makato-widget">
      <header className="dash-section__head">
        <h2 className="dash-section__title">
          <FiSmartphone aria-hidden="true" /> {t('dashboard.makato.title')}
        </h2>
        {hasData && (
          <span className="dash-section__hint tabular-nums">
            {t('dashboard.makato.summary', { count: makato.transactionCount, rate: makato.feeRatePercent })}
          </span>
        )}
      </header>

      {!makato.available ? (
        <p className="dash-section__empty">{t('insights.migrationPending')}</p>
      ) : !hasData ? (
        <p className="dash-section__empty">{t('insights.makato.empty')}</p>
      ) : (
        <dl className="makato-widget__rows">
          {rows.map((row) => (
            <div key={row.key} className={`makato-widget__row${row.tone ? ` is-${row.tone}` : ''}`}>
              <dt>{row.label}</dt>
              <dd className="tabular-nums">
                {row.tone === 'out' ? '− ' : ''}
                {formatMoney(row.value)}
              </dd>
              <Bar
                // The fee is usually a few percent: give it a visible sliver
                // rather than a bar that looks empty.
                percent={row.key === 'fee' && Number(row.value) > 0 ? Math.max(percentOf(row.value, makato.totalSent), 1) : percentOf(row.value, makato.totalSent)}
                tone={row.tone}
              />
            </div>
          ))}
        </dl>
      )}
      <p className="dash-section__note">{t('insights.makato.note')}</p>
    </section>
  );
}

const TIMELINE_ICON = {
  income: FiArrowDownLeft,
  expense: FiArrowUpRight,
  transfer: FiRepeat,
  reversal: FiRotateCcw,
  adjustment: FiSliders,
};

/**
 * Recent ledger postings. A plain list in normal document flow — no inner
 * scroll container — so it can never capture the page's scrolling.
 */
export function ActivityTimeline({ transactions }) {
  const { t } = useLocale();

  if (transactions.length === 0) {
    return <EmptyState icon={FiRepeat} message={t('common.noResults')} />;
  }

  return (
    <ol className="activity-timeline">
      {transactions.map((tx) => {
        const Icon = TIMELINE_ICON[tx.type] ?? FiRepeat;
        const incoming = tx.direction === 'in';
        const stamp = tx.posted_at ?? tx.created_at;
        return (
          <li key={tx.id} className={`activity-timeline__item ${incoming ? 'is-in' : 'is-out'}`}>
            <span className="activity-timeline__node" aria-hidden="true">
              <Icon />
            </span>
            <div className="activity-timeline__body">
              <div className="activity-timeline__title">{tx.description || t(`insights.timeline.type.${tx.type}`)}</div>
              <div className="activity-timeline__meta tabular-nums">
                {formatDate(stamp)} · {formatTime(stamp)} · {tx.transaction_number}
              </div>
            </div>
            <span className="activity-timeline__amount tabular-nums">
              {incoming ? '+' : '−'} {formatMoney(tx.amount)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
