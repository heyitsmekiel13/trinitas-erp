import type { EquipmentType, Priority, ClientType } from './afterSales'

/**
 * Service scheduling.
 *
 * A repair visit is not a meeting: it has travel either side of it, it is done
 * by a named person who cannot be in two places, and the person who decides
 * when it can happen is the supervisor, not the client. So the model has three
 * layers, and the client only ever sees the third:
 *
 *   availability   what the supervisor allows — days, hours, blackout dates
 *   commitments    what is already booked, per technician
 *   offered slots  availability minus commitments, minus travel time
 *
 * Everything here is pure. The store decides what is booked; this decides what
 * *could* be, and refuses to produce a slot that would double-book anyone.
 */

/* ========================================================================== */
/* AVAILABILITY                                                               */
/* ========================================================================== */

/** Minutes since midnight — comparable, and free of timezone surprises. */
export type Minutes = number

export type Window = { start: Minutes; end: Minutes }

export const toMinutes = (hhmm: string): Minutes => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export const toClock = (minutes: Minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

export function formatClock(minutes: Minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** The shop's default week — Monday to Saturday, with a lunch break. */
export const DEFAULT_WEEK: Window[][] = [
  [], // Sunday closed
  [{ start: 480, end: 720 }, { start: 780, end: 1020 }],
  [{ start: 480, end: 720 }, { start: 780, end: 1020 }],
  [{ start: 480, end: 720 }, { start: 780, end: 1020 }],
  [{ start: 480, end: 720 }, { start: 780, end: 1020 }],
  [{ start: 480, end: 720 }, { start: 780, end: 1020 }],
  [{ start: 480, end: 720 }], // Saturday, morning only
]

export type Technician = {
  id: string
  name: string
  /** Off duty entirely — keeps history without offering new slots. */
  active: boolean
  /** Overrides the shop week when set; null means "follow the shop". */
  week: Window[][] | null
  /** ISO dates this person is not available at all. */
  blackouts: string[]
  /** A hard cap, so a keen dispatcher cannot stack twelve calls on one van. */
  maxPerDay: number
  /** What this technician is trusted to work on. Empty means anything. */
  skills: EquipmentType[]
}

export type Availability = {
  /** The shop-wide week every technician follows unless they override it. */
  week: Window[][]
  /** How long a standard visit is blocked out for. */
  slotMinutes: number
  /** Travel and paperwork either side — the reason two visits cannot touch. */
  travelBufferMinutes: number
  /** Nothing may be booked closer than this to now. */
  leadTimeHours: number
  /** How far ahead the public page will offer. */
  horizonDays: number
  /** Shop-wide closures — holidays, stock-take, the Christmas party. */
  blackouts: string[]
  /** Turns the public page off without deleting anything. */
  publicBookingOpen: boolean

  /**
   * Lead time for a Priority 1 call.
   *
   * The standard lead time and the Priority 1 promise were in flat
   * contradiction: the SLA undertakes to respond to a non-operational or
   * unsafe unit within four hours, and the booking page refused anything
   * inside twelve. A client whose fryer is smoking could not book the visit
   * the SLA promised them. Priority 1 now has its own, shorter lead time.
   */
  emergencyLeadTimeHours: number
  /** Fully-loaded cost of one technician-hour, for job margin. */
  labourRatePerHour: number
  /** Whether a client may move or cancel their own visit from the tracking page. */
  allowClientReschedule: boolean
  /** How close to the visit a client may still change it themselves. */
  rescheduleCutoffHours: number
  /** Ask the client to rate the visit once it is completed. */
  collectCsat: boolean
}

export const DEFAULT_AVAILABILITY: Availability = {
  week: DEFAULT_WEEK,
  /*
   * One hour, which is what makes the shop week four slots a morning and four
   * an afternoon: 8, 9, 10, 11 and 1, 2, 3, 4. At two hours the same windows
   * only yielded two of each, so half the day's capacity was invisible to
   * anybody trying to book into it.
   *
   * Only the starting grid. A supervisor can widen it per shop under
   * Availability, and existing installs keep whatever they already saved.
   */
  slotMinutes: 60,
  travelBufferMinutes: 45,
  leadTimeHours: 12,
  horizonDays: 45,
  blackouts: [],
  publicBookingOpen: true,
  emergencyLeadTimeHours: 3,
  labourRatePerHour: 320,
  allowClientReschedule: true,
  rescheduleCutoffHours: 12,
  collectCsat: true,
}

/* ========================================================================== */
/* COMMITMENTS                                                                */
/* ========================================================================== */

export const VISIT_STATUSES = ['Scheduled', 'En route', 'On site', 'Completed', 'Cancelled', 'No show'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]

export type Visit = {
  id: string
  /** The repair ticket this visit answers. */
  ticket: string
  technicianId: string
  technicianName: string
  /** ISO instants. End already excludes travel — the buffer sits outside it. */
  start: string
  end: string
  status: VisitStatus
  client: string
  address: string
  clientType: ClientType
  contact: string
  phone: string
  email: string
  /**
   * The unit the visit is matched and scheduled on.
   *
   * Stays a single value because that is what technician skills, the slot
   * grid and the contract check are all keyed to. It is the first of `units`.
   */
  equipment: EquipmentType
  /**
   * Everything the client reported on this call.
   *
   * One visit routinely covers three broken things in the same kitchen, and
   * the form used to accept one — so the other two went into the fault
   * description as prose and the technician arrived with parts for one of
   * them. Recording the list is what lets the report say what was actually
   * looked at.
   */
  units: EquipmentType[]
  issue: string
  priority: Priority | null
  notes: string
  /** Set once a technician's report has been written against this visit. */
  reportId: string | null
  createdAt: string
  /** How the visit got here — the public page or a dispatcher. */
  source: 'Client booking' | 'Dispatcher' | 'Contract'

  /* ---------------------------------------------------------------------- */
  /* Service level                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * When the client was promised a first response, in working hours.
   *
   * Set at booking from the priority, so the clock is fixed by the promise
   * made rather than recalculated later against whatever the SLA table
   * happens to say today. A target that moves is not a target.
   */
  respondBy: string | null
  /** When somebody actually made contact. Stops the response clock. */
  respondedAt: string | null

  /* ---------------------------------------------------------------------- */
  /* What happened on the day                                               */
  /* ---------------------------------------------------------------------- */

  /** Stamped when the technician marks themselves on site — the real time in. */
  arrivedAt: string | null
  /** Stamped on completion — the real time out. */
  departedAt: string | null
  /** How the visit ended, from VISIT_OUTCOMES. Drives first-time-fix. */
  outcome: string | null

  /* ---------------------------------------------------------------------- */
  /* Links                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * The visit this one is a return for.
   *
   * The whole first-time-fix measure rests on this one field. Without it a
   * back job is indistinguishable from a fresh call, and a business that
   * cannot see its rework rate will always believe it is lower than it is.
   */
  backJobOf: string | null
  /** The maintenance agreement this visit falls under, where one covers it. */
  contractId: string | null

  /* ---------------------------------------------------------------------- */
  /* The client's side                                                      */
  /* ---------------------------------------------------------------------- */

  /** Short code the client quotes to track, move or cancel their own visit. */
  publicCode: string
  /** 1–5, captured after completion. */
  csat: number | null
  csatComment: string
  /** Photos or video the client attached when booking. */
  attachments: string[]
  /** Every state change, in order — who did what and when. */
  timeline: VisitEvent[]
}

/** One entry in a visit's audit trail. */
export type VisitEvent = { at: string; label: string; detail?: string }

/* ========================================================================== */
/* SERVICE-LEVEL CLOCK                                                        */
/* ========================================================================== */

/**
 * SLA arithmetic in working hours, not wall-clock hours.
 *
 * A four-hour promise made at 4pm on a Saturday is not due at 8pm on a
 * Saturday — the shop shuts at noon and does not open again until Monday. Any
 * SLA report built on plain elapsed time marks that call breached before
 * anybody could legitimately have attended it, and a metric that punishes the
 * team for being closed gets switched off within a month.
 *
 * Both functions walk the availability week a day at a time. The horizon caps
 * the walk so a misconfigured week (every day closed) terminates instead of
 * spinning.
 */
const SLA_HORIZON_DAYS = 400

/** The working minutes available on one date. */
function workingMinutesOn(day: string, availability: Availability): Window[] {
  if (availability.blackouts.includes(day)) return []
  const weekday = atMinutes(day, 0).getDay()
  return availability.week[weekday] ?? []
}

/** The instant `minutes` of *working* time after `from`. */
export function addWorkingMinutes(from: Date, minutes: number, availability: Availability): Date {
  let remaining = Math.max(0, Math.round(minutes))
  const cursor = new Date(from)

  for (let i = 0; i < SLA_HORIZON_DAYS; i++) {
    const day = dateKey(cursor)
    const windows = workingMinutesOn(day, availability)
    const fromMinutes = i === 0 ? cursor.getHours() * 60 + cursor.getMinutes() : 0

    for (const window of windows) {
      const start = Math.max(window.start, fromMinutes)
      if (start >= window.end) continue
      const usable = window.end - start
      if (remaining <= usable) return atMinutes(day, start + remaining)
      remaining -= usable
    }

    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
  }

  // A week with no open windows at all: fall back to elapsed time rather than
  // returning a date four hundred days out and calling everything breached.
  return new Date(from.getTime() + minutes * 60_000)
}

/** Working minutes between two instants. Negative spans return zero. */
export function workingMinutesBetween(a: Date, b: Date, availability: Availability): number {
  if (b <= a) return 0
  let total = 0
  const cursor = new Date(a)

  for (let i = 0; i < SLA_HORIZON_DAYS; i++) {
    const day = dateKey(cursor)
    if (cursor > b && dateKey(cursor) !== dateKey(b)) break

    for (const window of workingMinutesOn(day, availability)) {
      const dayStart = atMinutes(day, window.start).getTime()
      const dayEnd = atMinutes(day, window.end).getTime()
      const from = Math.max(dayStart, a.getTime())
      const to = Math.min(dayEnd, b.getTime())
      if (to > from) total += (to - from) / 60_000
    }

    cursor.setDate(cursor.getDate() + 1)
    cursor.setHours(0, 0, 0, 0)
    if (cursor.getTime() > b.getTime()) break
  }

  return Math.round(total)
}

export type SlaState = {
  /** Working minutes left before the promise is broken. Negative once breached. */
  minutesLeft: number
  breached: boolean
  /** Inside the last quarter of the window — the point worth acting on. */
  atRisk: boolean
  /** Set once the response actually happened, so the clock stops. */
  met: boolean | null
}

/**
 * Where a visit stands against the response it was promised.
 *
 * Returns null when no promise was recorded — historical visits booked before
 * the SLA clock existed. Showing those as "on target" would inflate the
 * attainment figure with rows that were never measured.
 */
export function slaState(visit: Visit, availability: Availability, now: Date = new Date()): SlaState | null {
  if (!visit.respondBy) return null
  const due = new Date(visit.respondBy)

  if (visit.respondedAt) {
    const responded = new Date(visit.respondedAt)
    return {
      minutesLeft: workingMinutesBetween(responded, due, availability) || -workingMinutesBetween(due, responded, availability),
      breached: responded > due,
      atRisk: false,
      met: responded <= due,
    }
  }

  if (visit.status === 'Cancelled') return null

  const breached = now > due
  const minutesLeft = breached
    ? -workingMinutesBetween(due, now, availability)
    : workingMinutesBetween(now, due, availability)

  // A quarter of the original window is the usual escalation trigger: early
  // enough to reassign somebody, late enough not to cry wolf on every call.
  const total = workingMinutesBetween(new Date(visit.createdAt), due, availability) || 1

  return {
    minutesLeft,
    breached,
    atRisk: !breached && minutesLeft <= total * 0.25,
    met: null,
  }
}

/* ========================================================================== */
/* SLOT MATH                                                                  */
/* ========================================================================== */

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function atMinutes(day: string, minutes: Minutes) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1, Math.floor(minutes / 60), minutes % 60, 0, 0)
}

