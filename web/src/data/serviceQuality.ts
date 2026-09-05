/**
 * Service quality — the vocabulary the after-sales process is measured in.
 *
 * The module could already say what a job *earned*. It could not say whether
 * the job was any good, and that is the half a service business is actually
 * judged on. Three things were missing and all three are structural rather
 * than cosmetic:
 *
 *   1. A closed fault vocabulary. `findings` is free text, so "compressor
 *      busted", "compresor defective" and "COMP. FAILURE" are three different
 *      causes to a computer and one cause to a technician. Nothing can be
 *      Pareto-charted out of prose, which means root cause analysis has never
 *      been possible on this data.
 *
 *   2. A link from a return visit back to the visit that failed to fix it.
 *      `Rework (Back job)` exists as a request type and `Back Job` exists as a
 *      repair status, but neither points at anything. First-Time Fix Rate —
 *      the headline metric of every field-service organisation on earth — was
 *      therefore uncomputable.
 *
 *   3. Cost of the labour. Revenue and reimbursables were recorded; the hours
 *      that produced them were not, so "margin" meant fee minus fuel and
 *      flattered every long job.
 *
 * This file supplies the vocabularies and the arithmetic. It holds no state
 * and knows nothing about React.
 */

import type { EquipmentType } from './afterSales'

/* ========================================================================== */
/* FAULT TAXONOMY — symptom / cause / action                                  */
/* ========================================================================== */

/**
 * The three-code structure field service settled on decades ago.
 *
 * The client reports a SYMPTOM ("it trips the breaker"). The technician finds
 * a CAUSE ("shorted heating element"). The technician takes an ACTION
 * ("replaced part"). Recording all three separately is what makes the
 * difference between "we did 900 repairs" and "37% of our oven calls are one
 * failing element we could stock".
 *
 * Kept deliberately short. A taxonomy nobody can pick from in four seconds
 * gets filled in with whatever is at the top of the list, and a mandatory
 * field answered at random is worse than no field.
 */
export const SYMPTOM_CODES = [
  'Will not start',
  'Stops during operation',
  'Trips the breaker',
  'Not heating / not cooling',
  'Overheating',
  'Unusual noise',
  'Leaking (water)',
  'Leaking (gas / refrigerant)',
  'Burning smell or smoke',
  'Controls unresponsive',
  'Display error code',
  'Door or lid fault',
  'Poor output quality',
  'Physical damage',
  'Routine service due',
] as const
export type SymptomCode = (typeof SYMPTOM_CODES)[number]

/**
 * Causes, each carrying its Ishikawa bone.
 *
 * The 6M grouping is not decoration: it decides who owns the fix. A cause in
 * `Method` or `People` is a training or standard-work problem the service
 * business owns. A cause in `Machine` is a design or parts problem. A cause in
 * `Environment` — dirty power, no ventilation — belongs to the client's site
 * and is the single most common thing an installer argues about after the
 * fact. Grouping them means the improvement page can say where the losses sit
 * rather than just which part broke most often.
 */
export const ISHIKAWA_CATEGORIES = [
  'Machine',
  'Method',
  'Material',
  'People',
  'Measurement',
  'Environment',
] as const
export type IshikawaCategory = (typeof ISHIKAWA_CATEGORIES)[number]

export const CAUSE_CODES: { code: string; category: IshikawaCategory; note: string }[] = [
  { code: 'Component wear (normal life)', category: 'Machine', note: 'Reached expected service life.' },
  { code: 'Component failure (premature)', category: 'Machine', note: 'Failed well short of expected life.' },
  { code: 'Electrical fault / short', category: 'Machine', note: 'Wiring, contactor, element or motor winding.' },
  { code: 'Control board or sensor fault', category: 'Machine', note: 'Electronics rather than mechanics.' },
  { code: 'Refrigerant loss', category: 'Machine', note: 'Leak, undercharge or blockage.' },

  { code: 'Missed preventive service', category: 'Method', note: 'PMS overdue — failure was foreseeable.' },
  { code: 'Incorrect earlier repair', category: 'Method', note: 'Our own work did not hold. Counts as rework.' },
  { code: 'Wrong installation / commissioning', category: 'Method', note: 'Levelling, clearance, ducting, wiring.' },

  { code: 'Wrong or substandard part fitted', category: 'Material', note: 'Non-OEM or incorrect specification.' },
  { code: 'Consumable exhausted', category: 'Material', note: 'Filter, belt, gasket, seal.' },

  { code: 'Operator error / misuse', category: 'People', note: 'Overloading, wrong premix, forced door.' },
  { code: 'No operator training', category: 'People', note: 'Nobody on site was shown how to run it.' },
  { code: 'Cleaning not performed', category: 'People', note: 'End-of-day routine skipped.' },

  { code: 'No fault found', category: 'Measurement', note: 'Reproduced nothing. Often a reporting problem.' },
  { code: 'Misdiagnosed on the first visit', category: 'Measurement', note: 'Counts against first-time fix.' },

  { code: 'Power quality (no AVR / brownout)', category: 'Environment', note: 'Site supply outside tolerance.' },
  { code: 'Ventilation or ambient heat', category: 'Environment', note: 'Insufficient clearance or extraction.' },
  { code: 'Water quality / scaling', category: 'Environment', note: 'Hard water, no softener.' },
  { code: 'Pest, dust or grease ingress', category: 'Environment', note: 'Site housekeeping.' },
] as const

