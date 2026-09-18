// Dashboard building blocks. Every money figure comes from the server's own
// aggregations (reports.service.js#getDashboardInsights, financialSummary,
// transactionJournal). The only arithmetic here is presentational: how much
// of a bar to fill.
import {
  FiArrowDownLeft,
  FiArrowUpRight,
  FiBarChart2,
  FiLayers,
  FiRepeat,
  FiRotateCcw,
  FiSliders,
  FiSmartphone,
  FiTarget,
} from 'react-icons/fi';
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

  // Fees charged before migration 0039 were recorded beside the contribution
  // but never posted as an expense. Saying so is the honest reading of the
  // figure above: part of it is in the books, part of it is only noted.
  const unposted = Number(makato.unpostedFees ?? 0);

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
      {hasData && (
        <p className="dash-section__note">
          {unposted > 0
            ? t('dashboard.makato.partlyPosted', {
                posted: formatMoney(makato.postedFees ?? '0.00'),
                unposted: formatMoney(makato.unpostedFees ?? '0.00'),
              })
            : t('dashboard.makato.postedNote')}
        </p>
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

/**
 * Income against expenses for the selected range: the two bars share one
 * scale (the larger of the two), so their lengths are directly comparable,
 * with the surplus or deficit stated underneath in words rather than left
 * to be inferred from bar lengths.
 */
export function NetComparison({ income, expenses, net, periodLabel }) {
  const { t } = useLocale();
  if (income === null || expenses === null) return null;

  const scale = Math.max(Number(income) || 0, Number(expenses) || 0);
  const deficit = String(net ?? '').startsWith('-');

  return (
    <section className="dash-section">
      <header className="dash-section__head">
        <h2 className="dash-section__title">
          <FiBarChart2 aria-hidden="true" /> {t('dashboard.netComparison.title')}
        </h2>
        <span className="dash-section__hint">{periodLabel}</span>
      </header>

      <dl className="compare-rows">
        <div className="compare-row">
          <dt>{t('dashboard.income')}</dt>
          <dd className="tabular-nums is-in">{formatMoney(income)}</dd>
          <Bar percent={percentOf(income, scale)} tone="in" />
        </div>
        <div className="compare-row">
          <dt>{t('dashboard.expenses')}</dt>
          <dd className="tabular-nums is-out">{formatMoney(expenses)}</dd>
          <Bar percent={percentOf(expenses, scale)} tone="out" />
        </div>
      </dl>

      <p className={`compare-result${deficit ? ' is-deficit' : ''}`}>
        <span className="compare-result__label">
          {deficit ? t('dashboard.netComparison.deficit') : t('dashboard.netComparison.surplus')}
        </span>
        <span className="compare-result__value tabular-nums">
          {formatMoney(String(net ?? '0').replace(/^-/, ''))}
        </span>
      </p>
    </section>
  );
}

/**
 * Monthly variance against target, per budget line of the open period.
 *
 * Income budgets are targets to reach and expense budgets are limits to stay
 * under, so they are read in opposite directions and never summed together:
 * "95% of a collection target" and "95% of a spending limit" are good news
 * and a warning respectively. Every figure (budget, actual, variance) comes
 * from the server's budget-vs-actual report; only the bar width is computed
 * here.
 */
export function VarianceTracker({ rows, fundNameById }) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return (
      <section className="dash-section">
        <header className="dash-section__head">
          <h2 className="dash-section__title">
            <FiTarget aria-hidden="true" /> {t('dashboard.variance.title')}
          </h2>
        </header>
        <p className="dash-section__empty">{t('dashboard.variance.empty')}</p>
      </section>
    );
  }

  return (
    <section className="dash-section">
      <header className="dash-section__head">
        <h2 className="dash-section__title">
          <FiTarget aria-hidden="true" /> {t('dashboard.variance.title')}
        </h2>
        <span className="dash-section__hint">{t('dashboard.variance.hint')}</span>
      </header>
      <ul className="variance-list">
        {rows.map((row) => {
          const reached = percentOf(row.actual_amount, row.budget_amount);
          const over = Number(row.actual_amount) > Number(row.budget_amount);
          const isIncome = row.type === 'income';
          // Emerald when an income target is being met or a spending limit
          // respected; crimson only when spending has passed its limit.
          const tone = isIncome ? 'in' : over ? 'out' : undefined;
          return (
            <li className="variance-row" key={row.id}>
              <div className="variance-row__head">
                <span className="variance-row__name">
                  {fundNameById.get(row.fund_id) ?? `#${row.fund_id}`}
                  <span className={`variance-row__kind${isIncome ? ' is-income' : ''}`}>
                    {isIncome ? t('dashboard.variance.target') : t('dashboard.variance.limit')}
                  </span>
                </span>
                <span className="variance-row__figures tabular-nums">
                  {formatMoney(row.actual_amount)}
                  <span className="variance-row__of"> / {formatMoney(row.budget_amount)}</span>
                </span>
              </div>
              <Bar percent={reached} tone={tone} />
              <span className={`variance-row__note${!isIncome && over ? ' is-over' : ''}`}>
                {!isIncome && over
                  ? t('dashboard.variance.over', { amount: formatMoney(String(row.variance).replace(/^-/, '')) })
                  : t('dashboard.variance.reached', { percent: Math.round(reached) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
