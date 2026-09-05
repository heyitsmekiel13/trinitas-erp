import * as React from 'react'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import type { LucideIcon } from 'lucide-react'

/**
 * The compact table dashboards put inside a card.
 *
 * Three of these were hand-rolled on the HR dashboard, each with its own
 * markup for the same header, the same row rule and the same em-dash for a
 * missing value — and each drifting slightly from the others. This is that
 * table, once, with the two things the copies could not be bothered to do:
 * an identity cell that shows who the row is about, and a deadline cell that
 * shows how close the deadline is rather than only what date it falls on.
 */

export type MiniColumn<T> = {
  key: string
  label: string
  align?: 'left' | 'right'
  /** Column width, e.g. `w-24`. Omit to let the content decide. */
  width?: string
  render: (row: T) => React.ReactNode
}

export function MiniTable<T>({
  columns,
  rows,
  rowKey,
  empty = 'Nothing to show.',
  emptyIcon,
  maxHeight = 320,
}: {
  columns: MiniColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => React.Key
  empty?: string
  emptyIcon?: LucideIcon
  maxHeight?: number
}) {
  if (rows.length === 0) {
    return emptyIcon ? (
      <EmptyState icon={emptyIcon} title={empty} />
    ) : (
      <p className="py-8 text-center text-[12px] text-ink-3">{empty}</p>
    )
  }

  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.width,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-2 align-middle text-[12px] text-ink-2',
                    c.align === 'right' ? 'tabular text-right' : 'text-left',
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Name over a quieter second line — the usual first column of a people table. */
export function PersonCell({ name, sub }: { name: string | null | undefined; sub?: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar name={name} size="xs" />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-medium text-ink">{name ?? '—'}</p>
        {sub && <p className="truncate text-[10px] text-ink-3">{sub}</p>}
      </div>
    </div>
  )
}

/**
 * A date, with the distance to it.
 *
 * A deadline column of bare dates makes the reader do the subtraction before
 * they can tell which row is urgent — and they have to do it once per row.
 * The countdown does it for them, and the colour sorts the list by pressure
 * without re-sorting it.
 */
export function DueCell({ date, days }: { date: string; days: number | null }) {
  const tone =
    days == null
      ? 'text-ink-3'
      : days < 0
        ? 'text-critical'
        : days <= 30
          ? 'text-warning'
          : 'text-ink-2'
  const suffix =
    days == null ? null : days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`

  return (
    <div className="leading-tight">
      <p className={cn('text-[12px] font-medium', tone)}>{date}</p>
      {suffix && <p className={cn('text-[10px]', tone)}>{suffix}</p>}
    </div>
  )
}
