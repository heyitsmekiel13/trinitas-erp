import * as React from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import { moneyCompact, num, numCompact } from '@/lib/format'
import { AXIS_PROPS, CHART_INK, ChartLegend, SERIES, TooltipCard } from './ChartCard'

export * from './ChartCard'
export * from './advanced'

type Fmt = (value: number) => string

const FORMATTERS: Record<string, Fmt> = {
  money: moneyCompact,
  number: numCompact,
  percent: (v) => `${v.toFixed(1)}%`,
  hours: (v) => `${num(v)}h`,
}

function resolveFormat(format?: keyof typeof FORMATTERS | Fmt): Fmt {
  if (typeof format === 'function') return format
  return FORMATTERS[format ?? 'number']!
}

export type SeriesDef = {
  key: string
  label: string
  /** Categorical slot 1-8. Assign in order; the entity keeps its slot forever. */
  slot?: number
  /** Overrides the slot colour — used for brand-red single-series charts. */
  color?: string
  kind?: 'line' | 'area' | 'bar'
  dashed?: boolean
}

function seriesColor(s: SeriesDef, index: number) {
  return s.color ?? SERIES[(s.slot ?? index + 1) - 1] ?? SERIES[0]!
}

/* -------------------------------------------------------------------------- */
/* Trend — change over time                                                    */
/* -------------------------------------------------------------------------- */

export function TrendChart({
  data,
  xKey,
  series,
  format = 'money',
  stacked,
  showLegend = true,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: SeriesDef[]
  format?: keyof typeof FORMATTERS | Fmt
  stacked?: boolean
  showLegend?: boolean
}) {
  const fmt = resolveFormat(format)
  const hasArea = series.some((s) => s.kind === 'area')
  const hasLine = series.some((s) => s.kind !== 'area')
  // Areas and lines can only share a plot inside a ComposedChart; AreaChart
  // silently drops Line children, which is how a series goes missing.
  const Chart = hasArea && hasLine ? ComposedChart : hasArea ? AreaChart : LineChart

  return (
    <div className="flex h-full flex-col">
      {showLegend && series.length > 1 && (
        <div className="px-3 pb-2">
          <ChartLegend items={series.map((s, i) => ({ color: seriesColor(s, i), label: s.label }))} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(s, i)} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={seriesColor(s, i)} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>

            {/* Horizontal hairlines only — solid, one shade off the surface. */}
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} strokeWidth={1} />
            <XAxis dataKey={xKey} {...AXIS_PROPS} dy={6} minTickGap={12} />
            <YAxis {...AXIS_PROPS} width={54} tickFormatter={fmt} />

            <Tooltip
              cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={label as string}
                    rows={payload.map((p) => ({
                      color: p.color,
                      name: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey),
                      value: fmt(Number(p.value)),
                    }))}
                  />
                ) : null
              }
            />

            {series.map((s, i) =>
              hasArea && s.kind !== 'line' ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={seriesColor(s, i)}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                  stackId={stacked ? 'stack' : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_INK.surface }}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={seriesColor(s, i)}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? '5 4' : undefined}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_INK.surface }}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Vertical bars — magnitude across a small set of categories                   */
/* -------------------------------------------------------------------------- */

