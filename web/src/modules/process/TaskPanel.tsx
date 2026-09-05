import * as React from 'react'
import {
  AtSign,
  Bell,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Eye,
  FileText,
  Link2,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Send,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateTime, fmtRelative, initials } from '@/lib/format'
import { Badge, Button, Input, Select, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import {
  addDependency,
  commentOnTask,
  completeTask,
  createTask,
  deleteTask,
  deleteTaskFile,
  getBoard,
  getProject,
  getTask,
  nudgeTask,
  removeDependency,
  reopenTask,
  updateTask,
  uploadTaskFiles,
  type ProjectLabel,
  type TaskDetail,
  type TaskFile,
} from '@/lib/workApi'
import { TimePanel } from './TimePanel'
import {
  ConfirmDelete,
  DeadlineMoves,
  DueChip,
  LabelChip,
  PersonBadge,
  PersonPicker,
  PRIORITIES,
  useDirectory,
} from './shared'

/**
 * One task, in full.
 *
 * A drawer rather than a page, because the thing a person is doing when they
 * open a task is reading a board — sending them to a route and back loses the
 * column they were looking at. Asana and Monday both learned this; Trello's
 * modal is the same idea.
 *
 * Every field saves on change rather than behind a Save button. A form with a
 * submit is right when the record is incomplete until all of it is filled in;
 * a task is valid at every moment, and asking somebody to confirm that they
 * really did mean to change the priority is friction with nothing behind it.
 */

/* -------------------------------------------------------------------------- */
/* Attachments                                                                 */
/* -------------------------------------------------------------------------- */

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The file list, with images shown rather than listed.
 *
 * A screenshot is the most common attachment on a task and the least useful
 * as a filename — "Screenshot 2026-08-19 at 14.22.31.png" tells the reader
 * nothing that opening it would not. So images become a grid and everything
 * else stays a row.
 */
function Attachments({
  files,
  onDelete,
  onOpen,
}: {
  files: TaskFile[]
  onDelete?: (file: TaskFile) => void
  onOpen: (file: TaskFile) => void
}) {
  if (files.length === 0) return null

  const images = files.filter((f) => f.isImage)
  const documents = files.filter((f) => !f.isImage)

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((file) => (
            <div key={file.id} className="group relative overflow-hidden rounded-lg border border-line bg-surface-2">
              <button type="button" onClick={() => onOpen(file)} className="block w-full">
                <img
                  src={file.url}
                  alt={file.name}
                  loading="lazy"
                  // The stored dimensions reserve the space before the bytes
                  // arrive, so six screenshots do not reflow the panel six
                  // times as they load.
                  width={file.width ?? undefined}
                  height={file.height ?? undefined}
                  className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                />
              </button>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <p className="truncate text-[10px] text-white">{file.name}</p>
              </div>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(file)}
                  aria-label={`Remove ${file.name}`}
                  className="absolute top-1.5 right-1.5 rounded-md bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {documents.map((file) => (
        <div key={file.id} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
          <FileText className="size-4 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">{file.name}</span>
            <span className="block text-[10px] text-ink-3">
              {fileSize(file.size)}
              {file.uploadedBy && ` · ${file.uploadedBy}`}
            </span>
          </span>
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink"
            aria-label={`Open ${file.name}`}
          >
            <Download className="size-3.5" />
          </a>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(file)}
              aria-label={`Remove ${file.name}`}
              className="rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-critical"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Full-size image, for when the thumbnail is not enough. */
function Lightbox({ file, onClose }: { file: TaskFile; onClose: () => void }) {
  React.useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="dialog"
      aria-label={file.name}
    >
      <img src={file.url} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Comment composer                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The comment box, with @mentions and drag-and-drop.
 *
 * Mentions resolve to user ids as they are picked rather than by parsing the
 * text on save — two people with the same surname would otherwise make the
 * notification a guess.
 */
function Composer({ taskId, onPosted }: { taskId: number; onPosted: () => void }) {
  const toast = useToast()
  const people = useDirectory()

  const [body, setBody] = React.useState('')
  const [mentions, setMentions] = React.useState<number[]>([])
  const [files, setFiles] = React.useState<File[]>([])
  const [menu, setMenu] = React.useState<{ query: string; at: number } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const onType = (value: string) => {
    setBody(value)

    // Open the mention menu on an "@" that starts a word, and close it as soon
    // as the fragment stops looking like a name.
    const caret = inputRef.current?.selectionStart ?? value.length
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')

    if (at >= 0 && (at === 0 || /\s/.test(upto[at - 1] ?? ''))) {
      const fragment = upto.slice(at + 1)
      setMenu(/^[\w .-]{0,30}$/.test(fragment) ? { query: fragment, at } : null)
    } else {
      setMenu(null)
    }
  }

  const pickMention = (id: number, name: string) => {
    if (!menu) return

    const caret = inputRef.current?.selectionStart ?? body.length
    const next = `${body.slice(0, menu.at)}@${name} ${body.slice(caret)}`

    setBody(next)
    setMentions((current) => (current.includes(id) ? current : [...current, id]))
    setMenu(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = async () => {
    if (!body.trim() && files.length === 0) return

    setBusy(true)
    try {
      const comment = await commentOnTask(taskId, body.trim() || '(file)', mentions)
      if (files.length > 0) await uploadTaskFiles(taskId, files, comment.id)

      setBody('')
      setMentions([])
      setFiles([])
      onPosted()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not post the comment', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const matches = menu
    ? people.filter((p) => p.name.toLowerCase().includes(menu.query.toLowerCase())).slice(0, 6)
    : []

  return (
    <div
      className={cn('relative rounded-xl border p-2 transition-colors', dragging ? 'border-brand-400 bg-brand-50/40' : 'border-line')}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        setFiles((current) => [...current, ...Array.from(e.dataTransfer.files)])
      }}
    >
      <Textarea
        ref={inputRef}
        value={body}
        onChange={(e) => onType(e.target.value)}
        onPaste={(e) => {
          // Pasting a screenshot is the fastest way to attach one, and every
          // tool that does not support it makes people save to disk first.
          const pasted = Array.from(e.clipboardData.files)
          if (pasted.length > 0) {
            e.preventDefault()
            setFiles((current) => [...current, ...pasted])
          }
        }}
        placeholder="Write a comment… use @ to bring somebody in, or drop a file here"
        rows={3}
        className="resize-none border-0 bg-transparent px-1.5 py-1 text-[13px] focus:ring-0"
      />

      {menu && matches.length > 0 && (
        <div className="absolute bottom-full left-2 z-50 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          {matches.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => pickMention(person.id, person.name)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2"
            >
              <PersonBadge name={person.name} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{person.name}</span>
                {person.department && <span className="block truncate text-[10px] text-ink-3">{person.department}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 px-1.5">
          {files.map((file, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-2">
              <Paperclip className="size-3" />
              <span className="max-w-[10rem] truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}
                aria-label={`Remove ${file.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1.5 px-1.5">
        {mentions.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-brand-600">
            <AtSign className="size-3" />
            {mentions.length} will be notified
          </span>
        )}
        <label className="ml-auto cursor-pointer rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" title="Attach files">
          <Paperclip className="size-3.5" />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles((current) => [...current, ...Array.from(e.target.files ?? [])])}
          />
        </label>
        <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy || (!body.trim() && files.length === 0)}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Comment
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Pickers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Attaches a label the project already defines.
 *
 * Deliberately cannot create one. Labels are a shared vocabulary — letting
 * anybody invent one from a task is how a board ends up with "urgent",
 * "Urgent" and "URGENT" as three different colours. New ones are made in
 * project settings, where the existing list is visible.
 */
function LabelPicker({
  projectId,
  selected,
  onChange,
}: {
  projectId: number
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const [labels, setLabels] = React.useState<ProjectLabel[]>([])
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    void getProject(projectId).then((project) => setLabels(project.labels))

    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open, projectId])

  const available = labels.filter((l) => !selected.includes(l.id))

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
      >
        <Plus className="size-2.5" />
        Label
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          {available.length === 0 ? (
            <p className="px-2.5 py-3 text-center text-[11px] text-ink-3">
              {labels.length === 0
                ? 'This project has no labels yet. Add them in project settings.'
                : 'All of them are on already.'}
            </p>
          ) : (
            available.map((label) => (
              <button
                key={label.id}
                type="button"
                onClick={() => {
                  onChange([...selected, label.id])
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: label.colour }} />
                <span className="truncate text-[12px] text-ink-2">{label.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** Adds somebody to the notification list without making them answerable. */
function WatcherPicker({ selected, onAdd }: { selected: number[]; onAdd: (id: number) => void }) {
  const people = useDirectory()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const matches = people
    .filter((p) => !selected.includes(p.id))
    .filter((p) => (query ? p.name.toLowerCase().includes(query.toLowerCase()) : true))
    .slice(0, 8)

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line-strong px-1.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
      >
        <Plus className="size-3" />
        Watcher
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-2.5 py-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {matches.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => {
                  onAdd(person.id)
                  setOpen(false)
                  setQuery('')
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <PersonBadge name={person.name} size="xs" />
                <span className="truncate text-[12px] text-ink-2">{person.name}</span>
              </button>
            ))}
            {matches.length === 0 && <p className="px-2 py-3 text-center text-[11px] text-ink-3">Nobody left to add.</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Picks the task this one is waiting on.
 *
 * Scoped to the same project. Cross-project blockers are expressible on the
 * API, but offering every task in the company in one list makes the common
 * case — "the thing before this one" — harder to find, not easier.
 */
function DependencyPicker({ task, onAdded }: { task: TaskDetail; onAdded: () => void }) {
  const toast = useToast()
  const [options, setOptions] = React.useState<{ id: number; reference: string; title: string; isDone: boolean }[]>([])
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    void getBoard(task.projectId).then((board) => {
      const all = [...board.sections.flatMap((section) => section.tasks), ...board.unsectioned]
      setOptions(all.map((t) => ({ id: t.id, reference: t.reference, title: t.title, isDone: t.isDone })))
    })

    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open, task.projectId])

  const taken = new Set([task.id, ...task.dependencies.map((d) => d.taskId)])
  const matches = options
    .filter((option) => !taken.has(option.id))
    .filter((option) => (query ? `${option.reference} ${option.title}`.toLowerCase().includes(query.toLowerCase()) : true))
    .slice(0, 8)

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line-strong px-2 py-1 text-[11px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
      >
        <Plus className="size-3" />
        Add a blocker
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-72 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)]">
          <div className="border-b border-line px-2.5 py-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this project&rsquo;s tasks…"
              className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {matches.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={async () => {
                  try {
                    await addDependency(task.id, option.id)
                    setOpen(false)
                    setQuery('')
                    onAdded()
                  } catch (e) {
                    toast({ tone: 'error', title: 'Could not add that', description: (e as Error).message })
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <span className="font-mono text-[10px] text-ink-3">{option.reference}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{option.title}</span>
                {option.isDone && <Badge tone="good">done</Badge>}
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-ink-3">Nothing else in this project.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

type Tab = 'work' | 'discussion' | 'history'

export function TaskPanel({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: number | null
  onClose: () => void
  onChanged?: () => void
}) {
  const toast = useToast()
  const [task, setTask] = React.useState<TaskDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('work')
  const [lightbox, setLightbox] = React.useState<TaskFile | null>(null)
  const [newSubtask, setNewSubtask] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [deletingSubtask, setDeletingSubtask] = React.useState<TaskDetail['subtasks'][number] | null>(null)
  const [removing, setRemoving] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!taskId) return

    setLoading(true)
    try {
      setTask(await getTask(taskId))
    } catch (e) {
      toast({ tone: 'error', title: 'Could not open the task', description: (e as Error).message })
      onClose()
    } finally {
      setLoading(false)
    }
  }, [taskId, toast, onClose])

  React.useEffect(() => {
    setTab('work')
    void load()
  }, [load])

  React.useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && !lightbox && onClose()
    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [onClose, lightbox])

  if (!taskId) return null

  /** Saves one field and refreshes, so derived values follow the edit. */
  const save = async (patch: Record<string, unknown>) => {
    if (!task) return

    // Optimistic, because a due-date change that takes 300ms to appear feels
    // like the click missed.
    setTask({ ...task, ...(patch as Partial<TaskDetail>) })

    try {
      await updateTask(task.id, patch)
      await load()
      onChanged?.()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
      await load()
    }
  }

  const toggleDone = async () => {
    if (!task) return

    try {
      await (task.isDone ? reopenTask(task.id) : completeTask(task.id))
      await load()
      onChanged?.()
    } catch (e) {
      toast({ tone: 'error', title: task.isDone ? 'Could not reopen' : 'Could not complete', description: (e as Error).message })
    }
  }

  const upload = async (files: File[]) => {
    if (!task || files.length === 0) return

    setUploading(true)
    try {
      await uploadTaskFiles(task.id, files)
      await load()
      onChanged?.()
    } catch (e) {
      toast({ tone: 'error', title: 'Upload failed', description: (e as Error).message })
    } finally {
      setUploading(false)
    }
  }

  const addSubtask = async () => {
    if (!task || !newSubtask.trim()) return

    try {
      await createTask(task.projectId, { title: newSubtask.trim(), parent_id: task.id })
      setNewSubtask('')
      await load()
      onChanged?.()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add the subtask', description: (e as Error).message })
    }
  }

  const nudge = async () => {
    if (!task) return

    try {
      const result = await nudgeTask(task.id)
      toast({ tone: result.sent > 0 ? 'success' : 'info', title: result.message })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send the reminder', description: (e as Error).message })
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />

      <aside
        className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[42rem] flex-col border-l border-line bg-surface shadow-2xl"
        role="dialog"
        aria-label={task?.title ?? 'Task'}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload(Array.from(e.dataTransfer.files))
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/70 dark:bg-brand-950/70">
            <p className="flex items-center gap-2 text-[13px] font-medium text-brand-700 dark:text-brand-300">
              <Upload className="size-4" />
              Drop to attach
            </p>
          </div>
        )}

        {/* ------------------------------ Header ------------------------------ */}
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <button
            type="button"
            onClick={() => void toggleDone()}
            className="mt-0.5 shrink-0 transition-transform hover:scale-110"
            aria-label={task?.isDone ? 'Reopen this task' : 'Mark complete'}
          >
            {task?.isDone ? (
              <CheckCircle2 className="size-6 text-good" />
            ) : (
              <Circle className="size-6 text-ink-3 hover:text-brand-500" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-ink-3">{task?.reference}</span>
              {task?.project && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background: `color-mix(in srgb, ${task.projectColour ?? 'var(--series-1)'} 14%, transparent)`,
                    color: task.projectColour ?? 'var(--series-1)',
                  }}
                >
                  {task.project}
                </span>
              )}
              {task?.section && <Badge tone={task.isDone ? 'good' : 'neutral'}>{task.section}</Badge>}
            </div>

            {/* The title is an input, not a heading with an edit button. */}
            <input
              value={task?.title ?? ''}
              onChange={(e) => setTask(task ? { ...task, title: e.target.value } : task)}
              onBlur={(e) => e.target.value !== '' && void save({ title: e.target.value })}
              className={cn(
                'mt-1.5 w-full border-0 bg-transparent p-0 text-[17px] leading-snug font-semibold text-ink outline-none focus:ring-0',
                task?.isDone && 'text-ink-3 line-through',
              )}
              aria-label="Task title"
            />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => void nudge()} title="Send today's reminder now">
              <Bell className="size-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {loading && !task && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-ink-3" />
          </div>
        )}

        {task && (
          <>
            {/* ------------------------- Field strip ------------------------- */}
            <div className="grid grid-cols-2 gap-3 border-b border-line px-5 py-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Assignee</span>
                <PersonPicker value={task.assigneeId} onChange={(id) => void save({ assignee_id: id })} />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Due</span>
                <Input
                  type="date"
                  value={task.dueDate ?? ''}
                  onChange={(e) => void save({ due_date: e.target.value || null })}
                  className="h-9 text-[13px]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Priority</span>
                <Select
                  value={task.priority}
                  onChange={(e) => void save({ priority: e.target.value })}
                  className="h-9 text-[13px]"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Progress</span>
                {task.subtasks.length > 0 ? (
                  // Derived, not dragged — a task with subtasks reports what
                  // they say, not what somebody wishes were true of them.
                  <div className="flex h-9 items-center gap-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-[var(--color-brand-500)] transition-[width]"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <span className="tabular w-8 shrink-0 text-right text-[12px] font-medium text-ink">
                      {task.progress}%
                    </span>
                  </div>
                ) : (
                  <div className="flex h-9 items-center gap-2">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={task.progress}
                      onChange={(e) => setTask({ ...task, progress: Number(e.target.value) })}
                      onMouseUp={(e) => void save({ progress: Number((e.target as HTMLInputElement).value) })}
                      onTouchEnd={(e) => void save({ progress: Number((e.target as HTMLInputElement).value) })}
                      className="w-full accent-[var(--color-brand-500)]"
                      aria-label="Progress"
                    />
                    <span className="tabular w-8 shrink-0 text-right text-[12px] font-medium text-ink">{task.progress}%</span>
                  </div>
                )}
              </label>
            </div>

            {/* Whatever this project defined beyond the fixed set above — set
                in Project settings → Fields, so a task in a project with no
                fields defined renders nothing here at all. */}
            {task.projectFieldDefs.length > 0 && (
              <div className="grid gap-4 border-b border-line px-5 py-4 sm:grid-cols-2">
                {task.projectFieldDefs.map((f) => {
                  const value = task.customFields[f.key] ?? ''
                  const commit = (v: string) =>
                    void save({ custom_fields: { [f.key]: v === '' ? null : v } })

                  return (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">
                        {f.label}
                      </span>
                      {f.type === 'select' ? (
                        <Select
                          value={String(value)}
                          onChange={(e) => commit(e.target.value)}
                          className="h-9 text-[13px]"
                        >
                          <option value="">—</option>
                          {(f.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          defaultValue={String(value)}
                          onBlur={(e) => commit(e.target.value)}
                          className="h-9 text-[13px]"
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            )}

            {/* Deadline history — a fact, shown to everybody. */}
            {(task.deadline.moves > 0 || task.daysLate !== null) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-surface-2 px-5 py-2">
                <DueChip date={task.dueDate} isDone={task.isDone} />
                {task.deadline.moves > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
                    <DeadlineMoves count={task.deadline.moves} />
                    moved from {task.deadline.originalDue ?? '—'}
                  </span>
                )}
                {task.deadline.reassignments > 0 && (
                  <span className="text-[11px] text-ink-3">reassigned {task.deadline.reassignments}×</span>
                )}
              </div>
            )}

            {/* --------------------------- Tabs ------------------------------ */}
            <nav className="flex gap-1 border-b border-line px-4" role="tablist">
              {([
                ['work', 'Work'],
                ['discussion', `Discussion${task.comments.length ? ` (${task.comments.length})` : ''}`],
                ['history', 'History'],
              ] as [Tab, string][]).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
                    tab === id
                      ? 'border-brand-500 text-ink'
                      : 'border-transparent text-ink-3 hover:text-ink-2',
                  )}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {tab === 'work' && (
                <div className="space-y-5">
                  <section>
                    <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Description</h3>
                    <Textarea
                      defaultValue={task.description ?? ''}
                      onBlur={(e) => void save({ description: e.target.value })}
                      rows={4}
                      placeholder="What needs doing, and what finished looks like."
                      className="text-[13px]"
                    />
                  </section>

                  <section>
                    <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      Subtasks
                      {task.subtasks.length > 0 && (
                        <span className="text-ink-3 normal-case">
                          {task.subtasks.filter((s) => s.isDone).length} of {task.subtasks.length} done
                        </span>
                      )}
                    </h3>

                    <div className="space-y-1">
                      {task.subtasks.map((sub) => (
                        <div key={sub.id} className="group/sub flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await (sub.isDone ? reopenTask(sub.id) : completeTask(sub.id))
                              await load()
                              onChanged?.()
                            }}
                            aria-label={sub.isDone ? 'Reopen' : 'Mark complete'}
                          >
                            {sub.isDone ? (
                              <CheckCircle2 className="size-4 text-good" />
                            ) : (
                              <Circle className="size-4 text-ink-3 hover:text-brand-500" />
                            )}
                          </button>
                          <span className={cn('min-w-0 flex-1 truncate text-[13px]', sub.isDone ? 'text-ink-3 line-through' : 'text-ink')}>
                            {sub.title}
                          </span>
                          <PersonBadge name={sub.assignee} size="xs" />
                          <DueChip date={sub.dueDate} isDone={sub.isDone} showIcon={false} />
                          <button
                            type="button"
                            onClick={() => setDeletingSubtask(sub)}
                            aria-label={`Delete ${sub.title}`}
                            className="text-ink-3 opacity-0 transition-opacity group-hover/sub:opacity-100 hover:text-critical"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="mt-1.5 flex gap-2">
                      <Input
                        value={newSubtask}
                        onChange={(e) => setNewSubtask(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void addSubtask()}
                        placeholder="Add a subtask and press Enter"
                        className="h-8 text-[13px]"
                      />
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      <Paperclip className="size-3" />
                      Files
                      {uploading && <Loader2 className="size-3 animate-spin" />}
                    </h3>

                    <Attachments
                      files={task.attachments}
                      onOpen={setLightbox}
                      onDelete={async (file) => {
                        await deleteTaskFile(task.id, file.id)
                        await load()
                      }}
                    />

                    <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line py-3 text-[12px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2">
                      <Upload className="size-3.5" />
                      Drop files here, paste a screenshot, or browse
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => void upload(Array.from(e.target.files ?? []))}
                      />
                    </label>
                  </section>

                  <section>
                      <h3 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                        <Link2 className="size-3" />
                        Dependencies
                      </h3>

                      {task.dependencies.map((dep) => (
                        <div key={dep.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-surface-2">
                          <Badge tone={dep.isDone ? 'good' : 'warning'}>{dep.isDone ? 'done' : 'waiting on'}</Badge>
                          <span className="font-mono text-[11px] text-ink-3">{dep.reference}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-2">{dep.title}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              await removeDependency(task.id, dep.id)
                              await load()
                            }}
                            aria-label="Remove dependency"
                            className="text-ink-3 hover:text-critical"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}

                      {task.blocking.map((dep) => (
                        <div key={dep.taskId} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px]">
                          <Badge tone="neutral">blocks</Badge>
                          <span className="font-mono text-[11px] text-ink-3">{dep.reference}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-2">{dep.title}</span>
                        </div>
                      ))}

                      <div className="mt-1.5">
                        <DependencyPicker task={task} onAdded={() => void load()} />
                      </div>

                      {task.dependencies.some((d) => !d.isDone) && (
                        <p className="mt-1.5 text-[11px] text-warning">
                          This cannot be marked complete until its blockers are finished.
                        </p>
                      )}
                    </section>

                  <section>
                    <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Estimate</h3>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      defaultValue={task.estimateHours ?? ''}
                      onBlur={(e) => void save({ estimate_hours: e.target.value === '' ? null : Number(e.target.value) })}
                      placeholder="Hours"
                      className="h-8 w-32 text-[13px]"
                    />
                  </section>

                  {/* Logged hours is no longer a box somebody types into — it
                      is the sum of timed and manually entered periods, each
                      with a person and a time attached. A total nobody can
                      break down is a total nobody can question. */}
                  <TimePanel taskId={task.id} onChanged={() => void load()} />

                  <section className="space-y-3 border-t border-line pt-3">
                    <div>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                        <Tag className="size-3" />
                        Labels
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {task.labels.map((label) => (
                          <LabelChip
                            key={label.id}
                            label={label}
                            onRemove={() =>
                              void save({ label_ids: task.labels.filter((l) => l.id !== label.id).map((l) => l.id) })
                            }
                          />
                        ))}
                        <LabelPicker
                          projectId={task.projectId}
                          selected={task.labels.map((l) => l.id)}
                          onChange={(ids) => void save({ label_ids: ids })}
                        />
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                        <Eye className="size-3" />
                        Watchers
                        <span className="font-normal text-ink-3 normal-case">— they get the reminders too</span>
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {task.watchers.map((w) => (
                          <span
                            key={w.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-3 py-0.5 pr-1.5 pl-1 text-[11px] text-ink-2"
                          >
                            <PersonBadge name={w.name} size="xs" />
                            {w.name}
                            <button
                              type="button"
                              onClick={() =>
                                void save({ watcher_ids: task.watchers.filter((x) => x.id !== w.id).map((x) => x.id) })
                              }
                              aria-label={`Stop ${w.name} watching`}
                              className="hover:text-critical"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                        <WatcherPicker
                          selected={task.watchers.map((w) => w.id)}
                          onAdd={(id) => void save({ watcher_ids: [...task.watchers.map((w) => w.id), id] })}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              )}

              {tab === 'discussion' && (
                <div className="space-y-4">
                  {task.comments.length === 0 && (
                    <p className="py-6 text-center text-[12px] text-ink-3">Nothing said about this yet.</p>
                  )}

                  {task.comments.map((comment) => (
                    <article key={comment.id} className="flex gap-2.5">
                      <PersonBadge name={comment.author} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="text-[13px] font-medium text-ink">{comment.author ?? 'Somebody'}</span>
                          <span className="text-[10px] text-ink-3">
                            {comment.createdAt ? fmtRelative(comment.createdAt) : ''}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{comment.body}</p>
                        {comment.attachments.length > 0 && (
                          <div className="mt-2">
                            <Attachments files={comment.attachments} onOpen={setLightbox} />
                          </div>
                        )}
                      </div>
                    </article>
                  ))}

                  <Composer taskId={task.id} onPosted={() => void load()} />
                </div>
              )}

              {tab === 'history' && (
                <ol className="space-y-0">
                  {task.activity.map((entry) => (
                    <li key={entry.id} className="flex gap-3 border-l border-line pl-4 pb-3 last:pb-0">
                      <span className="relative">
                        <span className="absolute -left-[1.32rem] top-1.5 size-1.5 rounded-full bg-line-strong" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-ink-2">
                          <span className="font-medium text-ink">{entry.user ?? 'The system'}</span> {entry.action}
                          {entry.from && entry.to && (
                            <>
                              {' '}
                              <span className="text-ink-3 line-through">{entry.from}</span>{' '}
                              <span className="text-ink">{entry.to}</span>
                            </>
                          )}
                          {!entry.from && entry.to && <span className="text-ink"> {entry.to}</span>}
                        </p>
                        <p className="text-[10px] text-ink-3">{entry.at ? fmtDateTime(entry.at) : ''}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <footer className="flex items-center gap-2 border-t border-line px-5 py-3">
              <span className="text-[11px] text-ink-3">
                Raised by {task.reporter ?? 'somebody'}
                {task.completedAt && ` · finished ${fmtDateTime(task.completedAt)}`}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)} title="Delete this task">
                  <Trash2 className="size-3.5 text-critical" />
                </Button>
                {task.isDone ? (
                  <Button size="sm" variant="secondary" onClick={() => void toggleDone()}>
                    <RotateCcw className="size-3.5" />
                    Reopen
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => void toggleDone()}>
                    <CheckCircle2 className="size-3.5" />
                    Mark complete
                  </Button>
                )}
              </div>
            </footer>
          </>
        )}
      </aside>

      {lightbox && <Lightbox file={lightbox} onClose={() => setLightbox(null)} />}

      <ConfirmDelete
        open={confirmingDelete}
        title={`Delete ${task?.reference}?`}
        consequence={
          <>
            Its comments, files, subtasks and history go with it, and it disappears from everyone&rsquo;s queue. If you
            only want it out of the way, move it to the finished column instead — that keeps the record of what was
            delivered and when.
          </>
        }
        confirmLabel="Delete the task"
        busy={removing}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={async () => {
          if (!task) return

          setRemoving(true)
          try {
            await deleteTask(task.id)
            toast({ tone: 'success', title: 'Task deleted' })
            setConfirmingDelete(false)
            onChanged?.()
            onClose()
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', description: (e as Error).message })
          } finally {
            setRemoving(false)
          }
        }}
      />

      <ConfirmDelete
        open={deletingSubtask !== null}
        title={`Delete "${deletingSubtask?.title}"?`}
        consequence="The subtask and anything on it goes. The parent task is untouched."
        confirmLabel="Delete the subtask"
        busy={removing}
        onCancel={() => setDeletingSubtask(null)}
        onConfirm={async () => {
          if (!deletingSubtask) return

          setRemoving(true)
          try {
            await deleteTask(deletingSubtask.id)
            setDeletingSubtask(null)
            await load()
            onChanged?.()
          } catch (e) {
            toast({ tone: 'error', title: 'Could not delete', description: (e as Error).message })
          } finally {
            setRemoving(false)
          }
        }}
      />
    </>
  )
}

/** Small helper the board and queue both use for the card's meta row. */
export function TaskMeta({ commentCount, attachmentCount }: { commentCount: number; attachmentCount: number }) {
  if (commentCount === 0 && attachmentCount === 0) return null

  return (
    <span className="inline-flex items-center gap-2 text-[10px] text-ink-3">
      {commentCount > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Clock className="size-3" />
          {commentCount}
        </span>
      )}
      {attachmentCount > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Paperclip className="size-3" />
          {attachmentCount}
        </span>
      )}
    </span>
  )
}

export { initials }
