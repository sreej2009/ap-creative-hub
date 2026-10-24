import { useEffect, useMemo, useRef, useState } from 'react';
import { cn, formatPrice } from '../../lib/format';

export interface TrendPoint {
  date: string; // YYYY-MM-DD (IST)
  value: number;
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const label = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function compactRupees(paise: number) {
  const r = paise / 100;
  if (r >= 100000) return `₹${(r / 100000).toFixed(r % 100000 ? 1 : 0)}L`;
  if (r >= 1000) return `₹${(r / 1000).toFixed(r % 1000 ? 1 : 0)}K`;
  return `₹${Math.round(r)}`;
}

/**
 * Single-series column chart (no legend: the panel title names the series).
 * Thin columns with 4px rounded caps, hairline grid, peak label only,
 * per-column hover tooltip, and a table view for accessibility.
 */
export function TrendChart({
  points,
  kind,
  height = 220,
  title,
}: {
  points: TrendPoint[];
  kind: 'money' | 'count';
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  // Render at the container's real pixel width so text stays legible at any size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);
  const fmt = (v: number) => (kind === 'money' ? formatPrice(v) : v.toLocaleString('en-IN'));
  const tick = (v: number) => (kind === 'money' ? compactRupees(v) : v.toLocaleString('en-IN'));

  const { max, ticks, peak } = useMemo(() => {
    const raw = Math.max(0, ...points.map((p) => p.value));
    // Empty periods still get a meaningful scale (₹1,000 or 4 orders).
    const m = kind === 'count' ? Math.max(4, niceMax(raw)) : niceMax(Math.max(raw, 100000));
    const t = [0, m / 4, m / 2, (3 * m) / 4, m].map((x) => (kind === 'count' ? Math.round(x) : x));
    const peakIdx = raw > 0 ? points.findIndex((p) => p.value === raw) : -1;
    return { max: m, ticks: t, peak: peakIdx };
  }, [points, kind]);

  const W = width;
  const H = height;
  const pad = { top: 18, right: 8, bottom: 26, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const band = innerW / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(24, band - 2)); // ≤24px, ≥2px surface gap between neighbours
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64)));
  const empty = points.every((p) => p.value === 0);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={() => setAsTable(!asTable)} className="text-xs text-muted underline underline-offset-2 hover:text-rose-700">
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="py-1.5 font-semibold">Date</th>
                <th className="py-1.5 text-right font-semibold">{kind === 'money' ? 'Sales' : 'Orders'}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t border-line/70">
                  <td className="py-1.5 text-ink-soft">{longFmt.format(new Date(`${p.date}T00:00:00Z`))}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`${title}. ${empty ? 'No activity in this period.' : `Peak ${fmt(points[peak]?.value ?? 0)} on ${points[peak] ? label(points[peak].date) : ''}.`}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="#efe6dc" strokeWidth={1} />
                <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                  {tick(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = pad.left + i * band + (band - barW) / 2;
              const top = y(p.value);
              const h = pad.top + innerH - top;
              const r = Math.min(4, barW / 2, h);
              const active = hover === i;
              return (
                <g key={p.date}>
                  {/* Hit target spans the full band, larger than the mark. */}
                  <rect
                    x={pad.left + i * band}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    fill={active ? '#fdf4f6' : 'transparent'}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    tabIndex={0}
                    aria-label={`${label(p.date)}: ${fmt(p.value)}`}
                  />
                  {p.value > 0 && (
                    <path
                      d={`M${x},${pad.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + innerH} Z`}
                      fill={active ? '#8b2d4e' : '#a63a5f'}
                      pointerEvents="none"
                    />
                  )}
                  {i === peak && p.value > 0 && (
                    <text x={x + barW / 2} y={top - 6} textAnchor="middle" className="fill-ink text-[11px] font-semibold tabular-nums" pointerEvents="none">
                      {tick(p.value)}
                    </text>
                  )}
                  {(points.length - 1 - i) % labelEvery === 0 && (
                    <text x={pad.left + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-muted text-[10.5px]">
                      {label(p.date)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={pad.left} x2={W - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#dccbb7" strokeWidth={1} />
          </svg>
          {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">No activity in this period yet</p>}
          {hover !== null && points[hover] && (
            <div
              className={cn('pointer-events-none absolute top-1 z-10 rounded-xl border border-line bg-paper px-3 py-2 text-xs shadow-lift')}
              style={{
                left: `${((pad.left + hover * band + band / 2) / W) * 100}%`,
                transform: `translateX(${hover > points.length / 2 ? '-105%' : '5%'})`,
              }}
            >
              <p className="text-muted">{longFmt.format(new Date(`${points[hover].date}T00:00:00Z`))}</p>
              <p className="mt-0.5 font-semibold tabular-nums text-ink">{fmt(points[hover].value)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
