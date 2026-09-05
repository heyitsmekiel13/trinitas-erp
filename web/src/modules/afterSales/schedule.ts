import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_AVAILABILITY,
  addWorkingMinutes,
  conflictFor,
  dateKey,
  type Availability,
  type Technician,
  type Visit,
  type VisitEvent,
  type VisitStatus,
  type Window,
} from '@/data/scheduling'
import { priorityOf, type ServiceReport } from '@/data/afterSales'
import {
  contractDueDates,
  coverFor,
  type KaizenAction,
  type ServiceContract,
} from '@/data/serviceQuality'

/**
 * The After-Sales working state.
 *
 * Five things live here and refer to each other, which is the whole point:
 *
 *   availability → who may be booked, when
 *   contracts    → who is under cover, and what falls due
 *   visits       → what has been booked, by whom, and how it went
 *   reports      → what happened on the visit, and what it earned
 *   kaizen       → what we are changing about the process, and whether it moved
 *
 * A visit carries the ticket it answers, the contract that covers it, the
 * report it produced and — when it failed to fix the problem — the visit it is
 * a return for. That last link is new and is the one that makes the whole
 * thing measurable: without it a back job looks exactly like fresh work.
 *
 * Booking goes through `book()` rather than pushing onto the array, because the
 * overlap check has to happen at the moment of writing. A slot list rendered
 * ten seconds ago is a guess; the state at save time is the truth.
 */

export type BookingRequest = {
  ticket: string
  technicianId: string
  start: string
  end: string
  client: string
  address: string
  clientType: Visit['clientType']
  contact: string
  phone: string
  email: string
  equipment: Visit['equipment']
  units?: Visit['units']
  issue: string
  priority: Visit['priority']
  notes: string
  source: Visit['source']
  /** Photos or video the client attached. */
  attachments?: string[]
  /** Set when this visit is a return for one that did not fix the fault. */
  backJobOf?: string | null
}

export type BookingResult = { ok: true; visit: Visit } | { ok: false; reason: string }

type ScheduleState = {
  availability: Availability
  technicians: Technician[]
  visits: Visit[]
  reports: ServiceReport[]
  contracts: ServiceContract[]
  kaizen: KaizenAction[]
  seeded: boolean

  seedTechnicians: (names: string[]) => void

  /* availability — the supervisor's controls */
  setAvailability: (patch: Partial<Availability>) => void
  setShopWeek: (weekday: number, windows: Window[]) => void
  toggleBlackout: (day: string) => void
  upsertTechnician: (technician: Technician) => void
  removeTechnician: (id: string) => void
  toggleTechnicianBlackout: (id: string, day: string) => void

  /* commitments */
  book: (request: BookingRequest) => BookingResult
  reschedule: (id: string, technicianId: string, start: string, end: string) => BookingResult
  setVisitStatus: (id: string, status: VisitStatus) => void
  cancelVisit: (id: string, reason?: string) => void
  attachReport: (visitId: string, reportId: string) => void

  /* the service-level and outcome chain */
  recordResponse: (id: string, note?: string) => void
  recordOutcome: (id: string, outcome: string) => void
  recordCsat: (id: string, score: number, comment?: string) => void
  findByCode: (code: string) => Visit | null

  /* reports */
  saveReport: (report: ServiceReport) => void
  removeReport: (id: string) => void

  /* contracts */
  upsertContract: (contract: ServiceContract) => void
  removeContract: (id: string) => void
  /** Books the PMS visits an agreement implies. Returns what it managed to place. */
  generateContractVisits: (
    contractId: string,
    throughISO: string,
  ) => { booked: number; skipped: { day: string; reason: string }[] }

  /* improvement register */
  upsertKaizen: (action: KaizenAction) => void
  removeKaizen: (id: string) => void
}

const reference = (visits: Visit[]) => `SV-${String(2600 + visits.length + 1)}`

