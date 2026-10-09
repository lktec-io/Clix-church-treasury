// Dashboard charts. Hand-drawn SVG (no chart library in the bundle), sized
// to their container so text renders at real size on every screen.
//
// Every figure comes from an existing report endpoint, untouched:
//   TrendBars        GET /reports/monthly-trends      (reports.service.js#getMonthlyTrends)
//   ActivityDots     GET /reports/transaction-journal (status=posted, the selected range)
//   CollectionsDonut GET /reports/dashboard-insights  (collections: tithe / offering / other)
// The only arithmetic here is presentational — where a mark sits, how tall a
// bar is — plus the income − expense line in the trend tooltip, which uses
// the same integer-cents helper (sumMoneyStrings) as the rest of the page.
import { useState } from 'react';
import { FiAlertCircle } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { useElementWidth } from '../../hooks/useElementWidth.js';
import EmptyState from '../ui/EmptyState.jsx';
import { formatDate, formatMoney, formatTime, parseServerDate, sumMoneyStrings } from '../../utils/format.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function intlLocale(locale) {
  return locale === 'sw' ? 'sw-TZ' : 'en-GB';
}

// Axis ticks only (never a displayed money figure): 1.2M, 450K.
function compactNumber(value, locale) {
  return new Intl.NumberFormat(intlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

// Clean axis ticks from 0 to a rounded maximum: 0 / 250K / 500K …
function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return ticks;
}

// Bar with a 4px rounded data-end and a square baseline.
function columnPath(x, y, w, h, r = 4) {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The card every chart sits in: title, hint, and the four states a chart can
 * be in. `status` is 'loading' | 'error' | 'empty' | 'ready'. Loading and
 * error never draw axes or zeros — a chart full of zeros reads as "this
 * church had no activity", which is a false statement while data is still in
 * flight or failed to arrive.
 */
export function ChartCard({ icon: Icon, title, hint, status, refreshing = false, emptyMessage, onRetry, className = '', children }) {
  const { t } = useLocale();
  return (
    <section
      className={`dash-section chart-card ${className}${refreshing ? ' is-refreshing' : ''}`}
      aria-busy={status === 'loading' || refreshing}
    >
      <header className="dash-section__head">
        <h2 className="dash-section__title">
          {Icon && <Icon aria-hidden="true" />} {title}
        </h2>
        {hint && <span className="dash-section__hint">{hint}</span>}
      </header>
      {status === 'loading' && (
        <div className="chart-state chart-state--loading" role="status">
          <div className="skeleton chart-state__skeleton" />
          <span className="visually-hidden">{t('charts.loading')}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="chart-state chart-state--error" role="alert">
          <FiAlertCircle aria-hidden="true" className="chart-state__icon" />
          <p className="chart-state__text">{t('charts.error')}</p>
          {onRetry && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
              {t('charts.retry')}
            </button>
          )}
        </div>
      )}
      {status === 'empty' && <EmptyState icon={Icon} message={emptyMessage} />}
      {status === 'ready' && children}
    </section>
  );
}

function ChartLegend({ items }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.key} className="chart-legend__item">
          <span className={`chart-key chart-key--${item.shape ?? 'square'}`} style={{ '--key-color': item.color }} aria-hidden="true" />
          <span className="chart-legend__label">{item.label}</span>
          {item.value && <span className="chart-legend__value tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

// Tooltip positioned inside the chart's own box and clamped to it, so it can
// never widen the page on a phone.
function ChartTooltip({ x, y, width, children }) {
  const TOOLTIP_WIDTH = 210;
  const left = clamp(x - TOOLTIP_WIDTH / 2, 0, Math.max(0, width - TOOLTIP_WIDTH));
  return (
    <div className="chart-tooltip" style={{ left, top: y, width: TOOLTIP_WIDTH }} role="presentation">
      {children}
    </div>
  );
}

// The chart's table twin — the accessible, exact equivalent of the drawing.
// Rows are only rendered once opened, so a 1,000-posting dot chart does not
// keep 1,000 hidden rows in the DOM.
function ChartTable({ caption, columns, rows }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <details className="chart-table" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('charts.table')}</summary>
      {open && (
        <div className="table-wrap">
          <table className="data-table data-table--dense">
            <caption className="visually-hidden">{caption}</caption>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={col.numeric ? 'is-numeric' : undefined}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  {columns.map((col) => (
                    <td key={col.key} className={col.numeric ? 'is-numeric tabular-nums' : undefined}>
                      {row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

// Arrow-key navigation across a chart's marks: focus the plot, then
// Left/Right (or Up/Down) move the highlighted mark; Home/End jump.
function useRovingIndex(count) {
  const [active, setActive] = useState(null);
  const onKeyDown = (event) => {
    if (count === 0) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in keys) {
      event.preventDefault();
      setActive((current) => clamp((current ?? (keys[event.key] > 0 ? -1 : count)) + keys[event.key], 0, count - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  };
  return { active, setActive, onKeyDown };
}

// ---------------------------------------------------------------------------
// A. Bar trend — income and expenses per month, last 12 months
// ---------------------------------------------------------------------------

const TREND_HEIGHT = 250;

export function TrendBars({ series }) {
  const { t, locale } = useLocale();
  const [ref, width] = useElementWidth();
  const { active, setActive, onKeyDown } = useRovingIndex(series.length);

  const monthLabel = (point, style = 'short') =>
    new Date(point.year, point.month - 1, 1).toLocaleDateString(intlLocale(locale), {
      month: style,
      ...(style === 'long' ? { year: 'numeric' } : {}),
    });

  const max = Math.max(0, ...series.flatMap((p) => [Number(p.income) || 0, Number(p.expense) || 0]));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const margin = { top: 10, right: 6, bottom: 28, left: 46 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = TREND_HEIGHT - margin.top - margin.bottom;
  const band = series.length ? plotW / series.length : 0;
  const barW = Math.max(3, Math.min(18, (band * 0.72 - 2) / 2));
  const groupW = barW * 2 + 2;
  const y = (v) => margin.top + plotH - (v / top) * plotH;
  // Thin the month labels as bands narrow; the latest month always shows.
  const labelEvery = band < 26 ? 3 : band < 40 ? 2 : 1;

  const activePoint = active !== null ? series[active] : null;
  const activeNet = activePoint ? sumMoneyStrings([activePoint.income, `-${activePoint.expense}`]) : null;

  return (
    <>
      <ChartLegend
        items={[
          { key: 'in', label: t('dashboard.income'), color: 'var(--chart-in)' },
          { key: 'out', label: t('dashboard.expenses'), color: 'var(--chart-out)' },
        ]}
      />
      <div className="chart-frame" ref={ref}>
        {width > 0 && (
          <svg
            className="chart-svg"
            width={width}
            height={TREND_HEIGHT}
            role="img"
            aria-label={t('charts.trend.aria')}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onMouseLeave={() => setActive(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="chart-axis" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {compactNumber(tick, locale)}
                </text>
              </g>
            ))}
            {series.map((point, i) => {
              const x0 = margin.left + i * band + (band - groupW) / 2;
              const income = Number(point.income) || 0;
              const expense = Number(point.expense) || 0;
              const hIn = (income / top) * plotH;
              const hOut = (expense / top) * plotH;
              const showLabel = (series.length - 1 - i) % labelEvery === 0;
              return (
                <g key={point.period}>
                  {active === i && (
                    <rect className="chart-band" x={margin.left + i * band} y={margin.top} width={band} height={plotH} />
                  )}
                  {hIn > 0 && <path d={columnPath(x0, y(income), barW, hIn)} fill="var(--chart-in)" />}
                  {hOut > 0 && <path d={columnPath(x0 + barW + 2, y(expense), barW, hOut)} fill="var(--chart-out)" />}
                  {showLabel && (
                    <text className="chart-axis" x={margin.left + i * band + band / 2} y={TREND_HEIGHT - 8} textAnchor="middle">
                      {monthLabel(point)}
                    </text>
                  )}
                  {/* Full-height hit band: the whole month column is the target. */}
                  <rect
                    className="chart-hit"
                    x={margin.left + i * band}
                    y={margin.top}
                    width={band}
                    height={plotH}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => setActive(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {activePoint && (
          <ChartTooltip x={margin.left + active * band + band / 2} y={margin.top} width={width}>
            <div className="chart-tooltip__title">{monthLabel(activePoint, 'long')}</div>
            <div className="chart-tooltip__row">
              <span className="chart-key chart-key--square" style={{ '--key-color': 'var(--chart-in)' }} aria-hidden="true" />
              <span>{t('dashboard.income')}</span>
              <strong className="tabular-nums">{formatMoney(activePoint.income)}</strong>
            </div>
            <div className="chart-tooltip__row">
              <span className="chart-key chart-key--square" style={{ '--key-color': 'var(--chart-out)' }} aria-hidden="true" />
              <span>{t('dashboard.expenses')}</span>
              <strong className="tabular-nums">{formatMoney(activePoint.expense)}</strong>
            </div>
            <div className="chart-tooltip__row chart-tooltip__row--total">
              <span />
              <span>{t('charts.net')}</span>
              <strong className="tabular-nums">{formatMoney(activeNet)}</strong>
            </div>
          </ChartTooltip>
        )}
        {/* Announces the focused month to screen readers as the arrow keys move. */}
        <div className="visually-hidden" aria-live="polite">
          {activePoint
            ? `${monthLabel(activePoint, 'long')}: ${t('dashboard.income')} ${formatMoney(activePoint.income)}, ${t('dashboard.expenses')} ${formatMoney(activePoint.expense)}`
            : ''}
        </div>
      </div>
      <ChartTable
        caption={t('charts.trend.title')}
        columns={[
          { key: 'month', label: t('charts.col.month') },
          { key: 'income', label: t('dashboard.income'), numeric: true },
          { key: 'expense', label: t('dashboard.expenses'), numeric: true },
        ]}
        rows={series.map((point) => ({
          key: point.period,
          month: monthLabel(point, 'long'),
          income: formatMoney(point.income),
          expense: formatMoney(point.expense),
        }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// B. Dot graph — every posted income/expense in the selected range
// ---------------------------------------------------------------------------

const DOTS_HEIGHT = 240;
const DOT_HIT_RADIUS = 24;

// `points` comes from chartData.js#activityPoints.
export function ActivityDots({ points, dateFrom, dateTo, truncated, rowLimit }) {
  const { t, locale } = useLocale();
  const [ref, width] = useElementWidth();
  const { active, setActive, onKeyDown } = useRovingIndex(points.length);

  const start = parseServerDate(dateFrom).getTime();
  const end = parseServerDate(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1;
  const max = Math.max(0, ...points.map((p) => p.amount));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const margin = { top: 12, right: 12, bottom: 28, left: 46 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = DOTS_HEIGHT - margin.top - margin.bottom;
  const x = (time) => margin.left + ((clamp(time, start, end) - start) / Math.max(1, end - start)) * plotW;
  const y = (v) => margin.top + plotH - (v / top) * plotH;

  const placed = points.map((p) => ({ ...p, cx: x(p.time), cy: y(p.amount), incoming: p.row.direction === 'in' }));

  // Date ticks: as many as fit at ~90px apart, evenly across the range.
  const dateTickCount = clamp(Math.floor(plotW / 90), 2, 6);
  const dateTicks = Array.from({ length: dateTickCount }, (_, i) => start + ((end - start) * i) / (dateTickCount - 1));

  const incomingCount = placed.filter((p) => p.incoming).length;

  // Nearest mark to the pointer (within the hit radius), so a reader does
  // not have to land dead-centre on an 8px dot.
  const onPointerMove = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = null;
    let bestDistance = DOT_HIT_RADIUS ** 2;
    placed.forEach((p, i) => {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d <= bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    setActive(best);
  };

  const activePoint = active !== null ? placed[active] : null;
  const typeLabel = (p) => p.row.description || t(`insights.timeline.type.${p.row.type}`);

  return (
    <>
      <ChartLegend
        items={[
          { key: 'in', label: t('dashboard.income'), color: 'var(--chart-in)', shape: 'circle', value: String(incomingCount) },
          {
            key: 'out',
            label: t('dashboard.expenses'),
            color: 'var(--chart-out)',
            shape: 'square',
            value: String(placed.length - incomingCount),
          },
        ]}
      />
      <div className="chart-frame" ref={ref}>
        {width > 0 && (
          <svg
            className="chart-svg"
            width={width}
            height={DOTS_HEIGHT}
            role="img"
            aria-label={t('charts.activity.aria', { count: placed.length })}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setActive(null)}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
                <text className="chart-axis" x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {compactNumber(tick, locale)}
                </text>
              </g>
            ))}
            {dateTicks.map((time, i) => (
              <text
                key={time}
                className="chart-axis"
                x={x(time)}
                y={DOTS_HEIGHT - 8}
                textAnchor={i === 0 ? 'start' : i === dateTicks.length - 1 ? 'end' : 'middle'}
              >
                {new Date(time).toLocaleDateString(intlLocale(locale), { day: 'numeric', month: 'short' })}
              </text>
            ))}
            {/* Circle = money in, square = money out: shape carries the
                direction too, so it never rests on colour alone. The 2px
                surface ring keeps overlapping marks legible. */}
            {placed.map((p, i) =>
              p.incoming ? (
                <circle
                  key={p.row.id}
                  className={`chart-dot${active === i ? ' is-active' : ''}`}
                  cx={p.cx}
                  cy={p.cy}
                  r={active === i ? 6 : 4.5}
                  fill="var(--chart-in)"
                />
              ) : (
                <rect
                  key={p.row.id}
                  className={`chart-dot${active === i ? ' is-active' : ''}`}
                  x={p.cx - (active === i ? 6 : 4.5)}
                  y={p.cy - (active === i ? 6 : 4.5)}
                  width={active === i ? 12 : 9}
                  height={active === i ? 12 : 9}
                  rx="1.5"
                  fill="var(--chart-out)"
                />
              )
            )}
          </svg>
        )}
        {activePoint && (
          <ChartTooltip x={activePoint.cx} y={Math.max(0, activePoint.cy - 96)} width={width}>
            <div className="chart-tooltip__title">{typeLabel(activePoint)}</div>
            <div className="chart-tooltip__meta tabular-nums">
              {formatDate(activePoint.stamp)} · {formatTime(activePoint.stamp)} · {activePoint.row.transaction_number}
            </div>
            <div className="chart-tooltip__row">
              <span
                className={`chart-key chart-key--${activePoint.incoming ? 'circle' : 'square'}`}
                style={{ '--key-color': activePoint.incoming ? 'var(--chart-in)' : 'var(--chart-out)' }}
                aria-hidden="true"
              />
              <span>{activePoint.incoming ? t('dashboard.income') : t('dashboard.expenses')}</span>
              <strong className="tabular-nums">{formatMoney(activePoint.row.amount)}</strong>
            </div>
          </ChartTooltip>
        )}
        <div className="visually-hidden" aria-live="polite">
          {activePoint ? `${typeLabel(activePoint)}, ${formatDate(activePoint.stamp)}, ${formatMoney(activePoint.row.amount)}` : ''}
        </div>
      </div>
      {truncated && <p className="chart-note">{t('charts.activity.truncated', { count: rowLimit ?? placed.length })}</p>}
      <ChartTable
        caption={t('charts.activity.title')}
        columns={[
          { key: 'date', label: t('charts.col.date') },
          { key: 'description', label: t('charts.col.description') },
          { key: 'direction', label: t('charts.col.type') },
          { key: 'amount', label: t('charts.col.amount'), numeric: true },
        ]}
        rows={[...placed].reverse().map((p) => ({
          key: p.row.id,
          date: `${formatDate(p.stamp)} ${formatTime(p.stamp)}`,
          description: typeLabel(p),
          direction: p.incoming ? t('dashboard.income') : t('dashboard.expenses'),
          amount: formatMoney(p.row.amount),
        }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// C. Donut — giving composition (tithe / offering / other) for the range
// ---------------------------------------------------------------------------

const DONUT_SIZE = 200;
const DONUT_THICKNESS = 26;

function arcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const point = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = point(rOuter, startAngle);
  const [x2, y2] = point(rOuter, endAngle);
  const [x3, y3] = point(rInner, endAngle);
  const [x4, y4] = point(rInner, startAngle);
  return `M${x1},${y1}A${rOuter},${rOuter} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${rInner},${rInner} 0 ${large} 0 ${x4},${y4}Z`;
}

function collectionSlices(collections, t) {
  return [
    { key: 'tithe', label: t('insights.collections.tithe'), value: collections.tithe, color: 'var(--chart-series-1)' },
    { key: 'offering', label: t('insights.collections.offering'), value: collections.offering, color: 'var(--chart-series-2)' },
    { key: 'other', label: t('charts.collections.other'), value: collections.other, color: 'var(--chart-series-3)' },
  ];
}

export function CollectionsDonut({ collections }) {
  const { t, locale } = useLocale();
  const [hovered, setHovered] = useState(null);
  const slices = collectionSlices(collections, t);
  const total = slices.reduce((sum, s) => sum + (Number(s.value) || 0), 0);

  const cx = DONUT_SIZE / 2;
  const cy = DONUT_SIZE / 2;
  const rOuter = DONUT_SIZE / 2 - 4;
  const rInner = rOuter - DONUT_THICKNESS;
  const drawn = slices.filter((s) => Number(s.value) > 0);
  // A 2px surface gap between segments, as an angle at the outer radius.
  // None when a single category is the whole ring.
  const gap = drawn.length > 1 ? 2 / rOuter : 0;

  const sweeps = drawn.map((slice) => ((Number(slice.value) || 0) / total) * Math.PI * 2);
  const arcs = drawn.map((slice, i) => {
    const from = -Math.PI / 2 + sweeps.slice(0, i).reduce((sum, s) => sum + s, 0);
    return { ...slice, sweep: sweeps[i], startAngle: from + gap / 2, endAngle: from + sweeps[i] - gap / 2 };
  });

  const share = (value) => (total > 0 ? Math.round(((Number(value) || 0) / total) * 1000) / 10 : 0);
  const focus = hovered ? slices.find((s) => s.key === hovered) : null;

  return (
    <div className="donut">
      <div className="donut__figure">
        <svg
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          className="donut__svg"
          role="img"
          aria-label={t('charts.collections.aria')}
          onMouseLeave={() => setHovered(null)}
        >
          {arcs.map((arc) =>
            arc.sweep >= Math.PI * 2 - 1e-6 ? (
              // A full ring cannot be drawn as one arc (start = end point).
              <circle
                key={arc.key}
                cx={cx}
                cy={cy}
                r={(rOuter + rInner) / 2}
                fill="none"
                stroke={arc.color}
                strokeWidth={DONUT_THICKNESS}
                onMouseEnter={() => setHovered(arc.key)}
              />
            ) : (
              <path
                key={arc.key}
                d={arcPath(cx, cy, rOuter, rInner, arc.startAngle, arc.endAngle)}
                fill={arc.color}
                className={`donut__arc${hovered && hovered !== arc.key ? ' is-dimmed' : ''}`}
                onMouseEnter={() => setHovered(arc.key)}
              />
            )
          )}
        </svg>
        <div className="donut__center" aria-hidden="true">
          <span className="donut__center-label">{focus ? focus.label : t('charts.collections.total')}</span>
          <span className="donut__center-value">
            TZS {compactNumber(focus ? Number(focus.value) || 0 : total, locale)}
          </span>
          {focus && <span className="donut__center-share">{share(focus.value)}%</span>}
        </div>
      </div>
      {/* The legend states every exact figure, so nothing depends on hover. */}
      <ul className="donut__legend">
        {slices.map((slice) => (
          <li
            key={slice.key}
            className={`donut__legend-item${hovered === slice.key ? ' is-active' : ''}`}
            onMouseEnter={() => setHovered(slice.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="chart-key chart-key--square" style={{ '--key-color': slice.color }} aria-hidden="true" />
            <span className="donut__legend-label">{slice.label}</span>
            <span className="donut__legend-value tabular-nums">{formatMoney(slice.value)}</span>
            <span className="donut__legend-share tabular-nums">{share(slice.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
