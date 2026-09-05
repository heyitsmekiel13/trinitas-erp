import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  KanbanSquare,
  List,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Waypoints,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, isoDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Input, Segmented, Select } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Menu, MenuItem, MenuSeparator } from '@/components/ui/overlay'
import { liveApi } from '@/lib/adminApi'
import {
  completeTask,
  createSection,
  createTask,
  deleteSection,
  getBoard,
  getProject,
  getProjects,
  moveTask,
  reopenTask,
  updateSection,
  type BoardPayload,
  type ProjectCard,
  type ProjectDetail,
  type TaskCard as TaskCardType,
} from '@/lib/workApi'
import {
  ColumnEmpty,
  ConfirmDelete,
  DeadlineMoves,
  DueChip,
  LabelChip,
  PersonBadge,
  PersonPicker,
  PriorityChip,
  PRIORITIES,
  SavedFiltersMenu,
  useSavedFilters,
} from './shared'
import { TaskMeta, TaskPanel } from './TaskPanel'
import { ProjectSettings } from './ProjectSettings'

/**
 * The work board.
 *
 * Four views over one dataset, which is the central bet of this module. Every
 * tool it replaces stores the board and the list as different things to some
 * degree, and every one of them has the same class of bug as a result: a card
 * that reads Done on the board and In progress in a report. Here `getBoard`
 * returns sections with their tasks nested, and the list, timeline and
 * calendar are re-arrangements of that same array in the browser. They cannot
 * disagree, because there is only one of them.
 *
 * The filters apply to all four for the same reason.
 */

type View = 'board' | 'list' | 'timeline' | 'calendar'

type Filters = {
  search: string
  assignee: number | null
  priority: string
  label: number | null
  hideDone: boolean
}

const EMPTY_FILTERS: Filters = {
  search: '',
  assignee: null,
  priority: '',
  label: null,
  hideDone: false,
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function TaskCard({
  task,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  onToggleDone,
  showProject,
  lifted,
}: {
  task: TaskCardType
  onOpen: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
  onToggleDone?: () => void
  showProject?: boolean
  lifted?: boolean
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-xl border border-line bg-surface p-2.5',
        'transition-[border-color,box-shadow,opacity,transform] duration-150 ease-out',
        'hover:border-line-strong hover:shadow-[var(--shadow-pop)]',
        draggable && 'active:cursor-grabbing',
        lifted && 'scale-[1.03] opacity-90 shadow-[var(--shadow-pop)]',
        task.isDone && 'opacity-60',
      )}
    >
      {/* A red hairline is the only decoration on an urgent card. Colouring
          the whole card, as Monday does, makes a board of urgent work
          unreadable — which is exactly when it needs reading. */}
      {task.priority === 'Urgent' && !task.isDone && (
        <div className="mb-2 h-0.5 w-8 rounded-full bg-critical" aria-hidden />
      )}

      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleDone?.()
          }}
          disabled={!onToggleDone}
          aria-label={task.isDone ? 'Mark incomplete' : 'Mark complete'}
          className={cn(
            'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full transition-transform',
            onToggleDone && 'hover:scale-125',
          )}
        >
          {task.isDone ? (
            <CheckCircle2 className="size-3.5 text-good transition-transform duration-150" />
          ) : (
            <Circle className="size-3.5 text-ink-3 transition-colors group-hover:text-ink-2" />
          )}
        </button>
        <p className={cn('min-w-0 flex-1 text-[13px] leading-snug font-medium text-ink', task.isDone && 'line-through')}>
          {task.title}
        </p>
      </div>

      {task.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1 pl-5.5">
          {task.labels.slice(0, 3).map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
        </div>
      )}

      {showProject && task.project && (
        <p className="mt-1.5 pl-5.5 text-[10px] text-ink-3">{task.project}</p>
      )}

      {task.subtaskCount > 0 && (
        <div className="mt-1.5 pl-5.5">
          <div className="flex items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
              <span
                className="block h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${(task.subtasksDone / task.subtaskCount) * 100}%` }}
              />
            </span>
            <span className="tabular text-[10px] text-ink-3">
              {task.subtasksDone}/{task.subtaskCount}
            </span>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5.5">
        <DueChip date={task.dueDate} isDone={task.isDone} />
        <DeadlineMoves count={task.deadlineMoves} />
        {task.priority !== 'Normal' && task.priority !== 'Low' && <PriorityChip value={task.priority} />}
        <span className="ml-auto flex items-center gap-1.5">
          <TaskMeta commentCount={task.commentCount} attachmentCount={task.attachmentCount} />
          <PersonBadge name={task.assignee} size="xs" />
        </span>
      </div>
    </article>
  )
}

