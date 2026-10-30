// Charts. The plot always runs left to right (time flows left → right in Hebrew too), but the
// legend and tooltips follow the UI language, and in Hebrew the value axis sits on the right,
// where reading starts. Balance is the emphasized series; money invested is the gray context
// line; returns use the validated blue (gain) ↔ red (loss) pair with 4px rounded data ends.

import { useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { FundType, Period, PeriodYield, ReturnPaths, SeriesPoint } from '../../shared/types';
import { useI18n } from '../i18n';
import { useTheme } from '../theme';
import { toneOf, typeClass } from './ui';

interface TooltipArgs {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

const MARGIN = { top: 8, right: 4, bottom: 0, left: 4 };

function useAxisProps() {
  const { chart } = useTheme();
  const { dir } = useI18n();

  return {
    x: { tick: { fill: chart.text, fontSize: 12 }, tickLine: false, axisLine: { stroke: chart.axis } },
    y: {
      tick: { fill: chart.text, fontSize: 12 },
      tickLine: false,
      axisLine: false,
      width: 56,
      orientation: (dir === 'rtl' ? 'right' : 'left') as 'right' | 'left',
    },
  };
}

/** Round percentage ticks (0%, 5%, 10%…) covering the data and zero. */
export function percentTicks(values: number[]): { ticks: number[]; digits: number } {
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 0.01;
  const step = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find(s => span / s <= 6) ?? 1;
  const ticks: number[] = [];

  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-6; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }

  // At least two ticks (all-zero data), and the top tick must cover the highest value.
  while (ticks.length < 2 || ticks[ticks.length - 1] < hi) {
    ticks.push(Math.round((ticks[ticks.length - 1] + step) * 1e6) / 1e6);
  }

  return { ticks, digits: Number.isInteger(Math.round(step * 1000) / 10) ? 0 : 1 };
}

/** The months a period covers, so the chart shows the same window as the return next to it (all of them when the period has no data). */
export function seriesIn(series: SeriesPoint[], { startMonth: from, endMonth: to }: Pick<PeriodYield, 'startMonth' | 'endMonth'>): SeriesPoint[] {
  return from && to ? series.filter(s => s.month >= from && s.month <= to) : series;
}

/** A choice between a few options, remembered in this browser. */
function useStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;

      return saved && options.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });

  return [
    value,
    next => {
      setValue(next);

      try {
        localStorage.setItem(key, next);
      } catch {
        // storage unavailable
      }
    },
  ];
}

function Segmented<T extends string>({ options, value, onChange, label }: { options: Array<[T, string]>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented small" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export type ReturnPath = ReturnPaths[Period];

/** One fund for BalanceChart's by-fund view: its recorded balances and its return path for the period shown. */
export interface FundLine {
  id: number;
  name: string;
  type: FundType;
  points: Array<{ month: string; balance: number }>;
  path: ReturnPath;
}

/** Line pattern of the 1st, 2nd, 3rd… fund of one type (they share the type's color). */
const DASHES = [undefined, '6 4', '2 3', '10 3 2 3'];

function LineSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg className="line-swatch" width="18" height="6" aria-hidden="true">
      <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dash} />
    </svg>
  );
}

/** Each fund's color and line pattern, given in fund order so a fund keeps its look everywhere. */
export function fundStyles(funds: Array<{ id: number; type: FundType }>, colors: Record<string, string>) {
  const perType = new Map<string, number>();
  const styles = new Map<number, { color: string; nth: number; dash?: string }>();

  for (const f of [...funds].sort((a, b) => a.id - b.id)) {
    const family = typeClass(f.type);
    const nth = perType.get(family) ?? 0;

    perType.set(family, nth + 1);
    styles.set(f.id, { color: colors[family], nth, dash: DASHES[nth % DASHES.length] });
  }

  return styles;
}

type Measure = 'balance' | 'return';

/**
 * Balance or return over the period shown. "Return" is the return since the period's start with
 * deposits and withdrawals taken out, ending at the same figure as the tables. Given `funds`, it
 * can draw each fund as its own line (in its type's color, a second fund of a type dashed).
 */
