import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney } from '../../utils/format.js';

// Monthly income timeline, drawn as responsive SVG.
//
// No charting dependency, for the same reason FundDonut.jsx has none: an
// area, a line and a dashed projection do not justify ~50kB of Recharts,
// and hand-drawing keeps every colour on the product's own tokens. What
// Recharts' <ResponsiveContainer> does — measure the parent and re-render
// the chart at that width — is done here by the ResizeObserver below.
//
// COORDINATE MODEL: the viewBox width TRACKS THE MEASURED CONTAINER WIDTH,
// so one viewBox unit is one CSS pixel and the SVG is never scaled.
//
// This is the fix for unreadable mobile labels. The viewBox used to be a
// fixed 720 units wide, stretched by CSS to whatever the panel offered.
// That scales the text along with the drawing: an 11-unit axis label
// rendered at 11 x (320/720) = 4.9 CSS pixels on a 360px phone — far below
// legibility, and the exact symptom reported. With the viewBox matching the
// render width, `fontSize={12}` means twelve real pixels at every viewport.
const VB_H = 240;
const FALLBACK_W = 720; // used for the first paint, before the observer reports
const MIN_W = 260;
const PAD = { top: 18, right: 16, bottom: 34, left: 16 };
const PLOT_H = VB_H - PAD.top - PAD.bottom;

// Real pixel sizes now, not viewBox units that shrink on small screens.
const AXIS_FONT_PX = 12;
// Widest an axis label gets ("Sep 26") plus breathing room, used to work out
// how many labels can share the axis without colliding.
const AXIS_LABEL_W = 46;

/**
 * Measures the element the ref is attached to and keeps its width in state —
 * the local equivalent of Recharts' <ResponsiveContainer width="100%">.
 *
 * Falls back to a fixed width when ResizeObserver is unavailable (older
 * Safari, and jsdom in tests), so the chart still renders rather than
 * collapsing to zero width.
 */
function useMeasuredWidth(ref) {
  const [width, setWidth] = useState(0);

  // Layout effect so the first real width is applied before the browser
  // paints, avoiding a visible reflow from the fallback width to the true one.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(node.getBoundingClientRect().width);
    return undefined;
  }, [ref]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      // contentRect excludes padding/border, which is exactly the drawable
      // width the viewBox should equal.
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * How many axis labels to skip so they never overlap, always keeping the
 * first and last (Recharts' `interval="preserveStartEnd"` behaviour).
 *
 * The old rule was a hardcoded `i % 2 === 0`, tuned for a 720px desktop
 * chart. On a 360px phone every other label out of twelve still collides;
 * on a wide screen it needlessly hides half the axis. This derives the
 * stride from the width actually available.
 */
function labelStride(count, plotWidth) {
  if (count <= 1) return 1;
  const fits = Math.max(1, Math.floor(plotWidth / AXIS_LABEL_W));
  return Math.max(1, Math.ceil((count - 1) / Math.max(1, fits - 1)));
}

const MONTH_SHORT = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};

// The tooltip is a fixed-width (min 150px) HTML box positioned as a
// percentage of the plot, inside a panel that clips its overflow
// (.analytics-canvas). Centred on the node it would therefore be cut in half
// at the first and last month — the whole left/right edge of the chart — and
// cut off at the top whenever a month is the series maximum. That is
// unmissable on a 360px phone, where the box is nearly half the panel width.
//
// So the anchor moves instead of the box being allowed to escape:
//   · near the left edge  → left-aligned  (extends right, into the plot)
//   · near the right edge → right-aligned (extends left, into the plot)
//   · near the top        → flipped below the node instead of above
// Everywhere else it stays centred above the node, which is the placement
// that reads best and is what most points get.
const EDGE_PCT = 24;
const TOP_FLIP_PCT = 34;

