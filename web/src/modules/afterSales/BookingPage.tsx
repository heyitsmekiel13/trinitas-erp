import * as React from 'react'
import { CalendarCheck, Clock, MessageSquare, Phone, ShieldCheck, Wrench } from 'lucide-react'
import { useCompany } from '@/lib/company'
import { PRIORITIES } from '@/data/afterSales'
import { useAfterSales } from './useAfterSales'
import { useSchedule } from './schedule'
import { BookingLetterhead, Scheduler } from './Scheduler'
import { TrackVisit } from './track'

/**
 * The client-facing booking page.
 *
 * Deliberately outside the ERP shell — it opens in its own tab, needs no
 * sign-in, and shows the company letterhead rather than the application
 * chrome. A branch manager whose oven died should not have to look at a
 * sidebar of departments they have no business in.
 *
 * What changed here, beyond the flow itself:
 *
 *   - The page had exactly one job: take a new booking. Everything after that
 *     — where is my technician, can I move it, it went badly — fell back to a
 *     phone call. Tracking now sits beside the form, because "check an
 *     existing booking" is the second reason anybody opens this page and was
 *     previously not served at all.
 *
 *   - The emergency line was a sentence at the bottom in eleven-point grey.
 *     A client whose fryer is on fire is not reading the footer.
 *
 *   - The three reassurance tiles said "real availability", "confirmed on the
 *     spot" and "priority understood". The first two are true and worth
 *     saying; the third meant nothing to a reader who has not seen the SLA
 *     table. The promises are now stated as times.
 */
export function ServiceBookingPage() {
  const company = useCompany()
  const { summary } = useAfterSales()
  const technicians = useSchedule((s) => s.technicians)
  const seedTechnicians = useSchedule((s) => s.seedTechnicians)
  const availability = useSchedule((s) => s.availability)

  const [tab, setTab] = React.useState<'book' | 'track'>('book')

  // The roster seeds from the names the revenue history already records, so the
  // page works on a fresh browser rather than showing an empty calendar.
  React.useEffect(() => {
    if (!technicians.length && summary.technicians.length) {
      seedTechnicians(summary.technicians.slice(0, 8).map((t) => t.name))
    }
  }, [technicians.length, summary.technicians, seedTechnicians])

  const fastest = PRIORITIES[0]

  return (
    <BookingLetterhead>
      {/* The emergency line, first and in the client's line of sight. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-critical/30 bg-critical/5 px-4 py-3">
        <Phone className="size-4 shrink-0 text-critical" />
        <p className="text-[13px] font-medium text-ink">
          Smoke, gas, or a live electrical fault? Switch it off at the isolator and call us.
        </p>
        {company.phone && (
          <a
            href={`tel:${company.phone.replace(/\s/g, '')}`}
            className="text-[14px] font-bold text-critical underline underline-offset-2"
          >
            {company.phone}
          </a>
        )}
      </div>

      <div className="mb-7 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Book a service visit</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          Tell us what broke, where you are, and when suits — about two minutes. You will only ever be offered a time
          somebody is genuinely free for, so there is no waiting for a call back to find out.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: CalendarCheck,
              title: 'Real availability',
              body: `Every slot shown has a technician free for it, with ${availability.travelBufferMinutes} minutes of travel protected either side.`,
            },
            {
              icon: Clock,
              title: `Answered in ${fastest.respondHours} hours`,
              body: 'That is the promise on a Critical call. Less urgent work has its own stated target, shown as you choose.',
            },
            {
              icon: ShieldCheck,
              title: 'Yours to change',
              body: availability.allowClientReschedule
                ? `Move or cancel it yourself up to ${availability.rescheduleCutoffHours} hours before, with the code we give you.`
                : 'You get a reference code immediately and a call to confirm.',
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-line bg-surface p-3">
              <Icon className="size-4 text-brand-500" />
              <p className="mt-1.5 text-[13px] font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Two jobs, two tabs. Booking is the default because it is what most
          people arrive to do; tracking is one tap away rather than a phone
          call away. */}
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface-2 p-1">
        {(
          [
            ['book', 'Book a visit', Wrench],
            ['track', 'Check a booking', MessageSquare],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={
              tab === id
                ? 'grad-brand flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-white shadow-sm'
                : 'flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink'
            }
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'book' ? (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
          <Scheduler mode="public" />
        </div>
      ) : (
        <div className="max-w-xl">
          <TrackVisit />
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-ink-3">
        Booked visits are confirmed by phone before the technician sets off. If nobody has been in touch within the
        window shown against your priority, call the service desk and quote your code — that is a promise we count
        ourselves against, not a hope.
      </p>
    </BookingLetterhead>
  )
}
