// Dashboard analytics blocks. Every figure is read from the server's own
// aggregations (reports.service.js#getDashboardInsights, budgetVsActual,
// transactionJournal) — the only arithmetic here is the share of a total a
// bar should fill, which is presentation, never a financial figure.
import {
  FiArrowDownLeft,
  FiArrowUpRight,
  FiDollarSign,
  FiGift,
  FiLayers,
  FiRepeat,
  FiSmartphone,
  FiTarget,
  FiRotateCcw,
  FiSliders,
} from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { formatDateTime, formatMoney } from '../../utils/format.js';

// Percent of `part` in `whole`, clamped to 0–100, or 0 when there is no whole.
function share(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p / w) * 100)));
}

function Meter({ percent, tint }) {
  return (
    <div className={tint ? `progress-meter progress-meter--${tint}` : 'progress-meter'} role="img" aria-label={`${percent}%`}>
      <span className="progress-meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Zaka / Sadaka / other collections for the selected range. */
export function CollectionsOverview({ collections }) {
  const { t } = useLocale();
  const tiles = [
    { key: 'tithe', icon: FiDollarSign, tint: 'income', value: collections.tithe },
    { key: 'offering', icon: FiGift, tint: 'info', value: collections.offering },
    { key: 'other', icon: FiLayers, tint: 'savings', value: collections.other },
  ];

  return (
    <section className="card insight-card">
      <div className="card__header">
        <h2>{t('insights.collections.title')}</h2>
        <span className="insight-card__total tabular-nums">
          <span className="insight-card__total-label">{t('reports.total')}</span> TZS {formatMoney(collections.total)}
        </span>
      </div>
      <div className="collection-grid">
        {tiles.map(({ key, icon: Icon, tint, value }) => {
          const percent = share(value, collections.total);
          return (
            <div className="collection-tile" key={key}>
              <div className="collection-tile__head">
                <span className={`stat-tile__icon stat-tile__icon--${tint}`}>
                  <Icon aria-hidden="true" />
                </span>
                <span className="collection-tile__share">{percent}%</span>
              </div>
              <div className="collection-tile__label">{t(`insights.collections.${key}`)}</div>
              <div className="collection-tile__value tabular-nums">{formatMoney(value)}</div>
              <Meter percent={percent} tint={tint} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Collections per church department (Kwaya, Vijana, …). */
export function DepartmentCollections({ departments }) {
  const { t } = useLocale();
  const rows = departments.rows ?? [];
  const max = rows.reduce((m, row) => Math.max(m, Number(row.total) || 0), 0);

  return (
    <section className="card insight-card">
      <div className="card__header">
        <h2>{t('insights.departments.title')}</h2>
      </div>
      {!departments.available ? (
        <p className="field-hint">{t('insights.migrationPending')}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FiLayers} message={t('insights.departments.empty')} />
      ) : (
        <ul className="department-list">
          {rows.map((row) => (
            <li className="department-row" key={row.id}>
              <div className="department-row__head">
                <span className="department-row__name">{row.name}</span>
                <span className="department-row__value tabular-nums">{formatMoney(row.total)}</span>
              </div>
              {/* Scaled to the largest department, so the leader fills the
                  bar and the others read relative to it. */}
              <Meter percent={max > 0 ? share(row.total, max) : 0} tint="income" />
              <span className="field-hint">{t('insights.departments.count', { count: row.contributionCount })}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="field-hint insight-card__note">{t('insights.departments.note')}</p>
    </section>
  );
}

/** Mobile-money agent fees (Makato) deducted before gifts reached the church. */
export function MakatoOverviewCard({ makato }) {
  const { t } = useLocale();

  return (
    <section className="card insight-card makato-card">
      <div className="card__header">
        <h2 className="makato-card__title">
          <FiSmartphone aria-hidden="true" /> {t('insights.makato.title')}
        </h2>
        {makato.available && makato.transactionCount > 0 && (
          <span className="badge badge--danger">{t('insights.makato.rate', { rate: makato.feeRatePercent })}</span>
        )}
      </div>

      {!makato.available ? (
        <p className="field-hint">{t('insights.migrationPending')}</p>
      ) : makato.transactionCount === 0 ? (
        <EmptyState icon={FiSmartphone} message={t('insights.makato.empty')} />
      ) : (
        <>
          <dl className="makato-card__figures">
            <div>
              <dt>{t('insights.makato.sent')}</dt>
              <dd className="tabular-nums">{formatMoney(makato.totalSent)}</dd>
            </div>
            <div>
              <dt>{t('insights.makato.fees')}</dt>
              <dd className="tabular-nums makato-card__fees">− {formatMoney(makato.totalFees)}</dd>
            </div>
            <div>
              <dt>{t('insights.makato.net')}</dt>
              <dd className="tabular-nums makato-card__net">{formatMoney(makato.netReceived)}</dd>
            </div>
          </dl>
          <p className="field-hint">
            {t('insights.makato.summary', { count: makato.transactionCount, average: formatMoney(makato.averageFee) })}
          </p>

          <ul className="makato-card__providers">
            {makato.providers.map((provider) => (
              <li key={provider.provider ?? 'unknown'} className="makato-provider">
                <div className="makato-provider__head">
                  <span className="makato-provider__name">
                    {provider.provider ? t(`mobileProvider.${provider.provider}`) : t('insights.makato.unknownProvider')}
                  </span>
                  <span className="makato-provider__fee tabular-nums">{formatMoney(provider.totalFees)}</span>
                </div>
                <Meter percent={share(provider.totalFees, makato.totalFees)} tint="danger" />
                <span className="field-hint">
                  {t('insights.makato.providerDetail', {
                    count: provider.transactionCount,
                    sent: formatMoney(provider.totalSent),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {/* The fee is recorded for visibility, not posted to the ledger — say so
          where the number is shown, so no one reconciles cash against it. */}
      <p className="field-hint insight-card__note">{t('insights.makato.note')}</p>
    </section>
  );
}

/**
 * Budget targets for the open financial period. Income budgets are targets
 * to reach; expense budgets are limits to stay under. They are shown
 * separately — summing a collection target with a spending limit produces a
 * number that means nothing.
 */
export function TargetsTracker({ rows, fundNameById }) {
  const { t } = useLocale();
  const income = rows.filter((row) => row.type === 'income');
  const expense = rows.filter((row) => row.type === 'expense');

  const renderRow = (row) => {
    const percent = share(row.actual_amount, row.budget_amount);
    const over = Number(row.actual_amount) > Number(row.budget_amount);
    // Over-target income is good news; over-limit spending is not.
    const tint = row.type === 'income' ? 'income' : over ? 'danger' : 'savings';
    return (
      <li className="target-row" key={row.id}>
        <div className="target-row__head">
          <span className="target-row__name">{fundNameById.get(row.fund_id) ?? `#${row.fund_id}`}</span>
          <span className="target-row__figures tabular-nums">
            {formatMoney(row.actual_amount)} <span className="field-hint">/ {formatMoney(row.budget_amount)}</span>
          </span>
        </div>
        <Meter percent={percent} tint={tint} />
        <span className={`field-hint${row.type === 'expense' && over ? ' is-overdue' : ''}`}>
          {row.type === 'expense' && over
            ? t('insights.targets.overLimit', { amount: formatMoney(String(row.variance).replace(/^-/, '')) })
            : t('insights.targets.percent', { percent })}
        </span>
      </li>
    );
  };

  return (
    <section className="card insight-card">
      <div className="card__header">
        <h2>
          <FiTarget aria-hidden="true" /> {t('insights.targets.title')}
        </h2>
        <Link to="/budgets" className="btn btn--secondary btn--sm">{t('dashboard.viewAll')}</Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={FiTarget} message={t('insights.targets.empty')} />
      ) : (
        <div className="targets-columns">
          {income.length > 0 && (
            <div>
              <h3 className="targets-columns__title">{t('insights.targets.income')}</h3>
              <ul className="target-list">{income.map(renderRow)}</ul>
            </div>
          )}
          {expense.length > 0 && (
            <div>
              <h3 className="targets-columns__title">{t('insights.targets.expense')}</h3>
              <ul className="target-list">{expense.map(renderRow)}</ul>
            </div>
          )}
        </div>
      )}
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

/** Recent ledger postings as a timeline, stamped to the minute. */
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
        return (
          <li key={tx.id} className={`activity-timeline__item ${incoming ? 'is-in' : 'is-out'}`}>
            <span className="activity-timeline__marker" aria-hidden="true">
              <Icon />
            </span>
            <div className="activity-timeline__body">
              <div className="activity-timeline__title">
                {tx.description || t(`insights.timeline.type.${tx.type}`)}
              </div>
              <div className="activity-timeline__meta">
                <span>{formatDateTime(tx.posted_at ?? tx.created_at)}</span>
                {' · '}
                {tx.transaction_number}
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
