import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/cn'
import { moneyCompact, num, numCompact } from '@/lib/format'
import { AXIS_PROPS, CHART_INK, ChartLegend, LegendChip, SERIES, TooltipCard } from './ChartCard'

/**
 * Chart forms the base library did not have.
 *
 * The HR dashboard reached for `RankedBars` for nearly every breakdown on it,
 * because a ranked bar is the only shape the base library offered for a list
 * of named numbers. That made ten different questions look like one question
 * asked ten times — and, worse, it drew several of them wrong: a funnel
 * re-sorted by size is no longer a funnel, an age distribution re-sorted by
 * size no longer has a shape, and days-taken drawn without the entitlement it
 * came out of cannot be read at all.
 *
 * Each form here exists because some breakdown on that page needed it.
 */

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

/* -------------------------------------------------------------------------- */
/* Funnel — a sequence, where the drop between steps is the story              */
/* -------------------------------------------------------------------------- */

/**
 * Stages in pipeline order, each measured against the one that opened it.
 *
 * A ranked list sorts by size and so destroys the two things a funnel is for:
 * the order, and the fall between neighbours. Here the width is the share of
 * the first stage, and the gap between two bars carries the conversion that
 * got from one to the other.
 */
export function FunnelBars({
  data,
  format = 'number',
}: {
  data: { name: string; value: number }[]
  format?: keyof typeof FORMATTERS | Fmt
}) {
  const fmt = resolveFormat(format)
  const top = data[0]?.value ?? 0
  const ceiling = Math.max(top, 1)

  return (
    <div className="h-full overflow-y-auto px-3 py-1">
      {data.map((row, i) => {
        const prior = i > 0 ? data[i - 1]!.value : null
        const step = prior ? (row.value / prior) * 100 : null
        const overall = top ? (row.value / top) * 100 : 0
        return (
          <div key={row.name}>
            {step != null && (
              <div className="flex items-center gap-1.5 py-1 pl-3 text-[10px]">
                <span className="h-3 w-px bg-line-strong" />
                <span className={cn('tabular font-medium', step < 50 ? 'text-warning' : 'text-ink-3')}>
                  {step.toFixed(0)}% carried through
                </span>
              </div>
            )}
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] text-ink-2" title={row.name}>
                {row.name}
              </span>
              <span className="shrink-0 text-[12px]">
                <span className="tabular font-medium text-ink">{fmt(row.value)}</span>
                <span className="tabular ml-1.5 text-[11px] text-ink-3">{overall.toFixed(0)}%</span>
              </span>
            </div>
            {/* Centred bar, so the taper reads as a funnel and not a ranking. */}
            <div className="flex h-6 w-full items-center justify-center rounded-md bg-surface-3">
              <div
                className="h-full rounded-md transition-[width] duration-500"
                style={{
                  width: `${Math.max((row.value / ceiling) * 100, row.value > 0 ? 4 : 0)}%`,
                  background: SERIES[i % SERIES.length],
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Waterfall — how a total is built up and taken apart                         */
/* -------------------------------------------------------------------------- */

export type WaterfallStep = {
  name: string
  value: number
  /** `total` sits on the axis; `add` and `subtract` float from the running sum. */
  kind: 'total' | 'add' | 'subtract'
}

/**
 * Gross to net, with every deduction floating between them.
 *
 * Six side-by-side bars can carry the same six numbers, but they cannot show
 * that four of them come out of the first and leave the last. The floating
 * bars do — the reader watches the money fall.
 */
export function WaterfallChart({
  data,
  format = 'money',
}: {
  data: WaterfallStep[]
  format?: keyof typeof FORMATTERS | Fmt
}) {
  const fmt = resolveFormat(format)

  let running = 0
  const rows = data.map((step) => {
    let base: number
    if (step.kind === 'total') {
      base = 0
      running = step.value
    } else if (step.kind === 'add') {
      base = running
      running += step.value
    } else {
      running -= step.value
      base = running
    }
    return { ...step, base, bar: step.value }
  })

  const color = (kind: WaterfallStep['kind']) =>
    kind === 'total' ? SERIES[0]! : kind === 'add' ? SERIES[2]! : SERIES[1]!

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2">
        <ChartLegend
          items={[
            { color: SERIES[0]!, label: 'Total' },
            { color: SERIES[1]!, label: 'Taken out' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
            <XAxis dataKey="name" {...AXIS_PROPS} dy={6} interval={0} tick={{ ...AXIS_PROPS.tick, fontSize: 10 }} />
            <YAxis {...AXIS_PROPS} width={54} tickFormatter={fmt} />
            <Tooltip
              cursor={{ fill: CHART_INK.grid, opacity: 0.6 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const row = payload[0]!.payload as (typeof rows)[number]
                return (
                  <TooltipCard
                    label={label as string}
                    rows={[
                      {
                        color: color(row.kind),
                        name: row.kind === 'subtract' ? 'Deducted' : 'Amount',
                        value: `${row.kind === 'subtract' ? '−' : ''}${fmt(row.value)}`,
                      },
                    ]}
                  />
                )
              }}
            />
            {/* The invisible plinth that lifts each floating bar to its level. */}
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} maxBarSize={56} />
            <Bar dataKey="bar" stackId="w" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
              {rows.map((r, i) => (
                <Cell key={i} fill={color(r.kind)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Gauge — one rate, against the 100% it is a share of                         */
/* -------------------------------------------------------------------------- */

/**
 * A percentage against its ceiling.
 *
 * "82%" as text says how far along; the arc says how much is left, which is
 * the half of the question a rate is usually being asked.
 */
export function GaugeArc({
  value,
  label,
  caption,
  tone,
  bands,
}: {
  /** 0-100. Null renders the empty state rather than a zero arc. */
  value: number | null
  label?: string
  caption?: string
  tone?: 'brand' | 'good' | 'warning' | 'critical'
  /** Thresholds that pick the tone: below `warn` is amber, below `bad` is red. */
  bands?: { warn: number; bad: number }
}) {
  if (value == null) {
    return <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded yet.</p>
  }

  const clamped = Math.max(0, Math.min(100, value))
  const auto: NonNullable<typeof tone> = bands
    ? clamped < bands.bad
      ? 'critical'
      : clamped < bands.warn
        ? 'warning'
        : 'good'
    : 'brand'
  const fill = {
    brand: 'var(--color-brand-500)',
    good: 'var(--color-good)',
    warning: 'var(--color-warning)',
    critical: 'var(--color-critical)',
  }[tone ?? auto]

  return (
    <div className="relative h-full min-h-[8rem] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ name: label ?? 'value', value: clamped }]}
          innerRadius="68%"
          outerRadius="98%"
          startAngle={220}
          endAngle={-40}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: 'var(--surface-3)' }}
            dataKey="value"
            cornerRadius={8}
            fill={fill}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6">
        <span className="tabular text-[30px] leading-none font-semibold text-ink">{clamped.toFixed(0)}%</span>
        {label && <span className="mt-1.5 text-[11px] font-medium text-ink-2">{label}</span>}
        {caption && <span className="mt-0.5 text-center text-[11px] text-ink-3">{caption}</span>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bullet — consumed against allowed                                           */
/* -------------------------------------------------------------------------- */

/**
 * Usage against entitlement, one row per category.
 *
 * A ranked bar can draw only one number, so "9 days taken" had to be read
 * against a credit figure printed beside it in words. Here the entitlement is
 * the track and the usage is the fill, so over- and under-use are visible
 * without arithmetic.
 */
export function BulletBars({
  data,
  format = 'number',
  usedLabel = 'Used',
  capacityLabel = 'Entitlement',
}: {
  data: { name: string; used: number; capacity: number; meta?: string }[]
  format?: keyof typeof FORMATTERS | Fmt
  usedLabel?: string
  capacityLabel?: string
}) {
  const fmt = resolveFormat(format)
  const ceiling = Math.max(...data.map((d) => Math.max(d.capacity, d.used)), 1)

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-2">
        <ChartLegend
          items={[
            { color: SERIES[0]!, label: usedLabel },
            { color: 'var(--surface-3)', label: capacityLabel },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-1">
        {data.map((row) => {
          const pct = row.capacity ? (row.used / row.capacity) * 100 : 0
          const over = row.used > row.capacity
          return (
            <div key={row.name}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-[12px] text-ink-2" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 text-[12px]">
                  <span className="tabular font-medium text-ink">{fmt(row.used)}</span>
                  <span className="tabular text-[11px] text-ink-3"> / {fmt(row.capacity)}</span>
                </span>
              </div>
              {/* The track is the entitlement drawn to scale, so two rows with
                  different credits stay comparable side by side. */}
              <div className="relative h-3 w-full rounded-full bg-surface-2">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-surface-3"
                  style={{ width: `${(row.capacity / ceiling) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                  style={{
                    width: `${(Math.min(row.used, ceiling) / ceiling) * 100}%`,
                    background: over ? 'var(--color-critical)' : SERIES[0],
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                {row.meta ?? `${pct.toFixed(0)}% taken`}
                {over && <span className="ml-1 font-medium text-critical">over entitlement</span>}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Treemap — composition where the size of the tail is itself the point        */
/* -------------------------------------------------------------------------- */

type TreemapNodeProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  /** 0 is the root rectangle covering the whole plot; the leaves are at 1. */
  depth?: number
  index?: number
  name?: string
  value?: number
  fmt?: Fmt
  total?: number
}

function TreemapNode({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  depth = 1,
  index = 0,
  name,
  value = 0,
  fmt,
  total = 0,
}: TreemapNodeProps) {
  // Recharts hands the root through the same renderer as the leaves. Drawn,
  // it is a full-bleed rectangle labelled with the total — a tenth tile that
  // is not a department, painted over the nine that are.
  if (depth === 0) return null

  const fill = SERIES[index % SERIES.length]!
  const share = total ? (value / total) * 100 : 0
  // Below roughly 56x34 a label is unreadable rather than merely tight.
  const roomy = width > 56 && height > 34

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke={CHART_INK.surface} strokeWidth={2} rx={4} />
      {roomy && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={11} fontWeight={600}>
            {String(name ?? '').slice(0, Math.max(2, Math.floor(width / 7)))}
          </text>
          <text x={x + 8} y={y + 33} fill="#fff" fontSize={10} opacity={0.85}>
            {`${fmt ? fmt(value) : value} · ${share.toFixed(0)}%`}
          </text>
        </>
      )}
    </g>
  )
}

/**
 * Parts of a whole, sized by value.
 *
 * Where a donut caps out at six wedges before they blur, a treemap stays
 * legible at fifteen — so a department list nobody wants truncated can be
 * shown entire, with the long tail visibly a tail.
 */
export function CompositionTreemap({
  data,
  format = 'number',
}: {
  data: { name: string; value: number }[]
  format?: keyof typeof FORMATTERS | Fmt
}) {
  const fmt = resolveFormat(format)
  const rows = data.filter((d) => d.value > 0)
  const total = rows.reduce((s, d) => s + d.value, 0)

  if (rows.length === 0) {
    return <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded yet.</p>
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={rows}
        dataKey="value"
        nameKey="name"
        isAnimationActive={false}
        content={<TreemapNode fmt={fmt} total={total} />}
      >
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipCard
                rows={[
                  {
                    color: SERIES[(Number(payload[0]!.payload.index) || 0) % SERIES.length],
                    name: String(payload[0]!.payload.name),
                    value: `${fmt(Number(payload[0]!.payload.value))} · ${(
                      (Number(payload[0]!.payload.value) / total) *
                      100
                    ).toFixed(1)}%`,
                  },
                ]}
              />
            ) : null
          }
        />
      </Treemap>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------------------- */
/* Histogram — an ordered distribution, drawn in its own order                 */
/* -------------------------------------------------------------------------- */

/**
 * Bands with a natural sequence — tenure, age, salary — drawn as columns in
 * that sequence.
 *
 * Sorting these by size, as a ranked list does, hides the shape: whether the
 * workforce is young, whether pay clusters at the floor. The shape is the
 * finding.
 */
export function Histogram({
  data,
  format = 'number',
  slot = 1,
  emphasisePeak = true,
}: {
  data: { name: string; value: number }[]
  format?: keyof typeof FORMATTERS | Fmt
  slot?: number
  emphasisePeak?: boolean
}) {
  const fmt = resolveFormat(format)
  const peak = Math.max(...data.map((d) => d.value), 0)
  const color = SERIES[slot - 1] ?? SERIES[0]!

  if (!data.some((d) => d.value > 0)) {
    return <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded yet.</p>
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 4 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke={CHART_INK.grid} />
        <XAxis dataKey="name" {...AXIS_PROPS} dy={6} interval={0} tick={{ ...AXIS_PROPS.tick, fontSize: 10 }} />
        <YAxis {...AXIS_PROPS} width={44} tickFormatter={fmt} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: CHART_INK.grid, opacity: 0.6 }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipCard
                label={label as string}
                rows={[{ color, name: 'People', value: fmt(Number(payload[0]!.value)) }]}
              />
            ) : null
          }
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={64}>
          {data.map((d, i) => (
            // The modal band carries full weight and the rest recede, so the
            // centre of the distribution is findable at a glance.
            <Cell key={i} fill={color} fillOpacity={emphasisePeak && d.value < peak ? 0.55 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/* -------------------------------------------------------------------------- */
/* Share bar — one row, the whole split                                        */
/* -------------------------------------------------------------------------- */

/** A single 100% bar. For a two- or three-way split that needs no axis. */
export function ShareBar({
  data,
  format = 'number',
  className,
}: {
  data: { name: string; value: number }[]
  format?: keyof typeof FORMATTERS | Fmt
  className?: string
}) {
  const fmt = resolveFormat(format)
  const rows = data.filter((d) => d.value > 0)
  const total = rows.reduce((s, d) => s + d.value, 0)
  if (!total) return null

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
        {rows.map((r, i) => (
          <div
            key={r.name}
            style={{ width: `${(r.value / total) * 100}%`, background: SERIES[i % SERIES.length] }}
            title={`${r.name}: ${fmt(r.value)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {rows.map((r, i) => (
          <LegendChip
            key={r.name}
            color={SERIES[i % SERIES.length]!}
            label={r.name}
            value={`${fmt(r.value)} · ${((r.value / total) * 100).toFixed(0)}%`}
          />
        ))}
      </div>
    </div>
  )
}