/**
 * The code a client quotes to find their own booking.
 *
 * Six characters from an alphabet with no O/0 or I/1, because this gets read
 * down a phone line to somebody standing next to a broken oven. Random rather
 * than sequential so one client cannot walk the range and read another's job.
 */
const PUBLIC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const publicCode = () =>
  Array.from({ length: 6 }, () => PUBLIC_ALPHABET[Math.floor(Math.random() * PUBLIC_ALPHABET.length)]).join('')

const event = (label: string, detail?: string): VisitEvent => ({
  at: new Date().toISOString(),
  label,
  ...(detail ? { detail } : {}),
})

/**
 * Fills in everything a visit stored before this version never had.
 *
 * Old bookings keep a null `respondBy` rather than being given one now: a
 * target invented retrospectively would let the SLA report claim attainment on
 * calls that were never measured against anything.
 */
function reviveVisit(visit: Partial<Visit> & { id: string }): Visit {
  return {
    respondBy: null,
    respondedAt: null,
    arrivedAt: null,
    departedAt: null,
    outcome: null,
    units: visit.equipment ? [visit.equipment] : [],
    backJobOf: null,
    contractId: null,
    publicCode: publicCode(),
    csat: null,
    csatComment: '',
    attachments: [],
    timeline: [],
    ...visit,
  } as Visit
}

/** The same, for reports written before the coded fields existed. */
function reviveReport(report: ServiceReport): ServiceReport {
  return {
    ...report,
    symptom: report.symptom ?? '',
    cause: report.cause ?? '',
    action: report.action ?? '',
    outcome: report.outcome ?? '',
    parts: report.parts ?? [],
    labourHours: report.labourHours ?? 0,
  }
}

