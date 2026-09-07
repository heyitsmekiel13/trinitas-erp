/**
 * After-Sales — the service business behind the equipment.
 *
 * Three documents run it today, all on paper or in a spreadsheet:
 *
 *   MSR  the client's repair request — a Google Form, 937 tickets so far
 *   TSR  what the technician found and did — a carbon-copy pad, series 5451+
 *   MRR  what the job cost and earned — a monthly workbook, one tab per month
 *
 * They describe one job and never agree, because nothing links them: the MSR
 * has a ticket number the MRR mostly leaves blank, and the TSR exists only as a
 * photograph of a piece of paper filed under `ROBATA KID_JUNE 1_5313.jpg`.
 *
 * The shape below is the join those three were reaching for. A request becomes
 * a job; a job carries the technician's report and its own money. Written once,
 * read everywhere — so "what did we earn on that oven" stops being an
 * archaeology exercise.
 */

import { costJob, type PartLine } from './serviceQuality'

/* ========================================================================== */
/* CONTROLLED VOCABULARIES                                                    */
/* ========================================================================== */

/**
 * The client segments, as the business actually uses them.
 *
 * The intake form left this free-text and collected 279 distinct spellings of
 * roughly seven values — "INSTITUTIONAL (GENERAL)", "Institutional (General)",
 * "GENERAL(INSTITUTIONAL)" and so on. They are the same segment, and a report
 * grouped on the raw text says otherwise.
 */
export const CLIENT_TYPES = [
  'Panadero',
  'Institutional',
  'CHBC',
  'JBYL Group',
  'PDF',
  'Company-Owned',
  'Franchise',
] as const
export type ClientType = (typeof CLIENT_TYPES)[number]

/** The four the TSR footer asks Operations to justify against. */
export const JUSTIFICATION_CODES = ['JBYL', 'CHBC', 'INSTI', 'PDF'] as const
export type JustificationCode = (typeof JUSTIFICATION_CODES)[number]

/** Billable work classes — these are the MRR's revenue columns. */
export const REPAIR_TYPES = [
  'Check-up',
  'Minor Repair',
  'Major Repair',
  'PMS',
  'System Reprocess',
  'Commissioning',
  'Installation',
  'Others',
] as const
export type RepairType = (typeof REPAIR_TYPES)[number]

/** Reimbursables — money spent reaching the job, recovered from the client. */
export const COST_TYPES = ['Fuel', 'Meals', 'Barge', 'Accommodition', 'Transportation'] as const
export type CostType = (typeof COST_TYPES)[number]

/** Equipment classes, from the TSR's tick-list plus what the intake sees. */
export const EQUIPMENT_TYPES = [
  'Convection Oven',
  'Oven',
  'Chinese Wok',
  'Rotisserie',
  'Bread Showcase',
  'Proofer',
  'Dish Washer',
  'Spiral Mixer',
  'Planetary Mixer',
  'Mixer',
  'Ice Maker',
  'Chiller',
  'Cake Chiller',
  'Freezer',
  'Meat Slicer',
  'Bread Slicer',
  'Fryer',
  'Rice Steamer',
  'Griddle / Grill',
  'Dough Sheeter',
  'Stove / Range',
  'Exhaust / Hood',
  'Air Conditioning',
  'Water Dispenser',
  'Others',
] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]

/**
 * Urgency, with the definitions the intake form already spells out.
 *
 * These are good — they describe operational impact rather than how cross the
 * caller sounded — so they are kept verbatim and given a response target,
 * which is the part the form was missing.
 *
 * The labels are words rather than numbers. "Priority 1" tells a reader
 * nothing on its own: it has to be looked up, and half the people reading a
 * ticket never do, so a P1 and a P4 look equally alarming at a glance. The
 * level survives as `level` for sorting and for the records already imported
 * against it — it just stops being what anybody is shown.
 */
export const PRIORITIES = [
  {
    level: 1,
    label: 'Critical',
    summary: 'Non-operational or a safety risk',
    detail: 'Equipment is non-operational or involves high safety risk.',
    respondHours: 4,
    tone: 'critical',
  },
  {
    level: 2,
    label: 'Urgent',
    summary: 'Major function down, work continues',
    detail: 'A major function is down but operations continue in a limited way.',
    respondHours: 24,
    tone: 'serious',
  },
  {
    level: 3,
    label: 'Standard',
    summary: 'Minimal effect, still usable',
    detail: 'The issue has minimal effect on operation and the unit is still usable.',
    respondHours: 72,
    tone: 'warning',
  },
  {
    level: 4,
    label: 'Scheduled',
    summary: 'Needs shutdown, no impact',
    detail: 'Requires equipment shutdown with no operational impact.',
    respondHours: 168,
    tone: 'neutral',
  },
] as const

