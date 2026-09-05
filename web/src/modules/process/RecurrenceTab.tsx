import * as React from 'react'
import { CalendarSync, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate } from '@/lib/format'
import { Badge, Button, Input, Select, Switch } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import {
  createRecurrence,
  deleteRecurrence,
  FREQUENCIES,
  getRecurrences,
  runRecurrences,
  updateRecurrence,
  type ProjectDetail,
  type Recurrence,
} from '@/lib/workApi'
import { ConfirmDelete, PersonPicker, PRIORITIES } from './shared'

/**
 * Work that should exist again on a schedule.
 *
 * A compliance office runs the same checks every month and had no way to say
 * so — somebody was going to copy a task by hand twelve times a year, or more
 * likely miss March and not notice until June.
 *
 * The rule is a template that spawns tasks, never a task that clones itself.
 * A recurring task which is also a real task has to be two things at once: the
 * one you complete this month, and the rule that makes next month's. Every
 * tool that models it that way ends up with a January task nobody can close,
 * because closing it would stop February.
 *
 * Each rule shows the next three dates it will fire on. A schedule nobody can
 * predict is one nobody trusts to be doing the right thing.
 */

const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function RecurrenceTab({ project }: { project: ProjectDetail }) {
  const toast = useToast()
  const [rules, setRules] = React.useState<Recurrence[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Recurrence | null>(null)
  const [busy, setBusy] = React.useState(false)

  const [form, setForm] = React.useState({
    title: '',
    frequency: 'Monthly' as (typeof FREQUENCIES)[number],
    weekday: 1,
    day_of_month: 0,
    due_in_days: 3,
    priority: 'Normal',
    assignee_id: null as number | null,
    section_id: null as number | null,
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: '',
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setRules(await getRecurrences(project.id))
    } catch {
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [project.id])

  React.useEffect(() => {
    void load()
  }, [load])

  const act = async (action: () => Promise<unknown>, message?: string) => {
    setBusy(true)
    try {
      await action()
      await load()
      if (message) toast({ tone: 'success', title: message })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not do that', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    act(async () => {
      await createRecurrence(project.id, {
        ...form,
        ends_on: form.ends_on || null,
        // Only the field the chosen frequency actually uses is sent; the
        // others would be stored as noise and read back as a contradiction.
        weekday: ['Weekly', 'Fortnightly'].includes(form.frequency) ? form.weekday : null,
        day_of_month: form.frequency === 'Monthly' ? form.day_of_month : null,
      })
      setForm({ ...form, title: '' })
      setAdding(false)
    }, 'Rule created')

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-3">
        Each rule raises a fresh task on its schedule and gives it its own deadline — not the project SLA, which would
        make a daily check due in a week. Dates always land on a working day, so a month-end check never falls on a
        Sunday.
      </p>

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="size-4 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && rules.length === 0 && !adding && (
        <p className="rounded-xl border border-dashed border-line py-6 text-center text-[12px] text-ink-3">
          Nothing recurs in this project yet.
        </p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} className={cn('rounded-xl border border-line p-3', ! rule.isActive && 'opacity-60')}>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{rule.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
                <span className="font-medium text-ink-2">{rule.describes}</span>
                <span>· due {rule.dueInDays} working days after</span>
                {rule.assignee && <span>· {rule.assignee}</span>}
                {rule.timesRaised > 0 && <span>· raised {rule.timesRaised}×</span>}
              </p>
            </div>

            <Switch
              checked={rule.isActive}
              onChange={(v) => void act(() => updateRecurrence(rule.id, { is_active: v }))}
              label={`Active — ${rule.title}`}
            />

            <button
              type="button"
              onClick={() => setDeleting(rule)}
              aria-label={`Delete ${rule.title}`}
              className="rounded-md p-1 text-ink-3 hover:text-critical"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {/* The next three dates, so the rule can be checked rather than
              taken on faith. */}
          {rule.isActive && rule.upcoming.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
              {rule.upcoming.map((o) => (
                <Badge key={o.raisedOn} tone="neutral">
                  {fmtDate(o.raisedOn)} → due {fmtDate(o.dueOn)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ))}

      {adding ? (
        <div className="space-y-3 rounded-xl border border-brand-400 p-3">
          <Input
            autoFocus
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="What has to happen each time?"
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">How often</span>
              <Select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as (typeof FREQUENCIES)[number] })}
                className="h-8 text-[12px]"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </Select>
            </label>

            {['Weekly', 'Fortnightly'].includes(form.frequency) && (
              <label className="block">
                <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">On</span>
                <Select
                  value={form.weekday}
                  onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
                  className="h-8 text-[12px]"
                >
                  {WEEKDAYS.slice(1).map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {form.frequency === 'Monthly' && (
              <label className="block">
                <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Day</span>
                <Select
                  value={form.day_of_month}
                  onChange={(e) => setForm({ ...form, day_of_month: Number(e.target.value) })}
                  className="h-8 text-[12px]"
                >
                  <option value={0}>Last working day</option>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      Day {d}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Due after</span>
              <Input
                type="number"
                min={0}
                max={60}
                value={form.due_in_days}
                onChange={(e) => setForm({ ...form, due_in_days: Number(e.target.value) })}
                className="h-8 text-[12px]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Assign to</span>
              <PersonPicker value={form.assignee_id} onChange={(id) => setForm({ ...form, assignee_id: id })} />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Priority</span>
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="h-8 text-[12px]"
              >
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Starts</span>
              <Input
                type="date"
                value={form.starts_on}
                onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
                className="h-8 text-[12px]"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Ends</span>
              <Input
                type="date"
                value={form.ends_on}
                onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
                className="h-8 text-[12px]"
              />
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => void create()} disabled={busy || !form.title.trim()}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Create the rule
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add a recurring task
          </Button>

          {rules.some((r) => r.isActive) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const result = await runRecurrences()
                  toast({
                    tone: result.raised > 0 ? 'success' : 'info',
                    title:
                      result.raised > 0
                        ? `${result.raised} task(s) raised`
                        : 'Nothing was due — everything is already up to date',
                  })
                })
              }
              title="Raise anything due now, instead of waiting for the 06:45 run"
            >
              <Play className="size-3.5" />
              Run now
            </Button>
          )}

          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-ink-3">
            <CalendarSync className="size-3" />
            Runs each morning at 06:45
          </span>
        </div>
      )}

      <ConfirmDelete
        open={deleting !== null}
        title={`Delete "${deleting?.title}"?`}
        consequence="The rule stops producing new tasks. Tasks it has already raised are real work and are left exactly as they are."
        confirmLabel="Delete the rule"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await act(() => deleteRecurrence(deleting.id), 'Rule deleted')
          setDeleting(null)
        }}
      />
    </div>
  )
}
