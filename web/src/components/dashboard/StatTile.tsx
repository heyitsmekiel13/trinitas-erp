import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, ProgressBar } from '@/components/ui/primitives'
import { Sparkline } from '@/components/charts'

/**
 * The KPI tile. When the story is one number, this is the chart — not a
 * one-bar bar chart and not an eight-hue donut.
 */
export function StatTile({
  label,
  value,
  /** Period-over-period change in percent. Direction is shown with an icon. */
  delta,
  deltaLabel = 'vs last month',
  /** Set when a fall is the good outcome (cost, downtime, overdue). */
  inverse,
  icon: Icon,
  hint,
  spark,
  progress,
  footer,
  className,
  onClick,
}: {
  label: string
  value: React.ReactNode
  delta?: number
  deltaLabel?: string
  inverse?: boolean
  icon?: LucideIcon
  hint?: string
  spark?: { data: Record<string, unknown>[]; dataKey: string; color?: string }
  progress?: { value: number; target?: string; tone?: 'brand' | 'good' | 'warning' | 'critical' }
  footer?: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  const isFlat = delta != null && Math.abs(delta) < 0.05
  const isGood = delta != null && (inverse ? delta < 0 : delta > 0)
  const DeltaIcon = isFlat ? Minus : delta != null && delta > 0 ? ArrowUpRight : ArrowDownRight

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] leading-tight font-medium tracking-wide text-ink-3 uppercase">{label}</p>
        {Icon && (
          <span className="grad-brand-soft flex size-7 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-3.5 text-brand-500" />
          </span>
        )}
      </div>

      {/* Proportional figures — tabular-nums makes large numbers look loose. */}
      <p className="mt-2.5 text-[26px] leading-none font-semibold tracking-tight text-ink">{value}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[12px] font-medium',
              isFlat ? 'text-ink-3' : isGood ? 'text-[var(--delta-up)]' : 'text-[var(--delta-down)]',
            )}
          >
            <DeltaIcon className="size-3.5" aria-hidden />
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {(delta != null || hint) && <span className="text-[11px] text-ink-3">{hint ?? deltaLabel}</span>}
      </div>

      {progress && (
        <div className="mt-3">
          <ProgressBar value={progress.value} tone={progress.tone ?? 'brand'} label={label} />
          {progress.target && (
            <p className="mt-1.5 flex items-center justify-between text-[11px] text-ink-3">
              <span>{progress.value.toFixed(0)}% of target</span>
              <span className="tabular">{progress.target}</span>
            </p>
          )}
        </div>
      )}

      {spark && (
        <div className="-mx-1 mt-3">
          <Sparkline {...spark} />
        </div>
      )}

      {footer && <div className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-3">{footer}</div>}
    </>
  )

  // The hint already renders as visible text, so no tooltip wrapper here —
  // wrapping would make the tile an inline element and break the grid.
  return (
    <Card
      className={cn(
        'flex h-full flex-col p-4 transition-shadow',
        onClick && 'cursor-pointer hover:shadow-[var(--shadow-pop)]',
        className,
      )}
      data-print="keep"
      onClick={onClick}
    >
      {body}
    </Card>
  )
}

/** Responsive KPI row. 2-up on phones, 4-up on desktop. */
export function StatGrid({
  columns = 4,
  className,
  children,
}: {
  columns?: 3 | 4 | 5
  className?: string
  children: React.ReactNode
}) {
  const cols = {
    3: 'grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-2 lg:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5',
  }
  return <div className={cn('grid gap-3', cols[columns], className)}>{children}</div>
}
