import * as React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, KanbanSquare, ListChecks, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ALL_MODULES, type FlatModule } from '@/app/registry'
import { useIsSuperAdmin } from '@/app/auth'
import { useUi } from '@/app/store'
import { liveApi } from '@/lib/adminApi'
import { searchProcess, type SearchResults } from '@/lib/workApi'

/** A module match, or a live task/project match — one navigable list either way. */
type Row =
  | { kind: 'module'; item: FlatModule }
  | { kind: 'task'; item: SearchResults['tasks'][number] }
  | { kind: 'project'; item: SearchResults['projects'][number] }

/** Subsequence match — "sord" finds "Sales Orders". Cheap and forgiving. */
function score(item: FlatModule, query: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const haystacks = [item.label.toLowerCase(), item.department.toLowerCase(), item.blurb.toLowerCase()]

  if (haystacks[0]!.startsWith(q)) return 1000
  if (haystacks[0]!.includes(q)) return 800
  if (haystacks[1]!.includes(q)) return 400

  // Subsequence over "department label" as one string.
  const target = `${haystacks[1]} ${haystacks[0]}`
  let i = 0
  for (const ch of target) {
    if (ch === q[i]) i++
    if (i === q.length) return 200
  }
  if (haystacks[2]!.includes(q)) return 100
  return 0
}

export function CommandPalette() {
  const open = useUi((s) => s.commandOpen)
  const setOpen = useUi((s) => s.setCommandOpen)
  const navigate = useNavigate()
  const superAdmin = useIsSuperAdmin()
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const [remote, setRemote] = React.useState<SearchResults>({ tasks: [], projects: [] })
  const listRef = React.useRef<HTMLDivElement>(null)

  // Ctrl/Cmd+K from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useUi.getState().commandOpen)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setOpen])

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setRemote({ tasks: [], projects: [] })
    }
  }, [open])

  // Tasks and projects live on the server, so this half of the palette is
  // debounced and async — the module list above stays instant either way.
  React.useEffect(() => {
    const q = query.trim()

    if (!open || !liveApi() || q.length < 2) {
      setRemote({ tasks: [], projects: [] })
      return
    }

    const timer = setTimeout(() => {
      void searchProcess(q)
        .then(setRemote)
        .catch(() => setRemote({ tasks: [], projects: [] }))
    }, 300)

    return () => clearTimeout(timer)
  }, [query, open])

  /**
   * What this account may actually open.
   *
   * The palette is a second front door, so it has to obey the same rules as
   * the sidebar — offering "Users & Roles" to somebody who will be redirected
   * out of it is worse than not offering it at all.
   */
  const reachable = React.useMemo(
    () =>
      ALL_MODULES.filter((m) => {
        if (m.departmentId === 'admin') return superAdmin
        if (m.path === '/me') return !superAdmin
        return true
      }),
    [superAdmin],
  )

  const moduleResults = React.useMemo(() => {
    return reachable
      .map((m) => ({ m, s: score(m, query) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((r) => r.m)
  }, [query, reachable])

  // Modules first — they resolve instantly and are what most keystrokes are
  // for — then live tasks and projects once the search comes back.
  const results = React.useMemo<Row[]>(
    () => [
      ...moduleResults.map((item): Row => ({ kind: 'module', item })),
      ...remote.tasks.map((item): Row => ({ kind: 'task', item })),
      ...remote.projects.map((item): Row => ({ kind: 'project', item })),
    ],
    [moduleResults, remote],
  )

  React.useEffect(() => setActive(0), [query])

  // Keep the highlighted row in view during keyboard navigation.
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }

  const openRow = (row: Row) => {
    if (row.kind === 'module') go(row.item.path)
    else if (row.kind === 'task') go(`/tasks?task=${row.item.id}`)
    else go(`/process/board?project=${row.item.id}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % Math.max(results.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      openRow(results[active]!)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden />
      <div className="fixed inset-x-0 top-[8vh] z-[71] mx-auto w-[min(94vw,620px)]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          className="animate-in overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)]"
        >
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-ink-3" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search modules, records and actions…"
              aria-label="Search"
              className="h-14 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <kbd className="hidden rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3 sm:block">
              ESC
            </kbd>
          </div>

          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
            {results.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-ink-3">
                No module, task or project matches “{query}”.
              </p>
            ) : (
              results.map((row, i) => {
                const isActive = i === active
                const key =
                  row.kind === 'module' ? row.item.path : `${row.kind}-${row.item.id}`

                let icon: React.ReactNode
                let label: string
                let sub: string
                let tag: string | null = null

                if (row.kind === 'module') {
                  const Icon = row.item.icon
                  icon = <Icon className="size-4" />
                  label = row.item.label
                  sub = row.item.blurb
                  tag = row.item.department
                } else if (row.kind === 'task') {
                  icon = <ListChecks className="size-4" />
                  label = row.item.title
                  sub = row.item.reference
                  tag = row.item.project
                } else {
                  icon = <KanbanSquare className="size-4" />
                  label = row.item.name
                  sub = row.item.code
                  tag = 'Project'
                }

                return (
                  <button
                    key={key}
                    data-index={i}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => openRow(row)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                      isActive ? 'bg-surface-3' : 'hover:bg-surface-2',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg',
                        isActive ? 'grad-brand text-white' : 'bg-surface-3 text-ink-3',
                      )}
                    >
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
                      <span className="block truncate text-xs text-ink-3">{sub}</span>
                    </span>
                    {tag && <span className="hidden shrink-0 text-[11px] text-ink-3 sm:block">{tag}</span>}
                    {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-ink-3" />}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-surface px-1">↑</kbd>
              <kbd className="rounded border border-line bg-surface px-1">↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-line bg-surface px-1">↵</kbd> open
            </span>
            <span className="ml-auto hidden sm:block">{results.length} results</span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
