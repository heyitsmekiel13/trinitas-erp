import * as React from 'react'
import { Loader2, Pause, Play, Plus, Timer, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateTime } from '@/lib/format'
import { Badge, Button, Input } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import {
  deleteTimeEntry,
  getRunningTimer,
  getTimeEntries,
  logTime,
  startTimer,
  stopTimer,
  type TimeEntry,
} from '@/lib/workApi'

/**
 * Time actually spent, on one task.
 *
 * `logged_hours` used to be a number somebody typed into a box — the only
 * figure in the module nothing could verify, and it was being compared against
 * estimates as though it meant something. It is now a sum of entries, each
 * with a person and a period attached.
 *
 * A timer and a manual box, because both are how people really record time:
 * the timer for work happening now, the box for the hour spent on it yesterday
 * that nobody was going to reconstruct from memory otherwise.
 */

/** Minutes as the reader would say them: `1h 25m`. */
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`

  return `${h}h ${m}m`
}

export function TimePanel({ taskId, onChanged }: { taskId: number; onChanged?: () => void }) {
  const toast = useToast()
  const [entries, setEntries] = React.useState<TimeEntry[]>([])
  const [estimate, setEstimate] = React.useState<number | null>(null)
  const [logged, setLogged] = React.useState(0)
  const [running, setRunning] = React.useState<{ taskId: number; minutes: number } | null>(null)
  const [manual, setManual] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [tick, setTick] = React.useState(0)

  const load = React.useCallback(async () => {
    try {
      const [data, timer] = await Promise.all([getTimeEntries(taskId), getRunningTimer()])
      setEntries(data.entries)
      setEstimate(data.estimateHours)
      setLogged(data.loggedHours)
      setRunning(timer ? { taskId: timer.taskId, minutes: timer.minutes } : null)
    } catch {
      setEntries([])
    }
  }, [taskId])

  React.useEffect(() => {
    void load()
  }, [load])

  // A running clock that does not move is worse than no clock. One minute is
  // enough — a second hand on a timesheet is decoration.
  React.useEffect(() => {
    if (!running) return

    const id = setInterval(() => setTick((t) => t + 1), 60_000)

    return () => clearInterval(id)
  }, [running])

  const isRunningHere = running?.taskId === taskId
  const liveMinutes = isRunningHere ? (running?.minutes ?? 0) + tick : 0

  const act = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true)
    try {
      await action()
      setTick(0)
      await load()
      onChanged?.()
      if (message) toast({ tone: 'success', title: message })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not do that', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const over = estimate !== null && estimate > 0 && logged > estimate

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        <Timer className="size-3" />
        Time
        {estimate !== null && (
          <span className={cn('font-normal normal-case', over ? 'text-critical' : 'text-ink-3')}>
            {logged}h logged of {estimate}h estimated
            {over && ` — ${(logged - estimate).toFixed(1)}h over`}
          </span>
        )}
        {estimate === null && logged > 0 && <span className="font-normal normal-case">{logged}h logged</span>}
      </h3>

      {/* Estimate versus actual, drawn only when there is an estimate to draw
          against. A bar with no ceiling says nothing. */}
      {estimate !== null && estimate > 0 && (
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min((logged / estimate) * 100, 100)}%`,
              background: over ? 'var(--color-critical)' : 'var(--color-good)',
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isRunningHere ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void act(() => stopTimer(), 'Timer stopped')}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
            Stop · {duration(liveMinutes)}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(() => startTimer(taskId))}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Start timer
          </Button>
        )}

        {/* Somebody timing a different task is told which, rather than being
            silently switched — the switch happens, but they should know. */}
        {running && !isRunningHere && (
          <Badge tone="warning">A timer is running on another task — starting here will stop it</Badge>
        )}

        <span className="ml-auto flex items-center gap-1.5">
          <Input
            type="number"
            min={1}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Minutes"
            className="h-8 w-24 text-[13px]"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What on?"
            className="h-8 w-40 text-[13px]"
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !manual || Number(manual) < 1}
            onClick={() =>
              void act(async () => {
                await logTime(taskId, Number(manual), note || undefined)
                setManual('')
                setNote('')
              }, 'Time logged')
            }
          >
            <Plus className="size-3.5" />
            Log
          </Button>
        </span>
      </div>

      {entries.length > 0 && (
        <div className="mt-2 space-y-1">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-surface-2">
              <span className="tabular w-16 shrink-0 font-medium text-ink">{duration(entry.minutes)}</span>
              <span className="shrink-0 text-ink-2">{entry.user}</span>
              {entry.note && <span className="min-w-0 flex-1 truncate text-ink-3">{entry.note}</span>}
              {!entry.note && <span className="flex-1" />}
              {entry.running && <Badge tone="brand">running</Badge>}
              {entry.manual && <Badge tone="neutral">typed</Badge>}
              <span className="shrink-0 text-[10px] text-ink-3">
                {entry.startedAt ? fmtDateTime(entry.startedAt) : ''}
              </span>
              <button
                type="button"
                onClick={() => void act(() => deleteTimeEntry(entry.id))}
                aria-label="Remove this entry"
                className="shrink-0 text-ink-3 hover:text-critical"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
