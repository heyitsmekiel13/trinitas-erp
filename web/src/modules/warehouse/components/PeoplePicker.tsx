import * as React from 'react'
import { Check, Search, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { dataset } from '@/data/dataset'
import { useResource } from '@/lib/api'
import { Avatar, Badge, Input } from '@/components/ui/primitives'

/**
 * Who was standing there when the goods were checked.
 *
 * Two ways in, because two situations exist. The usual one is the same handful
 * of people every shift — those are one tap on a card. The other is somebody
 * from another department who happened to be on the dock, and for that there is
 * a search across everyone.
 *
 * It matters because a check with nobody's name on it is an opinion. A check
 * with three names on it is something a supplier will accept.
 */

export type Person = { name: string; position: string; department: string }

/** The shape `sales/drivers` returns — the operational staff list. */
type StaffRow = { fullName?: string; name?: string; position?: string | null; site?: string | null }

/**
 * Warehouse crew first — they are who signs for goods nine times out of ten.
 *
 * Reads the live staff list when there is one, so the names on a receipt are
 * people who actually work here. A witness list of invented names would make
 * the audit trail worse than leaving it blank.
 */
export function useWarehousePeople(): { crew: Person[]; everyone: Person[] } {
  const { data: staff = [] } = useResource<StaffRow[]>('sales/drivers', () =>
    dataset()
      .employees.filter((e) => e.status !== 'Resigned')
      .map((e) => ({ fullName: e.name, position: e.position, site: e.department })),
  )

  return React.useMemo(() => {
    const people: Person[] = staff
      .map((row) => ({
        name: row.fullName ?? row.name ?? '',
        position: row.position ?? '',
        department: row.site ?? '',
      }))
      .filter((p) => p.name)

    // Prefer anyone whose role or site reads as warehouse work; if nothing
    // matches — a small company where everyone does everything — show the first
    // few rather than an empty row of cards.
    const warehouse = people.filter((p) =>
      /warehouse|picker|packer|forklift|inventory|logistic|driver|technician|operation/i.test(
        `${p.position} ${p.department}`,
      ),
    )

    return { crew: (warehouse.length ? warehouse : people).slice(0, 8), everyone: people }
  }, [staff])
}

export function PeoplePicker({
  value,
  onChange,
  label = 'Employees present for the check',
  hint = 'Tap the crew on shift, or search for anyone else who was on the dock.',
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  label?: string
  hint?: string
  className?: string
}) {
  const { crew, everyone } = useWarehousePeople()
  const [query, setQuery] = React.useState('')
  const selected = React.useMemo(() => new Set(value), [value])

  const toggle = (name: string) =>
    onChange(selected.has(name) ? value.filter((n) => n !== name) : [...value, name])

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return everyone
      .filter((p) => p.name.toLowerCase().includes(q) || p.position.toLowerCase().includes(q))
      .slice(0, 6)
  }, [everyone, query])

  // Anyone already chosen who is not on the quick-pick row still needs a card.
  const extras = value.filter((name) => !crew.some((p) => p.name === name))

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <UserPlus className="size-3.5 text-ink-3" />
          {label}
        </p>
        <Badge tone={value.length ? 'good' : 'warning'}>
          {value.length ? `${value.length} recorded` : 'nobody recorded yet'}
        </Badge>
      </div>

      <p className="mb-2.5 text-[11px] text-ink-3">{hint}</p>

      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {crew.map((person) => {
          const on = selected.has(person.name)
          return (
            <button
              key={person.name}
              type="button"
              onClick={() => toggle(person.name)}
              aria-pressed={on}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-all',
                on
                  ? 'border-brand-500 bg-brand-50 shadow-sm dark:bg-brand-950'
                  : 'border-line bg-surface hover:border-brand-300 hover:bg-surface-2',
              )}
            >
              <Avatar name={person.name} size="sm" className={cn(!on && 'opacity-60 grayscale')} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
                <span className="block truncate text-[11px] text-ink-3">{person.position}</span>
              </span>
              {on && <Check className="size-4 shrink-0 text-brand-500" />}
            </button>
          )
        })}

        {extras.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className="flex items-center gap-2.5 rounded-xl border border-brand-500 bg-brand-50 px-2.5 py-2 text-left dark:bg-brand-950"
          >
            <Avatar name={name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
              <span className="block truncate text-[11px] text-ink-3">Added by search</span>
            </span>
            <X className="size-4 shrink-0 text-ink-3" />
          </button>
        ))}
      </div>

      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search anyone else — name or role…"
          className="h-9 pl-8 text-[13px]"
        />

        {matches.length > 0 && (
          <div className="animate-in absolute z-30 mt-1 w-full rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {matches.map((person) => (
              <button
                key={person.name}
                type="button"
                onClick={() => {
                  toggle(person.name)
                  setQuery('')
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3"
              >
                <Avatar name={person.name} size="xs" />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                <span className="shrink-0 text-[11px] text-ink-3">{person.position}</span>
                {selected.has(person.name) && <Check className="size-3.5 shrink-0 text-good" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
