import * as React from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Plus,
  Video,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Info,
  MapPin,
  Phone,
  ShieldCheck,
  Trash2,
  User,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCompany } from '@/lib/company'
import {
  CLIENT_TYPES,
  EQUIPMENT_TYPES,
  PRIORITIES,
  priorityOf,
  type ClientType,
  type EquipmentType,
  type Priority,
} from '@/data/afterSales'
import {
  dateKey,
  formatClock,
  openDays,
  slotsForDay,
  type Slot,
  type Technician,
  type Visit,
} from '@/data/scheduling'
import { COVERAGE_LEVELS, coverFor } from '@/data/serviceQuality'
import { Badge, Button, Combobox, Input, Select, Textarea } from '@/components/ui/primitives'
import { AddressFields, PlaceSearchBox, useAddressForPoint } from '@/components/data/PlacePicker'
import { RouteMap } from '@/components/data/RouteMap'
import { EMPTY_ADDRESS, formatAddress, hasAddress, type AddressParts, type LatLng } from '@/lib/places'
import { useSchedule, type BookingRequest } from './schedule'

/**
 * The booking flow.
 *
 * It used to be three panels side by side: calendar, slot list, and a column of
 * fourteen inputs. That layout had three problems, and the third is the one
 * that mattered.
 *
 *   - On a phone the three panels stacked into a single scroll roughly two and
 *     a half screens long, with the confirm button at the bottom. Most clients
 *     book from a phone, standing next to the thing that broke.
 *
 *   - Everything was visible at once, so nothing was obviously required. The
 *     button read "Pick a day and time first" whether you had filled in one
 *     field or none.
 *
 *   - The order was wrong. Which technicians can take the job depends on the
 *     equipment, and how soon they can take it depends on the priority — yet
 *     both of those sat in the third panel, *after* the calendar the client had
 *     already picked a day from. Change the equipment afterwards and the chosen
 *     slot silently vanished. The fix is not a better warning; it is asking the
 *     questions in the order the answers are needed.
 *
 * So: fault first, then who and where, then when, then a review. Each step
 * validates before it will advance, which is also what makes the whole thing
 * work on a small screen — one decision per view.
 */

/**
 * What the account types mean, in the client's own terms.
 *
 * The list has been in the system since the intake form and was never
 * explained anywhere a client could see it — which is how a free-text version
 * of the same question collected 279 spellings of roughly seven values.
 */
const ACCOUNT_TYPE_GUIDE = [
  { type: 'Panadero', when: 'A Panadero bakery outlet.' },
  { type: 'Institutional', when: 'A hotel, hospital, school, canteen or restaurant buying for its own kitchen.' },
  { type: 'CHBC', when: 'Part of the CHBC group.' },
  { type: 'JBYL Group', when: 'Part of the JBYL group of companies.' },
  { type: 'PDF', when: 'Covered by a PDF arrangement.' },
  { type: 'Company-Owned', when: 'A branch the company owns and runs itself.' },
  { type: 'Franchise', when: 'A franchised branch under its own owner.' },
] as const

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function monthMatrix(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

const longDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-PH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' })

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Philippine mobile numbers, accepted in every shape people actually type them.
 *
 * 0917…, +63917…, 63917…, with or without spaces and dashes. Rejecting a
 * correct number because of a space is the fastest way to lose a booking, and
 * a field that silently accepts "n/a" is no better — so the check is
 * permissive about formatting and strict about substance.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '')
  const m = /^(?:\+?63|0)?(9\d{9})$/.exec(digits)
  return m ? `+63${m[1]}` : null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

const MAX_ATTACHMENTS = 6
/** Photos are small; a short clip is not. Generous enough for 20–30 seconds. */
const MAX_ATTACHMENT_BYTES = 25_000_000

/**
 * Why the attachment is required rather than encouraged.
 *
 * The single most expensive failure in this business is a technician arriving
 * without the right part, and the commonest cause is a fault described in
 * words. "It makes a noise" covers a worn bearing and a loose panel, which are
 * a two-hour job and a two-minute one. A ten-second clip of the noise settles
 * it before anybody leaves the shop.
 *
 * So one attachment is the minimum to submit. It is the only field on the form
 * that reliably saves a second visit.
 */
const ATTACHMENT_GUIDE = [
  'Stand back far enough to show the whole unit, then come close on the fault.',
  'For a noise or a fault that comes and goes, film it — sound matters, so do not mute.',
  'Photograph the data plate (inside the door, or the back panel). It carries the model and serial.',
  'If it trips a breaker or shows an error code, capture the panel or the code on screen.',
]

/**
 * A photo of the fault, read straight into the booking.
 *
 * The old intake form had an attachment column and it is the single most
 * useful field on it: a picture of the data plate tells the technician the
 * model and serial before they leave the shop, which is a return trip that
 * never happens. Held as a data URL because there is no upload endpoint yet;
 * the cap keeps a browser's local storage from being filled by one booking.
 */
type Attachment = { url: string; kind: 'image' | 'video'; name: string }

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

/* -------------------------------------------------------------------------- */
/* Calendar invite                                                            */
/* -------------------------------------------------------------------------- */