export const useSchedule = create<ScheduleState>()(
  persist(
    (set, get) => ({
      availability: DEFAULT_AVAILABILITY,
      technicians: [],
      visits: [],
      reports: [],
      contracts: [],
      kaizen: [],
      seeded: false,

      /**
       * Builds the roster from the names the revenue workbook already records.
       *
       * Those are the people who actually attend jobs, which is a better roster
       * than the HR list — it excludes office staff and includes the two who
       * only ever appear as `BRENCHELL | ELSON`.
       */
      seedTechnicians: (names) => {
        if (get().seeded || !names.length) return
        set({
          seeded: true,
          technicians: names.map((name, i) => ({
            id: `tech-${i + 1}`,
            name,
            active: true,
            week: null,
            blackouts: [],
            maxPerDay: 3,
            skills: [],
          })),
        })
      },

      /* ---------------------------- availability --------------------------- */

      setAvailability: (patch) => set((s) => ({ availability: { ...s.availability, ...patch } })),

      setShopWeek: (weekday, windows) =>
        set((s) => {
          const week = s.availability.week.map((day, i) => (i === weekday ? windows : day))
          return { availability: { ...s.availability, week } }
        }),

      toggleBlackout: (day) =>
        set((s) => ({
          availability: {
            ...s.availability,
            blackouts: s.availability.blackouts.includes(day)
              ? s.availability.blackouts.filter((d) => d !== day)
              : [...s.availability.blackouts, day].sort(),
          },
        })),

      upsertTechnician: (technician) =>
        set((s) => {
          const i = s.technicians.findIndex((t) => t.id === technician.id)
          if (i < 0) return { technicians: [...s.technicians, technician] }
          const next = [...s.technicians]
          next[i] = technician
          return { technicians: next }
        }),

      removeTechnician: (id) => set((s) => ({ technicians: s.technicians.filter((t) => t.id !== id) })),

      toggleTechnicianBlackout: (id, day) =>
        set((s) => ({
          technicians: s.technicians.map((t) =>
            t.id === id
              ? {
                  ...t,
                  blackouts: t.blackouts.includes(day)
                    ? t.blackouts.filter((d) => d !== day)
                    : [...t.blackouts, day].sort(),
                }
              : t,
          ),
        })),

      /* ---------------------------- commitments ---------------------------- */

      book: (request) => {
        const { technicians, visits, availability, contracts } = get()
        const technician = technicians.find((t) => t.id === request.technicianId)
        if (!technician) return { ok: false, reason: 'That technician is no longer on the roster.' }

        // Re-checked here, not trusted from the slot the client clicked.
        const conflict = conflictFor(technician, request.start, request.end, availability, visits)
        if (conflict) return { ok: false, reason: conflict }

        const now = new Date()
        const contract = coverFor(contracts, request.client, request.equipment, now)

        /**
         * The response promise, fixed at the moment it is made.
         *
         * A contract may undertake something faster than the standard table;
         * where it does, the tighter of the two applies, because that is what
         * the client is paying for.
         */
        const standardHours = priorityOf(request.priority)?.respondHours ?? null
        const contractHours = contract?.responseHours ?? null
        const promisedHours =
          standardHours != null && contractHours != null
            ? Math.min(standardHours, contractHours)
            : (contractHours ?? standardHours)

        const visit: Visit = {
          id: reference(visits),
          ticket: request.ticket,
          technicianId: technician.id,
          technicianName: technician.name,
          start: request.start,
          end: request.end,
          status: 'Scheduled',
          client: request.client,
          address: request.address,
          clientType: request.clientType,
          contact: request.contact,
          phone: request.phone,
          email: request.email,
          equipment: request.equipment,
          units: request.units?.length ? request.units : [request.equipment],
          issue: request.issue,
          priority: request.priority,
          notes: request.notes,
          reportId: null,
          createdAt: now.toISOString(),
          source: request.source,

          respondBy:
            promisedHours == null
              ? null
              : addWorkingMinutes(now, promisedHours * 60, availability).toISOString(),
          respondedAt: null,
          arrivedAt: null,
          departedAt: null,
          outcome: null,
          backJobOf: request.backJobOf ?? null,
          contractId: contract?.id ?? null,
          publicCode: publicCode(),
          csat: null,
          csatComment: '',
          attachments: request.attachments ?? [],
          timeline: [
            event(
              request.backJobOf ? 'Return visit booked' : 'Booked',
              request.source === 'Client booking' ? 'By the client, on the booking page' : request.source,
            ),
          ],
        }

        set({ visits: [...visits, visit] })
        return { ok: true, visit }
      },

      reschedule: (id, technicianId, start, end) => {
        const { technicians, visits, availability } = get()
        const visit = visits.find((v) => v.id === id)
        if (!visit) return { ok: false, reason: 'That visit no longer exists.' }

        const technician = technicians.find((t) => t.id === technicianId)
        if (!technician) return { ok: false, reason: 'That technician is no longer on the roster.' }

        // The visit being moved must not block itself.
        const conflict = conflictFor(technician, start, end, availability, visits, id)
        if (conflict) return { ok: false, reason: conflict }

        const next: Visit = {
          ...visit,
          technicianId: technician.id,
          technicianName: technician.name,
          start,
          end,
          status: visit.status === 'Cancelled' || visit.status === 'No show' ? 'Scheduled' : visit.status,
          timeline: [
            ...(visit.timeline ?? []),
            event(
              'Rescheduled',
              `${new Date(visit.start).toLocaleString('en-PH')} → ${new Date(start).toLocaleString('en-PH')}`,
            ),
          ],
        }
        set({ visits: visits.map((v) => (v.id === id ? next : v)) })
        return { ok: true, visit: next }
      },

      /**
       * Moves a visit's state and stamps the clock that state implies.
       *
       * `On site` and `Completed` write the arrival and departure times, which
       * is where time-on-site comes from. Asking a technician to type two
       * timestamps into a form after the fact produced the round-number
       * fiction the paper pad is full of — every job somehow two hours long.
       */
      setVisitStatus: (id, status) =>
        set((s) => ({
          visits: s.visits.map((v) => {
            if (v.id !== id) return v
            const now = new Date().toISOString()
            return {
              ...v,
              status,
              respondedAt: v.respondedAt ?? (status === 'En route' || status === 'On site' ? now : null),
              arrivedAt: status === 'On site' ? (v.arrivedAt ?? now) : v.arrivedAt,
              departedAt: status === 'Completed' ? (v.departedAt ?? now) : v.departedAt,
              timeline: [...(v.timeline ?? []), event(status)],
            }
          }),
        })),

      cancelVisit: (id, reason) =>
        set((s) => ({
          visits: s.visits.map((v) =>
            v.id === id
              ? {
                  ...v,
                  status: 'Cancelled',
                  notes: reason ? `${v.notes}\nCancelled: ${reason}`.trim() : v.notes,
                  timeline: [...(v.timeline ?? []), event('Cancelled', reason)],
                }
              : v,
          ),
        })),

      attachReport: (visitId, reportId) =>
        set((s) => ({
          visits: s.visits.map((v) =>
            v.id === visitId
              ? {
                  ...v,
                  reportId,
                  status: 'Completed',
                  departedAt: v.departedAt ?? new Date().toISOString(),
                  timeline: [...(v.timeline ?? []), event('Report written', reportId)],
                }
              : v,
          ),
        })),

      recordResponse: (id, note) =>
        set((s) => ({
          visits: s.visits.map((v) =>
            v.id === id && !v.respondedAt
              ? {
                  ...v,
                  respondedAt: new Date().toISOString(),
                  timeline: [...(v.timeline ?? []), event('Client contacted', note)],
                }
              : v,
          ),
        })),

      recordOutcome: (id, outcome) =>
        set((s) => ({
          visits: s.visits.map((v) =>
            v.id === id ? { ...v, outcome, timeline: [...(v.timeline ?? []), event('Outcome', outcome)] } : v,
          ),
        })),

      recordCsat: (id, score, comment) =>
        set((s) => ({
          visits: s.visits.map((v) =>
            v.id === id
              ? {
                  ...v,
                  csat: score,
                  csatComment: comment ?? '',
                  timeline: [...(v.timeline ?? []), event('Rated by the client', `${score} of 5`)],
                }
              : v,
          ),
        })),

      findByCode: (code) => {
        const wanted = code.trim().toUpperCase()
        if (!wanted) return null
        return (
          get().visits.find((v) => v.publicCode === wanted || v.id.toUpperCase() === wanted) ?? null
        )
      },

      /* ------------------------------- reports ----------------------------- */

      saveReport: (report) =>
        set((s) => {
          const i = s.reports.findIndex((r) => r.id === report.id)
          if (i < 0) return { reports: [report, ...s.reports] }
          const next = [...s.reports]
          next[i] = report
          return { reports: next }
        }),

      removeReport: (id) => set((s) => ({ reports: s.reports.filter((r) => r.id !== id) })),

      /* ------------------------------ contracts ---------------------------- */

      upsertContract: (contract) =>
        set((s) => {
          const i = s.contracts.findIndex((c) => c.id === contract.id)
          if (i < 0) return { contracts: [...s.contracts, contract] }
          const next = [...s.contracts]
          next[i] = contract
          return { contracts: next }
        }),

      removeContract: (id) => set((s) => ({ contracts: s.contracts.filter((c) => c.id !== id) })),

      /**
       * Turns an agreement into actual bookings.
       *
       * Planned maintenance that lives only as a frequency on a contract is
       * not planned at all — it is remembered, and it is remembered late. This
       * places a real visit for each due date, refusing rather than forcing the
       * ones that clash, and reports what it could not place so a supervisor
       * can deal with those few by hand.
       *
       * `generatedThrough` moves forward only over the range actually walked,
       * so running it twice never books the same month twice.
       */
      generateContractVisits: (contractId, throughISO) => {
        const state = get()
        const contract = state.contracts.find((c) => c.id === contractId)
        if (!contract || !contract.active) return { booked: 0, skipped: [] }

        const from = contract.generatedThrough
          ? new Date(new Date(`${contract.generatedThrough}T00:00:00`).getTime() + 86_400_000)
          : new Date()
        const to = new Date(`${throughISO}T00:00:00`)
        const skipped: { day: string; reason: string }[] = []
        let booked = 0

        for (const day of contractDueDates(contract, from, to)) {
          // Planned work goes mid-morning: early enough to finish inside the
          // day, late enough that a breakdown call still has the 8am slot.
          const start = new Date(`${day}T10:00:00`)
          const end = new Date(start.getTime() + get().availability.slotMinutes * 60_000)

          const equipment = contract.equipment[0] ?? 'Others'
          const free = get().technicians.filter(
            (t) =>
              t.active &&
              !conflictFor(t, start.toISOString(), end.toISOString(), get().availability, get().visits),
          )
          const preferred = free.find((t) => !t.skills.length || t.skills.includes(equipment)) ?? free[0]

          if (!preferred) {
            skipped.push({ day, reason: 'Nobody free that morning' })
            continue
          }

          const result = get().book({
            ticket: '',
            technicianId: preferred.id,
            start: start.toISOString(),
            end: end.toISOString(),
            client: contract.client,
            address: contract.address,
            clientType: contract.clientType as Visit['clientType'],
            contact: contract.contact,
            phone: contract.phone,
            email: contract.email,
            equipment,
            issue: `Planned maintenance under ${contract.reference}.`,
            priority: 4,
            notes: `Contract ${contract.reference} · ${contract.coverage}`,
            source: 'Contract',
          })

          if (result.ok) booked++
          else skipped.push({ day, reason: result.reason })
        }

        set((s) => ({
          contracts: s.contracts.map((c) =>
            c.id === contractId ? { ...c, generatedThrough: throughISO } : c,
          ),
        }))

        return { booked, skipped }
      },

      /* -------------------------- improvement register --------------------- */

      upsertKaizen: (action) =>
        set((s) => {
          const i = s.kaizen.findIndex((k) => k.id === action.id)
          if (i < 0) return { kaizen: [action, ...s.kaizen] }
          const next = [...s.kaizen]
          next[i] = action
          return { kaizen: next }
        }),

      removeKaizen: (id) => set((s) => ({ kaizen: s.kaizen.filter((k) => k.id !== id) })),
    }),
    {
      name: 'trinitas.aftersales.schedule',
      version: 2,
      /**
       * Version 1 threw the state away on every upgrade.
       *
       * That was survivable when the store held nothing a business would miss.
       * It is not survivable now: a wipe would discard real bookings, signed
       * reports and live agreements. This migration adds the new fields to what
       * is already there and keeps every record.
       */
      migrate: (persisted) => {
        const old = (persisted ?? {}) as Partial<ScheduleState>
        return {
          availability: { ...DEFAULT_AVAILABILITY, ...(old.availability ?? {}) },
          technicians: old.technicians ?? [],
          visits: (old.visits ?? []).map((v) => reviveVisit(v)),
          reports: (old.reports ?? []).map((r) => reviveReport(r)),
          contracts: old.contracts ?? [],
          kaizen: old.kaizen ?? [],
          seeded: old.seeded ?? false,
        } as unknown as ScheduleState
      },
      partialize: (s) =>
        ({
          availability: s.availability,
          technicians: s.technicians,
          visits: s.visits,
          reports: s.reports,
          contracts: s.contracts,
          kaizen: s.kaizen,
          seeded: s.seeded,
        }) as unknown as ScheduleState,
    },
  ),
)

/** Visits on one day, earliest first. */
export const visitsOn = (visits: Visit[], day: string) =>
  visits
    .filter((v) => dateKey(new Date(v.start)) === day)
    .sort((a, b) => a.start.localeCompare(b.start))

export const VISIT_TONE: Record<VisitStatus, 'neutral' | 'info' | 'good' | 'warning' | 'critical'> = {
  Scheduled: 'info',
  'En route': 'warning',
  'On site': 'warning',
  Completed: 'good',
  Cancelled: 'neutral',
  'No show': 'critical',
}