export function BalanceChart({
  series,
  path,
  funds,
  height = 280,
}: {
  series: SeriesPoint[];
  path: ReturnPath;
  funds?: FundLine[];
  height?: number;
}) {
  const { t, fmt, dir } = useI18n();
  const { chart } = useTheme();
  const axis = useAxisProps();
  const [measure, setMeasure] = useStoredChoice<Measure>('yielder-chart-measure', ['balance', 'return'], 'balance');
  const [view, setView] = useStoredChoice('yielder-chart-view', ['funds', 'total'] as const, 'funds');
  const styles = fundStyles(funds ?? [], chart.types);
  const inWindow = new Set(series.map(s => s.month));
  const isReturn = measure === 'return';

  // Per fund: the values drawn (balances in the period, or its return path), biggest balance first.
  const lines = (funds ?? [])
    .map(f => {
      const at = new Map<string, number | null>(
        isReturn ? f.path.map(p => [p.month, p.return]) : f.points.filter(p => inWindow.has(p.month)).map(p => [p.month, p.balance]),
      );

      return { ...f, ...styles.get(f.id)!, at, size: f.points.at(-1)?.balance ?? 0 };
    })
    .filter(f => f.at.size > 0)
    .sort((a, b) => b.size - a.size);
  const canSplit = (funds ?? []).length > 1;
  const byFund = canSplit && view === 'funds';

  // Months on the x-axis: the period's months (a fund's return period can start a month earlier
  // when it reports later than the others).
  const months = [...new Set([...(isReturn ? (byFund ? lines.flatMap(f => [...f.at.keys()]) : path.map(p => p.month)) : series.map(s => s.month))])].sort();
  const totalReturn = new Map(path.map(p => [p.month, p.return]));
  const data = months.map(month => ({
    month,
    total: isReturn ? (totalReturn.get(month) ?? null) : (series.find(s => s.month === month)?.balance ?? null),
    invested: series.find(s => s.month === month)?.cumulativeFlow ?? null,
    ...(byFund ? Object.fromEntries(lines.map(f => [`f${f.id}`, f.at.get(month) ?? null])) : {}),
  }));
  const pctValues = data.flatMap(d => (byFund ? lines.map(f => f.at.get(d.month) ?? 0) : [d.total ?? 0]));
  const { ticks, digits } = percentTicks(isReturn ? pctValues : [0]);
  const value = (v: number | null | undefined) => (isReturn ? fmt.pct(v) : fmt.money(v ?? null));

  return (
    <div className="chart">
      <div className="chart-head">
        <div className="chart-legend">
          {byFund ? (
            lines.map(f => (
              <span key={f.id}>
                <LineSwatch color={f.color} dash={f.dash} />
                <bdi>{f.name}</bdi>
              </span>
            ))
          ) : (
            <>
              <span>
                <span className="swatch" style={{ background: chart.accent }} />
                {isReturn ? t('chart.returnSoFar') : t('chart.balance')}
              </span>
              {!isReturn && (
                <span>
                  <span className="swatch" style={{ background: chart.context }} />
                  {t('chart.invested')}
                </span>
              )}
            </>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canSplit && (
            <Segmented
              label={t('chart.view')}
              value={view}
              onChange={setView}
              options={[
                ['funds', t('chart.byFund')],
                ['total', t('chart.total')],
              ]}
            />
          )}
          <Segmented
            label={t('chart.measure')}
            value={measure}
            onChange={setMeasure}
            options={[
              ['balance', t('chart.measureBalance')],
              ['return', t('chart.measureReturn')],
            ]}
          />
        </div>
      </div>
      <div dir="ltr">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={data} margin={MARGIN}>
            <defs>
              <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.accent} stopOpacity={0.18} />
                <stop offset="100%" stopColor={chart.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={chart.grid} />
            <XAxis dataKey="month" tickFormatter={fmt.monthShort} minTickGap={28} {...axis.x} />
            {isReturn ? (
              <YAxis ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} tickFormatter={v => fmt.pct(v, digits)} {...axis.y} />
            ) : (
              <YAxis tickFormatter={fmt.compact} {...axis.y} />
            )}
            {isReturn && <ReferenceLine y={0} stroke={chart.axis} />}
            <Tooltip
              cursor={{ stroke: chart.axis }}
              content={({ active, payload }: TooltipArgs) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;

                if (!row) {
                  return null;
                }

                if (byFund) {
                  // Only funds with a figure for this month; the Total view has the whole portfolio.
                  const at = (f: (typeof lines)[number]) => f.at.get(row.month) ?? 0;
                  const shown = lines.filter(f => f.at.get(row.month) !== undefined && f.at.get(row.month) !== null).sort((a, b) => at(b) - at(a));

                  return (
                    <div className="chart-tooltip" dir={dir}>
                      <div className="t-title">{fmt.month(row.month)}</div>
                      {shown.map(f => (
                        <div className="t-row" key={f.id}>
                          <span>
                            <LineSwatch color={f.color} dash={f.dash} />
                            <bdi>{f.name}</bdi>
                          </span>
                          <b className={isReturn ? toneOf(at(f)) : undefined}>{value(at(f))}</b>
                        </div>
                      ))}
                    </div>
                  );
                }

                return (
                  <div className="chart-tooltip" dir={dir}>
                    <div className="t-title">{fmt.month(row.month)}</div>
                    <div className="t-row">
                      <span>{isReturn ? t('chart.returnSoFar') : t('chart.balance')}</span>
                      <b className={isReturn ? toneOf(row.total) : undefined}>{value(row.total)}</b>
                    </div>
                    {!isReturn && (
                      <div className="t-row">
                        <span>{t('chart.invested')}</span>
                        <span>{fmt.money(row.invested)}</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {byFund
              ? lines.map(f => (
                  <Line
                    key={f.id}
                    type="monotone"
                    dataKey={`f${f.id}`}
                    stroke={f.color}
                    strokeDasharray={f.dash}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3.5, stroke: chart.surface, strokeWidth: 2 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))
              : isReturn
                ? [
                    <Line
                      key="total"
                      type="monotone"
                      dataKey="total"
                      stroke={chart.accent}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, stroke: chart.surface, strokeWidth: 2 }}
                      connectNulls
                      isAnimationActive={false}
                    />,
                  ]
                : [
                    <Area
                      key="total"
                      type="monotone"
                      dataKey="total"
                      stroke={chart.accent}
                      strokeWidth={2}
                      fill="url(#balanceFill)"
                      dot={false}
                      activeDot={{ r: 4, stroke: chart.surface, strokeWidth: 2 }}
                      isAnimationActive={false}
                    />,
                    <Line
                      key="invested"
                      type="stepAfter"
                      dataKey="invested"
                      stroke={chart.context}
                      strokeWidth={2}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                    />,
                  ]}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {isReturn && <p className="small muted chart-note">{t('chart.returnHint')}</p>}
    </div>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Striped fill: the second fund of a type, which shares the type's color. */
  hatched?: boolean;
}

function SliceSwatch({ slice }: { slice: Slice }) {
  return (
    <span
      className="slice-swatch"
      aria-hidden="true"
      style={{
        borderColor: slice.color,
        background: slice.hatched ? `repeating-linear-gradient(45deg, ${slice.color} 0 2px, transparent 2px 4px)` : slice.color,
      }}
    />
  );
}

/**
 * Part-to-whole donut (keep it to ~6 slices) with the total in the middle and a legend that
 * doubles as the table: name, share and amount for every slice.
 */
export function Donut({ slices, label, size = 168 }: { slices: Slice[]; label: string; size?: number }) {
  const { fmt, dir } = useI18n();
  const { chart } = useTheme();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const share = (v: number) => (total ? v / total : 0);
  const fill = (s: Slice) => (s.hatched ? `url(#hatch-${s.key})` : s.color);

  return (
    <div className="donut-block">
      <div className="donut" style={{ width: size, height: size }}>
        <PieChart width={size} height={size}>
          <defs>
            {slices
              .filter(s => s.hatched)
              .map(s => (
                <pattern key={s.key} id={`hatch-${s.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={s.color} opacity="0.35" />
                  <rect width="3" height="6" fill={s.color} />
                </pattern>
              ))}
          </defs>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius="64%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke={chart.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {slices.map(s => (
              <Cell key={s.key} fill={fill(s)} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }: TooltipArgs) => {
              const s = active ? (payload?.[0]?.payload as Slice | undefined) : undefined;

              return s ? (
                <div className="chart-tooltip" dir={dir}>
                  <div className="t-title">
                    <bdi>{s.label}</bdi>
                  </div>
                  <div className="t-row">
                    <b>{fmt.money(s.value)}</b>
                    <span>{fmt.share(share(s.value))}</span>
                  </div>
                </div>
              ) : null;
            }}
          />
        </PieChart>
        <div className="donut-center">
          <span className="muted small">{label}</span>
          <b>{fmt.money(total)}</b>
        </div>
      </div>
      <ul className="donut-legend">
        {slices.map(s => (
          <li key={s.key}>
            <SliceSwatch slice={s} />
            {/* The cell follows the page direction; the name inside keeps its own. */}
            <span className="name">
              <bdi>{s.label}</bdi>
            </span>
            <b className="num">{fmt.share(share(s.value))}</b>
            <span className="num muted">{fmt.money(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ReturnBar {
  label: string;
  value: number | null;
  title: string;
  /** Optional money gain shown in the tooltip. */
  gain?: number | null;
  /** Identifies the bar for onBarClick (e.g. '2024' or '2024-03'). */
  key?: string;
}

/** Rectangle with 4px rounded corners at the data end only (top for gains, bottom for losses). */
function DataEndBar(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; value?: number | number[] }) {
  const { x = 0, width = 0, fill } = props;
  const y0 = props.y ?? 0;
  const h0 = props.height ?? 0;
  const top = Math.min(y0, y0 + h0);
  const h = Math.abs(h0);
  const value = Array.isArray(props.value) ? props.value[1] - props.value[0] : (props.value ?? 0);
  const r = Math.min(4, h, width / 2);

  if (h === 0 || width <= 0) {
    return null;
  }

  const d =
    value >= 0
      ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`
      : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + width - r} Q${x + width},${top + h} ${x + width},${top + h - r} V${top} Z`;

  return <path d={d} fill={fill} />;
}

export function ReturnsChart({
  data,
  height = 220,
  onBarClick,
}: {
  data: ReturnBar[];
  height?: number;
  /** Makes bars clickable (drill-down); keyboard users get the same via the table next to the chart. */
  onBarClick?: (bar: ReturnBar) => void;
}) {
  const { fmt, dir, t } = useI18n();
  const { chart } = useTheme();
  const axis = useAxisProps();
  const { ticks, digits } = percentTicks(data.map(d => d.value ?? 0));

  return (
    <div dir="ltr" className="chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={MARGIN} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={chart.grid} />
          <XAxis dataKey="label" minTickGap={16} {...axis.x} />
          <YAxis ticks={ticks} domain={[ticks[0], ticks[ticks.length - 1]]} tickFormatter={v => fmt.pct(v, digits)} {...axis.y} />
          <ReferenceLine y={0} stroke={chart.axis} />
          <Tooltip
            cursor={{ fill: chart.grid, opacity: 0.5 }}
            content={({ active, payload }: TooltipArgs) => {
              const p = active && (payload?.[0]?.payload as ReturnBar | undefined);

              return p ? (
                <div className="chart-tooltip" dir={dir}>
                  <div className="t-title">{p.title}</div>
                  <div className="t-row">
                    <span>{t('chart.return')}</span>
                    <b className={toneOf(p.value)}>{fmt.pct(p.value)}</b>
                  </div>
                  {p.gain !== undefined && p.gain !== null && (
                    <div className="t-row">
                      <span>{t('yield.gain')}</span>
                      <span className={toneOf(p.gain)}>{fmt.signedMoney(p.gain)}</span>
                    </div>
                  )}
                </div>
              ) : null;
            }}
          />
          <Bar
            dataKey="value"
            isAnimationActive={false}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={onBarClick ? (entry: unknown) => onBarClick((entry as { payload: ReturnBar }).payload) : undefined}
            shape={(props: unknown) => {
              const p = props as Parameters<typeof DataEndBar>[0] & { payload: ReturnBar };

              return <DataEndBar {...p} fill={(p.payload.value ?? 0) >= 0 ? chart.gain : chart.loss} />;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