/* -------------------------------------------------------------------------- */
/* Views                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Kanban.
 *
 * Native HTML5 drag rather than a library: the board moves one card between
 * two columns, and 40KB of dependency to do that is a bad trade in an app
 * that already ships recharts.
 */
function BoardView({
  board,
  onOpen,
  onMoved,
  onToggleDone,
  onAdd,
  onRenameColumn,
  onSetDoneColumn,
  onSetWipLimit,
  onDeleteColumn,
  onAddColumn,
}: {
  board: BoardPayload
  onOpen: (id: number) => void
  onMoved: (taskId: number, sectionId: number, position: number) => void
  onToggleDone: (task: TaskCardType) => void
  onAdd: (sectionId: number, title: string) => void
  onRenameColumn: (sectionId: number, name: string) => void
  onSetDoneColumn: (sectionId: number) => void
  onSetWipLimit: (sectionId: number, limit: number | null) => void
  onDeleteColumn: (section: BoardPayload['sections'][number]) => void
  onAddColumn: (name: string) => void
}) {
  const [dragging, setDragging] = React.useState<number | null>(null)
  const [over, setOver] = React.useState<number | null>(null)
  // Where, within the hovered column, the card would land — index into that
  // column's task list. Recomputed on every dragover from the cursor's
  // position relative to the card under it, so the drop line tracks the
  // cursor instead of only ever landing at the end of the column.
  const [dropAt, setDropAt] = React.useState<{ sectionId: number; index: number } | null>(null)
  const [adding, setAdding] = React.useState<number | null>(null)
  const [draft, setDraft] = React.useState('')
  const [renaming, setRenaming] = React.useState<number | null>(null)
  const [newColumn, setNewColumn] = React.useState('')
  const [addingColumn, setAddingColumn] = React.useState(false)

  const endDrag = () => {
    setDragging(null)
    setOver(null)
    setDropAt(null)
  }

  const dragOverCard = (e: React.DragEvent, sectionId: number, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const before = e.clientY < rect.top + rect.height / 2
    setOver(sectionId)
    setDropAt({ sectionId, index: before ? index : index + 1 })
  }

  const DropLine = () => <div className="mx-0.5 h-0.5 rounded-full bg-brand-500" aria-hidden />

  const handleDrop = (sectionId: number, fallbackIndex: number) => {
    if (dragging == null) return
    const index = dropAt && dropAt.sectionId === sectionId ? dropAt.index : fallbackIndex
    onMoved(dragging, sectionId, index)
    endDrag()
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {board.sections.map((section) => {
        const open = section.tasks.filter((t) => !t.isDone).length
        const overLimit = section.wipLimit != null && open > section.wipLimit

        return (
          <section
            key={section.id}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(section.id)
              setDropAt({ sectionId: section.id, index: section.tasks.length })
            }}
            onDragLeave={() => setOver((current) => (current === section.id ? null : current))}
            onDrop={(e) => {
              e.preventDefault()
              handleDrop(section.id, section.tasks.length)
            }}
            className={cn(
              'flex w-[19rem] shrink-0 flex-col rounded-2xl border bg-surface-2 p-2 transition-colors',
              over === section.id ? 'border-brand-400 bg-brand-50/40 dark:bg-brand-950/30' : 'border-line',
            )}
          >
            <header className="flex items-center gap-2 px-1.5 py-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: section.colour ?? 'var(--line-strong)' }} />

              {renaming === section.id ? (
                <Input
                  autoFocus
                  defaultValue={section.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== section.name) {
                      onRenameColumn(section.id, e.target.value.trim())
                    }
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="h-6 flex-1 px-1.5 text-[12px] font-semibold"
                  aria-label={`Rename ${section.name}`}
                />
              ) : (
                <h3
                  className="cursor-text text-[12px] font-semibold text-ink"
                  onDoubleClick={() => setRenaming(section.id)}
                  title="Double-click to rename"
                >
                  {section.name}
                </h3>
              )}

              <span className="tabular text-[11px] text-ink-3">{section.tasks.length}</span>

              {section.wipLimit != null && (
                <span
                  className={cn(
                    'tabular rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                    overLimit ? 'bg-[color-mix(in_srgb,var(--color-critical)_16%,transparent)] text-critical' : 'text-ink-3',
                  )}
                  title={`Work-in-progress limit: ${section.wipLimit}`}
                >
                  {open}/{section.wipLimit}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  setAdding(section.id)
                  setDraft('')
                }}
                aria-label={`Add a task to ${section.name}`}
                className="ml-auto rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
              >
                <Plus className="size-3.5" />
              </button>

              {/* Column management on the column itself, rather than only in
                  settings: renaming a column is something people do while
                  looking at the board, not while looking at a form. */}
              <Menu
                trigger={({ toggle }) => (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={`Options for ${section.name}`}
                    className="rounded-md p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem
                      icon={Pencil}
                      onClick={() => {
                        setRenaming(section.id)
                        close()
                      }}
                    >
                      Rename
                    </MenuItem>
                    <MenuItem
                      icon={Check}
                      disabled={section.isDone}
                      onClick={() => {
                        onSetDoneColumn(section.id)
                        close()
                      }}
                    >
                      {section.isDone ? 'This is the finished column' : 'Make this the finished column'}
                    </MenuItem>
                    <MenuItem
                      icon={SlidersHorizontal}
                      onClick={() => {
                        const answer = window.prompt(
                          `Work-in-progress limit for "${section.name}". Leave empty for no limit.`,
                          section.wipLimit ? String(section.wipLimit) : '',
                        )
                        if (answer !== null) {
                          const parsed = Number(answer)
                          onSetWipLimit(section.id, answer.trim() === '' || parsed < 1 ? null : parsed)
                        }
                        close()
                      }}
                    >
                      Set a WIP limit
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      icon={Trash2}
                      danger
                      onClick={() => {
                        onDeleteColumn(section)
                        close()
                      }}
                    >
                      Delete column
                    </MenuItem>
                  </>
                )}
              </Menu>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto px-0.5 pb-1">
              {adding === section.id && (
                <div className="rounded-xl border border-brand-400 bg-surface p-2">
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.trim()) {
                        onAdd(section.id, draft.trim())
                        setDraft('')
                      }
                      if (e.key === 'Escape') setAdding(null)
                    }}
                    onBlur={() => !draft.trim() && setAdding(null)}
                    placeholder="What needs doing?"
                    className="h-8 text-[13px]"
                  />
                  <p className="mt-1 px-0.5 text-[10px] text-ink-3">Enter to add · Esc to close</p>
                </div>
              )}

              {section.tasks.map((task, index) => (
                <React.Fragment key={task.id}>
                  {dropAt?.sectionId === section.id && dropAt.index === index && dragging !== task.id && <DropLine />}
                  <div
                    onDragOver={(e) => dragOverCard(e, section.id, index)}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDrop(section.id, index)
                    }}
                  >
                    <TaskCard
                      task={task}
                      draggable
                      lifted={dragging === task.id}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        setDragging(task.id)
                      }}
                      onDragEnd={endDrag}
                      onOpen={() => onOpen(task.id)}
                      onToggleDone={() => onToggleDone(task)}
                    />
                  </div>
                </React.Fragment>
              ))}

              {dropAt?.sectionId === section.id && dropAt.index === section.tasks.length && <DropLine />}

              {section.tasks.length === 0 && adding !== section.id && <ColumnEmpty message="Nothing here" />}
            </div>
          </section>
        )
      })}

      {/* The add-column rail, at the end of the board where a new column would
          land. A button in a settings dialog would work, but nobody looks for
          it there while staring at four columns that are the wrong shape. */}
      <div className="w-[16rem] shrink-0">
        {addingColumn ? (
          <div className="rounded-2xl border border-brand-400 bg-surface p-2">
            <Input
              autoFocus
              value={newColumn}
              onChange={(e) => setNewColumn(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newColumn.trim()) {
                  onAddColumn(newColumn.trim())
                  setNewColumn('')
                  setAddingColumn(false)
                }
                if (e.key === 'Escape') setAddingColumn(false)
              }}
              onBlur={() => !newColumn.trim() && setAddingColumn(false)}
              placeholder="Column name"
              className="h-8 text-[13px]"
            />
            <p className="mt-1 px-0.5 text-[10px] text-ink-3">Enter to add · Esc to close</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingColumn(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line py-2.5 text-[12px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
          >
            <Plus className="size-3.5" />
            Add column
          </button>
        )}
      </div>

      {board.unsectioned.length > 0 && (
        <section className="flex w-[19rem] shrink-0 flex-col rounded-2xl border border-dashed border-warning bg-surface-2 p-2">
          <header className="flex items-center gap-2 px-1.5 py-1.5">
            <h3 className="text-[12px] font-semibold text-warning">No column</h3>
            <span className="tabular text-[11px] text-ink-3">{board.unsectioned.length}</span>
          </header>
          <p className="px-1.5 pb-2 text-[10px] text-ink-3">
            The column these sat in was deleted. Drag them somewhere.
          </p>
          <div className="flex-1 space-y-2 overflow-y-auto px-0.5">
            {board.unsectioned.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                draggable
                lifted={dragging === task.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDragging(task.id)
                }}
                onDragEnd={endDrag}
                onOpen={() => onOpen(task.id)}
                onToggleDone={() => onToggleDone(task)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/** The same tasks as rows, grouped by column, sorted by deadline. */
function ListView({ board, onOpen }: { board: BoardPayload; onOpen: (id: number) => void }) {
  return (
    <div className="space-y-4">
      {board.sections.map((section) => (
        <Card key={section.id} className="overflow-hidden">
          <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="size-2 rounded-full" style={{ background: section.colour ?? 'var(--line-strong)' }} />
            <h3 className="text-[12px] font-semibold text-ink">{section.name}</h3>
            <span className="tabular text-[11px] text-ink-3">{section.tasks.length}</span>
          </header>

          {section.tasks.length === 0 ? (
            <p className="px-4 py-5 text-center text-[12px] text-ink-3">Nothing in this column.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                    <th className="px-4 py-2 text-left">Task</th>
                    <th className="w-40 px-3 py-2 text-left">Assignee</th>
                    <th className="w-32 px-3 py-2 text-left">Due</th>
                    <th className="w-24 px-3 py-2 text-left">Priority</th>
                    <th className="w-28 px-3 py-2 text-left">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {[...section.tasks]
                    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
                    .map((task) => (
                      <tr
                        key={task.id}
                        onClick={() => onOpen(task.id)}
                        className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
                      >
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {task.isDone ? (
                              <CheckCircle2 className="size-3.5 shrink-0 text-good" />
                            ) : (
                              <Circle className="size-3.5 shrink-0 text-ink-3" />
                            )}
                            <span className="font-mono text-[10px] text-ink-3">{task.reference}</span>
                            <span className={cn('truncate text-[13px] text-ink', task.isDone && 'line-through opacity-70')}>
                              {task.title}
                            </span>
                            <DeadlineMoves count={task.deadlineMoves} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <PersonBadge name={task.assignee} size="xs" />
                            <span className="truncate text-[12px] text-ink-2">{task.assignee ?? '—'}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <DueChip date={task.dueDate} isDone={task.isDone} showIcon={false} />
                        </td>
                        <td className="px-3 py-2">
                          <PriorityChip value={task.priority} />
                        </td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5">
                            <span className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                              <span className="block h-full rounded-full bg-brand-500" style={{ width: `${task.progress}%` }} />
                            </span>
                            <span className="tabular w-8 text-right text-[10px] text-ink-3">{task.progress}%</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}

/**
 * Timeline.
 *
 * A Gantt without the dependency arrows, deliberately. The arrows are the
 * part of a Gantt everybody demonstrates and nobody reads on a screen this
 * size; the bar showing when a task runs, and where today falls across all of
 * them, is the part that gets used.
 */
function TimelineView({ tasks, onOpen }: { tasks: TaskCardType[]; onOpen: (id: number) => void }) {
  const dated = tasks.filter((t) => t.dueDate)

  if (dated.length === 0) {
    return <EmptyState icon={Waypoints} title="Nothing has dates yet" description="Give a task a deadline and it appears here." />
  }

  // The window spans the work, padded a little at each end so a bar starting
  // today does not sit flush against the frame.
  const stamps = dated.flatMap((t) => [t.startDate ?? t.dueDate!, t.dueDate!]).map((d) => new Date(d).getTime())
  const min = Math.min(...stamps, Date.now()) - 3 * 86_400_000
  const max = Math.max(...stamps, Date.now()) + 3 * 86_400_000
  const span = Math.max(max - min, 86_400_000)

  const position = (date: string) => ((new Date(date).getTime() - min) / span) * 100
  const todayAt = ((Date.now() - min) / span) * 100

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-x-auto">
        {/* Today, drawn once across every row rather than per bar. */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-critical/60"
          style={{ left: `calc(18rem + ${todayAt}% * 0.01 * (100% - 18rem))` }}
          aria-hidden
        />

        {dated
          .slice()
          .sort((a, b) => (a.startDate ?? a.dueDate!).localeCompare(b.startDate ?? b.dueDate!))
          .map((task) => {
            const start = task.startDate ?? task.dueDate!
            const left = position(start)
            const right = position(task.dueDate!)
            const width = Math.max(right - left, 1.2)

            return (
              <div
                key={task.id}
                onClick={() => onOpen(task.id)}
                className="flex cursor-pointer items-center border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
              >
                <div className="flex w-72 shrink-0 items-center gap-2 px-4 py-2">
                  <PersonBadge name={task.assignee} size="xs" />
                  <span className={cn('truncate text-[12px] text-ink', task.isDone && 'line-through opacity-60')}>
                    {task.title}
                  </span>
                </div>
                <div className="relative h-9 flex-1">
                  <span
                    className="absolute top-1/2 h-4 -translate-y-1/2 rounded-full"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: task.isDone
                        ? 'var(--color-good)'
                        : (task.daysLate ?? -1) > 0
                          ? 'var(--color-critical)'
                          : (task.projectColour ?? 'var(--series-1)'),
                      opacity: task.isDone ? 0.45 : 1,
                    }}
                    title={`${task.startDate ? `${fmtDate(task.startDate)} → ` : 'Due '}${fmtDate(task.dueDate!)}`}
                  />
                </div>
              </div>
            )
          })}
      </div>
    </Card>
  )
}

/** A month grid, for the people who plan by looking at a calendar. */
function CalendarView({ tasks, onOpen }: { tasks: TaskCardType[]; onOpen: (id: number) => void }) {
  const [month, setMonth] = React.useState(() => new Date())

  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // weeks start Monday

  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)

    return date
  })

  const byDate = new Map<string, TaskCardType[]>()
  tasks.forEach((task) => {
    if (!task.dueDate) return
    const key = task.dueDate
    byDate.set(key, [...(byDate.get(key) ?? []), task])
  })

  const today = isoDate(new Date())

  return (
    <Card className="overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-ink">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </h3>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(new Date())}>
            Today
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-7 border-b border-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <div key={day} className="px-2 py-1.5 text-center text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date) => {
          const key = isoDate(date)
          const items = byDate.get(key) ?? []
          const outside = date.getMonth() !== month.getMonth()

          return (
            <div
              key={key}
              className={cn(
                'min-h-[5.5rem] border-r border-b border-line/60 p-1.5 last:border-r-0',
                outside && 'bg-surface-2',
                key === today && 'bg-brand-50/50 dark:bg-brand-950/30',
              )}
            >
              <p className={cn('mb-1 text-[10px] font-medium', key === today ? 'text-brand-600' : outside ? 'text-ink-3' : 'text-ink-2')}>
                {date.getDate()}
              </p>
              <div className="space-y-1">
                {items.slice(0, 3).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onOpen(task.id)}
                    className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:opacity-80"
                    style={{
                      background: task.isDone
                        ? 'var(--surface-3)'
                        : `color-mix(in srgb, ${(task.daysLate ?? -1) > 0 ? 'var(--color-critical)' : (task.projectColour ?? 'var(--series-1)')} 16%, transparent)`,
                      color: task.isDone
                        ? 'var(--ink-3)'
                        : (task.daysLate ?? -1) > 0
                          ? 'var(--color-critical)'
                          : (task.projectColour ?? 'var(--series-1)'),
                    }}
                    title={task.title}
                  >
                    {task.title}
                  </button>
                ))}
                {items.length > 3 && <p className="px-1 text-[10px] text-ink-3">+{items.length - 3} more</p>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function WorkBoard() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()

  const [projects, setProjects] = React.useState<ProjectCard[]>([])
  const [projectId, setProjectId] = React.useState<number | null>(null)
  const [detail, setDetail] = React.useState<ProjectDetail | null>(null)
  const [board, setBoard] = React.useState<BoardPayload | null>(null)
  const [view, setView] = React.useState<View>('board')
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS)
  const savedFilters = useSavedFilters<Filters>('board')
  const [showFilters, setShowFilters] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [deletingColumn, setDeletingColumn] = React.useState<BoardPayload['sections'][number] | null>(null)
  const [columnBusy, setColumnBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const openTask = params.get('task') ? Number(params.get('task')) : null

  const setOpenTask = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('task', String(id))
    else next.delete('task')
    setParams(next, { replace: true })
  }

  /* The project list, once. */
  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    getProjects()
      .then((rows) => {
        setProjects(rows)
        const requested = params.get('project') ? Number(params.get('project')) : null
        setProjectId(requested ?? rows[0]?.id ?? null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
    // Deliberately once: re-reading the project list on every filter change
    // would reset the chosen project under the person's cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadBoard = React.useCallback(async () => {
    if (!projectId) return

    setLoading(true)
    try {
      const [payload, project] = await Promise.all([getBoard(projectId), getProject(projectId)])
      setBoard(payload)
      setDetail(project)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  React.useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  /* --------------------------- Filtering ---------------------------------- */

  const filtered = React.useMemo<BoardPayload | null>(() => {
    if (!board) return null

    const match = (task: TaskCardType) => {
      if (filters.hideDone && task.isDone) return false
      if (filters.priority && task.priority !== filters.priority) return false
      if (filters.assignee != null && task.assigneeId !== filters.assignee) return false
      if (filters.label != null && !task.labels.some((l) => l.id === filters.label)) return false
      if (filters.search) {
        const haystack = `${task.title} ${task.reference} ${task.assignee ?? ''}`.toLowerCase()
        if (!haystack.includes(filters.search.toLowerCase())) return false
      }

      return true
    }

    return {
      sections: board.sections.map((section) => ({ ...section, tasks: section.tasks.filter(match) })),
      unsectioned: board.unsectioned.filter(match),
    }
  }, [board, filters])

  const allTasks = React.useMemo(
    () => (filtered ? [...filtered.sections.flatMap((s) => s.tasks), ...filtered.unsectioned] : []),
    [filtered],
  )

  const activeFilters =
    (filters.search ? 1 : 0) +
    (filters.assignee != null ? 1 : 0) +
    (filters.priority ? 1 : 0) +
    (filters.label != null ? 1 : 0) +
    (filters.hideDone ? 1 : 0)

  /* ----------------------------- Actions ---------------------------------- */

  const onMoved = async (taskId: number, sectionId: number, position: number) => {
    // Optimistic: the card lands exactly where it was dropped — not just in
    // the right column but at the right index within it — and only snaps
    // back if the server refuses, which it does when the task is blocked.
    setBoard((current) => {
      if (!current) return current

      const task = [...current.sections.flatMap((s) => s.tasks), ...current.unsectioned].find((t) => t.id === taskId)
      if (!task) return current

      const target = current.sections.find((s) => s.id === sectionId)

      return {
        sections: current.sections.map((s) => {
          if (s.id !== sectionId) return { ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }
          const rest = s.tasks.filter((t) => t.id !== taskId)
          const moved = { ...task, sectionId, isDone: target?.isDone ?? task.isDone }
          const at = Math.max(0, Math.min(position, rest.length))
          return { ...s, tasks: [...rest.slice(0, at), moved, ...rest.slice(at)] }
        }),
        unsectioned: current.unsectioned.filter((t) => t.id !== taskId),
      }
    })

    try {
      await moveTask(taskId, sectionId, position)
      await loadBoard()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not move that', description: (e as Error).message })
      await loadBoard()
    }
  }

  const onToggleDone = async (task: TaskCardType) => {
    // The Asana-style shortcut: complete or reopen right from the card,
    // without opening the panel or dragging to the finished column. Same
    // optimistic-then-reconcile shape as onMoved — the check reads instantly,
    // and loadBoard settles the section/progress fields the server owns.
    const willBeDone = !task.isDone
    setBoard((current) => {
      if (!current) return current
      const patch = (t: TaskCardType) => (t.id === task.id ? { ...t, isDone: willBeDone } : t)
      return {
        sections: current.sections.map((s) => ({ ...s, tasks: s.tasks.map(patch) })),
        unsectioned: current.unsectioned.map(patch),
      }
    })

    try {
      await (willBeDone ? completeTask(task.id) : reopenTask(task.id))
      await loadBoard()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update that task', description: (e as Error).message })
      await loadBoard()
    }
  }

  const onAdd = async (sectionId: number, title: string) => {
    if (!projectId) return

    try {
      await createTask(projectId, { title, section_id: sectionId })
      await loadBoard()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add the task', description: (e as Error).message })
    }
  }

  /**
   * Every column write goes through here.
   *
   * One wrapper so a failure always reloads the board — a rename that the
   * server rejected must not stay on screen looking as if it worked.
   */
  const columnWrite = async (action: () => Promise<unknown>, failure: string) => {
    if (!projectId) return

    setColumnBusy(true)
    try {
      await action()
      await loadBoard()
    } catch (e) {
      toast({ tone: 'error', title: failure, description: (e as Error).message })
      await loadBoard()
    } finally {
      setColumnBusy(false)
    }
  }

  /* ------------------------------- Render --------------------------------- */

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Work Board" description="Kanban, list, timeline and calendar over the same tasks." />
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="The board needs the live API"
            description="Projects and tasks are stored on the server, not in the preview dataset."
          />
        </Card>
      </>
    )
  }

  if (!loading && projects.length === 0) {
    return (
      <>
        <PageHeader title="Work Board" description="Kanban, list, timeline and calendar over the same tasks." />
        <Card>
          <EmptyState
            icon={KanbanSquare}
            title="No projects yet"
            description="Create one on the Projects page and its board appears here."
          />
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Work Board"
        description="One set of tasks, four ways to look at them. Drag to move; a card in the finished column is a finished task."
        meta={
          detail && (
            <>
              <Badge tone="neutral">{detail.code}</Badge>
              <span className="text-[11px] text-ink-3">{num(allTasks.length)} shown</span>
            </>
          )
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void loadBoard()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} disabled={!detail}>
              <Settings2 className="size-3.5" />
              Project settings
            </Button>
          </>
        }
      />

      {/* ------------------------------ Controls ----------------------------- */}
      <div className="card mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 p-3" data-print="hide">
        <Select
          value={projectId ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value)
            setProjectId(id)
            const next = new URLSearchParams(params)
            next.set('project', String(id))
            setParams(next, { replace: true })
          }}
          className="h-8 w-56 text-[13px]"
          aria-label="Project"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search tasks…"
            className="h-8 w-56 pl-8 text-[13px]"
          />
        </div>

        <Button
          variant={activeFilters > 0 ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-3.5" />
          Filters
          {activeFilters > 0 && <Badge tone="brand">{activeFilters}</Badge>}
        </Button>

        {activeFilters > 0 && (
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

        <div className="ml-auto">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: <KanbanSquare className="size-3.5" /> },
              { value: 'list', label: <List className="size-3.5" /> },
              { value: 'timeline', label: <Waypoints className="size-3.5" /> },
              { value: 'calendar', label: <CalendarDays className="size-3.5" /> },
            ]}
          />
        </div>

        {showFilters && (
          <div className="flex w-full flex-wrap items-end gap-3 border-t border-line pt-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Assignee</span>
              <PersonPicker
                value={filters.assignee}
                onChange={(id) => setFilters({ ...filters, assignee: id })}
                placeholder="Anyone"
                className="w-52"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Priority</span>
              <Select
                value={filters.priority}
                onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
                className="h-9 w-36 text-[13px]"
              >
                <option value="">Any</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </label>

            {detail && detail.labels.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium tracking-wide text-ink-3 uppercase">Label</span>
                <Select
                  value={filters.label ?? ''}
                  onChange={(e) => setFilters({ ...filters, label: e.target.value ? Number(e.target.value) : null })}
                  className="h-9 w-40 text-[13px]"
                >
                  <option value="">Any</option>
                  {detail.labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            <label className="flex h-9 cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={filters.hideDone}
                onChange={(e) => setFilters({ ...filters, hideDone: e.target.checked })}
                className="accent-[var(--color-brand-500)]"
              />
              Hide finished
            </label>
          </div>
        )}
      </div>

      {error && !board && <ErrorState error={error} onRetry={() => void loadBoard()} />}

      {loading && !board && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {filtered && (
        <>
          {view === 'board' && (
            <BoardView
              board={filtered}
              onOpen={setOpenTask}
              onMoved={onMoved}
              onToggleDone={(task) => void onToggleDone(task)}
              onAdd={onAdd}
              onRenameColumn={(id, name) =>
                void columnWrite(() => updateSection(projectId!, id, { name }), 'Could not rename the column')
              }
              onSetDoneColumn={(id) =>
                void columnWrite(() => updateSection(projectId!, id, { is_done: true }), 'Could not set the finished column')
              }
              onSetWipLimit={(id, limit) =>
                void columnWrite(() => updateSection(projectId!, id, { wip_limit: limit }), 'Could not set the limit')
              }
              onDeleteColumn={setDeletingColumn}
              onAddColumn={(name) => void columnWrite(() => createSection(projectId!, { name }), 'Could not add the column')}
            />
          )}
          {view === 'list' && <ListView board={filtered} onOpen={setOpenTask} />}
          {view === 'timeline' && <TimelineView tasks={allTasks} onOpen={setOpenTask} />}
          {view === 'calendar' && <CalendarView tasks={allTasks} onOpen={setOpenTask} />}
        </>
      )}

      <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => void loadBoard()} />

      <ProjectSettings
        project={detail}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => void loadBoard()}
        onDeleted={() => {
          // The project this board was showing is gone — fall back to whatever
          // else the person can see rather than leaving an empty frame.
          const remaining = projects.filter((p) => p.id !== projectId)
          setProjects(remaining)
          setProjectId(remaining[0]?.id ?? null)
          setBoard(null)
          setDetail(null)
        }}
      />

      <ConfirmDelete
        open={deletingColumn !== null}
        title={`Delete the "${deletingColumn?.name}" column?`}
        consequence={
          <>
            The {deletingColumn?.tasks.length ?? 0} task(s) in it are <strong>not</strong> deleted — they move to the
            first remaining column. The column itself goes for good.
          </>
        }
        confirmLabel="Delete the column"
        busy={columnBusy}
        onCancel={() => setDeletingColumn(null)}
        onConfirm={async () => {
          if (!deletingColumn) return
          await columnWrite(() => deleteSection(projectId!, deletingColumn.id), 'Could not delete the column')
          setDeletingColumn(null)
        }}
      />
    </>
  )
}
