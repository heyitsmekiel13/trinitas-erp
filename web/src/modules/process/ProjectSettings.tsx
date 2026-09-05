import * as React from 'react'
import { Archive, Check, Copy, GripVertical, Loader2, Plus, Tag, Trash2, Users, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, Button, Input, Segmented, Select, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlay'
import {
  createLabel,
  createSection,
  deleteLabel,
  deleteProject,
  deleteSection,
  saveAsTemplate,
  syncMembers,
  updateProject,
  updateSection,
  type CustomFieldDef,
  type CustomFieldType,
  type ProjectDetail,
} from '@/lib/workApi'
import { ConfirmDelete, PersonBadge, PersonPicker, useDirectory } from './shared'
import { RecurrenceTab } from './RecurrenceTab'

/**
 * Everything about a project that is not a task.
 *
 * One dialog rather than a settings page, for the same reason the task detail
 * is a drawer: the person changing a WIP limit is looking at the board it
 * applies to, and a route change loses that. Four tabs, and each one owns a
 * different table — details, columns, people, labels — so nothing here has to
 * be saved as a single giant form.
 *
 * Details is the only tab with a Save button. The other three write on each
 * action, because adding a member and adding a column are already discrete
 * decisions; asking somebody to confirm a list they can see is redundant.
 */

const COLOURS = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`)

type Tab = 'details' | 'columns' | 'people' | 'labels' | 'fields' | 'recurring'

/* -------------------------------------------------------------------------- */
/* Details                                                                     */
/* -------------------------------------------------------------------------- */

function Details({ project, onSaved }: { project: ProjectDetail; onSaved: () => void }) {
  const toast = useToast()
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState({
    name: project.name,
    description: project.description ?? '',
    status: project.status,
    priority: project.priority,
    visibility: project.visibility,
    owner_id: project.ownerId,
    start_date: project.startDate ?? '',
    due_date: project.dueDate ?? '',
    default_sla_days: project.slaDays,
    colour: project.colour,
  })

  const save = async () => {
    setSaving(true)
    try {
      await updateProject(project.id, {
        ...form,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        description: form.description || null,
      })
      toast({ tone: 'success', title: 'Project updated' })
      onSaved()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-ink-2">Name</span>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-ink-2">Description</span>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Owner</span>
          <PersonPicker
            value={form.owner_id}
            onChange={(id) => setForm({ ...form, owner_id: id })}
            allowEmpty={false}
            fallbackName={project.owner}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Status</span>
          <Select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ProjectDetail['status'] })}
          >
            {['Planning', 'Active', 'On hold', 'Completed', 'Cancelled'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Priority</span>
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            {['Low', 'Normal', 'High', 'Critical'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Who can see it</span>
          <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
            <option value="Team">Only the people on it</option>
            <option value="Department">The whole department</option>
            <option value="Company">Everybody</option>
          </Select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Starts</span>
          <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Target finish</span>
          <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Default deadline</span>
          <Input
            type="number"
            min={0}
            max={120}
            value={form.default_sla_days}
            onChange={(e) => setForm({ ...form, default_sla_days: Number(e.target.value) })}
          />
          <span className="mt-1 block text-[11px] text-ink-3">
            Working days. A task raised here with no date of its own gets this one. Set it to 0 to allow undated tasks —
            the compliance scan will flag every one of them.
          </span>
        </label>
      </div>

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

      <div className="flex justify-end border-t border-line pt-4">
        <Button variant="primary" onClick={() => void save()} disabled={saving || !form.name.trim()}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save changes
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                     */
/* -------------------------------------------------------------------------- */

function Columns({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast()
  const [adding, setAdding] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ProjectDetail['sections'][number] | null>(null)

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    try {
      await action()
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: failure, description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-3">
        Columns are the workflow. A task's status <em>is</em> the column it sits in, which is why the board and every
        report agree about it. Exactly one column can mean finished — moving a card into it completes the task and stops
        its reminders.
      </p>

      <div className="space-y-2">
        {project.sections.map((section) => (
          <div key={section.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
            <GripVertical className="size-4 shrink-0 text-ink-3" aria-hidden />

            <Input
              defaultValue={section.name}
              onBlur={(e) =>
                e.target.value !== section.name &&
                e.target.value.trim() &&
                void run(() => updateSection(project.id, section.id, { name: e.target.value.trim() }), 'Could not rename')
              }
              className="h-8 flex-1 text-[13px]"
              aria-label={`Name of ${section.name}`}
            />

            <input
              type="color"
              // The stored value is a CSS variable, which a colour input cannot
              // display — so a swatch that has never been overridden shows the
              // series colour as its background and only sends a hex once set.
              onChange={(e) => void run(() => updateSection(project.id, section.id, { colour: e.target.value }), 'Could not recolour')}
              className="size-8 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
              style={{ background: section.colour ?? 'var(--line-strong)' }}
              aria-label={`Colour of ${section.name}`}
            />

            <label className="flex shrink-0 items-center gap-1.5">
              <span className="text-[10px] tracking-wide text-ink-3 uppercase">WIP</span>
              <Input
                type="number"
                min={0}
                max={99}
                defaultValue={section.wipLimit ?? ''}
                onBlur={(e) =>
                  void run(
                    () =>
                      updateSection(project.id, section.id, {
                        wip_limit: e.target.value === '' || Number(e.target.value) === 0 ? null : Number(e.target.value),
                      }),
                    'Could not set the limit',
                  )
                }
                placeholder="—"
                className="h-8 w-14 text-center text-[13px]"
                aria-label={`Work-in-progress limit for ${section.name}`}
              />
            </label>

            <Button
              size="sm"
              variant={section.isDone ? 'secondary' : 'ghost'}
              onClick={() => void run(() => updateSection(project.id, section.id, { is_done: true }), 'Could not set that')}
              disabled={section.isDone}
              title={section.isDone ? 'This column means finished' : 'Make this the finished column'}
            >
              <Check className="size-3.5" />
              {section.isDone ? 'Finished' : 'Set'}
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(section)}
              disabled={project.sections.length <= 1}
              title={project.sections.length <= 1 ? 'A project needs at least one column' : 'Delete this column'}
            >
              <Trash2 className="size-3.5 text-critical" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && adding.trim()) {
              void run(() => createSection(project.id, { name: adding.trim() }), 'Could not add the column')
              setAdding('')
            }
          }}
          placeholder="Add a column…"
          className="h-9 text-[13px]"
          disabled={busy}
        />
        <Button
          variant="secondary"
          onClick={() => {
            if (!adding.trim()) return
            void run(() => createSection(project.id, { name: adding.trim() }), 'Could not add the column')
            setAdding('')
          }}
          disabled={busy || !adding.trim()}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>

      <ConfirmDelete
        open={deleting !== null}
        title={`Delete the "${deleting?.name}" column?`}
        consequence={
          <>
            The tasks in it are <strong>not</strong> deleted — they move to the first remaining column, so nothing is
            lost. The column itself goes for good.
          </>
        }
        confirmLabel="Delete the column"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await run(() => deleteSection(project.id, deleting.id), 'Could not delete the column')
          setDeleting(null)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

function People({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast()
  const directory = useDirectory()
  const [adding, setAdding] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)

  const write = async (members: { userId: number; role?: string }[]) => {
    setBusy(true)
    try {
      await syncMembers(project.id, members)
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update the team', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const current = project.members.map((m) => ({ userId: m.id, role: m.role }))

  // Picking "Owner" for somebody hands them the seat outright — the person
  // who held it steps down to Lead in the same write, so the project is
  // never left with two owners or none.
  const setRole = (userId: number, role: string) =>
    void write(
      current.map((m) => {
        if (m.userId === userId) return { ...m, role }
        if (role === 'Owner' && m.role === 'Owner') return { ...m, role: 'Lead' }
        return m
      }),
    )

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-3">
        Who can open this project. The <strong>Owner</strong> is accountable for it, a <strong>Lead</strong> helps run
        it, a <strong>Member</strong> does the work, a <strong>Viewer</strong> can read but not change. There is always
        exactly one Owner — handing the role to someone else moves the previous owner to Lead rather than leaving the
        project without one.
      </p>

      <div className="space-y-1.5">
        {project.members.map((member) => (
          <div key={member.id} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
            <PersonBadge name={member.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{member.name}</span>
              <span className="block truncate text-[10px] text-ink-3">{member.username}</span>
            </span>

            <Select
              value={member.role}
              onChange={(e) => setRole(member.id, e.target.value)}
              className="h-8 w-28 text-[12px]"
              aria-label={`Role for ${member.name}`}
            >
              {['Owner', 'Lead', 'Member', 'Viewer'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => void write(current.filter((m) => m.userId !== member.id))}
              disabled={busy || member.id === project.ownerId}
              title={member.id === project.ownerId ? 'The owner cannot be removed — hand the role to someone else first' : 'Remove from the project'}
              aria-label={`Remove ${member.name}`}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}

        {project.members.length === 0 && (
          <p className="rounded-xl border border-dashed border-line py-5 text-center text-[12px] text-ink-3">
            Nobody on this project yet.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <PersonPicker
          value={adding}
          onChange={setAdding}
          placeholder="Add somebody…"
          className="flex-1"
          allowEmpty={false}
        />
        <Button
          variant="secondary"
          onClick={() => {
            if (!adding) return
            void write([...current, { userId: adding, role: 'Member' }])
            setAdding(null)
          }}
          disabled={busy || !adding || current.some((m) => m.userId === adding)}
        >
          <Users className="size-3.5" />
          Add
        </Button>
      </div>

      <p className="text-[11px] text-ink-3">
        {directory.length} people in the directory, read straight from the HR record.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

function Labels({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast()
  const [name, setName] = React.useState('')
  const [colour, setColour] = React.useState(COLOURS[0]!)
  const [busy, setBusy] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ProjectDetail['labels'][number] | null>(null)

  const add = async () => {
    if (!name.trim()) return

    setBusy(true)
    try {
      await createLabel(project.id, { name: name.trim(), colour })
      setName('')
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add the label', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-3">
        Labels cut across columns — a "blocked by client" or "needs review" that applies wherever the task sits. They
        are per project, so one team's vocabulary does not clutter another's board.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {project.labels.map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium"
            style={{ background: `color-mix(in srgb, ${label.colour} 16%, transparent)`, color: label.colour }}
          >
            {label.name}
            <button type="button" onClick={() => setDeleting(label)} aria-label={`Delete ${label.name}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}

        {project.labels.length === 0 && <p className="text-[12px] text-ink-3">No labels yet.</p>}
      </div>

      <div className="flex gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap gap-1">
          {COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              aria-label={`Use colour ${c}`}
              className={cn(
                'size-7 rounded-lg transition-transform',
                colour === c ? 'ring-2 ring-ink ring-offset-2 ring-offset-[var(--surface)]' : 'hover:scale-110',
              )}
              style={{ background: c }}
            />
          ))}
        </div>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="Label name…"
          className="h-9 flex-1 text-[13px]"
        />
        <Button variant="secondary" onClick={() => void add()} disabled={busy || !name.trim()}>
          <Tag className="size-3.5" />
          Add
        </Button>
      </div>

      <ConfirmDelete
        open={deleting !== null}
        title={`Delete the "${deleting?.name}" label?`}
        consequence="It is removed from every task that carries it. The tasks themselves are untouched."
        confirmLabel="Delete the label"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          setBusy(true)
          try {
            await deleteLabel(project.id, deleting.id)
            onChanged()
          } finally {
            setBusy(false)
            setDeleting(null)
          }
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Custom fields                                                              */
/* -------------------------------------------------------------------------- */

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Choice' },
]

