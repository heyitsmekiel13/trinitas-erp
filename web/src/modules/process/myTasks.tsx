import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarClock, CheckCircle2, ListChecks, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card } from '@/components/ui/primitives'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { liveApi } from '@/lib/adminApi'
import { getMyTasks, type MyTasks as MyTasksPayload } from '@/lib/workApi'
import { TaskCard } from './board'
import { TaskPanel } from './TaskPanel'

/**
 * One person's queue.
 *
 * The screen most of the workforce will ever open, which is why it does not
 * begin by asking which project. It answers the only two questions somebody
 * has at 9am — what is late, and what is due today — and it answers them
 * before anything else is drawn.
 *
 * Bucketed rather than sorted. A single list ordered by date technically
 * contains the same information, but the reader has to find the boundary
 * between "late" and "not late" themselves, every time they look. The buckets
 * do that once.
 */

const BUCKETS: {
  key: keyof MyTasksPayload['buckets']
  label: string
  hint: string
  tone: 'critical' | 'warning' | 'neutral'
}[] = [
  { key: 'overdue', label: 'Overdue', hint: 'Past the date they were promised for', tone: 'critical' },
  { key: 'today', label: 'Due today', hint: 'Finish these before you leave', tone: 'warning' },
  { key: 'week', label: 'This week', hint: 'The next seven days', tone: 'neutral' },
  { key: 'later', label: 'Later', hint: 'Dated, but not yet urgent', tone: 'neutral' },
  { key: 'undated', label: 'No deadline', hint: 'Nobody has said when these are needed', tone: 'neutral' },
  { key: 'done', label: 'Finished this week', hint: 'Kept visible for a week so a tick is undoable', tone: 'neutral' },
]

const TONE_RULE: Record<'critical' | 'warning' | 'neutral', string> = {
  critical: 'bg-critical',
  warning: 'bg-warning',
  neutral: 'bg-line-strong',
}

export function MyTasks() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = React.useState<MyTasksPayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const openTask = params.get('task') ? Number(params.get('task')) : null

  const setOpenTask = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', String(id))
    else next.delete('task')
    setParams(next, { replace: true })
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await getMyTasks())
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    void load()
  }, [load])

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="My Tasks" description="Everything assigned to you, and everything you are following." />
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Tasks need the live API"
            description="Your queue is read from the server, not from the preview dataset."
          />
        </Card>
      </>
    )
  }

  const counts = data?.counts

  return (
    <>
      <PageHeader
        title="My Tasks"
        description="Everything assigned to you, and everything you are following — ordered by how soon it matters."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error && !data && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && !data && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {data && counts && (
        <div className="space-y-5">
          <StatGrid>
            <StatTile
              label="Overdue"
              value={num(counts.overdue)}
              icon={CalendarClock}
              inverse
              hint={counts.overdue === 0 ? 'Nothing is late' : 'Deal with these first'}
            />
            <StatTile label="Due today" value={num(counts.today)} icon={CalendarClock} />
            <StatTile label="Due this week" value={num(counts.week)} icon={CalendarClock} />
            <StatTile
              label="Open in total"
              value={num(counts.open)}
              icon={ListChecks}
              hint="Assigned to you or followed by you"
            />
          </StatGrid>

          {counts.open === 0 && (
            <Card>
              <EmptyState
                icon={CheckCircle2}
                title="Nothing on your plate"
                description="No open tasks are assigned to you. Anything new will appear here, and you will get an email."
              />
            </Card>
          )}

          {BUCKETS.map((bucket) => {
            const tasks = data.buckets[bucket.key] ?? []

            if (tasks.length === 0) return null

            return (
              <section key={bucket.key}>
                <header className="mb-2 flex items-center gap-2.5">
                  <span className={cn('h-4 w-1 rounded-full', TONE_RULE[bucket.tone])} aria-hidden />
                  <h2 className="text-[13px] font-semibold text-ink">{bucket.label}</h2>
                  <span className="tabular text-[12px] text-ink-3">{tasks.length}</span>
                  <span className="text-[11px] text-ink-3">{bucket.hint}</span>
                </header>

                {/* Two columns on a wide screen: a queue of twenty tasks in one
                    column is a scroll, and the whole point of this page is
                    seeing the shape of the day at once. */}
                <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
                  {tasks.map((task) => (
                    <TaskCard key={task.id} task={task} showProject onOpen={() => setOpenTask(task.id)} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => void load()} />
    </>
  )
}