function tooltipPlacement(point, vbW) {
  const leftPct = (point.x / vbW) * 100;
  const topPct = (point.y / VB_H) * 100;
  const flipped = topPct < TOP_FLIP_PCT;

  let translateX = '-50%';
  if (leftPct < EDGE_PCT) translateX = '0';
  else if (leftPct > 100 - EDGE_PCT) translateX = '-100%';

  return {
    flipped,
    style: {
      left: `${leftPct}%`,
      top: `${topPct}%`,
      // 20% below the node when flipped, 120% above it otherwise — both
      // measured against the tooltip's own height, so neither depends on
      // the rendered chart size.
      transform: `translate(${translateX}, ${flipped ? '20%' : '-120%'})`,
    },
  };
}

export default function TrendChart({ series = [], forecast = null }) {
  const { t, locale } = useLocale();
  const [activeIndex, setActiveIndex] = useState(null);
  // Gradient ids must be unique per instance — two charts on one page
  // sharing an id would make the second one reference the first's fill.
  const gradientId = useId();
  const wrapRef = useRef(null);
  const measured = useMeasuredWidth(wrapRef);
  // MIN_W keeps the geometry sane if the panel is briefly measured at ~0
  // (during an enter animation, or inside a collapsed container).
  const vbW = Math.max(measured || FALLBACK_W, MIN_W);
  const plotW = vbW - PAD.left - PAD.right;

  const model = useMemo(() => {
    // The forecast shares the x-axis but is never part of the actual line;
    // it is appended only so the axis reserves room for it.
    const points = series.map((p) => ({ ...p, value: Number(p.income) || 0 }));
    const forecastValue = forecast ? Number(forecast.amount) || 0 : null;
    const allValues = [...points.map((p) => p.value), ...(forecastValue === null ? [] : [forecastValue])];
    // A flat-zero tenant would divide by zero; 1 keeps the baseline flat.
    const max = Math.max(...allValues, 1);
    const slots = points.length + (forecast ? 1 : 0);
    const step = slots > 1 ? plotW / (slots - 1) : 0;

    const x = (i) => PAD.left + i * step;
    const y = (value) => PAD.top + PLOT_H - (value / max) * PLOT_H;

    const coords = points.map((p, i) => ({ ...p, x: x(i), y: y(p.value) }));
    const forecastCoord = forecast
      ? { ...forecast, value: forecastValue, x: x(points.length), y: y(forecastValue) }
      : null;

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath = coords.length
      ? `${linePath} L ${coords[coords.length - 1].x} ${PAD.top + PLOT_H} L ${coords[0].x} ${PAD.top + PLOT_H} Z`
      : '';
    // Dashed bridge from the last real month into the projection.
    const forecastPath =
      forecastCoord && coords.length
        ? `M ${coords[coords.length - 1].x} ${coords[coords.length - 1].y} L ${forecastCoord.x} ${forecastCoord.y}`
        : '';

    return { coords, forecastCoord, linePath, areaPath, forecastPath, step };
  }, [series, forecast, plotW]);

  const months = MONTH_SHORT[locale] ?? MONTH_SHORT.en;
  const labelFor = (point) => `${months[point.month - 1]} ${String(point.year).slice(2)}`;
  const active = activeIndex === null ? null : model.coords[activeIndex];
  const tooltip = active ? tooltipPlacement(active, vbW) : null;
  const stride = labelStride(model.coords.length, plotW);

  // The wrapper is what gets measured, so it must render even when there is
  // nothing to draw — returning early above it would leave the observer with
  // no element and the chart stuck at its fallback width.
  return (
    <div className="trend-chart" ref={wrapRef}>
      {model.coords.length === 0 ? null : (
      <svg viewBox={`0 0 ${vbW} ${VB_H}`} role="img" aria-label={t('dashboard.trends.title')}>
        <defs>
          <linearGradient id={`${gradientId}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline only — no full grid. On a panel this size a gridline per
            month competes with the data it is supposed to support. */}
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={vbW - PAD.right}
          y2={PAD.top + PLOT_H}
          stroke="rgba(var(--color-primary-rgb), 0.14)"
          strokeWidth="1"
        />

        {/* Area sweeps up from the baseline as the line draws. */}
        <motion.path
          d={model.areaPath}
          fill={`url(#${gradientId}-area)`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.45 }}
        />

        {/* pathLength 0→1 is what makes the line appear to draw itself;
            Framer normalises pathLength so the value is unit-independent. */}
        <motion.path
          d={model.linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />

        {model.forecastCoord && (
          <>
            <motion.path
              d={model.forecastPath}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              strokeDasharray="6 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.35, 0.9, 0.35] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: 1.1 }}
            />
            {/* Ambient pulse on the projected node. */}
            <motion.circle
              cx={model.forecastCoord.x}
              cy={model.forecastCoord.y}
              r="9"
              fill="var(--color-accent)"
              opacity="0.18"
              animate={{ r: [7, 13, 7], opacity: [0.26, 0.05, 0.26] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <circle
              cx={model.forecastCoord.x}
              cy={model.forecastCoord.y}
              r="4"
              fill="var(--color-bg-solid, #ffffff)"
              stroke="var(--color-accent)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {model.coords.map((point, i) => (
          <g key={point.period}>
            <motion.circle
              cx={point.x}
              cy={point.y}
              r={activeIndex === i ? 5.5 : 3.5}
              fill="var(--color-accent)"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.5 + i * 0.05 }}
              style={{ transformOrigin: `${point.x}px ${point.y}px` }}
            />
            {/* Full-height hit area: a 3.5px dot is not a pointer target,
                and on touch it is unusable. This column makes the whole
                month hoverable/tappable. */}
            <rect
              x={point.x - model.step / 2}
              y={PAD.top}
              width={Math.max(model.step, 12)}
              height={PLOT_H}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
              tabIndex={0}
              role="button"
              aria-label={`${labelFor(point)}: ${formatMoney(point.income)}`}
            />
          </g>
        ))}

        {/* Axis labels, thinned to whatever actually fits the measured
            width, always keeping the first and last (preserve-start-end)
            plus whichever month is currently hovered. `stride` replaces the
            old fixed `i % 2`, which was tuned for a 720px desktop chart and
            still collided at 360px.

            textAnchor shifts to `start` on the first label and `end` on the
            last so neither hangs off the edge of the plot — centring them
            pushed roughly half a label's width outside the SVG. */}
        {model.coords.map((point, i) => {
          const isFirst = i === 0;
          const isLast = i === model.coords.length - 1;
          const show = isFirst || isLast || i % stride === 0 || activeIndex === i;
          if (!show) return null;
          return (
            <text
              key={`label-${point.period}`}
              x={point.x}
              y={VB_H - 12}
              textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
              fontSize={AXIS_FONT_PX}
              fontWeight="600"
              fill="var(--text-muted)"
            >
              {labelFor(point)}
            </text>
          );
        })}
      </svg>
      )}

      <AnimatePresence>
        {active && (
          <motion.div
            className={`trend-chart__tooltip${tooltip.flipped ? ' is-flipped' : ''}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
            // Positioned as a percentage of the plot so it tracks the node
            // through any responsive width, with the anchor flipped near the
            // panel edges so the box is never clipped (see tooltipPlacement).
            // The entry animation no longer animates `y`: Framer would write
            // its own transform and clobber the placement translate.
            style={tooltip.style}
          >
            <div className="trend-chart__tooltip-month">{labelFor(active)}</div>
            <div className="trend-chart__tooltip-row">
              <span className="trend-chart__tooltip-key">{t('dashboard.income')}</span>
              <span className="trend-chart__tooltip-value tabular-nums">{formatMoney(active.income)}</span>
            </div>
            <div className="trend-chart__tooltip-row">
              <span className="trend-chart__tooltip-key">{t('dashboard.expenses')}</span>
              <span className="trend-chart__tooltip-value tabular-nums">{formatMoney(active.expense)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