/** Two intervals overlap when each starts before the other ends. */
export const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && bStart < aEnd

/** The windows a technician actually works on a given date. */
export function windowsFor(technician: Technician, availability: Availability, day: string): Window[] {
  if (!technician.active) return []
  if (availability.blackouts.includes(day) || technician.blackouts.includes(day)) return []

  const weekday = atMinutes(day, 0).getDay()
  const week = technician.week ?? availability.week
  return week[weekday] ?? []
}

export type Slot = {
  /** ISO instant the visit would start. */
  start: string
  end: string
  minutes: Minutes
  /** Technicians free for this exact slot. */
  free: Technician[]
}

/**
 * Every slot that could still be booked on a day.
 *
 * A slot survives only if at least one technician is free for its whole length
 * *plus* the travel buffer on both sides, is under their daily cap, and — when
 * the caller names an equipment type — is trusted to work on it.
 */
export function slotsForDay(
  day: string,
  technicians: Technician[],
  availability: Availability,
  visits: Visit[],
  options: { equipment?: EquipmentType; now?: Date; ignoreVisitId?: string; priority?: Priority | null } = {},
): Slot[] {
  const { slotMinutes, travelBufferMinutes } = availability
  const now = options.now ?? new Date()
  // Priority 1 is a four-hour promise; refusing it a slot for twelve hours
  // made the booking page unable to honour the SLA printed beside it.
  const leadTimeHours =
    options.priority === 1 ? (availability.emergencyLeadTimeHours ?? availability.leadTimeHours) : availability.leadTimeHours
  const earliest = now.getTime() + leadTimeHours * 3_600_000

  const live = visits.filter(
    (v) => v.status !== 'Cancelled' && v.status !== 'No show' && v.id !== options.ignoreVisitId,
  )

  // Grid positions are shared across technicians so the client sees one column
  // of times rather than a different set per person.
  const positions = new Set<Minutes>()
  for (const technician of technicians) {
    for (const window of windowsFor(technician, availability, day)) {
      for (let m = window.start; m + slotMinutes <= window.end; m += slotMinutes) positions.add(m)
    }
  }

  const slots: Slot[] = []

  for (const minutes of [...positions].sort((a, b) => a - b)) {
    const start = atMinutes(day, minutes)
    const end = atMinutes(day, minutes + slotMinutes)
    if (start.getTime() < earliest) continue

    const free = technicians.filter((technician) => {
      if (options.equipment && technician.skills.length && !technician.skills.includes(options.equipment)) {
        return false
      }

      const windows = windowsFor(technician, availability, day)
      const fits = windows.some((w) => minutes >= w.start && minutes + slotMinutes <= w.end)
      if (!fits) return false

      const theirs = live.filter((v) => v.technicianId === technician.id)
      const sameDay = theirs.filter((v) => dateKey(new Date(v.start)) === day)
      if (sameDay.length >= technician.maxPerDay) return false

      // The buffer is applied to the *existing* commitments, so a booking is
      // refused when it would leave no time to travel between the two.
      return !theirs.some((visit) =>
        overlaps(
          start.getTime(),
          end.getTime(),
          new Date(visit.start).getTime() - travelBufferMinutes * 60_000,
          new Date(visit.end).getTime() + travelBufferMinutes * 60_000,
        ),
      )
    })

    if (free.length) {
      slots.push({ start: start.toISOString(), end: end.toISOString(), minutes, free })
    }
  }

  return slots
}