export function BarSeriesChart({
  data,
  xKey,
  series,
  format = 'money',
  stacked,
}: {
  data: Record<string, unknown>[]
  xKey: string
  series: SeriesDef[]
  format?: keyof typeof FORMATTERS | Fmt
  stacked?: boolean
}) {
  const fmt = resolveFormat(format)

  return (
    <div className="flex h-full flex-col">
      {series.length > 1 && (
        <div className="px-3 pb-2">
          <ChartLegend items={series.map((s, i) => ({ color: seriesColor(s, i), label: s.label }))} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barGap={2} barCategoryGap="26%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey={xKey} {...AXIS_PROPS} dy={6} minTickGap={8} />
            <YAxis {...AXIS_PROPS} width={54} tickFormatter={fmt} />
            <Tooltip
              cursor={{ fill: CHART_INK.grid, opacity: 0.6 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={label as string}
                    rows={payload.map((p) => ({
                      color: p.color,
                      name: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey),
                      value: fmt(Number(p.value)),
                    }))}
                  />
                ) : null
              }
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={seriesColor(s, i)}
                stackId={stacked ? 'stack' : undefined}
                radius={stacked && i < series.length - 1 ? 0 : [4, 4, 0, 0]}
                // A 2px surface-coloured stroke creates the gap between
                // stacked segments without drawing a border around marks.
                stroke={stacked ? CHART_INK.surface : undefined}
                strokeWidth={stacked ? 2 : 0}
                isAnimationActive={false}
                maxBarSize={44}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Ranked list — the honest alternative to a pie for comparing values          */
/* -------------------------------------------------------------------------- */

export function RankedBars({
  data,
  format = 'money',
  /** One colour for one series; a value-ramp on nominal categories is wrong. */
  slot = 1,
  max,
  emphasise,
  /**
   * Give each row its own categorical slot. Only for charts where the rows
   * ARE the series — a funnel, a set of pay components — never for a plain
   * ranking, where varying the hue implies a difference that is not there.
   */
  colorful,
  /** Append each row's share of the total to the value label. */
  showShare,
  /** Rank medals on the leading rows, so the eye lands on the top of the list. */
  rank,
}: {
  data: { name: string; value: number; meta?: string }[]
  format?: keyof typeof FORMATTERS | Fmt
  slot?: number
  max?: number
  /** Index of the row to highlight; every other row recedes. */
  emphasise?: number
  colorful?: boolean
  showShare?: boolean
  rank?: boolean
}) {
  const fmt = resolveFormat(format)
  const ceiling = max ?? Math.max(...data.map((d) => d.value), 1)
  const total = data.reduce((s, d) => s + d.value, 0)
  const base = SERIES[slot - 1] ?? SERIES[0]!

  return (
    <div className="h-full space-y-2.5 overflow-y-auto px-3 py-1">
      {data.map((row, i) => {
        const dim = emphasise != null && emphasise !== i
        const color = colorful ? SERIES[i % SERIES.length]! : base
        const share = total ? (row.value / total) * 100 : 0
        return (
          <div key={row.name} className="group">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-1.5">
                {rank && (
                  <span className="tabular w-4 shrink-0 text-[10px] font-semibold text-ink-3">{i + 1}</span>
                )}
                <span className="truncate text-[12px] text-ink-2" title={row.name}>
                  {row.name}
                </span>
              </span>
              {/* Direct label on every row — this is the relief for the
                  sub-3:1 contrast hues, and it removes the need to hover. */}
              <span className="shrink-0 text-[12px]">
                <span className="tabular font-medium text-ink">{fmt(row.value)}</span>
                {showShare && total > 0 && (
                  <span className="tabular ml-1.5 text-[11px] text-ink-3">{share.toFixed(1)}%</span>
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn('h-full rounded-full transition-[width] duration-500', dim && 'opacity-35')}
                style={{ width: `${(row.value / ceiling) * 100}%`, background: color }}
              />
            </div>
            {row.meta && <p className="mt-1 text-[11px] text-ink-3">{row.meta}</p>}
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Donut — part-to-whole at a glance only, max 6 segments                       */
/* -------------------------------------------------------------------------- */

export function DonutChart({
  data,
  format = 'money',
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number }[]
  format?: keyof typeof FORMATTERS | Fmt
  centerLabel?: string
  centerValue?: string
}) {
  const fmt = resolveFormat(format)
  // Past 6 slices the wedges blur together — fold the tail into "Other".
  const shown = data.slice(0, 5)
  const rest = data.slice(5)
  const segments = rest.length
    ? [...shown, { name: 'Other', value: rest.reduce((s, d) => s + d.value, 0) }]
    : shown
  const total = segments.reduce((s, d) => s + d.value, 0)

  return (
    // `items-center` would collapse the plot to auto height — the flex row
    // must stretch so the chart keeps the card's height.
    <div className="flex h-full flex-col gap-2 sm:flex-row sm:items-stretch">
      <div className="relative h-full min-h-[8rem] min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke={CHART_INK.surface}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {segments.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard
                    rows={[
                      {
                        color: payload[0]!.payload.fill,
                        name: payload[0]!.name as string,
                        value: `${fmt(Number(payload[0]!.value))} · ${((Number(payload[0]!.value) / total) * 100).toFixed(1)}%`,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Legend content={() => null} />
          </PieChart>
        </ResponsiveContainer>

        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[18px] leading-none font-semibold text-ink">{centerValue}</span>
            {centerLabel && <span className="mt-1 text-[11px] text-ink-3">{centerLabel}</span>}
          </div>
        )}
      </div>

      {/* Legend doubles as a value list, so nothing is colour-only. */}
      <ul className="shrink-0 space-y-1.5 overflow-y-auto px-3 sm:w-[46%] sm:self-center">
        {segments.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 text-[12px]">
            <span className="size-2 shrink-0 rounded-[3px]" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="flex-1 truncate text-ink-2">{s.name}</span>
            <span className="tabular font-medium text-ink">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sparkline — trend inside a stat tile                                        */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  data,
  dataKey,
  color = 'var(--color-brand-500)',
  height = 36,
}: {
  data: Record<string, unknown>[]
  dataKey: string
  color?: string
  height?: number
}) {
  const id = React.useId()
  return (
    <div style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#spark-${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
