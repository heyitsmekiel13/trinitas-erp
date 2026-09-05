import * as React from 'react'
import { AlertTriangle, Bookmark, CalendarClock, Check, ChevronDown, Loader2, Search, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { daysUntil, fmtDate, initials } from '@/lib/format'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay'
import { getDirectory, type DirectoryEntry, type Priority, type ProjectLabel } from '@/lib/workApi'

/**
 * The small pieces every Process & Performance screen shares.
 *
 * Kept together because a deadline chip that means one thing on the board and
 * another in the queue is exactly how a person stops trusting the colour — and
 * the colour is doing most of the work on these screens.
 */

/* -------------------------------------------------------------------------- */
/* Deadlines                                                                   */
/* -------------------------------------------------------------------------- */

export type DueTone = 'done' | 'overdue' | 'today' | 'soon' | 'later' | 'none'

/**
 * How a date should read, from the date alone.
 *
 * One function, so "soon" is the same three days everywhere. Trello and Asana
 * both colour a due date; neither tells you what the thresholds are, so nobody
 * can rely on them.
 */
export function dueTone(dueDate: string | null | undefined, isDone = false): DueTone {
  if (isDone) return 'done'
  if (!dueDate) return 'none'

  const days = daysUntil(dueDate)

  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 3) return 'soon'

  return 'later'
}

const DUE_STYLES: Record<DueTone, string> = {
  done: 'text-ink-3',
  overdue: 'text-critical',
  today: 'text-warning',
  soon: 'text-warning',
  later: 'text-ink-2',
  none: 'text-ink-3',
}

/** A due date that says how far away it is, because the date alone does not. */
export function DueChip({
  date,
  isDone,
  className,
  showIcon = true,
}: {
  date: string | null | undefined
  isDone?: boolean
  className?: string
  showIcon?: boolean
}) {
  const tone = dueTone(date, isDone)

  if (!date) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11px] text-ink-3', className)}>
        {showIcon && <CalendarClock className="size-3" />}
        No deadline
      </span>
    )
  }

  const days = daysUntil(date)
  const relative =
    isDone ? fmtDate(date)
      : days < 0 ? `${Math.abs(days)}d overdue`
        : days === 0 ? 'Due today'
          : days === 1 ? 'Due tomorrow'
            : days <= 14 ? `in ${days}d`
              : fmtDate(date)

  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', DUE_STYLES[tone], className)}>
      {showIcon && <CalendarClock className="size-3 shrink-0" />}
      {relative}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Priority                                                                    */
/* -------------------------------------------------------------------------- */

const PRIORITY_STYLE: Record<Priority, string> = {
  Low: 'bg-surface-3 text-ink-3',
  Normal: 'bg-surface-3 text-ink-2',
  High: 'bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-warning',
  Urgent: 'bg-[color-mix(in_srgb,var(--color-critical)_16%,transparent)] text-critical',
}

export const PRIORITIES: Priority[] = ['Low', 'Normal', 'High', 'Urgent']

export function PriorityChip({ value, className }: { value: Priority; className?: string }) {
  // Low and Normal deliberately recede. If every priority is coloured, the
  // urgent ones stop being findable — which is the state most ClickUp boards
  // end up in.
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        PRIORITY_STYLE[value],
        className,
      )}
    >
      {value}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

