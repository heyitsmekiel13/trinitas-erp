import * as React from 'react'
import { Loader2, RefreshCw, Timer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Select } from '@/components/ui/primitives'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { liveApi } from '@/lib/adminApi'
import { getBoard, getCapacity, getProjects, type CapacityRow, type ProjectCard, type TaskCard } from '@/lib/workApi'
import { MiniTable } from '@/components/dashboard/MiniTable'
import { DueChip, PersonBadge } from './shared'
import { TaskPanel } from './TaskPanel'

/**
 * Who is carrying what.
 *
 * The question a lead actually asks before assigning anything, and the one
 * Trello cannot answer at all. Counting tasks alone is misleading — six small
 * ones are not six large ones — so the bar is split by urgency, which is the
 * closest honest proxy when estimates are optional.
 *
 * Everyone in the project appears, including people with nothing on. An empty
 * row is the most useful row on the page.
 */

type Row = {
  id: number | null
  name: string
  overdue: number
  today: number
  soon: number
  later: number
  done: number
  total: number
  tasks: TaskCard[]
}

const SEGMENTS = [
  { key: 'overdue', label: 'Overdue', colour: 'var(--color-critical)' },
  { key: 'today', label: 'Due today', colour: 'var(--color-warning)' },
  { key: 'soon', label: 'Next 7 days', colour: 'var(--series-1)' },
  { key: 'later', label: 'Later / undated', colour: 'var(--surface-3)' },
] as const