export const causeCategory = (code: string): IshikawaCategory | null =>
  CAUSE_CODES.find((c) => c.code === code)?.category ?? null

export const ACTION_CODES = [
  'Cleaned and adjusted',
  'Part replaced',
  'Part repaired in place',
  'Rewired / re-terminated',
  'Refrigerant recovered and recharged',
  'Software or control reset',
  'Recommissioned / re-levelled',
  'Operator retrained on site',
  'Advised — no work required',
  'Quoted, awaiting client approval',
  'Escalated — parts to order',
] as const
export type ActionCode = (typeof ACTION_CODES)[number]

/* ========================================================================== */
/* OUTCOME — did the visit actually finish the job?                           */
/* ========================================================================== */

/**
 * How a visit ended, from the point of view of the client's problem.
 *
 * `Fixed on this visit` is the only value that counts towards first-time fix.
 * The rest are all deferrals, and separating *why* it was deferred is what
 * tells you whether the problem is the parts van, the quoting turnaround or
 * the diagnosis.
 */
export const VISIT_OUTCOMES = [
  { code: 'Fixed on this visit', firstTimeFix: true, tone: 'good' },
  { code: 'Return needed — parts to order', firstTimeFix: false, tone: 'warning' },
  { code: 'Return needed — quote approval', firstTimeFix: false, tone: 'warning' },
  { code: 'Return needed — more time required', firstTimeFix: false, tone: 'warning' },
  { code: 'Return needed — wrong diagnosis', firstTimeFix: false, tone: 'critical' },
  { code: 'Could not access the equipment', firstTimeFix: false, tone: 'critical' },
  { code: 'No fault found', firstTimeFix: true, tone: 'neutral' },
  { code: 'Beyond economic repair', firstTimeFix: true, tone: 'neutral' },
] as const
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number]['code']

export const outcomeOf = (code: string | null | undefined) =>
  VISIT_OUTCOMES.find((o) => o.code === code) ?? null

export const isFirstTimeFix = (code: string | null | undefined) => outcomeOf(code)?.firstTimeFix === true

/* ========================================================================== */
/* PARTS AND JOB COSTING                                                      */
/* ========================================================================== */

/**
 * A part consumed on a job.
 *
 * `cost` is what it cost us, `price` what the client is charged. Keeping both
 * is the only way the margin figure means anything — a job that recovers its
 * fuel but gives away a ₱9,000 compressor is a loss the revenue report was
 * previously reporting as a win.
 */
export type PartLine = {
  id: string
  /** Warehouse SKU where one exists; free text is accepted for over-the-counter buys. */
  sku: string
  description: string
  quantity: number
  /** Our landed cost per unit. */
  cost: number
  /** Charged to the client per unit. Zero when supplied under warranty. */
  price: number
  /** Supplied free because the unit or the earlier repair was under warranty. */
  underWarranty: boolean
}

export const blankPart = (): PartLine => ({
  id: `p-${Math.random().toString(36).slice(2, 9)}`,
  sku: '',
  description: '',
  quantity: 1,
  cost: 0,
  price: 0,
  underWarranty: false,
})

/**
 * What one technician-hour costs the business.
 *
 * A fully-loaded rate, not a wage: salary, statutory contributions, the van,
 * tools and the idle hours between jobs. Held as a setting because it moves
 * with the wage order, and because a business that cannot change it will
 * quietly stop believing the margin column.
 */