const icsStamp = (iso: string) => `${iso.replace(/[-:]/g, '').split('.')[0]}Z`

/** An .ics the client can put straight in their own calendar. */
function downloadInvite(visit: { id: string; start: string; end: string; client: string; address: string; equipment: string }, company: string) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Trinitas ERP//After-Sales//EN',
    'BEGIN:VEVENT',
    `UID:${visit.id}@trinitas`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(new Date(visit.start).toISOString())}`,
    `DTEND:${icsStamp(new Date(visit.end).toISOString())}`,
    `SUMMARY:${company} service visit — ${visit.equipment}`,
    `LOCATION:${visit.address.replace(/[,;]/g, ' ')}`,
    `DESCRIPTION:Service visit reference ${visit.id}.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `service-visit-${visit.id}.ics`
  anchor.click()
  URL.revokeObjectURL(url)
}

/* -------------------------------------------------------------------------- */

export type SchedulerPrefill = {
  ticket?: string
  client?: string
  address?: string
  clientType?: ClientType
  contact?: string
  phone?: string
  email?: string
  equipment?: EquipmentType
  issue?: string
  priority?: Priority | null
  backJobOf?: string | null
}

type StepId = 'fault' | 'where' | 'when' | 'review'

const STEPS: { id: StepId; label: string; short: string }[] = [
  { id: 'fault', label: 'What needs fixing', short: 'Fault' },
  { id: 'where', label: 'Where and who', short: 'Site' },
  { id: 'when', label: 'Pick a time', short: 'Time' },
  { id: 'review', label: 'Check and confirm', short: 'Confirm' },
]

