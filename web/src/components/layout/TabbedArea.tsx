import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Several menu items that were describing one job, as one destination.
 *
 * Timekeeping, discipline and training each had their records split across
 * separate pages that read the same tables — the daily log and the DTR are the
 * same punches, the watchlist is a scoreboard over the same cases, and a
 * training session is what issues a certificate. Splitting them made the menu
 * longer without making anything easier to find: you had to know which of
 * three pages held the answer before you could look for it.
 *
 * Nothing is ever removed by folding pages together — every view that existed
 * is still there, one click in rather than one scroll down a long menu.
 *
 * It lives here rather than under HR because Process needed it too, the moment
 * performance reviews moved next to the delivery verdicts they belong with.
 */

export type AreaTab = {
  id: string
  label: string
  /** One line on what this view answers, shown under the tab strip. */
  hint?: string
  render: () => React.ReactNode
}

export function TabbedArea({ tabs, storageKey }: { tabs: AreaTab[]; storageKey: string }) {
  // Remembered per area, because somebody who lives in Punch Integrity should
  // not land on the Daily Log every morning.
  const [active, setActive] = React.useState(() => {
    try {
      const saved = localStorage.getItem(`trinitas.hrtab.${storageKey}`)
      return saved && tabs.some((t) => t.id === saved) ? saved : tabs[0]!.id
    } catch {
      return tabs[0]!.id
    }
  })

  const choose = (id: string) => {
    setActive(id)
    try {
      localStorage.setItem(`trinitas.hrtab.${storageKey}`, id)
    } catch {
      // A browser refusing storage is not a reason to refuse the click.
    }
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0]!

  return (
    <>
      <div className="mb-4" data-print="hide">
        <div role="tablist" className="flex flex-wrap items-center gap-1">
          {tabs.map((tab) => {
            const on = tab.id === current.id
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={on}
                onClick={() => choose(tab.id)}
                className={cn(
                  'rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors',
                  on
                    ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        {current.hint && <p className="mt-2 text-[11px] text-ink-3">{current.hint}</p>}
      </div>

      {/* Keyed so switching tabs remounts rather than leaking one view's
          filters and scroll position into the next. */}
      <div key={current.id}>{current.render()}</div>
    </>
  )
}
