import type { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/cn'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { Badge, ProgressBar, StatusBadge, type Tone } from '@/components/ui/primitives'

/**
 * Column builders.
 *
 * Every module page composes its table from these, which is why a date looks
 * the same in Payroll as it does in Purchase Orders.
 */

type Key<T> = Extract<keyof T, string>

/** Statuses that close a document, so its dates stop being actionable. */
const TERMINAL_STATUSES = new Set([
  'completed',
  'delivered',
  'closed',
  'cancelled',
  'paid',
  'posted',
  'received',
  'rejected',
  'resolved',
  'won',
  'lost',
  'hired',
  'released',
  'filed',
  'converted',
  'awarded',
  'dispatched',
  'retired',
  'fully depreciated',
  'disposed',
])

/**
 * Binds every builder to one row type so a module writes `c.money('amount', …)`
 * instead of `moneyCol<SalesOrder>('amount', …)` on each line — and so the
 * compiler catches a typo'd field name.
 */
export function cols<T extends object>() {
  return {
    text: (key: Key<T>, header: string, opts?: Parameters<typeof text<T>>[2]) => text<T>(key, header, opts),
    primary: (key: Key<T>, header: string, sub?: (row: T) => string) => primary<T>(key, header, sub),
    money: (key: Key<T>, header: string, opts?: Parameters<typeof moneyCol<T>>[2]) => moneyCol<T>(key, header, opts),
    number: (key: Key<T>, header: string, opts?: Parameters<typeof numberCol<T>>[2]) => numberCol<T>(key, header, opts),
    percent: (key: Key<T>, header: string, opts?: Parameters<typeof percentCol<T>>[2]) => percentCol<T>(key, header, opts),
    date: (key: Key<T>, header: string, opts?: Parameters<typeof dateCol<T>>[2]) => dateCol<T>(key, header, opts),
    status: (key?: Key<T>, header?: string) => statusCol<T>(key, header),
    tag: (key: Key<T>, header: string, tone?: Tone, secondary?: boolean) => tagCol<T>(key, header, tone, secondary),
    level: (key: Key<T>, header: string, map: Record<string, Tone>) => levelCol<T>(key, header, map),
    bool: (key: Key<T>, header: string, opts?: Parameters<typeof boolCol<T>>[2]) => boolCol<T>(key, header, opts),
    progress: (key: Key<T>, header: string, opts?: Parameters<typeof progressCol<T>>[2]) => progressCol<T>(key, header, opts),
  }
}

export function text<T>(key: Key<T>, header: string, opts?: { secondary?: boolean; width?: string; mono?: boolean }): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { secondary: opts?.secondary, width: opts?.width },
    cell: ({ getValue }) => (
      <span className={cn('block whitespace-normal break-words', opts?.mono && 'font-mono text-[12px]')}>
        {String(getValue() ?? '—')}
      </span>
    ),
  }
}

/**
 * The document number / name column — carries the row's identity.
 *
 * Sub-labels are usually built by interpolating two fields ("C-1005 · Davao").
 * When one of them is empty the template would render "C-1005 · null", so the
 * parts are cleaned here rather than in every caller.
 */
export function primary<T>(key: Key<T>, header: string, sub?: (row: T) => string): ColumnDef<T, any> {
  const cleanSub = (row: T) => {
    const raw = sub?.(row)
    if (!raw) return ''
    return raw
      .split('·')
      .map((part) => part.trim())
      .filter((part) => part !== '' && part !== 'null' && part !== 'undefined')
      .join(' · ')
  }

  return {
    id: key,
    accessorKey: key,
    header,
    meta: { width: '15rem' },
    cell: ({ getValue, row }) => {
      const subtitle = sub ? cleanSub(row.original) : ''
      return (
        <div className="min-w-0">
          <span className="block whitespace-normal break-words text-ink">{String(getValue() ?? '—')}</span>
          {subtitle && (
            <span className="block whitespace-normal break-words text-[11px] font-normal text-ink-3">{subtitle}</span>
          )}
        </div>
      )
    },
  }
}

export function moneyCol<T>(key: Key<T>, header: string, opts?: { compact?: boolean; secondary?: boolean; bold?: boolean }): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: {
      numeric: true,
      secondary: opts?.secondary,
      exportValue: (row) => Number((row as Record<string, unknown>)[key] ?? 0),
    },
    cell: ({ getValue }) => {
      const value = Number(getValue() ?? 0)
      return (
        <span className={cn(opts?.bold && 'font-medium text-ink', value < 0 && 'text-critical')}>
          {opts?.compact ? moneyCompact(value) : money(value)}
        </span>
      )
    },
  }
}

