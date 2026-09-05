import * as React from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileSignature,
  MapPin,
  Phone,
  Repeat,
  User,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateTime, num } from '@/lib/format'
import { priorityOf } from '@/data/afterSales'
import {
  VISIT_STATUSES,
  dateKey,
  formatClock,
  slaState,
  slotsForDay,
  windowsFor,
  type Visit,
  type VisitStatus,
} from '@/data/scheduling'
import { VISIT_OUTCOMES, isFirstTimeFix } from '@/data/serviceQuality'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { VISIT_TONE, useSchedule } from './schedule'
import { Scheduler } from './Scheduler'

/**
 * The schedule board.
 *
 * A week at a time, one column per day, one lane per technician — because the
 * question a dispatcher asks is never "what is booked" but "who is free on
 * Thursday". Visits are grouped under the person who has to drive there.
 */

const addDays = (date: Date, days: number) => {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function VisitCard({ visit, onOpen }: { visit: Visit; onOpen: () => void }) {
  const priority = priorityOf(visit.priority)
  const start = new Date(visit.start)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'w-full rounded-lg border p-2 text-left transition-all hover:shadow-sm',
        visit.status === 'Cancelled' || visit.status === 'No show'
          ? 'border-line bg-surface-2 opacity-60'
          : 'border-line bg-surface hover:border-brand-300',
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="tabular text-[11px] font-semibold text-ink">
          {formatClock(start.getHours() * 60 + start.getMinutes())}
        </span>
        {priority && priority.level <= 2 && (
          <span
            className={cn('size-1.5 rounded-full', priority.level === 1 ? 'bg-critical' : 'bg-serious')}
            aria-label={priority.label}
          />
        )}
        {visit.reportId && <FileSignature className="size-3 text-good" aria-label="Report written" />}
      </span>
      <span className="mt-0.5 block truncate text-[12px] font-medium text-ink">{visit.client || 'Unnamed'}</span>
      <span className="block truncate text-[10px] text-ink-3">{visit.equipment}</span>
    </button>
  )
}

/* -------------------------------------------------------------------------- */

