import { useId, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney } from '../../utils/format.js';

// Monthly income timeline, drawn as responsive SVG.
//
// No charting dependency, for the same reason FundDonut.jsx has none: an
// area, a line and a dashed projection do not justify ~50kB of Recharts,
// and hand-drawing keeps every colour on the product's own tokens.
//
// COORDINATE MODEL: the SVG uses a fixed viewBox and `preserveAspectRatio
// = none` on nothing — instead the <svg> scales via CSS width:100% with a
// viewBox, so all geometry below is computed in viewBox units and the
// browser handles responsiveness. Stroke widths are therefore specified in
// viewBox units too, and `vector-effect: non-scaling-stroke` keeps them
// visually constant at any rendered size.
const VB_W = 720;
const VB_H = 240;
const PAD = { top: 18, right: 16, bottom: 30, left: 16 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;

const MONTH_SHORT = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  sw: ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'],
};

export default function TrendChart({ series = [], forecast = null }) {
  const { t, locale } = useLocale();
  const [activeIndex, setActiveIndex] = useState(null);
  // Gradient ids must be unique per instance — two charts on one page
  // sharing an id would make the second one reference the first's fill.
  const gradientId = useId();

  const model = useMemo(() => {
    // The forecast shares the x-axis but is never part of the actual line;
    // it is appended only so the axis reserves room for it.
    const points = series.map((p) => ({ ...p, value: Number(p.income) || 0 }));
    const forecastValue = forecast ? Number(forecast.amount) || 0 : null;
    const allValues = [...points.map((p) => p.value), ...(forecastValue === null ? [] : [forecastValue])];
    // A flat-zero tenant would divide by zero; 1 keeps the baseline flat.
    const max = Math.max(...allValues, 1);
    const slots = points.length + (forecast ? 1 : 0);
    const step = slots > 1 ? PLOT_W / (slots - 1) : 0;

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
  }, [series, forecast]);

  if (model.coords.length === 0) return null;

  const months = MONTH_SHORT[locale] ?? MONTH_SHORT.en;
  const labelFor = (point) => `${months[point.month - 1]} ${String(point.year).slice(2)}`;
  const active = activeIndex === null ? null : model.coords[activeIndex];

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label={t('dashboard.trends.title')}>
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
          x2={VB_W - PAD.right}
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

        {/* Every other label on the axis — 12 labels at this width collide. */}
        {model.coords.map((point, i) =>
          i % 2 === 0 || activeIndex === i ? (
            <text
              key={`label-${point.period}`}
              x={point.x}
              y={VB_H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
            >
              {labelFor(point)}
            </text>
          ) : null
        )}
      </svg>

      <AnimatePresence>
        {active && (
          <motion.div
            className="trend-chart__tooltip"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 30 }}
            // Positioned as a percentage of the plot so it tracks the node
            // through any responsive width.
            style={{ left: `${(active.x / VB_W) * 100}%`, top: `${(active.y / VB_H) * 100}%` }}
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