function Steps({ current, onJump }: { current: number; onJump: (index: number) => void }) {
  return (
    <ol className="mb-5 flex items-center gap-1 overflow-x-auto pb-1" aria-label="Booking progress">
      {STEPS.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={step.id} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              // Going back is always allowed; jumping ahead is not, because the
              // later steps are built out of the earlier answers.
              disabled={i > current}
              onClick={() => onJump(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                active
                  ? 'grad-brand text-white shadow-sm'
                  : done
                    ? 'text-ink-2 hover:bg-surface-2'
                    : 'cursor-not-allowed text-ink-3',
              )}
            >
              <span
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-white/20' : done ? 'bg-good/15 text-good' : 'bg-surface-3 text-ink-3',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.short}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="size-3 shrink-0 text-ink-3" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1 block">
      <span className="block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{children}</span>
      {hint && <span className="mt-0.5 block text-[11px] font-normal normal-case text-ink-3">{hint}</span>}
    </span>
  )
}

/* -------------------------------------------------------------------------- */

export function Scheduler({
  mode,
  prefill,
  onBooked,
  className,
}: {
  /** `public` collects the client's own details; `dispatch` assumes they exist. */
  mode: 'public' | 'dispatch'
  prefill?: SchedulerPrefill
  onBooked?: (visitId: string) => void
  className?: string
}) {
  const company = useCompany()
  const availability = useSchedule((s) => s.availability)
  const technicians = useSchedule((s) => s.technicians)
  const visits = useSchedule((s) => s.visits)
  const contracts = useSchedule((s) => s.contracts)
  const book = useSchedule((s) => s.book)

  // A dispatcher already has the client on screen, so they start at the
  // calendar; the earlier steps stay reachable behind the back button.
  const [step, setStep] = React.useState(mode === 'dispatch' ? 2 : 0)
  const [month, setMonth] = React.useState(() => new Date())
  const [day, setDay] = React.useState<string | null>(null)
  const [slot, setSlot] = React.useState<Slot | null>(null)
  const [technicianId, setTechnicianId] = React.useState<string>('')
  const [error, setError] = React.useState('')
  const [confirmed, setConfirmed] = React.useState<Visit | null>(null)
  const [busy, setBusy] = React.useState(false)

  /** A field no human sees and every naive bot fills in. */
  const [honeypot, setHoneypot] = React.useState('')

  const [form, setForm] = React.useState({
    client: prefill?.client ?? '',
    address: prefill?.address ?? '',
    clientType: (prefill?.clientType ?? 'Institutional') as ClientType,
    contact: prefill?.contact ?? '',
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
    equipment: (prefill?.equipment ?? 'Oven') as EquipmentType,
    model: '',
    issue: prefill?.issue ?? '',
    priority: (prefill?.priority ?? 2) as Priority,
    notes: '',
  })
  const [attachments, setAttachments] = React.useState<Attachment[]>([])

  /**
   * Every unit reported on this call.
   *
   * The first drives which technicians can take it, so the list is ordered and
   * the head of it is what the slot grid filters on. Added one at a time from
   * a searchable list rather than a wall of tick boxes — twenty-five equipment
   * types as checkboxes is a scrolling thicket, and people tick the wrong one.
   */
  const [units, setUnits] = React.useState<EquipmentType[]>([
    (prefill?.equipment ?? 'Oven') as EquipmentType,
  ])
  const [unitToAdd, setUnitToAdd] = React.useState<EquipmentType | null>(null)

  /* Where the site is, as a pin and as an address. */
  const [sitePoint, setSitePoint] = React.useState<LatLng | null>(null)
  const [siteParts, setSiteParts] = React.useState<AddressParts>(EMPTY_ADDRESS)
  const [pickingSite, setPickingSite] = React.useState(false)
  const setSiteAddress = useAddressForPoint(sitePoint, siteParts, setSiteParts, step === 1)

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // The primary unit is the head of the list; the slot grid and the skill
  // check both read `form.equipment`, so keep the two in step.
  React.useEffect(() => {
    if (units[0] && units[0] !== form.equipment) set('equipment', units[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units])

  /* ------------------------------ derived state ---------------------------- */

  // Which days still have room, for this equipment at this urgency. Priority 1
  // gets the shorter lead time, so the promise on screen and the calendar
  // beneath it finally agree.
  const available = React.useMemo(
    () => openDays(technicians, availability, visits, { equipment: form.equipment, priority: form.priority }),
    [technicians, availability, visits, form.equipment, form.priority],
  )

  const slots = React.useMemo(
    () =>
      day
        ? slotsForDay(day, technicians, availability, visits, {
            equipment: form.equipment,
            priority: form.priority,
          })
        : [],
    [day, technicians, availability, visits, form.equipment, form.priority],
  )

  // A change of equipment or urgency can invalidate the chosen slot — drop it
  // rather than book somebody who is not qualified for the unit.
  React.useEffect(() => {
    if (slot && !slots.some((s) => s.start === slot.start)) {
      setSlot(null)
      setTechnicianId('')
    }
  }, [slots, slot])

  /** The agreement covering this client and unit, if there is one. */
  const contract = React.useMemo(
    () => coverFor(contracts, form.client, form.equipment),
    [contracts, form.client, form.equipment],
  )

  /**
   * A live visit already booked for the same client and the same unit.
   *
   * The old intake collected the same complaint two and three times because a
   * client who has heard nothing books again. Two bookings for one fault is a
   * wasted van, so the duplicate is surfaced before the second one is taken.
   */
  const duplicate = React.useMemo(() => {
    const name = form.client.trim().toLowerCase()
    if (!name) return null
    return (
      visits.find(
        (v) =>
          v.client.trim().toLowerCase() === name &&
          v.equipment === form.equipment &&
          v.status !== 'Cancelled' &&
          v.status !== 'Completed' &&
          v.status !== 'No show',
      ) ?? null
    )
  }, [visits, form.client, form.equipment])

  /**
   * The account type this client was booked under last time.
   *
   * Asking somebody to classify their own business against a seven-item
   * internal taxonomy is asking them to guess. Where they have used us before,
   * the answer is already on file — so it is filled in and the client only has
   * to notice if it is wrong.
   */
  const matchedAccount = React.useMemo(() => {
    const name = form.client.trim().toLowerCase()
    if (name.length < 3) return null

    const previous = [...visits]
      .filter((v) => v.client.trim().toLowerCase() === name)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]

    return previous
      ? {
          clientType: previous.clientType,
          when: new Date(previous.createdAt).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }),
        }
      : null
  }, [visits, form.client])

  React.useEffect(() => {
    if (matchedAccount && matchedAccount.clientType !== form.clientType) {
      set('clientType', matchedAccount.clientType)
    }
    // Only when the match itself changes — otherwise it would fight anybody
    // who deliberately picks a different type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedAccount?.clientType])

  const priority = priorityOf(form.priority)
  const cells = React.useMemo(() => monthMatrix(month), [month])
  const today = dateKey(new Date())
  const chosen = slot?.free.find((t) => t.id === technicianId) ?? slot?.free[0] ?? null

  /* ------------------------------- navigation ------------------------------ */

  /** What is stopping this step from advancing. Null when it may. */
  const blocking = (index: number): string | null => {
    if (index === 0) {
      if (!units.length) return 'Add at least one unit.'
      if (form.issue.trim().length < 12) {
        return 'Describe the fault in a sentence — it decides who we send and what they bring.'
      }
      /*
       * Genuinely required, not encouraged. A fault described only in words is
       * the commonest reason a technician arrives without the right part, and
       * a ten-second clip settles in advance what a paragraph cannot.
       */
      if (!attachments.length) {
        return 'Add at least one photo or video of the problem — it is what gets the right part on the van.'
      }
      return null
    }
    if (index === 1) {
      if (!form.client.trim()) return 'Tell us which business this is for.'
      if (!form.address.trim()) return 'We need the branch or address to send somebody to.'
      if (mode === 'public') {
        if (!form.contact.trim()) return 'Give us a name to ask for on arrival.'
        if (!normalisePhone(form.phone)) return 'A mobile number we can reach on the day, please — 09XX XXX XXXX.'
        if (form.email.trim() && !EMAIL.test(form.email.trim())) return 'That email address does not look right.'
      }
      return null
    }
    if (index === 2 && !slot) return 'Choose a day and a time.'
    return null
  }

  const next = () => {
    const stop = blocking(step)
    if (stop) return setError(stop)
    setError('')
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  const back = () => {
    setError('')
    setStep((s) => Math.max(0, s - 1))
  }

  /* -------------------------------- submit --------------------------------- */

  const submit = () => {
    setError('')
    if (honeypot) return // Silently ignored, as a trap should be.
    if (!slot || !chosen) return setError('Choose a day and a time first.')

    for (let i = 0; i < 3; i++) {
      const stop = blocking(i)
      if (stop) {
        setStep(i)
        return setError(stop)
      }
    }

    setBusy(true)
    const request: BookingRequest = {
      ticket: prefill?.ticket ?? '',
      technicianId: chosen.id,
      start: slot.start,
      end: slot.end,
      client: form.client.trim(),
      address: formatAddress(siteParts, form.address) || form.address.trim(),
      clientType: form.clientType,
      contact: form.contact.trim(),
      phone: normalisePhone(form.phone) ?? form.phone.trim(),
      email: form.email.trim(),
      equipment: units[0] ?? form.equipment,
      units,
      issue: form.issue.trim(),
      priority: form.priority,
      notes: [form.model.trim() && `Model: ${form.model.trim()}`, form.notes.trim()].filter(Boolean).join('\n'),
      source: mode === 'public' ? 'Client booking' : 'Dispatcher',
      attachments: attachments.map((a) => a.url),
      backJobOf: prefill?.backJobOf ?? null,
    }

    const result = book(request)
    setBusy(false)
    if (!result.ok) return setError(result.reason)

    setConfirmed(result.visit)
    onBooked?.(result.visit.id)
  }

  const restart = () => {
    setConfirmed(null)
    setSlot(null)
    setDay(null)
    setTechnicianId('')
    setAttachments([])
    setStep(mode === 'dispatch' ? 2 : 0)
  }

  /* ------------------------------ confirmed ------------------------------- */

  if (confirmed) {
    const start = new Date(confirmed.start)
    return (
      <div className={cn('mx-auto max-w-xl py-8', className)}>
        <div className="text-center">
          <span className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-good/15">
            <Check className="size-7 text-good" strokeWidth={2.5} />
          </span>
          <h2 className="text-xl font-semibold text-ink">Visit booked</h2>
          <p className="mt-1.5 text-[13px] text-ink-2">
            Keep this code — it is how you check, move or cancel the visit.
          </p>
          <p className="mt-3 inline-block rounded-xl border border-brand-300 bg-brand-50 px-5 py-2.5 font-mono text-2xl font-bold tracking-[0.2em] text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300">
            {confirmed.publicCode}
          </p>
        </div>

        <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface-2 text-[13px]">
          {[
            ['When', `${longDate(dateKey(start))} at ${formatClock(start.getHours() * 60 + start.getMinutes())}`],
            ['On site for', `about ${availability.slotMinutes} minutes`],
            ['Equipment', `${confirmed.equipment}${form.model ? ` · ${form.model}` : ''}`],
            ['Where', confirmed.address],
            ['We will ask for', confirmed.contact || '—'],
            ['Reference', confirmed.id],
            ...(mode === 'dispatch' ? [['Technician', confirmed.technicianName]] : []),
            ...(confirmed.respondBy
              ? [['We will confirm by', new Date(confirmed.respondBy).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })]]
              : []),
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="shrink-0 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
              <dd className="text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              downloadInvite(
                {
                  id: confirmed.id,
                  start: confirmed.start,
                  end: confirmed.end,
                  client: confirmed.client,
                  address: confirmed.address,
                  equipment: confirmed.equipment,
                },
                company.name,
              )
            }
          >
            <CalendarDays className="size-3.5" />
            Add to my calendar
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" size="sm" onClick={restart}>
            Book another visit
          </Button>
        </div>

        {mode === 'public' && (
          <p className="mt-5 text-center text-[12px] leading-relaxed text-ink-3">
            We will call {form.contact || 'you'} on {normalisePhone(form.phone) ?? form.phone} to confirm before the
            technician sets off.
          </p>
        )}
      </div>
    )
  }

  /* ------------------------------- guard rails ----------------------------- */

  if (!technicians.length) {
    return (
      <div className={cn('rounded-xl border border-line bg-surface-2 p-8 text-center', className)}>
        <p className="text-[13px] font-medium text-ink">No technicians on the roster yet</p>
        <p className="mt-1 text-[12px] text-ink-3">
          Add them under After-Sales → Availability before bookings can be taken.
        </p>
      </div>
    )
  }

  if (!availability.publicBookingOpen && mode === 'public') {
    return (
      <div className={cn('rounded-xl border border-line bg-surface-2 p-8 text-center', className)}>
        <p className="text-[13px] font-medium text-ink">Online booking is closed right now</p>
        <p className="mt-1 text-[12px] text-ink-3">Please call the service desk and we will arrange a visit.</p>
      </div>
    )
  }

  /* ================================== steps ================================ */

  return (
    <div className={cn('mx-auto w-full max-w-3xl', className)}>
      <Steps current={step} onJump={(i) => i <= step && (setError(''), setStep(i))} />

      {/* ------------------------------ 1. the fault --------------------------- */}
      {step === 0 && (
        <div className="space-y-4">
          {/*
              One call, however many broken things.
              Added one at a time from a searchable list rather than a wall of
              twenty-five tick boxes — a thicket like that gets the wrong one
              ticked. The first unit added is the one the visit is scheduled
              and skill-matched on, which is why the list is ordered and says
              so.
          */}
          <div>
            <FieldLabel hint="Add every unit that needs looking at. The first one decides who we send.">
              Which unit is it?
            </FieldLabel>

            {units.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {units.map((unit, i) => (
                  <span
                    key={unit}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]',
                      i === 0
                        ? 'border-brand-500 bg-brand-50 font-medium text-ink dark:bg-brand-950'
                        : 'border-line bg-surface text-ink-2',
                    )}
                  >
                    {unit}
                    {i === 0 && <span className="text-[10px] text-ink-3">main</span>}
                    {units.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove ${unit}`}
                        onClick={() => setUnits((list) => list.filter((u) => u !== unit))}
                        className="text-ink-3 hover:text-critical"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  value={unitToAdd}
                  options={EQUIPMENT_TYPES.filter((t) => !units.includes(t)).map((t) => ({ value: t, label: t }))}
                  onChange={(v) => setUnitToAdd(v === null ? null : (String(v) as EquipmentType))}
                  placeholder="Search equipment…"
                />
              </div>
              <Button
                variant="secondary"
                size="lg"
                disabled={!unitToAdd}
                onClick={() => {
                  if (!unitToAdd) return
                  setUnits((list) => (list.includes(unitToAdd) ? list : [...list, unitToAdd]))
                  setUnitToAdd(null)
                }}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {units.length === 0 && (
              <p className="mt-1 text-[11px] text-critical">Add at least one unit.</p>
            )}
          </div>

          <label className="block">
            <FieldLabel hint="Optional, but it saves a return trip for the right part.">Model or serial number</FieldLabel>
            <Input
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="On the data plate — usually inside the door"
              className="h-11 text-[14px]"
            />
          </label>

          <label className="block">
            <FieldLabel hint="What it does, when it started, and anything you have already tried.">
              What is wrong?
            </FieldLabel>
            <Textarea
              value={form.issue}
              onChange={(e) => set('issue', e.target.value)}
              placeholder="The oven heats but the fan stopped last Tuesday. It trips the breaker when switched to fan mode."
              className="min-h-24 text-[14px]"
            />
            <span className="mt-1 block text-right text-[11px] text-ink-3">
              {form.issue.trim().length < 12 ? 'A sentence, please' : `${form.issue.trim().length} characters`}
            </span>
          </label>

          {/*
              Photos and video, and the form will not submit without one.
              See ATTACHMENT_GUIDE above for why this is a hard requirement
              rather than a nudge.
          */}
          <div>
            <FieldLabel hint={`Up to ${MAX_ATTACHMENTS} files. At least one is needed to submit.`}>
              Show us the problem
            </FieldLabel>

            <div className="mb-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/40">
              <p className="text-[12px] font-medium text-ink">
                The more you send, the better we arrive prepared.
              </p>
              <ul className="mt-1.5 space-y-1">
                {ATTACHMENT_GUIDE.map((tip) => (
                  <li key={tip} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
                    <span className="mt-[5px] size-1 shrink-0 rounded-full bg-brand-500" />
                    {tip}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                A technician who has seen the fault brings the right part. One who has read about it brings a guess.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((file, i) => (
                <span key={i} className="relative">
                  {file.kind === 'video' ? (
                    <video
                      src={file.url}
                      className="size-16 rounded-lg border border-line object-cover"
                      muted
                      playsInline
                    />
                  ) : (
                    <img src={file.url} alt="" className="size-16 rounded-lg border border-line object-cover" />
                  )}
                  {file.kind === 'video' && (
                    <span className="pointer-events-none absolute bottom-0.5 left-0.5 rounded bg-ink/70 px-1 text-[9px] text-white">
                      video
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-critical text-white"
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </span>
              ))}

              {attachments.length < MAX_ATTACHMENTS &&
                (
                  [
                    { kind: 'image' as const, accept: 'image/*', Icon: Camera, label: 'Photo' },
                    { kind: 'video' as const, accept: 'video/*', Icon: Video, label: 'Video' },
                  ]
                ).map(({ kind, accept, Icon, label }) => (
                  <label
                    key={kind}
                    className="flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-ink-3 hover:border-brand-400 hover:text-brand-500"
                  >
                    <Icon className="size-4" />
                    <span className="text-[10px]">{label}</span>
                    <input
                      type="file"
                      accept={accept}
                      capture={kind === 'video' ? 'environment' : undefined}
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        if (file.size > MAX_ATTACHMENT_BYTES) {
                          return setError(
                            `That file is over ${Math.round(MAX_ATTACHMENT_BYTES / 1_000_000)} MB. A shorter clip or a smaller picture will do.`,
                          )
                        }
                        try {
                          const url = await readAsDataUrl(file)
                          setError('')
                          setAttachments((a) =>
                            [...a, { url, kind, name: file.name }].slice(0, MAX_ATTACHMENTS),
                          )
                        } catch {
                          setError('That file could not be read.')
                        }
                      }}
                    />
                  </label>
                ))}
            </div>

            {attachments.length === 0 && (
              <p className="mt-1.5 text-[11px] text-ink-3">
                Nothing attached yet. A photo of the unit and a short clip of the fault is the ideal pair.
              </p>
            )}
          </div>

          {/* Urgency, with the definition beside it rather than in a dropdown
              the client has to guess at. */}
          <div>
            <FieldLabel hint="Be honest — it sets how fast we promise to come back to you.">
              How urgent is it?
            </FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRIORITIES.map((p) => {
                const on = form.priority === p.level
                return (
                  <button
                    key={p.level}
                    type="button"
                    onClick={() => set('priority', p.level as Priority)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition-all',
                      on
                        ? 'border-brand-500 bg-brand-50 shadow-sm dark:bg-brand-950'
                        : 'border-line bg-surface hover:border-brand-300',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Badge tone={p.tone as 'critical'}>{p.label}</Badge>
                      <span className="ml-auto text-[10px] font-medium text-ink-3">
                        reply within{' '}
                        {p.respondHours < 24
                          ? `${p.respondHours} h`
                          : `${p.respondHours / 24} day${p.respondHours === 24 ? '' : 's'}`}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[12px] leading-snug font-medium text-ink">{p.summary}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{p.detail}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* The emergency path. A Priority 1 client should not be quietly
              queued behind the calendar — the calendar cannot beat the phone. */}
          {form.priority === 1 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-critical/40 bg-critical/5 p-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
              <div className="min-w-0 text-[12px] leading-relaxed text-ink-2">
                <p className="font-semibold text-ink">If it is unsafe, stop and call us.</p>
                <p className="mt-0.5">
                  Switch the unit off at the isolator. You can still book below — a Critical call opens the next{' '}
                  {availability.emergencyLeadTimeHours} hours rather than the usual {availability.leadTimeHours} — but
                  for smoke, gas or live electrical faults the phone is faster than any calendar.
                </p>
                {company.phone && (
                  <a
                    href={`tel:${company.phone.replace(/\s/g, '')}`}
                    className="mt-1.5 inline-flex items-center gap-1.5 font-semibold text-critical underline underline-offset-2"
                  >
                    <Phone className="size-3.5" />
                    {company.phone}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------ 2. who and where ----------------------- */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <FieldLabel>Business or trade name</FieldLabel>
              <Input
                value={form.client}
                onChange={(e) => set('client', e.target.value)}
                placeholder="Villabake Bread and Pastries"
                className="h-11 text-[14px]"
              />
            </label>

            <label className="block sm:col-span-2">
              <FieldLabel hint="Street, barangay and city — enough for a driver who has not been before.">
                Branch or address
              </FieldLabel>
              <Textarea
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="2nd floor, Gaisano Mall, J. Catolico Ave, General Santos City"
                className="min-h-16 text-[14px]"
              />
            </label>

            <label className="block">
              <FieldLabel>Who should we ask for?</FieldLabel>
              <Input
                value={form.contact}
                onChange={(e) => set('contact', e.target.value)}
                placeholder="Branch manager's name"
                className="h-11 text-[14px]"
              />
            </label>

            <label className="block">
              <FieldLabel hint="We call this number to confirm.">Mobile number</FieldLabel>
              <Input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="0917 123 4567"
                className="h-11 text-[14px]"
              />
              {form.phone.trim() && !normalisePhone(form.phone) && (
                <span className="mt-1 block text-[11px] text-critical">
                  That does not look like a Philippine mobile number.
                </span>
              )}
            </label>

            <label className="block">
              <FieldLabel hint="Optional. We send the confirmation here.">Email</FieldLabel>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="name@company.com"
                className="h-11 text-[14px]"
              />
            </label>

            <label className="block">
              <FieldLabel
                hint={
                  matchedAccount
                    ? `Set from your last visit with us${matchedAccount.when ? ` (${matchedAccount.when})` : ''}. Change it if it is wrong.`
                    : 'Not sure? Pick the one that describes the business — the guide is below.'
                }
              >
                Account type
              </FieldLabel>
              <Select
                value={form.clientType}
                onChange={(e) => set('clientType', e.target.value as ClientType)}
                className="h-11 text-[14px]"
              >
                {CLIENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {/* What the account types actually mean.
              The list has been in the system since the intake form and has
              never been explained anywhere a client could see it, which is how
              it collected 279 spellings of roughly seven values. */}
          <details className="rounded-xl border border-line bg-surface-2 p-3">
            <summary className="cursor-pointer text-[12px] font-medium text-ink">
              Which account type am I?
            </summary>
            <dl className="mt-2 space-y-1.5">
              {ACCOUNT_TYPE_GUIDE.map(({ type, when }) => (
                <div key={type} className="flex gap-2 text-[11px] leading-relaxed">
                  <dt className="w-28 shrink-0 font-semibold text-ink">{type}</dt>
                  <dd className="text-ink-2">{when}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-ink-3">
              Still unsure? Leave it as it is — we will correct it when we confirm by phone.
            </p>
          </details>

          {/* The site on a map.
              An address a driver has to interpret is an address a driver gets
              wrong. The pin is what the technician navigates to; the fields
              underneath are filled in from it and stay editable. */}
          <div className="space-y-3">
            <FieldLabel hint="Drop the pin where the technician should actually arrive — the gate, not the block.">
              Where exactly?
            </FieldLabel>

            <PlaceSearchBox
              value={form.address}
              point={sitePoint}
              placeholder="Search the branch, mall or street…"
              onPick={(point, label, parts) => {
                setSitePoint(point)
                set('address', label)
                if (hasAddress(parts)) setSiteParts(parts)
                setPickingSite(false)
              }}
            />

            <Button
              variant={pickingSite ? 'primary' : 'ghost'}
              size="xs"
              onClick={() => setPickingSite((v) => !v)}
            >
              <MapPin className="size-3" />
              {pickingSite ? 'Click the map…' : 'Drop the pin myself'}
            </Button>

            <RouteMap
              origin={sitePoint}
              destination={null}
              picking={pickingSite ? 'origin' : null}
              height={260}
              onPick={(point) => {
                setSitePoint(point)
                setPickingSite(false)
              }}
              onDrag={(_which, point) => setSitePoint(point)}
            />

            <AddressFields parts={siteParts} onChange={setSiteAddress} />
          </div>

          {/* The honeypot. Off-screen rather than display:none, because some
              bots skip anything hidden outright. */}
          <label className="absolute left-[-9999px] h-px w-px overflow-hidden" aria-hidden tabIndex={-1}>
            Do not fill this in
            <input value={honeypot} onChange={(e) => setHoneypot(e.target.value)} autoComplete="off" tabIndex={-1} />
          </label>

          {contract && (
            <div className="flex items-start gap-2.5 rounded-xl border border-good/40 bg-good/5 p-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" />
              <p className="text-[12px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">You are under contract {contract.reference}.</span>{' '}
                {COVERAGE_LEVELS.find((c) => c.id === contract.coverage)?.detail}
                {contract.responseHours && ` Your agreement promises a response within ${contract.responseHours} hours.`}
              </p>
            </div>
          )}

          {duplicate && (
            <div className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/5 p-3">
              <Info className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-[12px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">You already have a visit booked for this unit.</span>{' '}
                {duplicate.technicianName} is due on {shortDate(dateKey(new Date(duplicate.start)))} under reference{' '}
                <span className="font-mono">{duplicate.publicCode || duplicate.id}</span>. Book again only if this is a
                different fault.
              </p>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------- 3. when ----------------------------- */}
      {step === 2 && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">
                {month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            {/* A real grid with real labels: the old one announced nothing but a
                bare number to a screen reader, and "17" is not a date. */}
            <div role="grid" aria-label="Available dates" className="grid grid-cols-7 gap-1">
              {WEEKDAY_INITIALS.map((d, i) => (
                <span key={i} role="columnheader" aria-label={WEEKDAY_NAMES[i]} className="pb-1 text-center text-[10px] font-semibold text-ink-3">
                  {d}
                </span>
              ))}

              {cells.map((date) => {
                const key = dateKey(date)
                const outside = date.getMonth() !== month.getMonth()
                const isOpen = available.has(key)
                const isToday = key === today
                const selected = key === day

                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    disabled={!isOpen}
                    aria-selected={selected}
                    aria-label={`${longDate(key)}${isOpen ? '' : ' — nothing available'}`}
                    onClick={() => {
                      setDay(key)
                      setSlot(null)
                      setTechnicianId('')
                      setError('')
                    }}
                    className={cn(
                      'relative flex aspect-square items-center justify-center rounded-lg text-[13px] transition-all',
                      outside && 'opacity-35',
                      selected
                        ? 'grad-brand font-semibold text-white shadow-sm'
                        : isOpen
                          ? 'bg-surface-2 font-medium text-ink hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950 dark:hover:text-brand-300'
                          : 'cursor-not-allowed text-ink-3',
                    )}
                  >
                    {date.getDate()}
                    {isToday && !selected && (
                      <span className="absolute bottom-1 size-1 rounded-full bg-brand-500" aria-hidden />
                    )}
                  </button>
                )
              })}
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Only days with a technician genuinely free to work on your {form.equipment.toLowerCase()} are selectable.
            </p>
          </div>

          <div className="min-w-0">
            <p className="mb-2 text-[13px] font-semibold text-ink">
              {day ? longDate(day) : 'Pick a day first'}
            </p>

            {!day ? (
              <p className="text-[12px] text-ink-3">Choose a date to see the times still open.</p>
            ) : slots.length === 0 ? (
              <p className="text-[12px] text-ink-3">Nothing left that day. Try another.</p>
            ) : (
              // Grouped, because "morning or afternoon?" is the question a
              // client actually asks themselves before "8 or 10?".
              <div className="space-y-3">
                {[
                  { label: 'Morning', of: slots.filter((s) => s.minutes < 720) },
                  { label: 'Afternoon', of: slots.filter((s) => s.minutes >= 720) },
                ]
                  .filter((group) => group.of.length)
                  .map((group) => (
                    <div key={group.label}>
                      <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">
                        {group.label}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {group.of.map((s) => {
                          const active = slot?.start === s.start
                          return (
                            <button
                              key={s.start}
                              type="button"
                              onClick={() => {
                                setSlot(s)
                                setTechnicianId(s.free[0]?.id ?? '')
                                setError('')
                              }}
                              className={cn(
                                'rounded-lg border px-2 py-2.5 text-center text-[13px] font-medium transition-all',
                                active
                                  ? 'grad-brand border-brand-600/40 text-white shadow-sm'
                                  : 'border-line-strong bg-surface text-ink hover:border-brand-400',
                              )}
                            >
                              {formatClock(s.minutes)}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {/* Who is coming is a dispatcher's decision, not a client's. The
                public page never offered a real choice anyway — it listed
                whoever happened to be free — and naming technicians to clients
                invites requests for one by name, which is how a rota falls
                over. */}
            {mode === 'dispatch' && slot && slot.free.length > 1 && (
              <label className="mt-4 block">
                <FieldLabel>Assign to</FieldLabel>
                <Select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                  {slot.free.map((t: Technician) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}

            {slot && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 dark:border-brand-800 dark:bg-brand-950">
                <Clock className="size-4 shrink-0 text-brand-500" />
                <span className="text-[13px] font-medium text-ink">
                  {shortDate(day!)} · {formatClock(slot.minutes)}
                </span>
                <span className="text-[11px] text-ink-3">{availability.slotMinutes} min on site</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ------------------------------- 4. review ---------------------------- */}
      {step === 3 && slot && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            One last look. Anything wrong, tap the step above to go back and change it.
          </p>

          <dl className="divide-y divide-line rounded-xl border border-line bg-surface-2 text-[13px]">
            {[
              [
                'When',
                `${longDate(day!)} at ${formatClock(slot.minutes)} · about ${availability.slotMinutes} minutes`,
                CalendarDays,
              ],
              ['Equipment', `${form.equipment}${form.model ? ` · ${form.model}` : ''}`, Wrench],
              ['Fault', form.issue.trim(), Info],
              ['Urgency', `${priority?.label} — ${priority?.summary}`, AlertTriangle],
              ['Where', `${form.client.trim()} · ${form.address.trim()}`, MapPin],
              [
                'Contact',
                [form.contact.trim(), normalisePhone(form.phone) ?? form.phone.trim(), form.email.trim()]
                  .filter(Boolean)
                  .join(' · '),
                User,
              ],
            ].map(([label, value, Icon]) => (
              <div key={label as string} className="flex items-start gap-3 px-4 py-3">
                {React.createElement(Icon as React.ElementType, { className: 'mt-0.5 size-4 shrink-0 text-ink-3' })}
                <div className="min-w-0">
                  <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label as string}</dt>
                  <dd className="mt-0.5 break-words text-ink">{(value as string) || '—'}</dd>
                </div>
              </div>
            ))}
          </dl>

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((file, i) =>
                file.kind === 'video' ? (
                  <video
                    key={i}
                    src={file.url}
                    className="size-14 rounded-lg border border-line object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <img key={i} src={file.url} alt="" className="size-14 rounded-lg border border-line object-cover" />
                ),
              )}
            </div>
          )}

          <label className="block">
            <FieldLabel hint="Parking, which gate to use, when the kitchen is quiet — anything that helps.">
              Anything else we should know?
            </FieldLabel>
            <Textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Deliveries use the back gate on Rizal St. Kitchen is closed 2–4 PM."
              className="min-h-16 text-[14px]"
            />
          </label>

          {priority && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" />
              As a {priority.label} we undertake to come back to you within{' '}
              {priority.respondHours < 24
                ? `${priority.respondHours} hours`
                : `${priority.respondHours / 24} working day${priority.respondHours === 24 ? '' : 's'}`}
              , and the clock starts the moment you confirm.
            </p>
          )}
        </div>
      )}

      {/* -------------------------------- footer ------------------------------ */}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-critical/10 px-3 py-2 text-[12px] text-critical ring-1 ring-critical/25 ring-inset"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
        {step > (mode === 'dispatch' ? 2 : 0) ? (
          <Button variant="secondary" size="lg" onClick={back}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
        ) : (
          <span />
        )}

        {step < STEPS.length - 1 ? (
          <Button variant="primary" size="lg" className="ml-auto" onClick={next}>
            Continue
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="ml-auto" disabled={busy || !slot} onClick={submit}>
            <Check className="size-4" />
            Confirm this visit
          </Button>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        Each visit is blocked out for {availability.slotMinutes} minutes with {availability.travelBufferMinutes} minutes
        of travel either side, so the time you pick is a time somebody can actually keep.
      </p>
    </div>
  )
}

/** Letterheaded wrapper — the public page and the print-out share it. */
export function BookingLetterhead({ children }: { children: React.ReactNode }) {
  const company = useCompany()

  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt="" className="size-11 rounded-lg object-contain" />
            ) : (
              <span className="grad-brand flex size-11 items-center justify-center rounded-lg text-base font-bold text-white">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold tracking-tight text-ink uppercase">{company.name}</p>
              <p className="text-[11px] font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-400">
                Engineering Department · Service Booking
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-ink-3">
            {company.phone && (
              <p>
                <a href={`tel:${company.phone.replace(/\s/g, '')}`} className="hover:text-brand-600">
                  {company.phone}
                </a>
              </p>
            )}
            {company.email && <p>{company.email}</p>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>

      <footer className="border-t border-line py-5 text-center text-[11px] text-ink-3">
        © {new Date().getFullYear()} {company.legalName || company.name} · {company.address}
      </footer>
    </div>
  )
}
