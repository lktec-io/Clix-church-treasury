import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { formatMoney, sumMoneyStrings } from '../../utils/format.js';

// Fund-allocation donut, drawn as plain SVG rather than pulling in a chart
// library — one ring of arcs doesn't justify ~50kB of Recharts/Chart.js, and
// hand-drawing it keeps the segments on the product's own --chart-* tokens.
//
// Geometry: each arc is a full circle whose stroke is dashed so that only
// its own share is painted (dasharray = "<arc> <rest>"), then rotated into
// place with a negative dashoffset equal to everything before it. The group
// is rotated -90° so the first segment starts at 12 o'clock instead of 3.

const RADIUS = 52;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

export default function FundDonut({ funds = [], total = 0 }) {
  const { t } = useLocale();
  const [activeIndex, setActiveIndex] = useState(null);

  // Only positive balances can be drawn — a negative fund has no arc length,
  // and including it would make the shares sum to more than 100%.
  //
  // Two representations are kept per segment, deliberately:
  //   value   — a Number, used ONLY for arc geometry and percentages
  //   display — the untouched decimal string from the API, used for text
  // Money is never rendered from the numeric form. Passing the Number to
  // formatMoney is what blanked the dashboard after login, and even with
  // formatMoney now hardened, round-tripping a DECIMAL(14,2) through a JS
  // float to display it is the wrong thing to do with someone's balance.
  const segments = useMemo(() => {
    if (!(total > 0)) return [];
    let cumulative = 0;
    return funds
      .map((fund) => ({ ...fund, value: Number(fund.balance), display: fund.balance }))
      .filter((fund) => Number.isFinite(fund.value) && fund.value > 0)
      .map((fund, i) => {
        const fraction = fund.value / total;
        const segment = {
          ...fund,
          fraction,
          color: CHART_COLORS[i % CHART_COLORS.length],
          offset: cumulative,
        };
        cumulative += fraction;
        return segment;
      });
  }, [funds, total]);

  // Total shown at rest. Summed from the original decimal strings with the
  // integer-cents helper rather than reusing the numeric `total` prop, so
  // the headline figure never passes through a float.
  const totalDisplay = useMemo(() => sumMoneyStrings(segments.map((s) => s.display)), [segments]);

  if (segments.length === 0) {
    return <div className="fund-donut__empty">{t('dashboard.fundAllocation.empty')}</div>;
  }

  const active = activeIndex === null ? null : segments[activeIndex];

  return (
    <div className="fund-donut">
      <div className="fund-donut__chart">
        <svg viewBox="0 0 140 140" role="img" aria-label={t('dashboard.fundAllocation')}>
          <g transform="rotate(-90 70 70)">
            {/* Track keeps the ring visually closed when one fund dominates
                and the remaining arcs are sub-pixel. */}
            <circle
              cx="70"
              cy="70"
              r={RADIUS}
              fill="none"
              stroke="rgba(var(--color-primary-rgb), 0.09)"
              strokeWidth={STROKE}
            />
            {segments.map((segment, i) => {
              const arc = segment.fraction * CIRCUMFERENCE;
              const isActive = activeIndex === i;
              return (
                <motion.circle
                  key={segment.fundId}
                  cx="70"
                  cy="70"
                  r={RADIUS}
                  fill="none"
                  stroke={segment.color}
                  strokeWidth={isActive ? STROKE + 5 : STROKE}
                  strokeDashoffset={-segment.offset * CIRCUMFERENCE}
                  strokeLinecap="butt"
                  initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}`, opacity: 0 }}
                  animate={{ strokeDasharray: `${arc} ${CIRCUMFERENCE - arc}`, opacity: 1 }}
                  transition={{ duration: 0.75, delay: 0.1 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    opacity: activeIndex === null || isActive ? 1 : 0.35,
                    transition: 'opacity 160ms ease, stroke-width 160ms ease',
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                />
              );
            })}
          </g>
        </svg>

        {/* Centre readout: the hovered fund, or the total at rest. */}
        <div className="fund-donut__center">
          <span className="fund-donut__center-label">
            {active ? active.name : t('dashboard.fundAllocation.total')}
          </span>
          <span className="fund-donut__center-value tabular-nums">
            {formatMoney(active ? active.display : totalDisplay)}
          </span>
          {active && (
            <span className="fund-donut__center-share">{Math.round(active.fraction * 100)}%</span>
          )}
        </div>
      </div>

      <ul className="fund-donut__legend">
        {segments.map((segment, i) => (
          <li key={segment.fundId}>
            <button
              type="button"
              className={`fund-donut__legend-item${activeIndex === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
            >
              <span className="fund-donut__swatch" style={{ background: segment.color }} aria-hidden="true" />
              <span className="fund-donut__legend-name">{segment.name}</span>
              <span className="fund-donut__legend-share tabular-nums">
                {Math.round(segment.fraction * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
