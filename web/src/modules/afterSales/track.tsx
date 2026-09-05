import * as React from 'react'
import {
  CalendarClock,
  Check,
  CircleDot,
  Clock,
  MapPin,
  Search,
  ShieldCheck,
  Star,
  Wrench,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { priorityOf } from '@/data/afterSales'
import { CSAT_SCALE } from '@/data/serviceQuality'
import { dateKey, formatClock, slotsForDay, type Visit } from '@/data/scheduling'
import { Badge, Button, Input, Textarea } from '@/components/ui/primitives'
import { VISIT_TONE, useSchedule } from './schedule'

/**
 * The client's side of a booking, after it is made.
 *
 * The confirmation screen used to end with "reply to the confirmation email
 * quoting your reference", which puts every change of plan through a person.
 * That person is the same person dispatching, and a reschedule that costs a
 * phone call and a wait is a reschedule that arrives as a no-show instead.
 *
 * Three things a client can now do without ringing anybody: see where their
 * visit stands, move it while there is still time to move it, and say how it
 * went. The third is not a courtesy — an after-sales business with no
 * satisfaction measurement is guessing at the one thing its clients actually
 * renew on.
 *
 * The code alone is enough to look a visit up, and that is a deliberate
 * trade-off: a six-character code is guessable in a way a real account is not.
 * It is acceptable here because the code reveals an appointment, not money or
 * identity, and because the alternative — an account per branch manager — is
 * the reason nobody would use it. When this moves behind the API, pair the
 * code with the last four digits of the contact number.
 */

const longWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

const JOURNEY = ['Scheduled', 'En route', 'On site', 'Completed'] as const

function Journey({ visit }: { visit: Visit }) {
  const reached = JOURNEY.indexOf(visit.status as (typeof JOURNEY)[number])

  if (visit.status === 'Cancelled' || visit.status === 'No show') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
        <X className="size-4 text-ink-3" />
        <span className="text-[13px] text-ink-2">This visit was {visit.status.toLowerCase()}.</span>
      </div>
    )
  }

  return (
    <ol className="flex items-center gap-1">
      {JOURNEY.map((stage, i) => {
        const done = i <= reached
        return (
          <li key={stage} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="flex w-full items-center">
              <span className={cn('h-0.5 flex-1', i === 0 ? 'bg-transparent' : done ? 'bg-brand-500' : 'bg-line')} />
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  done ? 'border-brand-500 bg-brand-500 text-white' : 'border-line bg-surface text-ink-3',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : <CircleDot className="size-2.5" />}
              </span>
              <span
                className={cn(
                  'h-0.5 flex-1',
                  i === JOURNEY.length - 1 ? 'bg-transparent' : i < reached ? 'bg-brand-500' : 'bg-line',
                )}
              />
            </span>
            <span className={cn('truncate text-[10px] font-medium', done ? 'text-ink' : 'text-ink-3')}>{stage}</span>
          </li>
        )
      })}
    </ol>
  )
}

/* -------------------------------------------------------------------------- */
/* Rating                                                                     */
/* -------------------------------------------------------------------------- */