export type Priority = 1 | 2 | 3 | 4

export const priorityOf = (level: number | null | undefined) =>
  PRIORITIES.find((p) => p.level === level) ?? null

/** A controlled version of "Preferred Time", which collected 324 spellings. */
export const VISIT_WINDOWS = [
  { id: 'asap', label: 'As soon as possible', hint: 'Any slot today or tomorrow' },
  { id: 'morning', label: 'Morning', hint: '8:00 AM – 12:00 NN' },
  { id: 'afternoon', label: 'Afternoon', hint: '1:00 PM – 5:00 PM' },
  { id: 'anytime', label: 'Any time during business hours', hint: '8:00 AM – 5:00 PM' },
] as const
export type VisitWindow = (typeof VISIT_WINDOWS)[number]['id']

export const REQUEST_TYPES = ['New Repair Request', 'Rework (Back job)'] as const
export type RequestType = (typeof REQUEST_TYPES)[number]

export const REQUEST_STATUSES = ['Pending', 'For Scheduling', 'Scheduled', 'Done', 'Cancelled'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/* ========================================================================== */
/* THE TECHNICIAN SERVICE REPORT                                              */
/* ========================================================================== */

/** Ticked on the paper form's Equipment/Parts Specification block. */
export const PART_SOURCES = [
  'Brand New',
  'Service Unit',
  'Replacement Unit',
  'Unit Locally-SO',
  'Parts from Overseas',
] as const
export type PartSource = (typeof PART_SOURCES)[number]

export const WARRANTY_STATES = ['Under Warranty', 'Beyond Warranty'] as const
export type WarrantyState = (typeof WARRANTY_STATES)[number]

export const PURCHASED_BY = ['PKE', 'Client'] as const

/** The ten standing recommendations pre-printed on the form. */
export const STANDARD_RECOMMENDATIONS = [
  'Equipment subject for immediate PMS',
  'Follow required premix / no overloading',
  'Operate the equipment with utmost care',
  'Gently open the door / avoid banging',
  'Equipment EOD cleaning is necessary',
  'To change compressor assembly',
  'To change fan blower assembly',
  'To change heating element / component',
  'Gently press switches to avoid damage',
  'Equipment should have an HD-AVR',
] as const

/** The repair outcomes the form's right-hand column offers. */
export const REPAIR_STATUSES = [
  'Repaired / Fixed',
  'PMS',
  'Electrical Works',
  'Major Repair',
  'Minor Repair',
  'Pending',
  'Back Job',
  'Pending / Resolved',
  'Back Job / Resolved',
  'Blinds Installation',
  'Minor Civil Works',
  'Major Civil Works',
  'Others',
] as const
export type RepairStatus = (typeof REPAIR_STATUSES)[number]

export type ServiceReport = {
  id: string
  /** The pre-printed pad number — series 5451 and up. */
  series: string
  ticket: string
  client: string
  clientAddress: string
  clientType: ClientType
  reportDate: string
  timeIn: string | null
  timeOut: string | null
  equipment: { type: EquipmentType; description: string }[]
  findings: string
  scopeOfWork: string
  model: string
  serialNo: string
  partSources: PartSource[]
  purchaseDate: string | null
  warranty: WarrantyState | null
  purchasedBy: (typeof PURCHASED_BY)[number] | null
  recommendation: string
  standardRecommendations: string[]
  status: RepairStatus[]
  leadTechnician: string
  assistantTechnician: string
  witnessedBy: string
  witnessDesignation: string
  justification: string
  justificationCode: JustificationCode | null
  /** Money, so the report and the revenue line can never disagree. */
  revenue: Partial<Record<RepairType, number>>
  costs: Partial<Record<CostType, number>>

  /* ---------------------------------------------------------------------- */
  /* Coded outcome — what makes this measurable rather than merely readable  */
  /* ---------------------------------------------------------------------- */

  /**
   * The fault in three coded parts.
   *
   * `findings` and `scopeOfWork` stay exactly as they were: prose is what the
   * client signs and what the next technician reads, and no code list replaces
   * it. These sit alongside so the same job is also countable. A Pareto chart
   * of free text is not a thing.
   */
  symptom: string
  cause: string
  action: string
  /** From VISIT_OUTCOMES — whether the client's problem actually went away. */
  outcome: string
  /** Parts consumed, with what they cost us and what the client paid. */
  parts: PartLine[]
  /**
   * Technician-hours booked to the job, both people counted.
   *
   * Deliberately separate from time on site: a two-man three-hour call is six
   * labour hours, and costing it as three is how a service business convinces
   * itself the difficult jobs are profitable.
   */
  labourHours: number
}

/** Everything the report says about the money, once. */
export function reportCosting(report: ServiceReport, labourRate?: number) {
  return costJob({
    serviceRevenue: sumMoney(report.revenue),
    recoveredCosts: sumMoney(report.costs),
    parts: report.parts ?? [],
    labourHours: report.labourHours ?? 0,
    labourRate,
  })
}

/** Minutes on site, from the two stamps. Null until both are set. */
export function minutesOnSite(report: Pick<ServiceReport, 'timeIn' | 'timeOut'>) {
  if (!report.timeIn || !report.timeOut) return null
  const diff = new Date(report.timeOut).getTime() - new Date(report.timeIn).getTime()
  return diff > 0 ? Math.round(diff / 60_000) : null
}

export function fmtDuration(minutes: number | null) {
  if (minutes === null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m ? `${m}m` : ''}`.trim() : `${m}m`
}

export const sumMoney = (values: Partial<Record<string, number>>) =>
  Object.values(values).reduce<number>((sum, v) => sum + (Number(v) || 0), 0)

/* ========================================================================== */
/* THE RECORDS AS IMPORTED                                                    */
/* ========================================================================== */

/** One row of the intake form. */
export type ServiceRequest = {
  ticket: string
  requestedAt: string | null
  status: RequestStatus
  remarks: string
  client: string
  branch: string
  clientType: ClientType
  clientTypeRaw: string
  contact: string
  phone: string
  email: string
  preferredTime: string
  requestType: string
  priority: Priority | null
  equipment: EquipmentType
  equipmentRaw: string
  issue: string
  attachment: string
}

/** One row of the revenue workbook. */
export type ServiceJob = {
  sheet: string
  tsr: string
  ticket: string
  repairedOn: string | null
  submittedOn: string | null
  clientType: ClientType
  client: string
  address: string
  equipment: EquipmentType
  equipmentRaw: string
  srNo: string
  drNo: string
  requestedWork: string
  repairType: RepairType
  technicians: string[]
  costs: Record<string, number>
  revenue: Record<string, number>
  costTotal: number
  revenueTotal: number
  statedTotal: number
}

export type AfterSalesData = {
  vocabularies: { clientTypes: string[]; repairTypes: string[]; equipment: string[] }
  requests: ServiceRequest[]
  jobs: ServiceJob[]
}

/**
 * Loads the imported history.
 *
 * Served as a static file rather than bundled: it is 1.8 MB of real records,
 * and putting that in the JavaScript would make every page of the ERP pay for
 * a screen only After-Sales opens. Cached after the first read.
 */
let cache: Promise<AfterSalesData> | null = null

export function afterSalesData(): Promise<AfterSalesData> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/after-sales.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load the After-Sales history (${response.status}).`)
      return response.json() as Promise<AfterSalesData>
    })
    .catch((error) => {
      cache = null
      throw error
    })
  return cache
}