export function LabelChip({ label, onRemove }: { label: ProjectLabel; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        // A tint of the label's own colour rather than the colour itself:
        // full-strength chips at 10px are unreadable and the row becomes a
        // rainbow that carries no information.
        background: `color-mix(in srgb, ${label.colour} 16%, transparent)`,
        color: label.colour,
      }}
    >
      {label.name}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label.name}`} className="hover:opacity-70">
          <X className="size-2.5" />
        </button>
      )}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

let directoryCache: DirectoryEntry[] | null = null
let directoryPromise: Promise<DirectoryEntry[]> | null = null

/**
 * Everyone who can be given work, loaded once per session.
 *
 * Cached at module scope rather than per component: the picker appears in the
 * task panel, the filter bar, the mention menu and the project form, and four
 * copies of the same fetch on one screen is how a directory of forty people
 * becomes a loading spinner.
 */
export function useDirectory() {
  const [people, setPeople] = React.useState<DirectoryEntry[]>(directoryCache ?? [])

  React.useEffect(() => {
    if (directoryCache) return

    directoryPromise ??= getDirectory().then((rows) => {
      directoryCache = rows

      return rows
    })

    let alive = true
    void directoryPromise.then((rows) => alive && setPeople(rows)).catch(() => undefined)

    return () => {
      alive = false
    }
  }, [])

  return people
}

/** Small round initials, for a name with no photo. */
export function PersonBadge({
  name,
  size = 'sm',
  className,
}: {
  name: string | null | undefined
  size?: 'xs' | 'sm' | 'md'
  className?: string
}) {
  const sizes = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-[12px]' }

  if (!name) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-3',
          sizes[size],
          className,
        )}
        title="Nobody assigned"
      >
        ?
      </span>
    )
  }

  return (
    <span
      className={cn(
        'grad-brand inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-black/5',
        sizes[size],
        className,
      )}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

/**
 * Assignee picker over the HR directory.
 *
 * Searchable because forty names in a dropdown is already too many to scan,
 * and grouped by nothing on purpose — people look for a person, not for a
 * department, and the department is shown on the row so the ambiguous names
 * still resolve.
 */
export function PersonPicker({
  value,
  onChange,
  allowEmpty = true,
  placeholder = 'Unassigned',
  fallbackName,
  className,
}: {
  value: number | null
  onChange: (id: number | null) => void
  allowEmpty?: boolean
  placeholder?: string
  /**
   * Name to show when the selected id is not in the directory.
   *
   * The directory is the assignable workforce, which excludes system accounts
   * — so a project owned by the super administrator rendered as "Unassigned"
   * even though it had an owner. The value was still correct underneath, which
   * makes it the worst kind of display bug: nothing breaks, it just lies.
   */
  fallbackName?: string | null
  className?: string
}) {
  const people = useDirectory()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const known = people.find((p) => p.id === value)
  const selected = known ?? (value != null && fallbackName ? { id: value, name: fallbackName } : undefined)
  const matches = query
    ? people.filter((p) => `${p.name} ${p.department ?? ''} ${p.position ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : people

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink transition-colors hover:border-line-strong"
      >
        <PersonBadge name={selected?.name} size="xs" />
        <span className={cn('flex-1 truncate text-left', !selected && 'text-ink-3')}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {allowEmpty && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] text-ink-3 hover:bg-surface-2"
              >
                <PersonBadge name={null} size="xs" />
                {placeholder}
                {value === null && <Check className="ml-auto size-3.5" />}
              </button>
            )}

            {matches.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => {
                  onChange(person.id)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2"
              >
                <PersonBadge name={person.name} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{person.name}</span>
                  {person.department && (
                    <span className="block truncate text-[10px] text-ink-3">{person.department}</span>
                  )}
                </span>
                {value === person.id && <Check className="size-3.5 shrink-0 text-brand-500" />}
              </button>
            ))}

            {matches.length === 0 && (
              <p className="px-2.5 py-4 text-center text-[12px] text-ink-3">Nobody matches that.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Signals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The deadline-movement warning.
 *
 * Shown to everybody, including the assignee. The count is a fact and seeing
 * it is useful — what stays behind the office door is the conclusion drawn
 * from it.
 */
export function DeadlineMoves({ count }: { count: number }) {
  if (count < 1) return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-medium',
        count >= 3 ? 'text-critical' : 'text-warning',
      )}
      title={`The deadline on this task has moved ${count} time${count === 1 ? '' : 's'}`}
    >
      <AlertTriangle className="size-3" />
      {count}×
    </span>
  )
}