function RateVisit({ visit }: { visit: Visit }) {
  const recordCsat = useSchedule((s) => s.recordCsat)
  const [score, setScore] = React.useState<number | null>(null)
  const [comment, setComment] = React.useState('')

  if (visit.csat != null) {
    return (
      <div className="rounded-xl border border-good/40 bg-good/5 p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          <Star className="size-4 text-good" />
          You rated this visit {visit.csat} of 5. Thank you.
        </p>
        {visit.csatComment && <p className="mt-1 text-[12px] text-ink-2">“{visit.csatComment}”</p>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <p className="text-[13px] font-semibold text-ink">How did the visit go?</p>
      <p className="mt-0.5 text-[11px] text-ink-3">
        One tap. It goes to the service supervisor, not to a survey company.
      </p>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {CSAT_SCALE.map((option) => (
          <button
            key={option.score}
            type="button"
            onClick={() => setScore(option.score)}
            aria-pressed={score === option.score}
            className={cn(
              'rounded-lg border px-1 py-2 text-center transition-all',
              score === option.score
                ? 'border-brand-500 bg-brand-50 shadow-sm dark:bg-brand-950'
                : 'border-line bg-surface hover:border-brand-300',
            )}
          >
            <span className="block text-[15px] font-semibold text-ink">{option.score}</span>
            <span className="mt-0.5 block text-[9px] leading-tight text-ink-3">{option.label}</span>
          </button>
        ))}
      </div>

      {score !== null && (
        <>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={score <= 3 ? 'What went wrong? We would rather know.' : 'Anything worth passing on?'}
            className="mt-3 min-h-16 text-[13px]"
          />
          <Button
            variant="primary"
            size="sm"
            className="mt-2 w-full"
            onClick={() => recordCsat(visit.id, score, comment.trim())}
          >
            Send my rating
          </Button>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Reschedule                                                                 */
/* -------------------------------------------------------------------------- */

function Reschedule({ visit, onDone }: { visit: Visit; onDone: () => void }) {
  const availability = useSchedule((s) => s.availability)
  const technicians = useSchedule((s) => s.technicians)
  const visits = useSchedule((s) => s.visits)
  const reschedule = useSchedule((s) => s.reschedule)

  const [day, setDay] = React.useState(dateKey(new Date(visit.start)))
  const [error, setError] = React.useState('')

  const slots = slotsForDay(day, technicians, availability, visits, {
    equipment: visit.equipment,
    priority: visit.priority,
    ignoreVisitId: visit.id,
  })

  /** The next fortnight, which is as far ahead as a client ever moves a visit. */
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return dateKey(d)
  })

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <p className="text-[13px] font-semibold text-ink">Move this visit</p>

      <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDay(d)}
            className={cn(
              'shrink-0 rounded-lg border px-2.5 py-1.5 text-center text-[11px] transition-colors',
              d === day ? 'grad-brand border-transparent text-white' : 'border-line bg-surface text-ink-2',
            )}
          >
            <span className="block font-semibold">
              {new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short' })}
            </span>
            <span className="block">{new Date(`${d}T00:00:00`).getDate()}</span>
          </button>
        ))}
      </div>

      {slots.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-3">Nothing free that day — try another.</p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {slots.map((slot) => (
            <button
              key={slot.start}
              type="button"
              onClick={() => {
                const technician = slot.free[0]
                if (!technician) return
                const result = reschedule(visit.id, technician.id, slot.start, slot.end)
                if (!result.ok) return setError(result.reason)
                onDone()
              }}
              className="rounded-lg border border-line-strong bg-surface px-2 py-2 text-[12px] font-medium text-ink hover:border-brand-400"
            >
              {formatClock(slot.minutes)}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-critical">{error}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                  */
/* -------------------------------------------------------------------------- */

export function TrackVisit() {
  const availability = useSchedule((s) => s.availability)
  const findByCode = useSchedule((s) => s.findByCode)
  const cancelVisit = useSchedule((s) => s.cancelVisit)
  const visits = useSchedule((s) => s.visits)

  const [code, setCode] = React.useState('')
  const [lookedUp, setLookedUp] = React.useState<string | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [moving, setMoving] = React.useState(false)

  // Read back out of the store rather than held in state, so a reschedule or a
  // rating shows immediately instead of on the next lookup.
  const visit = lookedUp ? (visits.find((v) => v.id === lookedUp) ?? null) : null

  const search = () => {
    const found = findByCode(code)
    setMissing(!found)
    setLookedUp(found?.id ?? null)
    setMoving(false)
  }

  if (!visit) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="text-[14px] font-semibold text-ink">Already booked?</p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Enter the six-character code from your confirmation to check, move or cancel it.
        </p>

        <div className="mt-3 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setMissing(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="e.g. K7P2QM"
              maxLength={10}
              className="h-11 pl-8 font-mono tracking-[0.15em] uppercase"
              aria-label="Booking code"
            />
          </div>
          <Button variant="secondary" size="lg" onClick={search}>
            Find it
          </Button>
        </div>

        {missing && (
          <p className="mt-2 text-[12px] text-critical">
            No visit with that code. Check the confirmation, or call the service desk and we will find it for you.
          </p>
        )}
      </div>
    )
  }

  const priority = priorityOf(visit.priority)
  const hoursAway = (new Date(visit.start).getTime() - Date.now()) / 3_600_000
  const changeable =
    availability.allowClientReschedule &&
    visit.status === 'Scheduled' &&
    hoursAway > availability.rescheduleCutoffHours

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[15px] font-bold tracking-[0.15em] text-ink">{visit.publicCode}</span>
        <Badge tone={VISIT_TONE[visit.status]} dot>
          {visit.status}
        </Badge>
        {priority && <Badge tone={priority.tone as 'critical'}>{priority.label}</Badge>}
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => {
            setLookedUp(null)
            setCode('')
          }}
        >
          Look up another
        </Button>
      </div>

      <div className="mt-4">
        <Journey visit={visit} />
      </div>

      <dl className="mt-4 space-y-2.5 text-[13px]">
        {[
          [CalendarClock, 'When', longWhen(visit.start)],
          [Wrench, 'Equipment', `${visit.equipment} — ${visit.issue}`],
          [MapPin, 'Where', `${visit.client} · ${visit.address}`],
          ...(visit.status === 'Scheduled' && visit.respondBy
            ? [[Clock, 'We confirm by', new Date(visit.respondBy).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })]]
            : []),
          ...(visit.status === 'En route' || visit.status === 'On site'
            ? [[ShieldCheck, 'Technician', visit.technicianName]]
            : []),
        ].map(([Icon, label, value]) => (
          <div key={label as string} className="flex items-start gap-2.5">
            {React.createElement(Icon as React.ElementType, { className: 'mt-0.5 size-4 shrink-0 text-ink-3' })}
            <div className="min-w-0">
              <dt className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">{label as string}</dt>
              <dd className="break-words text-ink">{value as string}</dd>
            </div>
          </div>
        ))}
      </dl>

      {/* Rating is offered only once the visit is genuinely finished. Asking
          before that gets a rating of the booking, which nobody needs. */}
      {visit.status === 'Completed' && availability.collectCsat && (
        <div className="mt-4">
          <RateVisit visit={visit} />
        </div>
      )}

      {moving ? (
        <div className="mt-4">
          <Reschedule visit={visit} onDone={() => setMoving(false)} />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setMoving(false)}>
            Never mind
          </Button>
        </div>
      ) : (
        changeable && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Button variant="secondary" size="sm" onClick={() => setMoving(true)}>
              <CalendarClock className="size-3.5" />
              Move this visit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Cancel this visit? The slot goes back to somebody else.')) {
                  cancelVisit(visit.id, 'Cancelled by the client from the tracking page.')
                }
              }}
            >
              Cancel it
            </Button>
          </div>
        )
      )}

      {!changeable && visit.status === 'Scheduled' && (
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-3">
          {availability.allowClientReschedule
            ? `It is inside ${availability.rescheduleCutoffHours} hours of the visit, so changes go through the service desk — the technician may already be on their way.`
            : 'To change this visit, please call the service desk.'}
        </p>
      )}
    </div>
  )
}