export const DEFAULT_LABOUR_RATE_PER_HOUR = 320

export type JobCosting = {
  revenueService: number
  revenueParts: number
  revenueRecovered: number
  /** Everything invoiced to the client. */
  billed: number
  costParts: number
  costLabour: number
  costTravel: number
  cost: number
  margin: number
  /** Percent. Null when nothing was billed, rather than a misleading zero. */
  marginPct: number | null
}

export function costJob(input: {
  serviceRevenue: number
  recoveredCosts: number
  parts: PartLine[]
  labourHours: number
  labourRate?: number
}): JobCosting {
  const rate = input.labourRate ?? DEFAULT_LABOUR_RATE_PER_HOUR
  const revenueParts = input.parts.reduce((s, p) => s + (p.underWarranty ? 0 : p.price * p.quantity), 0)
  const costParts = input.parts.reduce((s, p) => s + p.cost * p.quantity, 0)
  const costLabour = input.labourHours * rate

  const billed = input.serviceRevenue + revenueParts + input.recoveredCosts
  // Reimbursables are recovered at cost, so they wash: they appear on both
  // sides and change the margin percentage without changing the peso margin.
  const cost = costParts + costLabour + input.recoveredCosts

  return {
    revenueService: input.serviceRevenue,
    revenueParts,
    revenueRecovered: input.recoveredCosts,
    billed,
    costParts,
    costLabour,
    costTravel: input.recoveredCosts,
    cost,
    margin: billed - cost,
    marginPct: billed > 0 ? ((billed - cost) / billed) * 100 : null,
  }
}

/* ========================================================================== */
/* CLIENT SATISFACTION                                                        */
/* ========================================================================== */

/**
 * A five-point CSAT captured after the visit, not a ten-point NPS.
 *
 * NPS asks whether you would recommend the company; after a broken freezer
 * that measures the relationship, not the repair. CSAT on the specific visit
 * is what a service desk can actually act on, and five points is what fits on
 * a phone without a scroll.
 */
export const CSAT_SCALE = [
  { score: 1, label: 'Very poor', tone: 'critical' },
  { score: 2, label: 'Poor', tone: 'critical' },
  { score: 3, label: 'Acceptable', tone: 'warning' },
  { score: 4, label: 'Good', tone: 'good' },
  { score: 5, label: 'Excellent', tone: 'good' },
] as const

/** Satisfied = 4 or 5. The industry's usual "top-two-box" definition. */
export const isSatisfied = (score: number | null | undefined) => score != null && score >= 4

/* ========================================================================== */
/* SERVICE CONTRACTS                                                          */
/* ========================================================================== */

/**
 * A maintenance agreement.
 *
 * `PMS` was one of the revenue columns and one of the repair types, which is
 * how the workbook recorded planned maintenance: after the fact, as though it
 * had been an unplanned call. A contract turns that around — the visits are
 * generated from the agreement, the agreement carries the entitlement, and a
 * client under cover is not asked for a card at the door.
 *
 * This is also the single largest commercial gap in the module as it stood.
 * Contract revenue is recurring and forecastable; call-out revenue is neither.
 */
export const CONTRACT_FREQUENCIES = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'bimonthly', label: 'Every 2 months', months: 2 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'semiannual', label: 'Twice a year', months: 6 },
  { id: 'annual', label: 'Annually', months: 12 },
] as const
export type ContractFrequency = (typeof CONTRACT_FREQUENCIES)[number]['id']

export const frequencyMonths = (id: ContractFrequency) =>
  CONTRACT_FREQUENCIES.find((f) => f.id === id)?.months ?? 3

/** What the agreement covers when a call comes in. */
export const COVERAGE_LEVELS = [
  {
    id: 'pms-only',
    label: 'Planned maintenance only',
    detail: 'Scheduled visits are covered. Breakdown call-outs are charged as usual.',
  },
  {
    id: 'labour',
    label: 'Planned maintenance + labour',
    detail: 'Scheduled visits and call-out labour are covered. Parts are charged.',
  },
  {
    id: 'full',
    label: 'Full cover',
    detail: 'Scheduled visits, call-out labour and parts are all covered.',
  },
] as const
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number]['id']