export function SectionHeading({
  title,
  hint,
  actions,
}: {
  title: string
  hint?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mt-6 mb-3 flex items-center gap-3 first:mt-0">
      <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">{title}</h2>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      <div className="h-px flex-1 bg-line" />
      {actions}
    </div>
  )
}

/** A count that reads as a heading — used above every bucket and column. */
export function CountBadge({ value, tone = 'neutral' }: { value: number; tone?: 'neutral' | 'warning' | 'critical' }) {
  return (
    <Badge tone={tone === 'neutral' ? 'neutral' : tone}>{value}</Badge>
  )
}

/** Empty state that fits inside a column rather than taking over the page. */
export function ColumnEmpty({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line py-6 text-center text-[11px] text-ink-3">
      {message}
    </div>
  )
}

export { Card }

/* -------------------------------------------------------------------------- */
/* Destructive actions                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The confirmation shown before anything is destroyed.
 *
 * One component for every delete in the module, because the thing that makes a
 * confirmation useful is saying what will be lost — and a dialog written fresh
 * at each call site ends up saying "Are you sure?" at half of them. `consequence`
 * is required for that reason: if the caller cannot describe what goes, the
 * caller does not yet know whether it should.
 */
export function ConfirmDelete({
  open,
  title,
  consequence,
  confirmLabel = 'Delete',
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  consequence: React.ReactNode
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  React.useEffect(() => {
    if (!open) return

    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-pop)]"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--color-critical)_14%,transparent)]">
            <Trash2 className="size-4 text-critical" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            <div className="mt-1 text-[13px] leading-relaxed text-ink-3">{consequence}</div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Saved filters                                                              */
/* -------------------------------------------------------------------------- */

type SavedFilterSet<T> = { name: string; filters: T }

/**
 * A filter combination, remembered per browser.
 *
 * `localStorage`, not a backend record — this is a per-device convenience
 * (the same pattern `TabbedArea` already uses for remembering a tab), not
 * something that needs to follow somebody to a different machine. Capped at
 * ten so it stays a shortlist, not a second inbox.
 */
export function useSavedFilters<T>(scope: string) {
  const storageKey = `trinitas.process.savedFilters.${scope}`

  const [saved, setSaved] = React.useState<SavedFilterSet<T>[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw ? (JSON.parse(raw) as SavedFilterSet<T>[]) : []
    } catch {
      return []
    }
  })

  const persist = (next: SavedFilterSet<T>[]) => {
    setSaved(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // A private window or a full quota just means it doesn't stick — not
      // worth surfacing as an error over a device-local convenience.
    }
  }

  const save = (name: string, filters: T) => {
    persist([...saved.filter((s) => s.name !== name), { name, filters }].slice(-10))
  }

  const remove = (name: string) => persist(saved.filter((s) => s.name !== name))

  return { saved, save, remove }
}

export function SavedFiltersMenu<T>({
  saved,
  onApply,
  onSave,
  onRemove,
}: {
  saved: SavedFilterSet<T>[]
  onApply: (filters: T) => void
  onSave: (name: string) => void
  onRemove: (name: string) => void
}) {
  return (
    <Menu
      trigger={({ toggle }) => (
        <Button variant="ghost" size="sm" onClick={toggle}>
          <Bookmark className="size-3.5" />
          Saved
        </Button>
      )}
    >
      {saved.length === 0 ? (
        <p className="px-2.5 py-4 text-center text-[12px] text-ink-3">No saved filters yet.</p>
      ) : (
        <>
          {saved.map((s) => (
            <div key={s.name} className="flex items-center">
              <MenuItem onClick={() => onApply(s.filters)}>{s.name}</MenuItem>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(s.name)
                }}
                aria-label={`Delete saved filter ${s.name}`}
                className="mr-1 shrink-0"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
          <MenuSeparator />
        </>
      )}
      <MenuItem
        onClick={() => {
          const name = window.prompt('Name this filter combination:')?.trim()
          if (name) onSave(name)
        }}
      >
        <Bookmark className="size-3.5" />
        Save current filter…
      </MenuItem>
    </Menu>
  )
}