export function numberCol<T>(key: Key<T>, header: string, opts?: { decimals?: number; secondary?: boolean; suffix?: string }): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { numeric: true, secondary: opts?.secondary },
    cell: ({ getValue }) => {
      const raw = getValue()
      // Null is "not measured", not zero. Coercing it would make a supplier
      // with no history look identical to one scoring nothing.
      if (raw == null || raw === '') return <span className="text-ink-3">—</span>

      return `${num(Number(raw), opts?.decimals ?? 0)}${opts?.suffix ?? ''}`
    },
  }
}

/**
 * Percentage with a threshold colour. `good` is the direction that reads well:
 * 'high' means bigger is better (on-time rate), 'low' means smaller is better
 * (variance, downtime).
 */
export function percentCol<T>(
  key: Key<T>,
  header: string,
  opts?: { warnBelow?: number; warnAbove?: number; secondary?: boolean },
): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { numeric: true, secondary: opts?.secondary },
    cell: ({ getValue }) => {
      const raw = getValue()
      if (raw == null || raw === '') return <span className="text-ink-3">—</span>

      const value = Number(raw)
      const bad =
        (opts?.warnBelow != null && value < opts.warnBelow) || (opts?.warnAbove != null && value > opts.warnAbove)
      return <span className={cn(bad && 'font-medium text-critical')}>{percent(value)}</span>
    },
  }
}

export function dateCol<T>(key: Key<T>, header: string, opts?: { secondary?: boolean; overdueWhenPast?: boolean }): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: {
      secondary: opts?.secondary,
      width: '8.5rem',
      exportValue: (row) => {
        const value = (row as Record<string, unknown>)[key]
        return value ? fmtDate(value as string) : ''
      },
    },
    cell: ({ getValue, row }) => {
      const raw = getValue() as string | null
      if (!raw) return <span className="text-ink-3">—</span>
      // A past due-date only matters while the document is still open — a
      // delivered order is not "overdue" just because its date has passed.
      const status = String((row.original as Record<string, unknown>).status ?? '').toLowerCase()
      const open = !TERMINAL_STATUSES.has(status)
      const past = opts?.overdueWhenPast && open && new Date(raw) < new Date()
      return <span className={cn('whitespace-nowrap', past && 'font-medium text-critical')}>{fmtDate(raw)}</span>
    },
  }
}

export function statusCol<T>(key: Key<T> = 'status' as Key<T>, header = 'Status'): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { width: '10rem' },
    cell: ({ getValue }) => <StatusBadge status={String(getValue() ?? '—')} />,
  }
}

/** A categorical label that is not a document status (channel, category, tier). */
export function tagCol<T>(key: Key<T>, header: string, tone: Tone = 'neutral', secondary = false): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { secondary },
    cell: ({ getValue }) => <Badge tone={tone}>{String(getValue() ?? '—')}</Badge>,
  }
}

/** Severity / priority — maps its own vocabulary onto the status tones. */
export function levelCol<T>(key: Key<T>, header: string, map: Record<string, Tone>): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { width: '8rem' },
    cell: ({ getValue }) => {
      const value = String(getValue() ?? '—')
      return (
        <Badge tone={map[value] ?? 'neutral'} dot>
          {value}
        </Badge>
      )
    },
  }
}

/**
 * A yes/no flag.
 *
 * A raw `true` in a table cell is developer output, not information — this
 * gives the flag words a reader recognises, and lets the page choose whether
 * "yes" is good news (proof of delivery received) or merely a fact.
 */
export function boolCol<T>(
  key: Key<T>,
  header: string,
  opts?: { yes?: string; no?: string; tone?: Tone; falseTone?: Tone },
): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { width: '7rem' },
    cell: ({ getValue }) => {
      const value = getValue()
      if (value == null) return <span className="text-ink-3">—</span>

      const on = Boolean(value)
      return (
        <Badge tone={on ? (opts?.tone ?? 'good') : (opts?.falseTone ?? 'neutral')} dot>
          {on ? (opts?.yes ?? 'Yes') : (opts?.no ?? 'No')}
        </Badge>
      )
    },
  }
}

export function progressCol<T>(
  key: Key<T>,
  header: string,
  opts?: { tone?: (value: number) => 'brand' | 'good' | 'warning' | 'critical' },
): ColumnDef<T, any> {
  return {
    id: key,
    accessorKey: key,
    header,
    meta: { width: '9rem' },
    cell: ({ getValue }) => {
      const value = Number(getValue() ?? 0)
      return (
        <div className="flex items-center gap-2">
          <ProgressBar value={value} tone={opts?.tone?.(value) ?? 'brand'} className="w-16" />
          <span className="tabular w-9 shrink-0 text-right text-[12px] text-ink-3">{value.toFixed(0)}%</span>
        </div>
      )
    },
  }
}
