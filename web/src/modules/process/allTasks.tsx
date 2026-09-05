import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layers, Loader2, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Input, Select } from '@/components/ui/primitives'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { liveApi } from '@/lib/adminApi'
import { getAllTasks, getProjects, type ProjectCard, type TaskCard as TaskCardType } from '@/lib/workApi'
import { PersonPicker, PRIORITIES, SavedFiltersMenu, useDirectory, useSavedFilters } from './shared'
import { TaskCard } from './board'
import { TaskPanel } from './TaskPanel'

/**
 * Every open task the requester can see, in one filterable list.
 *
 * "My Tasks" answers "what is mine"; this answers "what is happening" — the
 * screen a project owner or the office reaches for when one project's board
 * is too narrow a window. Filtered client-side against a single fetch, the
 * same way the Work Board's own filters work, rather than a round trip per
 * filter change.
 */

type Filters = {
  search: string
  projectId: number | null
  assignee: number | null
  priority: string
  dueFrom: string
  dueTo: string
  hideDone: boolean
}

const EMPTY_FILTERS: Filters = {
  search: '',
  projectId: null,
  assignee: null,
  priority: '',
  dueFrom: '',
  dueTo: '',
  hideDone: true,
}

export function AllTasks() {
  const [params, setParams] = useSearchParams()
  const directory = useDirectory()
  const [projects, setProjects] = React.useState<ProjectCard[]>([])
  const [tasks, setTasks] = React.useState<TaskCardType[]>([])
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS)
  const savedFilters = useSavedFilters<Filters>('all-tasks')
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
      const [t, p] = await Promise.all([getAllTasks(), getProjects()])
      setTasks(t)
      setProjects(p)
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

  const filtered = React.useMemo(() => {
    const q = filters.search.trim().toLowerCase()

    return tasks
      .filter((t) => {
        if (filters.hideDone && t.isDone) return false
        if (filters.projectId && t.projectId !== filters.projectId) return false
        if (filters.assignee && t.assigneeId !== filters.assignee) return false
        if (filters.priority && t.priority !== filters.priority) return false
        if (filters.dueFrom && (!t.dueDate || t.dueDate < filters.dueFrom)) return false
        if (filters.dueTo && (!t.dueDate || t.dueDate > filters.dueTo)) return false
        if (q && !t.title.toLowerCase().includes(q) && !t.reference.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  }, [tasks, filters])

  const active =
    Boolean(filters.search) ||
    filters.projectId !== null ||
    filters.assignee !== null ||
    Boolean(filters.priority) ||
    Boolean(filters.dueFrom) ||
    Boolean(filters.dueTo) ||
    !filters.hideDone

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="All Tasks" description="Every open task across every project you can see." />
        <Card>
          <EmptyState icon={Layers} title="Tasks need the live API" description="This list is read from the server, not the preview dataset." />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="All Tasks"
        description="Every open task across every project you can see, in one filterable list."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error && !tasks.length && <ErrorState error={error} onRetry={() => void load()} />}

      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="block w-48">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Search</span>
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Title or reference…"
            className="h-9 text-[13px]"
          />
        </label>

        <label className="block w-44">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Project</span>
          <Select
            value={filters.projectId ?? ''}
            onChange={(e) => setFilters({ ...filters, projectId: e.target.value ? Number(e.target.value) : null })}
            className="h-9 text-[13px]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block w-44">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Assignee</span>
          <PersonPicker
            value={filters.assignee}
            onChange={(id) => setFilters({ ...filters, assignee: id })}
            placeholder="Anyone"
          />
        </label>

        <label className="block w-32">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Priority</span>
          <Select
            value={filters.priority}
            onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            className="h-9 text-[13px]"
          >
            <option value="">Any</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>

        <label className="block w-36">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Due from</span>
          <Input
            type="date"
            value={filters.dueFrom}
            onChange={(e) => setFilters({ ...filters, dueFrom: e.target.value })}
            className="h-9 text-[13px]"
          />
        </label>

        <label className="block w-36">
          <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Due to</span>
          <Input
            type="date"
            value={filters.dueTo}
            min={filters.dueFrom || undefined}
            onChange={(e) => setFilters({ ...filters, dueTo: e.target.value })}
            className="h-9 text-[13px]"
          />
        </label>

        <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={filters.hideDone}
            onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })}
            className="accent-[var(--color-brand-500)]"
          />
          Hide finished
        </label>

        {active && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X className="size-3.5" />
            Clear
          </Button>
        )}

        <SavedFiltersMenu
          saved={savedFilters.saved}
          onApply={setFilters}
          onSave={(name) => savedFilters.save(name, filters)}
          onRemove={savedFilters.remove}
        />

        <span className="ml-auto text-[11px] text-ink-3">
          {directory.length > 0 ? `${filtered.length} of ${tasks.length} tasks` : `${filtered.length} tasks`}
        </span>
      </Card>

      {loading && !tasks.length && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={Layers}
            title={active ? 'Nothing matches those filters' : 'Nothing open anywhere'}
            description={active ? 'Try widening the filters above.' : 'Every visible task across every project is finished.'}
          />
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((task) => (
            <TaskCard key={task.id} task={task} showProject onOpen={() => setOpenTask(task.id)} />
          ))}
        </div>
      )}

      <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => void load()} />
    </>
  )
}
