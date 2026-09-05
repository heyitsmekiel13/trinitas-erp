import * as React from 'react'
import { Loader2, Plus, RefreshCw, Target, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Input, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlay'
import { liveApi } from '@/lib/adminApi'
import {
  createGoal,
  deleteGoal,
  getGoals,
  getProjects,
  updateGoal,
  type Goal,
  type ProjectCard,
} from '@/lib/workApi'
import { ConfirmDelete, PersonPicker } from './shared'

/**
 * What the projects are for.
 *
 * Projects could say what was being done and never why. A board full of
 * finished tasks tells you a team was busy; it does not tell you whether the
 * thing the business wanted actually happened, and those are different
 * questions that get confused precisely because only one of them was ever on a
 * screen.
 *
 * Progress comes from one of three places and the card says which, because
 * "62% from linked projects" is a much weaker claim than "62% measured against
 * a target" and presenting them identically would flatten that.
 */

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'good' | 'critical' | 'warning'> = {
  Draft: 'neutral',
  Active: 'brand',
  Achieved: 'good',
  Missed: 'critical',
  Abandoned: 'neutral',
}

/** This quarter and the next three, plus the year — the periods people use. */
function periods(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const quarter = Math.floor(now.getMonth() / 3) + 1

  const list = [`${year}`]

  for (let i = 0; i < 4; i++) {
    const q = ((quarter - 1 + i) % 4) + 1
    const y = year + Math.floor((quarter - 1 + i) / 4)
    list.push(`${y}-Q${q}`)
  }

  return [...new Set(list)]
}

function GoalForm({
  goal,
  projects,
  open,
  onClose,
  onSaved,
}: {
  goal: Goal | null
  projects: ProjectCard[]
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: '',
    description: '',
    owner_id: null as number | null,
    period: periods()[1] ?? `${new Date().getFullYear()}`,
    status: 'Active',
    target_value: '',
    current_value: '',
    unit: '',
    due_on: '',
    project_ids: [] as number[],
  })

  React.useEffect(() => {
    if (!open) return

    setForm({
      name: goal?.name ?? '',
      description: goal?.description ?? '',
      owner_id: goal?.ownerId ?? null,
      period: goal?.period ?? periods()[1] ?? `${new Date().getFullYear()}`,
      status: goal?.status ?? 'Active',
      target_value: goal?.targetValue != null ? String(goal.targetValue) : '',
      current_value: goal?.currentValue != null ? String(goal.currentValue) : '',
      unit: goal?.unit ?? '',
      due_on: goal?.dueOn ?? '',
      project_ids: goal?.projects.map((p) => p.id) ?? [],
    })
  }, [open, goal])

  const submit = async () => {
    setSaving(true)
    try {
      const body = {
        ...form,
        description: form.description || null,
        target_value: form.target_value === '' ? null : Number(form.target_value),
        current_value: form.current_value === '' ? 0 : Number(form.current_value),
        unit: form.unit || null,
        due_on: form.due_on || null,
      }

      if (goal) await updateGoal(goal.id, body)
      else await createGoal(body)

      toast({ tone: 'success', title: goal ? 'Goal updated' : 'Goal created' })
      onSaved()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} size="lg">
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">What is the outcome? *</span>
          <Input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Not a task — the thing that will be true when this has worked."
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Description</span>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Owner</span>
            <PersonPicker value={form.owner_id} onChange={(id) => setForm({ ...form, owner_id: id })} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Period</span>
            <Select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
              {periods().map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Status</span>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['Draft', 'Active', 'Achieved', 'Missed', 'Abandoned'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </label>
        </div>

        {/* A measurable target where there is one. Leaving it blank is a
            legitimate answer — some goals are judged, not counted — and the
            card will say so rather than inventing a number. */}
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Target</span>
            <Input
              type="number"
              value={form.target_value}
              onChange={(e) => setForm({ ...form, target_value: e.target.value })}
              placeholder="Optional"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Now at</span>
            <Input
              type="number"
              value={form.current_value}
              onChange={(e) => setForm({ ...form, current_value: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Unit</span>
            <Input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="%, ₱, days…"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Due</span>
            <Input type="date" value={form.due_on} onChange={(e) => setForm({ ...form, due_on: e.target.value })} />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-[11px] font-medium text-ink-2">
            Projects pursuing it
            <span className="ml-1.5 font-normal text-ink-3">
              — where there is no target, progress is taken from these
            </span>
          </span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
            {projects.length === 0 && <p className="p-2 text-[12px] text-ink-3">No projects to link yet.</p>}
            {projects.map((project) => (
              <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={form.project_ids.includes(project.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      project_ids: e.target.checked
                        ? [...form.project_ids, project.id]
                        : form.project_ids.filter((id) => id !== project.id),
                    })
                  }
                  className="accent-[var(--color-brand-500)]"
                />
                <span className="size-2 rounded-full" style={{ background: project.colour }} />
                <span className="text-[13px] text-ink-2">{project.name}</span>
                <span className="ml-auto text-[11px] text-ink-3">{project.progress}%</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || !form.name.trim()}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {goal ? 'Save changes' : 'Create goal'}
        </Button>
      </div>
    </Modal>
  )
}

export function Goals() {
  const toast = useToast()
  const [goals, setGoals] = React.useState<Goal[]>([])
  const [projects, setProjects] = React.useState<ProjectCard[]>([])
  const [period, setPeriod] = React.useState('')
  const [editing, setEditing] = React.useState<Goal | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Goal | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [g, p] = await Promise.all([getGoals(period || undefined), getProjects()])
      setGoals(g)
      setProjects(p)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [period])

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
        <PageHeader title="Goals" description="What the projects are for." />
        <Card>
          <EmptyState icon={Target} title="Goals need the live API" />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Goals"
        description="The outcomes the projects are pursuing. A board full of finished tasks says a team was busy; this says whether the thing the business wanted happened."
        actions={
          <>
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-8 w-32 text-[13px]">
              <option value="">Every period</option>
              {periods().map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              New goal
            </Button>
          </>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && goals.length === 0 && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && goals.length === 0 && !error && (
        <Card>
          <EmptyState
            icon={Target}
            title="No goals set"
            description="A goal is the outcome; projects are how it is being pursued. Without one, a project can be delivered perfectly and still not have been worth doing."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="size-3.5" />
                Set the first one
              </Button>
            }
          />
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {goals.map((goal) => (
          <Card key={goal.id} className="p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-ink">{goal.name}</h3>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {[goal.period, goal.owner, goal.department].filter(Boolean).join(' · ')}
                  {goal.dueOn && ` · due ${fmtDate(goal.dueOn)}`}
                </p>
              </div>
              <Badge tone={STATUS_TONE[goal.status] ?? 'neutral'}>{goal.status}</Badge>
            </div>

            {goal.description && (
              <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-3">{goal.description}</p>
            )}

            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[11px] text-ink-3">
                  {goal.targetValue !== null
                    ? `${num(goal.currentValue)} of ${num(goal.targetValue)}${goal.unit ? ` ${goal.unit}` : ''}`
                    : goal.progressSource}
                </span>
                <span className="tabular text-[14px] font-semibold text-ink">{goal.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${goal.progress}%`,
                    background:
                      goal.progress >= 100
                        ? 'var(--color-good)'
                        : goal.status === 'Missed'
                          ? 'var(--color-critical)'
                          : 'var(--color-brand-500)',
                  }}
                />
              </div>
              {/* Says where the number came from. "From linked projects" is a
                  proxy — finishing the work is not the same as achieving the
                  outcome — and presenting it identically to a measured target
                  would hide that. */}
              {goal.targetValue !== null && (
                <p className="mt-1 text-[10px] text-ink-3">{goal.progressSource}</p>
              )}
            </div>

            {goal.projects.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                {goal.projects.map((project) => (
                  <span
                    key={project.id}
                    className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: `color-mix(in srgb, ${project.colour} 14%, transparent)`,
                      color: project.colour,
                    }}
                  >
                    {project.name}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-3 flex justify-end gap-1.5 border-t border-line pt-2.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(goal)
                  setFormOpen(true)
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting(goal)}>
                <Trash2 className="size-3.5 text-critical" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <GoalForm
        goal={editing}
        projects={projects}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => void load()}
      />

      <ConfirmDelete
        open={deleting !== null}
        title={`Delete "${deleting?.name}"?`}
        consequence="The goal goes. The projects linked to it are untouched — they simply stop being attached to an outcome."
        confirmLabel="Delete the goal"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteGoal(deleting.id)
          toast({ tone: 'success', title: 'Goal deleted' })
          setDeleting(null)
          await load()
        }}
      />
    </>
  )
}