/* ========================================================================== */
/* DERIVED FIGURES                                                            */
/* ========================================================================== */

const monthKey = (iso: string | null) => (iso ? iso.slice(0, 7) : null)

/**
 * A date the business could plausibly have worked on.
 *
 * One row carries 2052-12-04, almost certainly a slipped keystroke for 2025.
 * It is left in the record — correcting somebody's book silently is worse than
 * showing it — but excluded from the trend, where a single typo would stretch
 * the axis across thirty empty years and flatten every real month.
 */
export function plausible(iso: string | null) {
  if (!iso) return false
  const year = Number(iso.slice(0, 4))
  const now = new Date().getFullYear()
  return year >= now - 6 && year <= now + 1
}

/** The date a job is filed under: when it was repaired, or failing that, when it was requested. */
export function effectiveJobDate(job: ServiceJob): string | null {
  return plausible(job.repairedOn) ? job.repairedOn : plausible(job.submittedOn) ? job.submittedOn : null
}

/**
 * The numeric core of a ticket reference.
 *
 * The intake writes `00001`; the workbook writes `98.0`, `MRT #: 1203`, `NONE`
 * and `PENDING` in the same column. Stripping non-digits turns `98.0` into 980
 * and matches nothing, so the first run of digits is taken and read as a
 * number — and anything with no digits at all matches nothing, correctly.
 */
