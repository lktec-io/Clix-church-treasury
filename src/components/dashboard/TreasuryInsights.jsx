// Dashboard analytics blocks. Every money figure is read from the server's
// own aggregations (reports.service.js#getDashboardInsights, budgetVsActual,
// transactionJournal). The only arithmetic here is presentational: how much
// of a bar to fill, and a provider's fee rate shown as a percentage.
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
  FiTrendingDown,
} from 'react-icons/fi';
import { Link } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { formatDate, formatMoney, formatTime } from '../../utils/format.js';

// Percent of `part` in `whole`, clamped to 0–100, or 0 when there is no whole.
function share(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p / w) * 100)));
}

// Same, unrounded — for widths where a 0.4% fee slice must still be visible.
function exactShare(part, whole) {
  const p = Number(part);
  const w = Number(whole);
  if (!Number.isFinite(p) || !Number.isFinite(w) || w <= 0) return 0;
  return Math.max(0, Math.min(100, (p / w) * 100));
}

function Meter({ percent, tint }) {
  return (
    <div className={tint ? `progress-meter progress-meter--${tint}` : 'progress-meter'} role="img" aria-label={`${Math.round(percent)}%`}>
      <span className="progress-meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Zaka / Sadaka / other income for the selected range, presented as account
 * balance blocks. `periodLabel` names the range the figures cover.
 */
export function CollectionsOverview({ collections, periodLabel }) {
  const { t } = useLocale();
  const accounts = [
    { key: 'tithe', icon: FiDollarSign, value: collections.tithe },
    { key: 'offering', icon: FiGift, value: collections.offering },
    { key: 'other', icon: FiLayers, value: collections.other },
  ];

  return (
    <section className="account-blocks" aria-label={t('insights.collections.title')}>
      <header className="account-blocks__head">
        <h2 className="section-heading">{t('insights.collections.title')}</h2>
        <span className="account-blocks__total">
          <span className="account-blocks__total-label">{t('insights.collections.totalFor', { period: periodLabel })}</span>
          <span className="account-blocks__total-value tabular-nums">TZS {formatMoney(collections.total)}</span>
        </span>
      </header>
      <div className="account-blocks__grid">
        {accounts.map(({ key, icon: Icon, value }) => {
          const percent = share(value, collections.total);
          return (
            <article className={`account-block account-block--${key}`} key={key}>
              <div className="account-block__head">
                <span className="account-block__icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="account-block__name">{t(`insights.collections.${key}`)}</span>
                <span className="account-block__share tabular-nums">{percent}%</span>
              </div>
              <div className="account-block__label">{t('insights.collections.balanceLabel')}</div>
              <div className="account-block__balance tabular-nums">
                <span className="account-block__currency">TZS</span>
                {formatMoney(value)}
              </div>
              <Meter percent={percent} tint={key === 'tithe' ? 'income' : undefined} />
            </article>
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
        <h2>
          <FiLayers aria-hidden="true" /> {t('insights.departments.title')}
        </h2>
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

/**
 * Mobile-money agent fees (Makato) as an expense-leakage widget: how much of
 * what members sent never reached the church, and through which provider.
 */
export function MakatoOverviewCard({ makato }) {
  const { t } = useLocale();
  const hasData = makato.available && makato.transactionCount > 0;
  const netWidth = hasData ? exactShare(makato.netReceived, makato.totalSent) : 0;
  const feeWidth = hasData ? Math.max(exactShare(makato.totalFees, makato.totalSent), Number(makato.totalFees) > 0 ? 0.6 : 0) : 0;
  const providerRates = hasData
    ? makato.providers.map((provider) => ({
        ...provider,
        rate: Number(provider.totalSent) > 0 ? (Number(provider.totalFees) / Number(provider.totalSent)) * 100 : 0,
      }))
    : [];
  const maxRate = providerRates.reduce((m, p) => Math.max(m, p.rate), 0);

  return (
    <section className="card insight-card leakage">
      <div className="leakage__head">
        <h2 className="leakage__title">
          <FiSmartphone aria-hidden="true" /> {t('insights.makato.title')}
        </h2>
        {hasData && (
          <span className="leakage__rate">
            <FiTrendingDown aria-hidden="true" />
            <span className="tabular-nums">{t('insights.makato.rate', { rate: makato.feeRatePercent })}</span>
          </span>
        )}
      </div>

      {!makato.available ? (
        <p className="field-hint">{t('insights.migrationPending')}</p>
      ) : !hasData ? (
        <EmptyState icon={FiSmartphone} message={t('insights.makato.empty')} />
      ) : (
        <>
          <div className="leakage__headline">
            <span className="leakage__headline-label">{t('insights.makato.lost')}</span>
            <span className="leakage__headline-value tabular-nums">TZS {formatMoney(makato.totalFees)}</span>
            <span className="leakage__headline-meta tabular-nums">
              {t('insights.makato.summary', { count: makato.transactionCount, average: formatMoney(makato.averageFee) })}
            </span>
          </div>

          {/* One bar = everything members sent. The crimson slice is what the
              agents kept. */}
          <div className="leakage__flow" role="img" aria-label={t('insights.makato.flowLabel', { rate: makato.feeRatePercent })}>
            <span className="leakage__flow-net" style={{ width: `${netWidth}%` }} />
            <span className="leakage__flow-fee" style={{ width: `${feeWidth}%` }} />
          </div>

          <div className="makato-equation makato-equation--compact">
            <div className="makato-equation__term">
              <span className="makato-equation__label">{t('insights.makato.sent')}</span>
              <span className="makato-equation__value tabular-nums">{formatMoney(makato.totalSent)}</span>
            </div>
            <span className="makato-equation__op" aria-hidden="true">−</span>
            <div className="makato-equation__term is-fee">
              <span className="makato-equation__label">{t('insights.makato.fees')}</span>
              <span className="makato-equation__value tabular-nums">{formatMoney(makato.totalFees)}</span>
            </div>
            <span className="makato-equation__op" aria-hidden="true">=</span>
            <div className="makato-equation__term is-net">
              <span className="makato-equation__label">{t('insights.makato.net')}</span>
              <span className="makato-equation__value tabular-nums">{formatMoney(makato.netReceived)}</span>
            </div>
          </div>

          <table className="leakage__providers">
            <caption className="leakage__providers-caption">{t('insights.makato.byProvider')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('contributions.makato.provider')}</th>
                <th scope="col" className="is-num">{t('insights.makato.fees')}</th>
                <th scope="col" className="leakage__rate-col">{t('insights.makato.rateColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {providerRates.map((provider) => (
                <tr key={provider.provider ?? 'unknown'}>
                  <th scope="row">
                    <span className="cell-stack">
                      <span className="cell-stack__primary">
                        {provider.provider ? t(`mobileProvider.${provider.provider}`) : t('insights.makato.unknownProvider')}
                      </span>
                      <span className="cell-stack__secondary tabular-nums">
                        {t('insights.makato.providerDetail', {
                          count: provider.transactionCount,
                          sent: formatMoney(provider.totalSent),
                        })}
                      </span>
                    </span>
                  </th>
                  <td className="is-num leakage__fee tabular-nums">{formatMoney(provider.totalFees)}</td>
                  <td className="leakage__rate-col">
                    <span className="leakage__rate-bar">
                      {/* Scaled to the most expensive provider, so the worst
                          offender fills the bar. */}
                      <span className="leakage__rate-track">
                        <span
                          className="leakage__rate-fill"
                          style={{ width: `${maxRate > 0 ? (provider.rate / maxRate) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="leakage__rate-value tabular-nums">{provider.rate.toFixed(2)}%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    const tint = row.type === 'income' ? 'income' : over ? 'danger' : undefined;
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

/**
 * Recent ledger postings on a vertical axis. The stamp column has a fixed
 * width so every time lines up; the list is plain document flow (no inner
 * scroll container), so it can never capture the page's scroll.
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
            <span className="activity-timeline__stamp">
              <span className="activity-timeline__date">{formatDate(stamp)}</span>
              <span className="activity-timeline__time">{formatTime(stamp)}</span>
            </span>
            <span className="activity-timeline__node" aria-hidden="true">
              <Icon />
            </span>
            <div className="activity-timeline__body">
              <div className="activity-timeline__title">
                {tx.description || t(`insights.timeline.type.${tx.type}`)}
              </div>
              <div className="activity-timeline__meta">
                <span className="is-mono">{tx.transaction_number}</span>
                <span className="activity-timeline__type">{t(`insights.timeline.type.${tx.type}`)}</span>
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
