import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Archive, KanbanSquare, Layers, Loader2, MoreHorizontal, Plus, RefreshCw, Settings2, Trash2, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Input, Segmented, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay'
import { Modal } from '@/components/ui/overlay'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { liveApi } from '@/lib/adminApi'
import {
  createFromTemplate,
  createProject,
  deleteProject,
  getProject,
  getProjects,
  getTemplates,
  updateProject,
  type ProjectCard,
  type ProjectDetail,
  type Template,
} from '@/lib/workApi'
import { ConfirmDelete, DueChip, PersonBadge, PersonPicker } from './shared'
import { ProjectSettings } from './ProjectSettings'

/**
 * The portfolio.
 *
 * Deliberately a grid of cards rather than the table the rest of the ERP uses
 * for a list. A project is not a record somebody scans forty of looking for a
 * value — it is a thing with a state, and the state is best carried by a
 * progress bar and an overdue count sitting next to each other.
 */

const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'brand'> = {
  Planning: 'neutral',
  Active: 'brand',
  'On hold': 'warning',
  Completed: 'good',
  Cancelled: 'neutral',
}

/** The eight categorical slots, offered as project colours. */
const COLOURS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

function NewProject({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [saving, setSaving] = React.useState(false)
  const [mode, setMode] = React.useState<'blank' | 'template'>('blank')
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = React.useState(false)
  const [templateId, setTemplateId] = React.useState<number | null>(null)
  const [form, setForm] = React.useState({
    name: '',
    description: '',
    status: 'Active',
    priority: 'Normal',
    visibility: 'Team',
    owner_id: null as number | null,
    start_date: '',
    due_date: '',
    default_sla_days: 5,
    colour: COLOURS[0]!,
  })

  React.useEffect(() => {
    if (!open || mode !== 'template' || templates.length > 0) return

    setTemplatesLoading(true)
    getTemplates()
      .then(setTemplates)
      .catch(() => undefined)
      .finally(() => setTemplatesLoading(false))
  }, [open, mode, templates.length])

  const submit = async () => {
    if (!form.name.trim() || (mode === 'template' && !templateId)) return

    setSaving(true)
    try {
      if (mode === 'template' && templateId) {
        await createFromTemplate(templateId, {
          name: form.name.trim(),
          owner_id: form.owner_id,
          start_date: form.start_date || null,
          due_date: form.due_date || null,
        })
        toast({ tone: 'success', title: 'Project created from template', description: 'Its columns and labels are already set up.' })
      } else {
        await createProject({
          ...form,
          name: form.name.trim(),
          start_date: form.start_date || null,
          due_date: form.due_date || null,
        })
        toast({ tone: 'success', title: 'Project created', description: 'Four columns are ready; add the first task.' })
      }
      onCreated()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create the project', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New project" size="lg">
      <div className="space-y-4">
        <Segmented
          value={mode}
          onChange={(v) => {
            setMode(v)
            if (v === 'blank') setTemplateId(null)
          }}
          options={[
            { value: 'blank', label: 'Start blank' },
            { value: 'template', label: 'Start from a template' },
          ]}
        />

        {mode === 'template' && (
          <div className="space-y-1.5">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Template *</span>
            {templatesLoading ? (
              <p className="text-[12px] text-ink-3">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-4 text-center text-[12px] text-ink-3">
                No templates yet. Save one from an existing project's settings.
              </p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                      templateId === t.id ? 'border-brand-400 bg-brand-50 dark:bg-brand-950' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: t.colour }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {t.sectionCount} columns · {t.labelCount} labels
                        {t.taskCount > 0 && ` · ${t.taskCount} starter tasks`}
                        {t.timesUsed > 0 && ` · used ${t.timesUsed}×`}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Name *</span>
          <Input
            autoFocus
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="What is being delivered?"
          />
        </label>

        {mode === 'blank' && (
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Description</span>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="What this is for, and what finished looks like."
            />
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Owner</span>
            <PersonPicker value={form.owner_id} onChange={(id) => setForm({ ...form, owner_id: id })} placeholder="You" />
          </label>

          {mode === 'blank' && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink-2">Status</span>
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {['Planning', 'Active', 'On hold'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Starts</span>
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Target finish</span>
            <Input
              type="date"
              value={form.due_date}
              min={form.start_date || undefined}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </label>

          {mode === 'blank' && (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Who can see it</span>
                <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                  <option value="Team">Only the people on it</option>
                  <option value="Department">The whole department</option>
                  <option value="Company">Everybody</option>
                </Select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-ink-2">Default deadline</span>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={form.default_sla_days}
                  onChange={(e) => setForm({ ...form, default_sla_days: Number(e.target.value) })}
                />
                {/* The SLA is the reason "no deadline" cannot become a hiding
                    place, so it is explained rather than left as a number. */}
                <span className="mt-1 block text-[11px] text-ink-3">
                  Working days. A task raised here with no date of its own gets this one, so nothing is undated by default.
                </span>
              </label>
            </>
          )}
        </div>

        {mode === 'blank' && (
          <div>
            <span className="mb-1.5 block text-[11px] font-medium text-ink-2">Colour</span>
            <div className="flex flex-wrap gap-1.5">
              {COLOURS.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  onClick={() => setForm({ ...form, colour })}
                  aria-label={`Use colour ${colour}`}
                  className={cn(
                    'size-7 rounded-lg transition-transform',
                    form.colour === colour ? 'ring-2 ring-ink ring-offset-2 ring-offset-[var(--surface)]' : 'hover:scale-110',
                  )}
                  style={{ background: colour }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={saving || !form.name.trim() || (mode === 'template' && !templateId)}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Create project
        </Button>
      </div>
    </Modal>
  )
}

export function Projects() {
  const navigate = useNavigate()
  const toast = useToast()
  const [projects, setProjects] = React.useState<ProjectCard[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)
  const [creating, setCreating] = React.useState(false)
  const [settingsFor, setSettingsFor] = React.useState<ProjectDetail | null>(null)
  const [opening, setOpening] = React.useState<number | null>(null)
  const [showArchived, setShowArchived] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ProjectCard | null>(null)
  const [removing, setRemoving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await getProjects(showArchived))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    void load()
  }, [load])

  /**
   * The settings dialog needs the full record, not the card.
   *
   * The grid deliberately returns a summary — sections, members and labels are
   * three more joins per row and the grid does not draw any of them — so the
   * detail is fetched when somebody actually opens the dialog.
   */
  const openSettings = async (id: number) => {
    setOpening(id)
    try {
      setSettingsFor(await getProject(id))
    } finally {
      setOpening(null)
    }
  }

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Projects" description="Every project, its progress and what is running late inside it." />
        <Card>
          <EmptyState icon={Layers} title="Projects need the live API" description="They are stored on the server." />
        </Card>
      </>
    )
  }

  const totals = {
    active: projects.filter((p) => p.status === 'Active').length,
    overdue: projects.reduce((sum, p) => sum + p.overdueTasks, 0),
    open: projects.reduce((sum, p) => sum + p.openTasks, 0),
    mine: projects.reduce((sum, p) => sum + p.myTasks, 0),
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project you can see, with what is running late inside it."
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              variant={showArchived ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowArchived((v) => !v)}
            >
              <Archive className="size-3.5" />
              {showArchived ? 'Showing archived' : 'Archived'}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              New project
            </Button>
          </>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && projects.length === 0 && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && projects.length === 0 && !error && (
        <Card>
          <EmptyState
            icon={Layers}
            title={showArchived ? 'Nothing archived' : 'No projects yet'}
            description={
              showArchived
                ? 'Archived projects appear here so they can be restored.'
                : 'A project holds the work, the people on it and the deadline everything inside it is measured against.'
            }
            action={
              showArchived ? (
                <Button variant="secondary" onClick={() => setShowArchived(false)}>
                  Back to the active list
                </Button>
              ) : (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" />
                  Create the first one
                </Button>
              )
            }
          />
        </Card>
      )}

      {projects.length > 0 && (
        <>
          <StatGrid className="mb-4">
            <StatTile label="Active projects" value={num(totals.active)} icon={Layers} />
            <StatTile label="Open tasks" value={num(totals.open)} icon={Layers} />
            <StatTile
              label="Overdue tasks"
              value={num(totals.overdue)}
              icon={AlertTriangle}
              inverse
              hint={totals.overdue === 0 ? 'Everything is inside its date' : 'Across every project you can see'}
            />
            <StatTile label="Assigned to you" value={num(totals.mine)} icon={Users} />
          </StatGrid>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <Card
                key={project.id}
                onClick={() => navigate(`/process/board?project=${project.id}`)}
                className="cursor-pointer overflow-hidden p-0 transition-shadow hover:shadow-[var(--shadow-pop)]"
              >
                <div className="h-1" style={{ background: project.colour }} aria-hidden />

                <div className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] text-ink-3">{project.code}</p>
                      <h3 className="truncate text-[14px] font-semibold text-ink">{project.name}</h3>
                    </div>
                    <Badge tone={STATUS_TONE[project.status] ?? 'neutral'}>{project.status}</Badge>

                    {/* The card is a link to the board, so the menu has to stop
                        the click travelling — otherwise every menu press also
                        navigates away from the thing being edited. */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Menu
                        trigger={({ toggle }) => (
                          <button
                            type="button"
                            onClick={toggle}
                            aria-label={`Options for ${project.name}`}
                            className="rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
                          >
                            {opening === project.id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-3.5" />
                            )}
                          </button>
                        )}
                      >
                        {(close) => (
                          <>
                            <MenuItem
                              icon={KanbanSquare}
                              onClick={() => {
                                close()
                                navigate(`/process/board?project=${project.id}`)
                              }}
                            >
                              Open the board
                            </MenuItem>
                            <MenuItem
                              icon={Settings2}
                              onClick={() => {
                                close()
                                void openSettings(project.id)
                              }}
                            >
                              Settings, columns and people
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem
                              icon={Archive}
                              onClick={async () => {
                                close()
                                try {
                                  await updateProject(project.id, { archived: !project.archived })
                                  toast({
                                    tone: 'success',
                                    title: project.archived ? 'Project restored' : 'Project archived',
                                    description: project.archived
                                      ? 'It is back in the active list.'
                                      : 'Hidden from the list, and its tasks stop being chased. Find it again under Archived.',
                                  })
                                  await load()
                                } catch (e) {
                                  toast({
                                    tone: 'error',
                                    title: project.archived ? 'Could not restore' : 'Could not archive',
                                    description: (e as Error).message,
                                  })
                                }
                              }}
                            >
                              {project.archived ? 'Restore' : 'Archive'}
                            </MenuItem>

                            {/* Delete lives on the card as well as in settings,
                                because the place somebody decides a project is
                                finished with is the archived list — and having
                                to open a settings dialog to clear something out
                                of it made archiving feel like a dead end. */}
                            <MenuItem
                              icon={Trash2}
                              danger
                              onClick={() => {
                                close()
                                setDeleting(project)
                              }}
                            >
                              Delete permanently
                            </MenuItem>
                          </>
                        )}
                      </Menu>
                    </div>
                  </div>

                  {project.description && (
                    <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-ink-3">{project.description}</p>
                  )}

                  <div className="mt-3">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-[11px] text-ink-3">
                        {num(project.doneTasks)} of {num(project.totalTasks)} done
                      </span>
                      <span className="tabular text-[12px] font-semibold text-ink">{project.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${project.progress}%`, background: project.colour }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <DueChip date={project.dueDate} isDone={project.status === 'Completed'} />

                    {project.overdueTasks > 0 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-critical">
                        <AlertTriangle className="size-3" />
                        {project.overdueTasks} overdue
                      </span>
                    )}

                    {project.myTasks > 0 && (
                      <span className="text-[11px] font-medium text-brand-600">{project.myTasks} yours</span>
                    )}

                    <span className="ml-auto flex -space-x-1.5">
                      {project.members.map((member) => (
                        <PersonBadge key={member.id} name={member.name} size="xs" className="ring-2 ring-[var(--surface)]" />
                      ))}
                      {project.memberCount > project.members.length && (
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface-3 text-[9px] font-medium text-ink-3 ring-2 ring-[var(--surface)]">
                          +{project.memberCount - project.members.length}
                        </span>
                      )}
                    </span>
                  </div>

                  {project.owner && (
                    <p className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-3">
                      Owned by {project.owner}
                      {project.startDate && ` · started ${fmtDate(project.startDate)}`}
                    </p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <NewProject open={creating} onClose={() => setCreating(false)} onCreated={() => void load()} />

      <ConfirmDelete
        open={deleting !== null}
        title={`Delete "${deleting?.name}"?`}
        consequence={
          <>
            Its {deleting?.totalTasks ?? 0} task{deleting?.totalTasks === 1 ? '' : 's'} go with it, along with their
            comments, files and history, and any compliance observations raised against them.
            {!deleting?.archived && (
              <>
                {' '}
                If you only want it out of the way, <strong>archive</strong> it instead.
              </>
            )}
          </>
        }
        confirmLabel="Delete permanently"
        busy={removing}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return

          setRemoving(true)
          try {
            await deleteProject(deleting.id)
            toast({ tone: 'success', title: `${deleting.name} deleted` })
            setDeleting(null)
            await load()
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', description: (e as Error).message })
          } finally {
            setRemoving(false)
          }
        }}
      />

      <ProjectSettings
        project={settingsFor}
        open={settingsFor !== null}
        onClose={() => setSettingsFor(null)}
        onChanged={async () => {
          await load()
          if (settingsFor) setSettingsFor(await getProject(settingsFor.id))
        }}
        onDeleted={() => {
          setSettingsFor(null)
          void load()
        }}
      />
    </>
  )
}
