import * as React from 'react'
import {
  CheckCircle2, Circle, ClipboardCheck, ListChecks, RotateCcw, TriangleAlert, UserCheck,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  completeEmployeeFile, completeOnboardingTask, getEmployeeFile, getOnboarding, getOnboardingTasks,
  liveApi, reopenEmployeeFile, reopenOnboardingTask,
  type EmployeeOnboardingChecklist, type OnboardingFile, type OnboardingTaskItem, type ProfileGap,
} from '@/lib/adminApi'
import { invalidateResource } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { Badge, Button } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/**
 * The 201 files that are not finished, said in terms somebody can act on.
 *
 * This is the answer to "how do I know a new employee's record still needs
 * filling in". It is deliberately not a reminder or a message that can be
 * dismissed — those get dismissed. It is a standing statement, on the screens
 * where the work already happens, that says which fields are missing and what
 * each one stops:
 *
 *   Cannot be paid       payroll will not run correctly on this file
 *   Filings incomplete   payroll runs, but a government return will be wrong
 *   Thin                 nothing breaks; the file is just sparse
 *
 * The three tiers matter more than a count. "Six fields missing" tells nobody
 * whether to act today. "Cannot be paid" does.
 */

const STATUS_TONE: Record<string, 'critical' | 'warning' | 'info' | 'neutral' | 'good'> = {
  'Cannot be paid': 'critical',
  'Filings incomplete': 'warning',
  Thin: 'info',
  'For review': 'neutral',
  Complete: 'good',
}

const SEVERITY_TONE: Record<ProfileGap['severity'], string> = {
  blocking: 'text-critical',
  attendance: 'text-warning',
  statutory: 'text-warning',
  record: 'text-ink-3',
}

const SEVERITY_LABEL: Record<ProfileGap['severity'], string> = {
  blocking: 'Cannot be paid',
  attendance: 'Blocks attendance',
  statutory: 'Blocks a filing',
  record: 'Record only',
}

/* -------------------------------------------------------------------------- */
/* The banner on the masterfile                                                */
/* -------------------------------------------------------------------------- */

/**
 * Sits above the employee list whenever anything is outstanding.
 *
 * Above rather than beside, because the masterfile is where somebody goes to
 * fix one of these, and a notice they have to scroll to find is a notice that
 * only reaches the people who already knew.
 */