function VisitDetail({ visit, onClose }: { visit: Visit | null; onClose: () => void }) {
  const toast = useToast()
  const technicians = useSchedule((s) => s.technicians)
  const availability = useSchedule((s) => s.availability)
  const visits = useSchedule((s) => s.visits)
  const setVisitStatus = useSchedule((s) => s.setVisitStatus)
  const reschedule = useSchedule((s) => s.reschedule)
  const recordOutcome = useSchedule((s) => s.recordOutcome)
  const recordResponse = useSchedule((s) => s.recordResponse)

  const [moving, setMoving] = React.useState(false)
  const [returning, setReturning] = React.useState(false)
  const [day, setDay] = React.useState('')
  const [slotStart, setSlotStart] = React.useState('')
  const [technicianId, setTechnicianId] = React.useState('')

  React.useEffect(() => {
    if (!visit) return
    setMoving(false)
    setReturning(false)
    setDay(dateKey(new Date(visit.start)))
    setTechnicianId(visit.technicianId)
    setSlotStart('')
  }, [visit])

  if (!visit) return null

  const priority = priorityOf(visit.priority)
  const sla = slaState(visit, availability)
  // The visit being moved must not count as a clash with itself.
  const slots = day
    ? slotsForDay(day, technicians, availability, visits, { ignoreVisitId: visit.id })
    : []

  const move = () => {
    const slot = slots.find((s) => s.start === slotStart)
    if (!slot) return
    const end = slot.end
    const result = reschedule(visit.id, technicianId || slot.free[0]!.id, slot.start, end)
    if (!result.ok) {
      toast({ tone: 'error', title: 'Could not move it', description: result.reason })
      return
    }
    toast({ tone: 'success', title: `${visit.id} moved`, description: `Now with ${result.visit.technicianName}.` })
    setMoving(false)
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${visit.id} · ${visit.client || 'Unnamed client'}`}
      description={`${visit.equipment} · ${new Date(visit.start).toLocaleString('en-PH', { dateStyle: 'full', timeStyle: 'short' })}`}
      headerAside={<Badge tone={VISIT_TONE[visit.status]} dot>{visit.status}</Badge>}
      footer={
        <>
          <Select
            value={visit.status}
            onChange={(e) => setVisitStatus(visit.id, e.target.value as VisitStatus)}
            className="mr-auto h-8 w-auto text-[13px]"
          >
            {VISIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={() => setMoving((v) => !v)}>
            <Repeat className="size-3.5" />
            {moving ? 'Keep as is' : 'Reschedule'}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {[
            ['Technician', visit.technicianName],
            ['Ticket', visit.ticket || 'Booked without a ticket'],
            ['Priority', priority ? `${priority.label} — ${priority.summary}` : 'Not stated'],
            ['Account', visit.clientType],
            ['Contact', [visit.contact, visit.phone].filter(Boolean).join(' · ') || '—'],
            ['Booked via', visit.source],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
              <dd className="mt-0.5 text-[13px] text-ink">{value}</dd>
            </div>
          ))}
          <div className="col-span-full">
            <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Address</dt>
            <dd className="mt-0.5 flex items-start gap-1.5 text-[13px] text-ink">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              {visit.address || '—'}
            </dd>
          </div>
          <div className="col-span-full">
            <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Reported fault</dt>
            <dd className="mt-0.5 text-[13px] text-ink">{visit.issue || '—'}</dd>
          </div>
        </dl>

        {/*
            How the visit ended, and the clock it was measured against.

            This is the block that makes first-time fix computable. It is a
            dispatcher-side control rather than a report field alone, because
            the outcome is known the moment the technician rings in — hours
            before the paperwork — and a metric that waits for paperwork is a
            metric that is always a week stale.
        */}
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[12px] font-semibold text-ink">How did it end?</p>
            {sla && (
              <Badge tone={sla.met === true ? 'good' : sla.breached ? 'critical' : sla.atRisk ? 'warning' : 'info'} dot>
                {sla.met === true
                  ? 'Responded in time'
                  : sla.breached
                    ? `SLA missed by ${num(Math.abs(sla.minutesLeft) / 60, 1)} h`
                    : `${num(sla.minutesLeft / 60, 1)} h left to respond`}
              </Badge>
            )}
            {!visit.respondedAt && visit.respondBy && (
              <Button variant="secondary" size="xs" onClick={() => recordResponse(visit.id)}>
                Mark contacted
              </Button>
            )}
          </div>

          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {VISIT_OUTCOMES.map((outcome) => {
              const on = visit.outcome === outcome.code
              return (
                <button
                  key={outcome.code}
                  type="button"
                  onClick={() => recordOutcome(visit.id, outcome.code)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors',
                    on ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-950' : 'border-line bg-surface text-ink-2 hover:border-brand-300',
                  )}
                >
                  {outcome.code}
                </button>
              )
            })}
          </div>

          {/* A return visit booked from the one that failed, carrying the link
              that lets the rework rate be counted at all. */}
          {visit.outcome && !isFirstTimeFix(visit.outcome) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <p className="min-w-0 flex-1 text-[11px] text-ink-3">
                This one did not finish the job. Book the return from here so it is counted as rework rather than as
                fresh work.
              </p>
              <Button variant="primary" size="xs" onClick={() => setReturning(true)}>
                <Repeat className="size-3" />
                Book the return
              </Button>
            </div>
          )}

          {visit.backJobOf && (
            <p className="mt-2 text-[11px] text-warning">
              This is a return visit for {visit.backJobOf}.
            </p>
          )}
        </div>

        {/* The audit trail. Every state change with a time against it, which is
            what turns a dispute about "when did you actually get there" into a
            lookup. */}
        {visit.timeline?.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">What happened</p>
            <ol className="space-y-1">
              {visit.timeline.map((entry, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="tabular shrink-0 text-[11px] text-ink-3">{fmtDateTime(entry.at)}</span>
                  <span className="text-ink-2">
                    {entry.label}
                    {entry.detail && <span className="text-ink-3"> — {entry.detail}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {returning && (
          <div className="animate-in rounded-xl border border-warning/50 p-3">
            <p className="mb-2 text-[12px] text-ink-2">
              The client, site, equipment and fault carry over. Only the time needs choosing.
            </p>
            <Scheduler
              mode="dispatch"
              prefill={{
                ticket: visit.ticket,
                client: visit.client,
                address: visit.address,
                clientType: visit.clientType,
                contact: visit.contact,
                phone: visit.phone,
                email: visit.email,
                equipment: visit.equipment,
                issue: visit.issue,
                priority: visit.priority,
                backJobOf: visit.id,
              }}
              onBooked={(id) => {
                setReturning(false)
                toast({
                  tone: 'success',
                  title: `Return visit ${id} booked`,
                  description: 'It is linked to this one, so it counts against the first-time fix rate.',
                })
              }}
            />
          </div>
        )}

        {moving && (
          <div className="animate-in space-y-3 rounded-xl border border-brand-300 p-3">
            <p className="text-[12px] text-ink-2">
              Only slots that leave enough travel time are offered, and this visit does not block itself.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Day</span>
                <input
                  type="date"
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value)
                    setSlotStart('')
                  }}
                  className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Time</span>
                <Select
                  value={slotStart}
                  onChange={(e) => {
                    setSlotStart(e.target.value)
                    const slot = slots.find((s) => s.start === e.target.value)
                    if (slot && !slot.free.some((t) => t.id === technicianId)) {
                      setTechnicianId(slot.free[0]?.id ?? '')
                    }
                  }}
                >
                  <option value="">
                    {slots.length ? `${slots.length} slot${slots.length === 1 ? '' : 's'} open` : 'Nothing open'}
                  </option>
                  {slots.map((s) => (
                    <option key={s.start} value={s.start}>
                      {formatClock(s.minutes)} — {s.free.length} free
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            {slotStart && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Technician
                </span>
                <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                  {slots
                    .find((s) => s.start === slotStart)
                    ?.free.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </Select>
              </label>
            )}

            <Button variant="primary" size="sm" disabled={!slotStart} onClick={move}>
              Move this visit
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */

export function ScheduleBoard() {
  const availability = useSchedule((s) => s.availability)
  const technicians = useSchedule((s) => s.technicians)
  const visits = useSchedule((s) => s.visits)

  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date()))
  const [opened, setOpened] = React.useState<string | null>(null)
  const [booking, setBooking] = React.useState(false)

  const days = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const today = dateKey(new Date())

  const live = visits.filter((v) => v.status !== 'Cancelled' && v.status !== 'No show')
  const thisWeek = live.filter((v) => {
    const key = dateKey(new Date(v.start))
    return days.some((d) => dateKey(d) === key)
  })

  const unreported = live.filter((v) => v.status === 'Completed' && !v.reportId)

  return (
    <div>
      <PageHeader
        title="Service Schedule"
        description="A week of visits, grouped by the person who has to drive there. Move one and the travel buffer is re-checked before it lands."
        meta={
          <>
            <Badge tone="neutral">{num(thisWeek.length)} this week</Badge>
            {unreported.length > 0 && (
              <Badge tone="warning" dot>
                {num(unreported.length)} done without a report
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => window.open('/book/service', '_blank', 'noopener')}>
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Client booking page</span>
            </Button>
            <Button variant="primary" size="sm" onClick={() => setBooking(true)}>
              <CalendarDays className="size-3.5" />
              Book a visit
            </Button>
          </>
        }
      />

      <StatGrid className="mb-4">
        <StatTile label="Booked this week" value={num(thisWeek.length)} icon={CalendarDays} />
        <StatTile
          label="Awaiting a report"
          value={num(unreported.length)}
          icon={FileSignature}
          hint="Completed visits with no TSR yet"
        />
        <StatTile
          label="From the client page"
          value={num(live.filter((v) => v.source === 'Client booking').length)}
          icon={User}
          hint="Booked without anybody answering a phone"
        />
        <StatTile
          label="Open slots today"
          value={num(slotsForDay(today, technicians, availability, visits).length)}
          icon={ClipboardList}
          hint="Still bookable for the rest of today"
        />
      </StatGrid>

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 p-3" data-print="hide">
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="icon-sm" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            This week
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <p className="text-[13px] font-medium text-ink">
          {weekStart.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })} —{' '}
          {addDays(weekStart, 6).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </Card>

      {technicians.length === 0 ? (
        <Card>
          <EmptyState
            icon={User}
            title="No technicians on the roster"
            description="Add them under Availability & Roster, then visits can be booked against them."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[62rem]">
              {/* Day header */}
              <div className="grid grid-cols-[10rem_repeat(7,minmax(0,1fr))] border-b border-line bg-surface-2">
                <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
                  Technician
                </div>
                {days.map((date) => {
                  const key = dateKey(date)
                  const closed = (availability.week[date.getDay()] ?? []).length === 0 || availability.blackouts.includes(key)
                  return (
                    <div
                      key={key}
                      className={cn(
                        'px-2 py-2 text-center',
                        key === today && 'bg-brand-50 dark:bg-brand-950',
                        closed && 'opacity-50',
                      )}
                    >
                      <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
                        {date.toLocaleDateString('en-PH', { weekday: 'short' })}
                      </p>
                      <p className={cn('text-[13px] font-semibold', key === today ? 'text-brand-600 dark:text-brand-400' : 'text-ink')}>
                        {date.getDate()}
                      </p>
                      {closed && <p className="text-[9px] text-ink-3">closed</p>}
                    </div>
                  )
                })}
              </div>

              {/* One lane per technician */}
              {technicians.map((technician) => (
                <div
                  key={technician.id}
                  className="grid grid-cols-[10rem_repeat(7,minmax(0,1fr))] border-b border-line last:border-0"
                >
                  <div className="border-r border-line px-3 py-2">
                    <p className="truncate text-[13px] font-medium text-ink">{technician.name}</p>
                    <p className="text-[10px] text-ink-3">
                      {technician.active ? `max ${technician.maxPerDay}/day` : 'off duty'}
                    </p>
                  </div>

                  {days.map((date) => {
                    const key = dateKey(date)
                    const mine = live
                      .filter((v) => v.technicianId === technician.id && dateKey(new Date(v.start)) === key)
                      .sort((a, b) => a.start.localeCompare(b.start))
                    const working = windowsFor(technician, availability, key).length > 0

                    return (
                      <div
                        key={key}
                        className={cn(
                          'min-h-[4.5rem] space-y-1 border-r border-line/60 p-1.5 last:border-0',
                          !working && 'bg-surface-2',
                          key === today && 'bg-brand-50/40 dark:bg-brand-950/40',
                        )}
                      >
                        {mine.map((visit) => (
                          <VisitCard key={visit.id} visit={visit} onOpen={() => setOpened(visit.id)} />
                        ))}
                        {!working && mine.length === 0 && (
                          <p className="pt-4 text-center text-[10px] text-ink-3">—</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Today's run sheet, for the person doing the ringing round. */}
      {thisWeek.length > 0 && (
        <Card className="mt-4">
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
            <h3 className="text-[15px] font-semibold text-ink">This week's calls</h3>
            <Badge tone="neutral">{num(thisWeek.length)}</Badge>
          </div>
          <div className="divide-y divide-line border-t border-line">
            {thisWeek
              .sort((a, b) => a.start.localeCompare(b.start))
              .map((visit) => (
                <button
                  key={visit.id}
                  type="button"
                  onClick={() => setOpened(visit.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-left hover:bg-surface-2 sm:px-5"
                >
                  <span className="tabular w-32 shrink-0 text-[12px] text-ink-2">
                    {new Date(visit.start).toLocaleString('en-PH', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{visit.client}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {visit.equipment} · {visit.address || 'no address'}
                    </span>
                  </span>
                  <Badge tone={VISIT_TONE[visit.status]}>{visit.status}</Badge>
                  <span className="flex items-center gap-1 text-[11px] text-ink-3">
                    <User className="size-3" />
                    {visit.technicianName}
                  </span>
                  {visit.phone && (
                    <span className="flex items-center gap-1 text-[11px] text-ink-3">
                      <Phone className="size-3" />
                      {visit.phone}
                    </span>
                  )}
                </button>
              ))}
          </div>
        </Card>
      )}

      <VisitDetail visit={visits.find((v) => v.id === opened) ?? null} onClose={() => setOpened(null)} />

      <Modal
        open={booking}
        onClose={() => setBooking(false)}
        size="2xl"
        title="Book a visit"
        description="Same rules as the client page — nothing that would double-book anyone is offered."
        footer={
          <Button variant="secondary" size="sm" onClick={() => setBooking(false)}>
            Close
          </Button>
        }
      >
        <Scheduler mode="dispatch" onBooked={() => setBooking(false)} />
      </Modal>
    </div>
  )
}