/** Days in the horizon that still have at least one slot. */
export function openDays(
  technicians: Technician[],
  availability: Availability,
  visits: Visit[],
  options: { equipment?: EquipmentType; from?: Date; days?: number; priority?: Priority | null } = {},
): Set<string> {
  const from = options.from ?? new Date()
  const days = options.days ?? availability.horizonDays
  const open = new Set<string>()

  for (let i = 0; i < days; i++) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    const key = dateKey(d)
    if (
      slotsForDay(key, technicians, availability, visits, {
        equipment: options.equipment,
        priority: options.priority,
      }).length
    ) {
      open.add(key)
    }
  }

  return open
}

/**
 * Why a proposed booking cannot be taken.
 *
 * Returns null when it can. Checked again at save time rather than trusted
 * from the button that was clicked, because two people can pick the same slot
 * from two browsers a second apart.
 */
export function conflictFor(
  technician: Technician,
  start: string,
  end: string,
  availability: Availability,
  visits: Visit[],
  ignoreVisitId?: string,
): string | null {
  const day = dateKey(new Date(start))
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()

  if (!technician.active) return `${technician.name} is off duty.`
  if (availability.blackouts.includes(day)) return 'The shop is closed that day.'
  if (technician.blackouts.includes(day)) return `${technician.name} is not available that day.`

  const minutes = new Date(start).getHours() * 60 + new Date(start).getMinutes()
  const length = Math.round((endMs - startMs) / 60_000)
  const windows = windowsFor(technician, availability, day)
  if (!windows.some((w) => minutes >= w.start && minutes + length <= w.end)) {
    return `That time is outside ${technician.name}'s working hours.`
  }

  const live = visits.filter(
    (v) => v.status !== 'Cancelled' && v.status !== 'No show' && v.id !== ignoreVisitId && v.technicianId === technician.id,
  )

  const clash = live.find((visit) =>
    overlaps(
      startMs,
      endMs,
      new Date(visit.start).getTime() - availability.travelBufferMinutes * 60_000,
      new Date(visit.end).getTime() + availability.travelBufferMinutes * 60_000,
    ),
  )
  if (clash) {
    return `${technician.name} is already at ${clash.client || 'another job'} around then — allow ${availability.travelBufferMinutes} minutes to travel.`
  }

  if (live.filter((v) => dateKey(new Date(v.start)) === day).length >= technician.maxPerDay) {
    return `${technician.name} already has ${technician.maxPerDay} visits that day.`
  }

  return null
}