export function Workload() {
  const [projects, setProjects] = React.useState<ProjectCard[]>([])
  const [projectId, setProjectId] = React.useState<number | null>(null)
  const [tasks, setTasks] = React.useState<TaskCard[]>([])
  const [openTask, setOpenTask] = React.useState<number | null>(null)
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)
  const [capacity, setCapacity] = React.useState<CapacityRow[]>([])
  const [workingDays, setWorkingDays] = React.useState(0)

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    getProjects()
      .then((rows) => {
        setProjects(rows)
        setProjectId(rows[0]?.id ?? null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [])

  const load = React.useCallback(async () => {
    if (!projectId) return

    setLoading(true)
    try {
      const board = await getBoard(projectId)
      setTasks([...board.sections.flatMap((s) => s.tasks), ...board.unsectioned])
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    void load()
  }, [load])

  /*
   * Capacity is loaded independently of the project.
   *
   * It is a question about people — how much time they have after weekends,
   * holidays and leave — and tying it to a project selection meant it
   * vanished entirely when every project happened to be archived. Who is free
   * next fortnight is exactly the question somebody asks *before* there is a
   * project to put them on.
   */
  React.useEffect(() => {
    if (!liveApi()) return

    getCapacity(14)
      .then((cap) => {
        setCapacity(cap.people)
        setWorkingDays(cap.workingDays)
      })
      .catch(() => setCapacity([]))
  }, [])

  const rows = React.useMemo<Row[]>(() => {
    const map = new Map<number | null, Row>()

    for (const task of tasks) {
      const key = task.assigneeId ?? null
      const row =
        map.get(key) ??
        ({
          id: key,
          name: task.assignee ?? 'Nobody assigned',
          overdue: 0,
          today: 0,
          soon: 0,
          later: 0,
          done: 0,
          total: 0,
          tasks: [],
        } satisfies Row)

      row.tasks.push(task)

      if (task.isDone) {
        row.done++
      } else {
        row.total++
        const late = task.daysLate

        if (late !== null && late > 0) row.overdue++
        else if (late === 0) row.today++
        else if (late !== null && late >= -7) row.soon++
        else row.later++
      }

      map.set(key, row)
    }

    return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total)
  }, [tasks])

  const peak = Math.max(...rows.map((r) => r.total), 1)

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Workload" description="Who is carrying what, and who is carrying too much." />
        <Card>
          <EmptyState icon={Timer} title="Workload needs the live API" />
        </Card>
      </>
    )
  }

  const totals = rows.reduce(
    (sum, r) => ({ open: sum.open + r.total, overdue: sum.overdue + r.overdue, people: sum.people + (r.id ? 1 : 0) }),
    { open: 0, overdue: 0, people: 0 },
  )

  return (
    <>
      <PageHeader
        title="Workload"
        description="Open work per person, split by how soon it is needed. Six small tasks are not six large ones — the colours are the honest part."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3" data-print="hide">
        <Select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(Number(e.target.value))}
          className="h-8 w-56 text-[13px]"
          aria-label="Project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {SEGMENTS.map((segment) => (
            <span key={segment.key} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className="size-2 rounded-[3px]" style={{ background: segment.colour }} />
              {segment.label}
            </span>
          ))}
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && rows.length === 0 && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <StatGrid className="mb-4" columns={3}>
            <StatTile label="Open tasks" value={num(totals.open)} icon={Timer} />
            <StatTile label="Overdue" value={num(totals.overdue)} icon={Timer} inverse />
            <StatTile label="People with work" value={num(totals.people)} icon={Timer} />
          </StatGrid>

          <Card className="divide-y divide-line p-0">
            {rows.map((row) => (
              <div key={String(row.id)}>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <PersonBadge name={row.id ? row.name : null} size="sm" />

                  <span className="w-44 shrink-0">
                    <span className={cn('block truncate text-[13px] font-medium', row.id ? 'text-ink' : 'text-warning')}>
                      {row.name}
                    </span>
                    <span className="block text-[10px] text-ink-3">
                      {num(row.total)} open · {num(row.done)} done
                    </span>
                  </span>

                  {/* Bar width is the count against the busiest person, so the
                      row lengths are comparable rather than each self-scaled. */}
                  <span className="flex h-5 min-w-0 flex-1 items-center gap-0.5 overflow-hidden rounded-md">
                    {SEGMENTS.map((segment) => {
                      const value = row[segment.key]
                      if (value === 0) return null

                      return (
                        <span
                          key={segment.key}
                          className="h-full"
                          style={{ width: `${(value / peak) * 100}%`, background: segment.colour, minWidth: '0.35rem' }}
                          title={`${value} ${segment.label.toLowerCase()}`}
                        />
                      )
                    })}
                    {row.total === 0 && <span className="text-[11px] text-ink-3">Nothing open</span>}
                  </span>

                  {row.overdue > 0 && (
                    <span className="tabular shrink-0 text-[12px] font-semibold text-critical">{row.overdue} late</span>
                  )}
                </button>

                {expanded === row.id && (
                  <div className="space-y-1 bg-surface-2 px-4 py-2">
                    {row.tasks
                      .filter((t) => !t.isDone)
                      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
                      .map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => setOpenTask(task.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface"
                        >
                          <span className="font-mono text-[10px] text-ink-3">{task.reference}</span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{task.title}</span>
                          <DueChip date={task.dueDate} showIcon={false} />
                        </button>
                      ))}
                    {row.total === 0 && <p className="px-2 py-1.5 text-[12px] text-ink-3">Nothing open — available for work.</p>}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Capacity, in hours rather than task counts.

          Counting tasks treats a ten minute job and a fortnight the same. This
          takes the working days left in the fortnight, subtracts approved
          leave, and compares the result against the estimates already
          assigned — which is the question a lead is actually asking before
          they hand somebody else a job. */}
      {capacity.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <Timer className="size-4 text-ink-3" />
            <h2 className="text-[13px] font-semibold text-ink">Capacity, next fortnight</h2>
            <span className="text-[11px] text-ink-3">
              {workingDays} working days after weekends, public holidays and approved leave
            </span>
          </header>

          <MiniTable
            rows={capacity.filter((r) => r.openTasks > 0 || r.leaveDays > 0)}
            rowKey={(r) => r.userId}
            maxHeight={420}
            empty="Nobody has estimated work assigned."
            columns={[
              {
                key: 'name',
                label: 'Person',
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <PersonBadge name={r.name} size="xs" />
                    <span>
                      <span className="block text-[12px] font-medium text-ink">{r.name}</span>
                      {r.department && <span className="block text-[10px] text-ink-3">{r.department}</span>}
                    </span>
                  </span>
                ),
              },
              {
                key: 'leave',
                label: 'On leave',
                align: 'right',
                render: (r) => (
                  <span className={cn('text-[12px]', r.leaveDays > 0 ? 'text-warning' : 'text-ink-3')}>
                    {r.leaveDays > 0 ? `${r.leaveDays}d` : '—'}
                  </span>
                ),
              },
              { key: 'available', label: 'Available', align: 'right', render: (r) => `${r.availableHours}h` },
              {
                key: 'committed',
                label: 'Committed',
                align: 'right',
                render: (r) => (
                  <span>
                    {r.committedHours}h
                    {r.unestimated > 0 && (
                      <span className="ml-1 text-[10px] text-ink-3" title="Unestimated tasks charged at half a day each">
                        ({r.unestimated} est.)
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: 'load',
                label: 'Load',
                width: 'w-40',
                render: (r) =>
                  r.loadPct === null ? (
                    <span className="text-[12px] text-ink-3">no time available</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(r.loadPct, 100)}%`,
                            background:
                              r.loadPct > 100
                                ? 'var(--color-critical)'
                                : r.loadPct > 80
                                  ? 'var(--color-warning)'
                                  : 'var(--color-good)',
                          }}
                        />
                      </span>
                      <span
                        className={cn(
                          'tabular w-11 text-right text-[12px] font-medium',
                          r.loadPct > 100 ? 'text-critical' : 'text-ink',
                        )}
                      >
                        {r.loadPct}%
                      </span>
                    </span>
                  ),
              },
            ]}
          />

          <p className="border-t border-line px-4 py-2 text-[11px] text-ink-3">
            An unestimated task is charged at half a day. It is a guess, but a visible one — treating it as zero would
            declare somebody idle when they are not.
          </p>
        </Card>
      )}

      <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => void load()} />
    </>
  )
}
