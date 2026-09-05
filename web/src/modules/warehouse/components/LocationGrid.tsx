import * as React from 'react'
import { Eraser, MapPin, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { GRID_COLUMNS, GRID_ROWS } from '@/data/warehouse'
import { Button } from '@/components/ui/primitives'

/**
 * The storage location picker.
 *
 * A bin code typed into a text box is a code somebody has to remember. The rack
 * layout is a picture everyone in the building already has in their head, so
 * this shows the picture and asks them to point at it.
 *
 * Click a cell to place the shipment there. Click more cells when it is split
 * across several bays — which is the normal case for anything on more than one
 * pallet. Click a selected cell again to take it back off.
 */

export function LocationGrid({
  value,
  onChange,
  /** Cell → what is already there. Shown as occupied, still selectable. */
  occupied = {},
  disabled,
  compact,
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  occupied?: Record<string, string>
  disabled?: boolean
  /** Smaller cells, for side-by-side use inside a busy dialog. */
  compact?: boolean
  className?: string
}) {
  const selected = React.useMemo(() => new Set(value), [value])

  const toggle = (cell: string) => {
    if (disabled) return
    onChange(selected.has(cell) ? value.filter((c) => c !== cell) : [...value, cell])
  }

  const cellSize = compact ? 'size-7 text-[10px]' : 'size-9 text-[11px] sm:size-10 sm:text-xs'

  return (
    <div className={cn('grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]', className)}>
      {/* ------------------------------- Grid ------------------------------- */}
      <div className="overflow-x-auto">
        <div className="inline-block rounded-xl border border-line bg-surface-2 p-2.5">
          {/* Column letters, so a cell can be read out loud without counting. */}
          <div className="flex gap-1 pl-6">
            {GRID_COLUMNS.map((column) => (
              <span
                key={column}
                className={cn(
                  'text-center text-[10px] font-semibold text-ink-3',
                  compact ? 'w-7' : 'w-9 sm:w-10',
                )}
              >
                {column}
              </span>
            ))}
          </div>

          <div className="mt-1 space-y-1">
            {Array.from({ length: GRID_ROWS }, (_, r) => r + 1).map((row) => (
              <div key={row} className="flex items-center gap-1">
                <span className="w-5 text-right text-[10px] font-semibold text-ink-3">{row}</span>
                {GRID_COLUMNS.map((column) => {
                  const cell = `${column}${row}`
                  const isSelected = selected.has(cell)
                  const holder = occupied[cell]

                  return (
                    <button
                      key={cell}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(cell)}
                      aria-pressed={isSelected}
                      aria-label={
                        holder ? `${cell} — currently holding ${holder}` : `${cell} — empty`
                      }
                      title={holder ? `${cell} · ${holder}` : cell}
                      className={cn(
                        'flex shrink-0 items-center justify-center rounded-md border font-semibold transition-all',
                        cellSize,
                        disabled && 'cursor-not-allowed opacity-60',
                        isSelected
                          ? 'grad-brand scale-105 border-brand-600/40 text-white shadow-[0_1px_3px_rgb(225_29_52/0.4)]'
                          : holder
                            ? 'border-warning/40 bg-warning/15 text-[#8a5d00] hover:border-brand-400 dark:text-[#f0b640]'
                            : 'border-line-strong bg-surface text-ink-3 hover:border-brand-400 hover:text-ink',
                      )}
                    >
                      {cell}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------ Read-out ----------------------------- */}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
          Selected location{value.length === 1 ? '' : 's'}
        </p>

        {value.length === 0 ? (
          <p className="mt-1.5 text-[15px] font-semibold text-ink-3">None yet</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {value.map((cell) => (
              <span
                key={cell}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[12px] font-semibold text-brand-700 ring-1 ring-brand-200 ring-inset dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800"
              >
                <MapPin className="size-3" />
                {cell}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => toggle(cell)}
                    aria-label={`Remove ${cell}`}
                    className="text-brand-500 hover:text-brand-700"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <dl className="mt-4 space-y-1.5 text-[11px] text-ink-3">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded border border-line-strong bg-surface" />
            Empty bay
          </div>
          <div className="flex items-center gap-2">
            <span className="size-3 rounded border border-warning/40 bg-warning/25" />
            Already holding stock
          </div>
          <div className="flex items-center gap-2">
            <span className="grad-brand size-3 rounded" />
            Selected for this document
          </div>
        </dl>

        {!disabled && value.length > 0 && (
          <Button variant="ghost" size="xs" className="mt-3" onClick={() => onChange([])}>
            <Eraser className="size-3" />
            Clear selection
          </Button>
        )}
      </div>
    </div>
  )
}

/** Compact read-only rendering for tables and detail panels. */
export function LocationChips({ locations, className }: { locations: string[]; className?: string }) {
  if (!locations.length) return <span className="text-ink-3">—</span>
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {locations.map((cell) => (
        <span
          key={cell}
          className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-2"
        >
          {cell}
        </span>
      ))}
    </span>
  )
}
