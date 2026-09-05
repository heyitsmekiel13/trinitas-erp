import * as React from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, CardHeader, Segmented } from '@/components/ui/primitives'

/**
 * Categorical series slots, in fixed order.
 *
 * The ORDER is the colourblind-safety mechanism — it was validated with the
 * palette validator (worst adjacent CVD ΔE 9.1 light / 8.4 dark). Assign slot
 * 1, 2, 3… in order and never cycle past 8; fold the tail into "Other".
 * Values resolve from CSS variables, so light/dark swap without JS.
 */
export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const

export const CHART_INK = {
  grid: 'var(--grid)',
  axis: 'var(--line-strong)',
  label: 'var(--ink-3)',
  surface: 'var(--surface)',
}

/** Shared axis styling — recessive by design, never competing with the marks. */
export const AXIS_PROPS = {
  stroke: CHART_INK.axis,
  tick: { fill: CHART_INK.label, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const

export type TableColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: (value: unknown, row: Record<string, unknown>) => React.ReactNode
}

/**
 * The wrapper every chart lives in.
 *
 * It guarantees the accessibility contract: a table view exists for every
 * chart, so no value is reachable by colour alone.
 */
export function ChartCard({
  title,
  subtitle,
  action,
  footer,
  table,
  height = 280,
  className,
  children,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  /** The WCAG-clean equivalent of the chart. Omit only for bare stat tiles. */
  table?: { columns: TableColumn[]; rows: Record<string, unknown>[] }
  height?: number
  className?: string
  children: React.ReactNode
}) {
  const [view, setView] = React.useState<'chart' | 'table'>('chart')

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)} data-print="keep">
      <CardHeader
        title={title}
        subtitle={subtitle}
        action={
          <>
            {action}
            {table && (
              <div data-print="hide">
                <Segmented
                  size="sm"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'chart', label: <BarChart3 className="size-3.5" /> },
                    { value: 'table', label: <Table2 className="size-3.5" /> },
                  ]}
                />
              </div>
            )}
          </>
        }
      />

      {view === 'chart' ? (
        // Height includes the axis band so labels are never clipped into a
        // nested scrollbar.
        <div className="px-2 pb-3" style={{ height }}>
          {children}
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto px-1 pb-3">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line">
                {table!.columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      'px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase',
                      c.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table!.rows.map((row, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  {table!.columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn('px-3 py-2 text-ink-2', c.align === 'right' ? 'num text-right' : 'text-left')}
                    >
                      {c.format ? c.format(row[c.key], row) : String(row[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {footer && <div className="mt-auto border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:px-5">{footer}</div>}
    </Card>
  )
}

/** Legend chip — identity is never carried by colour alone. */
export function LegendChip({ color, label, value }: { color: string; label: string; value?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
      <span className="size-2 shrink-0 rounded-[3px]" style={{ background: color }} />
      {label}
      {value != null && <span className="tabular text-ink-3">{value}</span>}
    </span>
  )
}

export function ChartLegend({ items }: { items: { color: string; label: string; value?: React.ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <LegendChip key={i.label} {...i} />
      ))}
    </div>
  )
}

/** Recharts tooltip body, themed to the app surface. */
export function TooltipCard({
  label,
  rows,
}: {
  label?: React.ReactNode
  rows: { color?: string; name: React.ReactNode; value: React.ReactNode }[]
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-[var(--shadow-pop)]">
      {label != null && <p className="mb-1.5 text-[11px] font-semibold text-ink">{label}</p>}
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 text-[11px]">
            {r.color && <span className="size-2 shrink-0 rounded-[3px]" style={{ background: r.color }} />}
            <span className="flex-1 text-ink-3">{r.name}</span>
            <span className="tabular font-medium text-ink">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