function ticketKey(value: string): number | null {
  const digits = /(\d+)/.exec(value ?? '')
  if (!digits) return null
  const n = Number(digits[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export type AfterSalesSummary = {
  jobs: number
  billedJobs: number
  revenue: number
  costs: number
  /** What the client is invoiced: service revenue plus recovered costs. */
  billed: number
  /** Reimbursables as a share of service revenue — the number that hurts. */
  costRatio: number | null
  averageTicket: number | null
  byType: { name: string; jobs: number; value: number }[]
  byCost: { name: string; value: number }[]
  byClientType: { name: string; jobs: number; value: number }[]
  byMonth: { key: string; month: string; revenue: number; costs: number; jobs: number }[]
  technicians: { name: string; jobs: number; revenue: number }[]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function rank(map: Map<string, { jobs: number; value: number }>) {
  return [...map.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value || b.jobs - a.jobs)
}

export function summarise(jobs: ServiceJob[]): AfterSalesSummary {
  const revenue = jobs.reduce((s, j) => s + j.revenueTotal, 0)
  const costs = jobs.reduce((s, j) => s + j.costTotal, 0)
  const billedJobs = jobs.filter((j) => j.revenueTotal > 0).length

  const byType = new Map<string, { jobs: number; value: number }>()
  const byClientType = new Map<string, { jobs: number; value: number }>()
  const byCost = new Map<string, number>()
  const byMonth = new Map<string, { revenue: number; costs: number; jobs: number }>()
  const technicians = new Map<string, { jobs: number; revenue: number }>()

  for (const job of jobs) {
    const type = byType.get(job.repairType) ?? { jobs: 0, value: 0 }
    byType.set(job.repairType, { jobs: type.jobs + 1, value: type.value + job.revenueTotal })

    const client = byClientType.get(job.clientType) ?? { jobs: 0, value: 0 }
    byClientType.set(job.clientType, { jobs: client.jobs + 1, value: client.value + job.revenueTotal })

    for (const [name, value] of Object.entries(job.costs)) {
      if (value) byCost.set(name, (byCost.get(name) ?? 0) + value)
    }

    const key = monthKey(effectiveJobDate(job))
    if (key) {
      const month = byMonth.get(key) ?? { revenue: 0, costs: 0, jobs: 0 }
      byMonth.set(key, {
        revenue: month.revenue + job.revenueTotal,
        costs: month.costs + job.costTotal,
        jobs: month.jobs + 1,
      })
    }

    for (const name of job.technicians) {
      const tech = technicians.get(name) ?? { jobs: 0, revenue: 0 }
      // Revenue is split across everyone who attended, so a two-man job does
      // not count twice and flatter the pair.
      technicians.set(name, {
        jobs: tech.jobs + 1,
        revenue: tech.revenue + job.revenueTotal / job.technicians.length,
      })
    }
  }

  return {
    jobs: jobs.length,
    billedJobs,
    revenue,
    costs,
    billed: revenue + costs,
    costRatio: revenue > 0 ? (costs / revenue) * 100 : null,
    averageTicket: billedJobs > 0 ? revenue / billedJobs : null,
    byType: rank(byType),
    byClientType: rank(byClientType),
    byCost: [...byCost.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    byMonth: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        key,
        month: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`,
        ...v,
      })),
    technicians: [...technicians.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.jobs - a.jobs),
  }
}

/**
 * How long a request waited before anyone responded.
 *
 * The intake records when a request arrived but never when it was picked up,
 * so this measures against the job that closed it where one can be matched on
 * the ticket number. Unmatched requests are excluded rather than counted as
 * instant.
 */
export function responseTimes(requests: ServiceRequest[], jobs: ServiceJob[]) {
  const jobByTicket = new Map<number, ServiceJob>()
  for (const job of jobs) {
    const key = ticketKey(job.ticket)
    if (key !== null && !jobByTicket.has(key)) jobByTicket.set(key, job)
  }

  const measured: { request: ServiceRequest; hours: number; within: boolean }[] = []

  for (const request of requests) {
    const key = ticketKey(request.ticket)
    const job = key !== null ? jobByTicket.get(key) : undefined
    if (!job?.repairedOn || !request.requestedAt) continue

    const hours = (new Date(job.repairedOn).getTime() - new Date(request.requestedAt).getTime()) / 3_600_000
    if (hours < 0) continue

    const target = priorityOf(request.priority)?.respondHours
    measured.push({ request, hours, within: target ? hours <= target : true })
  }

  return {
    matched: measured.length,
    medianHours: measured.length
      ? [...measured].sort((a, b) => a.hours - b.hours)[Math.floor(measured.length / 2)]!.hours
      : null,
    withinTarget: measured.length ? (measured.filter((m) => m.within).length / measured.length) * 100 : null,
  }
}