export function OnboardingBanner({ onOpen }: { onOpen?: (employeeId: number) => void }) {
  const [data, setData] = React.useState<Awaited<ReturnType<typeof getOnboarding>> | null>(null)
  const [expanded, setExpanded] = React.useState(false)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getOnboarding()
      .then(setData)
      .catch(() => setData(null))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const counts = data?.counts
  const rows = data?.employees ?? []

  // Files that are merely awaiting a signature are not worth a banner. Only
  // something actually missing earns the interruption.
  const needing = rows.filter((r) => r.gaps > 0)

  if (!counts || needing.length === 0) return null

  const blocking = counts.blocking
  const tone = blocking > 0 ? 'critical' : counts.statutory > 0 ? 'warning' : 'info'

  return (
    <div
      className={cn(
        'card mb-4 border-l-4 p-3',
        tone === 'critical' ? 'border-l-critical' : tone === 'warning' ? 'border-l-warning' : 'border-l-info',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <TriangleAlert
            className={cn(
              'mt-0.5 size-4 shrink-0',
              tone === 'critical' ? 'text-critical' : tone === 'warning' ? 'text-warning' : 'text-info',
            )}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink">
              {blocking > 0
                ? `${blocking} 201 ${blocking === 1 ? 'file cannot' : 'files cannot'} be paid on`
                : `${needing.length} 201 ${needing.length === 1 ? 'file is' : 'files are'} incomplete`}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">
              {blocking > 0
                ? 'Payroll will not run correctly for them until the missing fields are filled in.'
                : 'Nothing breaks, but a government return will be wrong or the file is thin.'}
              {counts.fromHire > 0 && ` ${counts.fromHire} came from a hire and has never been reviewed.`}
            </p>
          </div>
        </div>

        <Button size="sm" variant="ghost" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Hide' : `Show ${needing.length}`}
        </Button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-1 border-t border-line pt-3">
          {needing.map((row) => (
            <button
              key={row.id}
              onClick={() => onOpen?.(row.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
            >
              <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
              <span className="text-[12px] font-medium text-ink">{row.name}</span>
              <span className="text-[11px] text-ink-3">{row.employeeNo}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{row.summary}</span>
              {row.daysSinceHired !== null && row.fromHire && (
                <span className="text-[10px] text-ink-3">hired {row.daysSinceHired}d ago</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The panel on one employee                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Shown inside an employee's record: what is missing, and the sign-off.
 *
 * Signing off is a person's act rather than a flag the system sets when the
 * last column is filled. A file can have every field populated and still be
 * wrong — a transposed TIN, a bank account belonging to a previous employer —
 * and the only thing that makes it right is somebody having looked.
 */
export function EmployeeFilePanel({ employeeId }: { employeeId: number }) {
  const toast = useToast()
  const [file, setFile] = React.useState<OnboardingFile | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(() => {
    getEmployeeFile(employeeId)
      .then(setFile)
      .catch(() => setFile(null))
  }, [employeeId])

  React.useEffect(() => {
    load()
  }, [load])

  if (!file) return null

  const act = async (action: () => Promise<OnboardingFile>, title: string) => {
    setBusy(true)
    try {
      setFile(await action())
      void invalidateResource('hr/employees')
      toast({ tone: 'success', title })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not do that.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const done = file.completedAt !== null

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <Badge tone={STATUS_TONE[file.status] ?? 'neutral'}>{file.status}</Badge>
            {file.applicantCode && (
              <span className="text-[11px] text-ink-3">from application {file.applicantCode}</span>
            )}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{file.summary}</p>
        </div>

        {done ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => reopenEmployeeFile(file.id), 'File reopened')}>
            <RotateCcw className="size-3.5" />
            Reopen
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || file.blockedReason !== null}
            title={file.blockedReason ?? 'Confirm the 201 file is right'}
            onClick={() => void act(() => completeEmployeeFile(file.id), '201 file signed off')}
          >
            <ClipboardCheck className="size-3.5" />
            Mark reviewed
          </Button>
        )}
      </div>

      {file.missing.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {file.missing.map((gap) => (
            <li key={gap.key} className="flex items-start gap-2 text-[12px]">
              <span className={cn('w-24 shrink-0 text-[10px] tracking-wide uppercase', SEVERITY_TONE[gap.severity])}>
                {SEVERITY_LABEL[gap.severity]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{gap.label}</span>
                <span className="ml-1.5 text-ink-3">{gap.why}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {file.blockedReason && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-critical/10 p-2 text-[11px] leading-relaxed text-critical">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {file.blockedReason}
        </p>
      )}

      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-good">
          <CheckCircle2 className="size-3.5" />
          Reviewed {fmtDate(file.completedAt!.slice(0, 10))}
        </p>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * What the hire dialog shows the moment it has created somebody.
 *
 * The cheapest place to say any of this: whoever pressed Hire is certainly
 * looking at the screen right now. Everything else — the banner, the bell, the
 * badge on the row — exists because people are not always looking.
 */
export function NewHireGaps({ profile }: { profile: { status: string; summary: string; missing: ProfileGap[] } }) {
  if (profile.missing.length === 0) {
    return (
      <p className="flex items-start gap-2 rounded-lg bg-good/10 p-2.5 text-[12px] leading-relaxed text-good">
        <UserCheck className="mt-px size-4 shrink-0" />
        Their 201 file is complete — everything the application gave has been carried across.
      </p>
    )
  }

  const blocking = profile.missing.filter((g) => g.severity === 'blocking')

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2.5">
      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
        <TriangleAlert
          className={cn('mt-px size-4 shrink-0', blocking.length > 0 ? 'text-critical' : 'text-warning')}
        />
        <span>
          Everything the application could answer is already in their 201 file.{' '}
          <strong className="text-ink">
            {profile.missing.length} {profile.missing.length === 1 ? 'field' : 'fields'} only HR can supply
          </strong>{' '}
          {profile.missing.length === 1 ? 'is' : 'are'} still empty
          {blocking.length > 0 && ', and payroll will not run correctly until they are filled in'}.
        </span>
      </p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {profile.missing.map((gap) => (
          <li
            key={gap.key}
            title={gap.why}
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px]',
              gap.severity === 'blocking'
                ? 'bg-critical/10 text-critical'
                : gap.severity === 'statutory' || gap.severity === 'attendance'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-surface-3 text-ink-3',
            )}
          >
            {gap.label}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        You will find this record flagged in Employees until somebody fills those in and marks it reviewed. It
        is also in the bell at the top of the screen.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The new-hire checklist                                                      */
/* -------------------------------------------------------------------------- */

const CATEGORY_ORDER: OnboardingTaskItem['category'][] = ['Documentation', 'IT Access', 'Training', 'Compliance']

/**
 * Everything a new hire needs in their first month, generated once at hire
 * and ticked off here — the sibling of `EmployeeFilePanel` above, which
 * tracks the *data* on the 201 file rather than the *process* of settling
 * somebody in.
 */
export function OnboardingTaskPanel({ employeeId }: { employeeId: number }) {
  const toast = useToast()
  const [checklist, setChecklist] = React.useState<EmployeeOnboardingChecklist | null>(null)
  const [busy, setBusy] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    getOnboardingTasks(employeeId)
      .then(setChecklist)
      .catch(() => setChecklist(null))
  }, [employeeId])

  React.useEffect(() => {
    load()
  }, [load])

  if (!checklist || checklist.items.length === 0) return null

  const toggle = async (task: OnboardingTaskItem) => {
    setBusy(task.id)
    try {
      await (task.status === 'Done' ? reopenOnboardingTask(task.id) : completeOnboardingTask(task.id))
      load()
    } catch (error) {
      toast({ tone: 'error', title: 'Could not update that task.', description: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const { completion } = checklist
  const tone = completion.overdue > 0 ? 'critical' : completion.percent >= 100 ? 'good' : 'warning'

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <ListChecks className="size-4" />
          Onboarding checklist
        </p>
        <Badge tone={tone}>
          {completion.done}/{completion.total} done
          {completion.overdue > 0 && ` · ${completion.overdue} overdue`}
        </Badge>
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full', tone === 'good' ? 'bg-good' : tone === 'critical' ? 'bg-critical' : 'bg-warning')}
          style={{ width: `${completion.percent}%` }}
        />
      </div>

      <div className="mt-3 space-y-3">
        {CATEGORY_ORDER.map((category) => {
          const items = checklist.items.filter((t) => t.category === category)
          if (items.length === 0) return null

          return (
            <div key={category}>
              <p className="mb-1 text-[10px] font-medium tracking-wide text-ink-3 uppercase">{category}</p>
              <div className="space-y-1">
                {items.map((task) => {
                  const overdue = task.status === 'Pending' && task.due_date && new Date(task.due_date) < new Date(new Date().toDateString())

                  return (
                    <button
                      key={task.id}
                      disabled={busy === task.id}
                      onClick={() => void toggle(task)}
                      className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
                    >
                      {task.status === 'Done' ? (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
                      ) : (
                        <Circle className={cn('mt-0.5 size-4 shrink-0', overdue ? 'text-critical' : 'text-ink-3')} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block text-[12px] font-medium',
                            task.status === 'Done' ? 'text-ink-3 line-through' : 'text-ink',
                          )}
                        >
                          {task.title}
                        </span>
                        {task.status === 'Pending' && task.due_date && (
                          <span className={cn('text-[10px]', overdue ? 'text-critical' : 'text-ink-3')}>
                            {overdue ? 'Overdue since' : 'Due'} {fmtDate(task.due_date)}
                          </span>
                        )}
                        {task.status === 'Done' && task.completedBy && (
                          <span className="text-[10px] text-ink-3">Done by {task.completedBy.name}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
