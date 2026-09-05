import * as React from 'react'
import {
  Award,
  CalendarPlus,
  Check,
  ChevronLeft,
  GraduationCap,
  MapPin,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import {
  completeTrainingSession,
  createTrainingSession,
  enrolInTraining,
  getTrainingSession,
  listTrainingSessions,
  liveApi,
  markTrainingAttendance,
  removeTrainingAttendee,
  reopenTrainingSession,
  type TrainingAttendeeStatus,
  type TrainingSession,
} from '@/lib/adminApi'
import { fmtDate } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Combobox, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'

/**
 * Training as a thing that happens on a date.
 *
 * The flow the module exists for, in the order somebody actually does it:
 * schedule a run, put people on the roster, mark who turned up on the day,
 * then close it — which issues the certificates.
 *
 * Nothing here writes a certificate by hand. Certification follows from
 * attendance, so the register and the room agree by construction.
 */

const STATUS_TONE: Record<TrainingSession['status'], 'neutral' | 'info' | 'good' | 'critical'> = {
  Scheduled: 'neutral',
  Ongoing: 'info',
  Completed: 'good',
  Cancelled: 'critical',
}

const ATTENDANCE_TONE: Record<TrainingAttendeeStatus, 'neutral' | 'good' | 'critical' | 'warning'> = {
  Enrolled: 'neutral',
  Attended: 'good',
  Absent: 'critical',
  Excused: 'warning',
}

/* -------------------------------------------------------------------------- */
/* Schedule a session                                                          */
/* -------------------------------------------------------------------------- */

function NewSession({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (session: TrainingSession) => void
}) {
  const toast = useToast()
  const { data: courses = [] } = useResource<Record<string, unknown>[]>('hr/training-courses', () => [])
  const { data: employees = [] } = useResource<Record<string, unknown>[]>('hr/employees', () => [])

  const [courseId, setCourseId] = React.useState<number | null>(null)
  const [title, setTitle] = React.useState('')
  const [scheduledOn, setScheduledOn] = React.useState('')
  const [endsOn, setEndsOn] = React.useState('')
  const [venue, setVenue] = React.useState('')
  const [trainer, setTrainer] = React.useState('')
  const [capacity, setCapacity] = React.useState('')
  const [passingScore, setPassingScore] = React.useState('')
  const [picked, setPicked] = React.useState<number[]>([])
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCourseId(null)
    setTitle('')
    setScheduledOn('')
    setEndsOn('')
    setVenue('')
    setTrainer('')
    setCapacity('')
    setPassingScore('')
    setPicked([])
  }, [open])

  const course = courses.find((c) => Number(c.id) === courseId)

  const submit = async () => {
    if (!courseId || !scheduledOn) return

    setBusy(true)
    try {
      onCreated(
        await createTrainingSession({
          trainingCourseId: courseId,
          ...(title.trim() ? { title: title.trim() } : {}),
          scheduledOn,
          ...(endsOn ? { endsOn } : {}),
          ...(venue.trim() ? { venue: venue.trim() } : {}),
          ...(trainer.trim() ? { trainer: trainer.trim() } : {}),
          ...(capacity ? { capacity: Number(capacity) } : {}),
          ...(passingScore ? { passingScore: Number(passingScore) } : {}),
          ...(picked.length ? { employeeIds: picked } : {}),
        }),
      )
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not schedule that.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule a training"
      description="Pick the course, set the date, and put the people on the roster."
      size="lg"
      dirty={Boolean(courseId || scheduledOn || picked.length)}
      footer={
        <>
          <span className="mr-auto text-[11px] text-ink-3">
            {!courseId ? 'Choose a course.' : !scheduledOn ? 'Set the date.' : `${picked.length} on the roster`}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!courseId || !scheduledOn || busy} loading={busy}>
            Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course" required composite className="sm:col-span-2">
            <Combobox
              value={courseId}
              options={courses.map((c) => ({
                value: Number(c.id),
                label: String(c.name ?? ''),
                sublabel: c.validityMonths ? `valid ${c.validityMonths} months` : 'no expiry',
              }))}
              onChange={(v) => setCourseId(v === null ? null : Number(v))}
              placeholder={courses.length ? 'Choose a course…' : 'No courses yet — create one first'}
              emptyLabel="No courses have been set up"
            />
          </Field>

          <Field
            label="Session title"
            hint="Optional — defaults to the course name. Useful when a course runs in batches."
            className="sm:col-span-2"
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={course ? `${course.name} — Batch 1` : ''} />
          </Field>

          <Field label="Date" required>
            <Input type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
          </Field>
          <Field label="Ends" hint="Leave blank for a one-day session.">
            <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} min={scheduledOn} />
          </Field>

          <Field label="Venue">
            <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Training Room A, Head Office" />
          </Field>
          <Field label="Trainer">
            <Input value={trainer} onChange={(e) => setTrainer(e.target.value)} placeholder="Engr. R. Bautista" />
          </Field>

          <Field label="Room capacity" hint="Blank for no limit.">
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="tabular text-right" />
          </Field>
          <Field
            label="Passing score"
            hint="Blank if attendance alone certifies. Otherwise nobody below this gets a certificate."
          >
            <Input
              type="number"
              min={0}
              max={100}
              value={passingScore}
              onChange={(e) => setPassingScore(e.target.value)}
              className="tabular text-right"
            />
          </Field>
        </div>

        <Field label={`Roster${picked.length ? ` · ${picked.length}` : ''}`} composite>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-line">
            {employees.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-ink-3">No employees on file.</p>
            ) : (
              <ul>
                {employees.map((e) => {
                  const id = Number(e.id)
                  const on = picked.includes(id)
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setPicked((p) => (on ? p.filter((x) => x !== id) : [...p, id]))}
                        className={cn(
                          'flex w-full items-center gap-2.5 border-b border-line px-3 py-1.5 text-left transition-colors last:border-b-0',
                          on ? 'bg-brand-50 dark:bg-brand-950' : 'hover:bg-surface-3',
                        )}
                        aria-pressed={on}
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded border',
                            on ? 'grad-brand border-transparent text-white' : 'border-line-strong',
                          )}
                        >
                          {on && <Check className="size-2.5" strokeWidth={3.5} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{String(e.fullName ?? e.name ?? '')}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{String(e.employeeNo ?? '')}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* One session: the roster and the day                                         */
/* -------------------------------------------------------------------------- */

function SessionDetail({ session, onBack, onChanged }: { session: TrainingSession; onBack: () => void; onChanged: (s: TrainingSession) => void }) {
  const toast = useToast()
  const { data: employees = [] } = useResource<Record<string, unknown>[]>('hr/employees', () => [])
  const [adding, setAdding] = React.useState(false)
  const [pick, setPick] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)

  const roster = session.roster ?? []
  const locked = session.status === 'Completed'
  const onRoster = new Set(roster.map((r) => r.employeeId))

  const mark = async (employeeId: number, status: TrainingAttendeeStatus, score?: number | null) => {
    try {
      const { session: next } = await markTrainingAttendance(session.id, [{ employeeId, status, score }])
      onChanged(next)
    } catch (err) {
      toast({ tone: 'error', title: 'Could not record that.', description: (err as Error).message })
    }
  }

  const add = async () => {
    if (!pick) return
    try {
      const { session: next } = await enrolInTraining(session.id, [pick])
      onChanged(next)
      setPick(null)
      setAdding(false)
    } catch (err) {
      toast({ tone: 'error', title: 'Could not enrol them.', description: (err as Error).message })
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      const result = await completeTrainingSession(session.id)
      onChanged(result.session)
      toast({
        tone: 'success',
        title: `${result.issued} ${result.issued === 1 ? 'certificate' : 'certificates'} issued`,
        description: result.skipped
          ? `${result.skipped} skipped — absent, or below the passing score.`
          : undefined,
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not close the session.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const reopen = async () => {
    try {
      onChanged(await reopenTrainingSession(session.id))
      toast({ tone: 'info', title: 'Session reopened', description: 'Certificates already issued stay valid.' })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not reopen.', description: (err as Error).message })
    }
  }

  const attended = roster.filter((r) => r.status === 'Attended').length

  return (
    <>
      <PageHeader
        title={session.title}
        description={`${session.sessionNo} · ${session.course ?? ''}`}
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              <ChevronLeft className="size-4" />
              All sessions
            </Button>
            {locked ? (
              <Button variant="secondary" onClick={() => void reopen()}>
                Reopen
              </Button>
            ) : (
              <Button onClick={() => void finish()} disabled={!attended || busy} loading={busy}>
                <Award className="size-4" />
                Close &amp; issue certificates
              </Button>
            )}
          </>
        }
        meta={
          <>
            <Badge tone={STATUS_TONE[session.status]}>{session.status}</Badge>
            {session.scheduledOn && (
              <span className="text-[11px] text-ink-3">
                {fmtDate(session.scheduledOn)}
                {session.endsOn && session.endsOn !== session.scheduledOn && ` – ${fmtDate(session.endsOn)}`}
              </span>
            )}
            {session.venue && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                <MapPin className="size-3" />
                {session.venue}
              </span>
            )}
            {session.trainer && <span className="text-[11px] text-ink-3">Trainer: {session.trainer}</span>}
            {session.passingScore !== null && (
              <Badge tone="info">Pass mark {session.passingScore}</Badge>
            )}
            {session.validityMonths && <Badge tone="neutral">Valid {session.validityMonths} months</Badge>}
          </>
        }
      />

      {locked && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-good/10 p-3 text-[12px] text-good">
          <Check className="size-4 shrink-0" />
          Certificates have been issued. Reopen the session to correct attendance — existing certificate numbers
          are kept.
        </p>
      )}

      <div className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-[13px] font-medium text-ink">
            Roster
            <span className="ml-1.5 font-normal text-ink-3">
              {roster.length} enrolled · {attended} attended
              {session.capacity ? ` · room fits ${session.capacity}` : ''}
            </span>
          </p>
          {!locked && (
            <Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)}>
              <UserPlus className="size-3.5" />
              {adding ? 'Done' : 'Add someone'}
            </Button>
          )}
        </div>

        {adding && (
          <div className="flex items-end gap-2 border-b border-line bg-surface-2 p-3">
            <Field label="Employee" composite className="flex-1">
              <Combobox
                value={pick}
                options={employees
                  .filter((e) => !onRoster.has(Number(e.id)))
                  .map((e) => ({
                    value: Number(e.id),
                    label: String(e.fullName ?? e.name ?? ''),
                    sublabel: String(e.employeeNo ?? ''),
                  }))}
                onChange={(v) => setPick(v === null ? null : Number(v))}
                placeholder="Search by name or number…"
              />
            </Field>
            <Button onClick={() => void add()} disabled={!pick}>
              Enrol
            </Button>
          </div>
        )}

        {roster.length === 0 ? (
          <EmptyState icon={Users} title="Nobody on the roster yet" description="Add the people who are meant to attend." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-left">Attendance</th>
                  {session.passingScore !== null && <th className="px-3 py-2 text-right">Score</th>}
                  <th className="px-3 py-2 text-left">Certificate</th>
                  {!locked && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => {
                  const failed =
                    session.passingScore !== null && r.score !== null && r.score < session.passingScore

                  return (
                    <tr key={r.employeeId} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <p className="text-[13px] text-ink">{r.name}</p>
                        <p className="text-[11px] text-ink-3">
                          {r.employeeNo}
                          {r.department && ` · ${r.department}`}
                        </p>
                      </td>

                      <td className="px-3 py-2">
                        {locked ? (
                          <Badge tone={ATTENDANCE_TONE[r.status]}>{r.status}</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(['Attended', 'Absent', 'Excused'] as const).map((s) => (
                              <button
                                key={s}
                                onClick={() => void mark(r.employeeId, s, r.score)}
                                className={cn(
                                  'rounded-md border px-2 py-1 text-[11px] transition-colors',
                                  r.status === s
                                    ? 'border-brand-400 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                                    : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2',
                                )}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>

                      {session.passingScore !== null && (
                        <td className="px-3 py-2 text-right">
                          {locked ? (
                            <span className={cn('tabular text-[13px]', failed && 'text-critical')}>{r.score ?? '—'}</span>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              defaultValue={r.score ?? ''}
                              onBlur={(e) =>
                                void mark(r.employeeId, r.status, e.target.value === '' ? null : Number(e.target.value))
                              }
                              className={cn('tabular h-8 w-20 text-right text-[13px]', failed && 'border-critical')}
                            />
                          )}
                        </td>
                      )}

                      <td className="px-3 py-2">
                        {r.certificateNo ? (
                          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-good">
                            <Award className="size-3.5" />
                            {r.certificateNo}
                          </span>
                        ) : (
                          <span className="text-[11px] text-ink-3">
                            {r.status === 'Attended'
                              ? failed
                                ? 'Below pass mark'
                                : 'On closing'
                              : '—'}
                          </span>
                        )}
                      </td>

                      {!locked && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${r.name}`}
                            onClick={async () => {
                              try {
                                onChanged(await removeTrainingAttendee(session.id, r.employeeId))
                              } catch (err) {
                                toast({ tone: 'error', title: 'Could not remove them.', description: (err as Error).message })
                              }
                            }}
                          >
                            <Trash2 className="size-3.5 text-critical" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!locked && attended > 0 && (
        <p className="mt-3 text-[11px] text-ink-3">
          Closing the session issues a certificate to each of the {attended} marked Attended
          {session.passingScore !== null && ` who scored ${session.passingScore} or above`}, dated{' '}
          {fmtDate(session.endsOn ?? session.scheduledOn ?? '')}
          {session.validityMonths ? ` and valid for ${session.validityMonths} months.` : '.'}
        </p>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

export function TrainingSessions() {
  const toast = useToast()
  const [sessions, setSessions] = React.useState<TrainingSession[]>([])
  const [open, setOpen] = React.useState<TrainingSession | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    try {
      setSessions(await listTrainingSessions())
    } catch (err) {
      toast({ tone: 'error', title: 'Could not load sessions.', description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [toast])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const openSession = async (id: number) => {
    try {
      setOpen(await getTrainingSession(id))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not open that session.', description: (err as Error).message })
    }
  }

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Training & Certifications" description="Schedule a training, mark the room, issue the certificates." />
        <div className="card">
          <EmptyState
            icon={GraduationCap}
            title="Training needs the live API"
            description="Sessions and certificates are written straight to the database."
          />
        </div>
      </>
    )
  }

  if (open) {
    return (
      <SessionDetail
        session={open}
        onBack={() => {
          setOpen(null)
          void refresh()
        }}
        onChanged={(s) => setOpen(s)}
      />
    )
  }

  return (
    <>
      <PageHeader
        title="Training & Certifications"
        description="Schedule a run of a course, mark who turned up, and close it — certificates follow from the attendance."
        actions={
          <Button onClick={() => setCreating(true)}>
            <CalendarPlus className="size-4" />
            Schedule a training
          </Button>
        }
      />

      {loading ? (
        <div className="card h-48 shimmer" />
      ) : sessions.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={GraduationCap}
            title="No training scheduled"
            description="Schedule a run of a course, put people on the roster, and mark attendance on the day."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <CalendarPlus className="size-3.5" />
                Schedule a training
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => void openSession(s.id)}
              className="card p-4 text-left transition-colors hover:border-brand-300"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">{s.title}</p>
                <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-3">{s.sessionNo}</p>

              <div className="mt-2 space-y-0.5 text-[12px] text-ink-2">
                {s.scheduledOn && <p>{fmtDate(s.scheduledOn)}{s.endsOn && s.endsOn !== s.scheduledOn && ` – ${fmtDate(s.endsOn)}`}</p>}
                {s.venue && <p className="text-ink-3">{s.venue}</p>}
              </div>

              <div className="mt-3 flex items-center gap-3 border-t border-line pt-2 text-[11px] text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />
                  {s.enrolled} enrolled
                </span>
                {s.attended > 0 && (
                  <span className="inline-flex items-center gap-1 text-good">
                    <Check className="size-3" />
                    {s.attended} attended
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <NewSession
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(s) => {
          void refresh()
          setOpen(s)
        }}
      />
    </>
  )
}