/** Turns "Budget Code" into "budget_code" — stable, storable, never shown. */
function slugify(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || `field_${Date.now()}`
  )
}

function Fields({ project, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [label, setLabel] = React.useState('')
  const [type, setType] = React.useState<CustomFieldType>('text')
  const [options, setOptions] = React.useState('')

  const write = async (defs: CustomFieldDef[]) => {
    setBusy(true)
    try {
      await updateProject(project.id, { custom_field_defs: defs })
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update the fields', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const add = () => {
    if (!label.trim()) return

    const key = slugify(label)
    if (project.customFieldDefs.some((f) => f.key === key)) {
      toast({ tone: 'error', title: 'A field with that name already exists' })
      return
    }

    const def: CustomFieldDef = {
      key,
      label: label.trim(),
      type,
      options: type === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : null,
    }

    void write([...project.customFieldDefs, def])
    setLabel('')
    setOptions('')
    setType('text')
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-ink-3">
        Extra fields for this project's tasks, beyond the ones every task already has. Removing a field here only
        hides it going forward — values already saved on a task stay there.
      </p>

      <div className="space-y-1.5">
        {project.customFieldDefs.map((f) => (
          <div key={f.key} className="flex items-center gap-2.5 rounded-xl border border-line px-2.5 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{f.label}</span>
              {f.type === 'select' && f.options && f.options.length > 0 && (
                <span className="block truncate text-[11px] text-ink-3">{f.options.join(', ')}</span>
              )}
            </span>
            <Badge tone="neutral">{FIELD_TYPES.find((t) => t.value === f.type)?.label ?? f.type}</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void write(project.customFieldDefs.filter((d) => d.key !== f.key))}
              disabled={busy}
              aria-label={`Remove ${f.label}`}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}

        {project.customFieldDefs.length === 0 && (
          <p className="rounded-xl border border-dashed border-line py-5 text-center text-[12px] text-ink-3">
            No custom fields yet.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
        <label className="block flex-1">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Field name</span>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && type !== 'select' && add()}
            placeholder="e.g. Customer, Budget Code"
            className="h-9 text-[13px]"
          />
        </label>

        <label className="block w-32">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Type</span>
          <Select value={type} onChange={(e) => setType(e.target.value as CustomFieldType)} className="h-9 text-[13px]">
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>

        {type === 'select' && (
          <label className="block flex-1">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Choices, comma-separated</span>
            <Input
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="e.g. Small, Medium, Large"
              className="h-9 text-[13px]"
            />
          </label>
        )}

        <Button variant="secondary" onClick={add} disabled={busy || !label.trim()}>
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Save as template                                                            */
/* -------------------------------------------------------------------------- */

function SaveAsTemplate({ project, open, onClose }: { project: ProjectDetail; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = React.useState(project.name)
  const [description, setDescription] = React.useState('')
  const [includeTasks, setIncludeTasks] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const submit = async () => {
    if (!name.trim()) return

    setSaving(true)
    try {
      await saveAsTemplate(project.id, {
        name: name.trim(),
        description: description.trim() || null,
        includeTasks,
      })
      toast({ tone: 'success', title: 'Template saved', description: 'It shows up next time somebody starts a project.' })
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save the template', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Save as template" size="md">
      <div className="space-y-4">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Captures this project's columns and labels, so the next one like it starts already set up. Titles only —
          not who is assigned or when things are due, so every project made from this template starts a blank slate
          for both.
        </p>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Template name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Description</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" />
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={includeTasks}
            onChange={(e) => setIncludeTasks(e.target.checked)}
            className="accent-[var(--color-brand-500)]"
          />
          Include this project's open task titles too
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || !name.trim()}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save template
        </Button>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The dialog                                                                  */
/* -------------------------------------------------------------------------- */

export function ProjectSettings({
  project,
  open,
  onClose,
  onChanged,
  onDeleted,
}: {
  project: ProjectDetail | null
  open: boolean
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const toast = useToast()
  const [tab, setTab] = React.useState<Tab>('details')
  const [confirming, setConfirming] = React.useState(false)
  const [savingTemplate, setSavingTemplate] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  if (!project) return null

  const archive = async () => {
    setBusy(true)
    try {
      await updateProject(project.id, { archived: !project.archived })
      toast({
        tone: 'success',
        title: project.archived ? 'Project restored' : 'Project archived',
        description: project.archived
          ? 'It appears in the project list again.'
          : 'It is hidden from the lists, and its tasks stop being chased.',
      })
      onChanged()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not archive', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={project.name}
        description={`${project.code} · ${project.sections.length} columns · ${project.members.length} people`}
        size="xl"
        headerAside={
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'details', label: 'Details' },
              { value: 'columns', label: 'Columns' },
              { value: 'people', label: 'People' },
              { value: 'labels', label: 'Labels' },
              { value: 'fields', label: 'Fields' },
              { value: 'recurring', label: 'Recurring' },
            ]}
          />
        }
      >
        {tab === 'details' && <Details project={project} onSaved={onChanged} />}
        {tab === 'columns' && <Columns project={project} onChanged={onChanged} />}
        {tab === 'people' && <People project={project} onChanged={onChanged} />}
        {tab === 'labels' && <Labels project={project} onChanged={onChanged} />}
        {tab === 'fields' && <Fields project={project} onChanged={onChanged} />}
        {tab === 'recurring' && <RecurrenceTab project={project} />}

        {/* Archiving and deleting sit under every tab rather than in one of
            them: they are properties of the project, not of its details. */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="text-[11px] text-ink-3">
            Archiving hides a project and stops its reminders. Deleting cannot be undone.
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSavingTemplate(true)} disabled={busy}>
              <Copy className="size-3.5" />
              Save as template
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void archive()} disabled={busy}>
              <Archive className="size-3.5" />
              {project.archived ? 'Restore' : 'Archive'}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirming(true)} disabled={busy}>
              <Trash2 className="size-3.5" />
              Delete project
            </Button>
          </div>
        </div>
      </Modal>

      <SaveAsTemplate project={project} open={savingTemplate} onClose={() => setSavingTemplate(false)} />

      <ConfirmDelete
        open={confirming}
        title={`Delete "${project.name}"?`}
        consequence={
          <>
            Every task in it goes with it, along with their comments, files and history. Compliance observations raised
            against those tasks are removed too. If you only want it out of the way, <strong>archive</strong> it
            instead.
          </>
        }
        confirmLabel="Delete permanently"
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setBusy(true)
          try {
            await deleteProject(project.id)
            toast({ tone: 'success', title: 'Project deleted' })
            setConfirming(false)
            onClose()
            onDeleted()
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', description: (e as Error).message })
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