export type ServiceContract = {
  id: string
  reference: string
  client: string
  /** The site the covered equipment sits at. */
  address: string
  clientType: string
  contact: string
  phone: string
  email: string
  equipment: EquipmentType[]
  frequency: ContractFrequency
  coverage: CoverageLevel
  startDate: string
  endDate: string
  /** Billed per period, for the recurring-revenue figure. */
  value: number
  /** A tighter promise than the standard SLA, in hours. Null follows the default. */
  responseHours: number | null
  /** Visits generated so far, so re-running generation never duplicates. */
  generatedThrough: string | null
  active: boolean
  notes: string
}

/** Contracts covering a client + equipment pair on a given date. */
export function coverFor(
  contracts: ServiceContract[],
  client: string,
  equipment: EquipmentType,
  on: Date = new Date(),
): ServiceContract | null {
  const day = on.toISOString().slice(0, 10)
  const name = client.trim().toLowerCase()
  if (!name) return null

  return (
    contracts.find(
      (c) =>
        c.active &&
        c.client.trim().toLowerCase() === name &&
        c.startDate <= day &&
        c.endDate >= day &&
        (c.equipment.length === 0 || c.equipment.includes(equipment)),
    ) ?? null
  )
}

/** The PMS dates an agreement implies between two points in time. */
export function contractDueDates(contract: ServiceContract, from: Date, to: Date): string[] {
  const months = frequencyMonths(contract.frequency)
  const start = new Date(`${contract.startDate}T00:00:00`)
  const end = new Date(`${contract.endDate}T00:00:00`)
  const dates: string[] = []

  for (let i = 0; i < 240; i++) {
    const due = new Date(start)
    due.setMonth(start.getMonth() + i * months)
    if (due > end) break
    if (due >= from && due <= to) {
      dates.push(
        `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
      )
    }
  }

  return dates
}

/* ========================================================================== */
/* KAIZEN — the improvement register                                          */
/* ========================================================================== */

/** Where a countermeasure sits in the DMAIC cycle. */
export const KAIZEN_STAGES = ['Define', 'Measure', 'Analyze', 'Improve', 'Control'] as const
export type KaizenStage = (typeof KAIZEN_STAGES)[number]

export const KAIZEN_STATUSES = ['Proposed', 'In progress', 'Piloting', 'Adopted', 'Dropped'] as const
export type KaizenStatus = (typeof KAIZEN_STATUSES)[number]

/**
 * One countermeasure against one root cause.
 *
 * Deliberately opinionated about two fields most action registers omit:
 * `metric` and `baseline`. An improvement action with no stated measure is a
 * good intention, and the reason most Lean programmes die is a register full
 * of them. Recording what the action is supposed to move — and what that
 * number was before — is what lets the Control phase say whether it worked.
 */
export type KaizenAction = {
  id: string
  title: string
  /** The root cause it attacks, from CAUSE_CODES where one applies. */
  rootCause: string
  category: IshikawaCategory | null
  stage: KaizenStage
  status: KaizenStatus
  owner: string
  due: string | null
  /** Which CTQ metric this is meant to move. */
  metric: string
  baseline: number | null
  target: number | null
  /** Waste type in the lean sense — kept plain-language. */
  waste: string
  notes: string
  createdAt: string
  closedAt: string | null
}

/**
 * The eight wastes, worded for a service business rather than a factory.
 *
 * "Transport" in a plant means moving material between machines; here it is a
 * van crossing the city twice in a day because two calls in the same barangay
 * were booked a week apart. Naming them in the language of the work is the
 * difference between a team that uses this and a team that files it.
 */
export const SERVICE_WASTES = [
  { id: 'travel', label: 'Travel', example: 'Two calls on the same street booked a week apart.' },
  { id: 'waiting', label: 'Waiting', example: 'Technician on site waiting for a client decision or a key.' },
  { id: 'rework', label: 'Rework', example: 'A back job — the same fault attended twice.' },
  { id: 'motion', label: 'Motion', example: 'Returning to the shop for a part that should be on the van.' },
  { id: 'inventory', label: 'Inventory', example: 'Slow-moving spares tying up cash on the shelf.' },
  { id: 'overprocessing', label: 'Over-processing', example: 'The same client details keyed into three documents.' },
  { id: 'defects', label: 'Defects', example: 'A TSR returned because the charge or signature is missing.' },
  { id: 'talent', label: 'Unused skill', example: 'A senior technician sent to a filter change.' },
] as const
