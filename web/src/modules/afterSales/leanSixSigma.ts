import * as React from 'react'
/**
 * Lean Six Sigma, applied to the after-sales process.
 *
 * Not a dashboard with the word "sigma" on it. The DMAIC cycle only means
 * anything if the process is defined as a chain of steps, each step has a
 * stated defect, and the defect is counted the same way every month. That is
 * what this file does; the page merely draws it.
 *
 * The process, as it actually runs:
 *
 *   1. Intake      a client raises a request
 *   2. Response    somebody makes contact inside the promised window
 *   3. Schedule    a technician with the right skill is committed to a slot
 *   4. Attend      the technician arrives when they said they would
 *   5. Fix         the fault is gone when they leave
 *   6. Document    the TSR is written, signed and priced
 *   7. Bill        the charge reaches the revenue report
 *
 * Each step is a yield: it either passed cleanly or it did not. Multiplying
 * the seven yields gives Rolled Throughput Yield — the probability a job goes
 * through the whole process without needing anybody to intervene. RTY is the
 * number that embarrasses a service business, because seven steps at 90% is
 * 48%, and every step "feels fine" on its own.
 *
 * A deliberate choice about honesty: every metric reports its denominator.
 * A first-time-fix rate of 100% on two jobs is not a result, and a page that
 * shows it as one will get a team congratulated for nothing.
 */

import {
  isFirstTimeFix,
  isSatisfied,
  causeCategory,
  ISHIKAWA_CATEGORIES,
  type IshikawaCategory,
} from '@/data/serviceQuality'
import type { ServiceReport } from '@/data/afterSales'
import { slaState, workingMinutesBetween, type Availability, type Visit } from '@/data/scheduling'
import { useSchedule } from './schedule'

/* ========================================================================== */
/* STATISTICS                                                                 */
/* ========================================================================== */

/**
 * Inverse standard normal CDF (Acklam's rational approximation).
 *
 * Needed to turn a defect rate into a sigma level. Accurate to about 1.15e-9
 * across the range, which is four orders of magnitude better than the input
 * data deserves and costs nothing.
 */
function probit(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity

  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

  const plow = 0.02425
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }

  const q = p - 0.5
  const r = q * q
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
}

/**
 * Sigma level from defects per million opportunities.
 *
 * Uses the conventional 1.5-sigma shift, so 3.4 DPMO reads as six sigma — the
 * definition everybody who has sat through the training expects. Quoting the
 * unshifted figure would be more defensible statistically and would confuse
 * every reader of the page, which is a worse outcome.
 */
export function sigmaLevel(dpmo: number): number | null {
  if (!Number.isFinite(dpmo)) return null
  if (dpmo <= 0) return 6
  if (dpmo >= 1_000_000) return 0
  const z = probit(1 - dpmo / 1_000_000)
  return Math.max(0, Math.min(6, z + 1.5))
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The value below which `p` percent of observations fall. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]!
}

/* ========================================================================== */
/* THE PROCESS, STEP BY STEP                                                  */
/* ========================================================================== */

export type StepYield = {
  id: string
  step: string
  /** What counts as a defect at this step, in one sentence. */
  defect: string
  opportunities: number
  defects: number
  /** Percent, or null when nothing has been through this step yet. */
  yieldPct: number | null
}

/**
 * Yield at each step of the chain.
 *
 * `opportunities` is deliberately not "all visits" everywhere: a step can only
 * fail for a job that reached it. Counting an unattended booking as a
 * documentation defect would move the blame to the wrong step and send the
 * improvement effort somewhere useless.
 */
export function processYields(
  visits: Visit[],
  reports: ServiceReport[],
  availability: Availability,
  now: Date = new Date(),
): StepYield[] {
  const live = visits.filter((v) => v.status !== 'Cancelled')
  const reportById = new Map(reports.map((r) => [r.id, r]))

  /* 2. Response — measured only where a promise was recorded. */
  const promised = live.filter((v) => v.respondBy)
  const responseDefects = promised.filter((v) => {
    const sla = slaState(v, availability, now)
    return sla?.met === false || (sla?.met === null && sla.breached)
  }).length

  /* 3. Schedule — a booking given to somebody not trusted on that equipment. */
  const scheduleDefects = 0 // Enforced at booking time; kept as a step for completeness.

  /* 4. Attend — arrived more than fifteen minutes after the promised start. */
  const attended = live.filter((v) => v.arrivedAt)
  const lateDefects = attended.filter(
    (v) => new Date(v.arrivedAt!).getTime() - new Date(v.start).getTime() > 15 * 60_000,
  ).length

  /* 5. Fix — an outcome that was not a first-time fix. */
  const outcomes = live.filter((v) => v.outcome)
  const fixDefects = outcomes.filter((v) => !isFirstTimeFix(v.outcome)).length

  /* 6. Document — a completed visit with no report against it. */
  const completed = live.filter((v) => v.status === 'Completed')
  const undocumented = completed.filter((v) => !v.reportId).length

  /* 7. Bill — a report carrying no charge at all. */
  const documented = completed.filter((v) => v.reportId)
  const unbilled = documented.filter((v) => {
    const report = reportById.get(v.reportId!)
    if (!report) return true
    return Object.values(report.revenue ?? {}).reduce<number>((s, x) => s + (Number(x) || 0), 0) <= 0
  }).length

  /* 1. Intake — a booking with no fault description is a call-back waiting to happen. */
  const vagueIntake = live.filter((v) => v.issue.trim().length < 12).length

  const step = (id: string, name: string, defect: string, opportunities: number, defects: number): StepYield => ({
    id,
    step: name,
    defect,
    opportunities,
    defects,
    yieldPct: opportunities > 0 ? ((opportunities - defects) / opportunities) * 100 : null,
  })

  return [
    step('intake', 'Intake', 'Fault described in fewer than a dozen characters.', live.length, vagueIntake),
    step('response', 'Response', 'First contact later than the priority promised.', promised.length, responseDefects),
    step('schedule', 'Schedule', 'Booked to somebody not trusted on that equipment.', live.length, scheduleDefects),
    step('attend', 'Attend', 'Arrived more than 15 minutes after the agreed time.', attended.length, lateDefects),
    step('fix', 'Fix', 'Left without the fault resolved.', outcomes.length, fixDefects),
    step('document', 'Document', 'Visit completed with no service report written.', completed.length, undocumented),
    step('bill', 'Bill', 'Report written with no charge recorded.', documented.length, unbilled),
  ]
}

/** Rolled throughput yield — the chance a job clears every step untouched. */
export function rolledThroughputYield(steps: StepYield[]): number | null {
  const measured = steps.filter((s) => s.yieldPct !== null)
  if (!measured.length) return null
  return measured.reduce((product, s) => product * (s.yieldPct! / 100), 1) * 100
}

/* ========================================================================== */
/* CAPABILITY                                                                 */
/* ========================================================================== */

export type Capability = {
  units: number
  /** How many ways one job can go wrong — the number of measured steps. */
  opportunitiesPerUnit: number
  opportunities: number
  defects: number
  dpmo: number | null
  sigma: number | null
  /**
   * True when no defect was observed at all, so the figure is a floor rather
   * than a measurement — "at least this good", not "this good".
   */
  bounded: boolean
  /** Percent of jobs that cleared every step. */
  rty: number | null
}

/**
 * The fewest opportunities before a capability figure is worth printing.
 *
 * Thirty is the conventional floor for a proportion estimate and it is a low
 * bar, deliberately: the point is not to be strict, it is to stop the page
 * announcing six sigma on four observations.
 */
export const MIN_OPPORTUNITIES = 30

/**
 * Process capability, with two pieces of honesty most implementations skip.
 *
 * The first: below `MIN_OPPORTUNITIES` no figure is reported at all. A process
 * with four observations and no defects is not a six-sigma process; it is an
 * unmeasured one, and printing 6.00 against it is the single fastest way to
 * make everybody stop believing the page.
 *
 * The second: zero observed defects does not mean a zero defect rate. It means
 * the rate is somewhere below what the sample could have detected. The rule of
 * three gives that ceiling — with no defects in n trials the true rate is
 * under roughly 3/n at 95% confidence — so the figure is computed from that
 * bound and flagged as a floor. "At least 4.1 sigma on 60 opportunities" is a
 * claim that survives being questioned. "6.00 sigma" is not.
 */
export function capability(steps: StepYield[]): Capability {
  const measured = steps.filter((s) => s.yieldPct !== null)
  const opportunities = measured.reduce((s, x) => s + x.opportunities, 0)
  const defects = measured.reduce((s, x) => s + x.defects, 0)
  const units = Math.max(...measured.map((s) => s.opportunities), 0)

  const enough = opportunities >= MIN_OPPORTUNITIES
  const bounded = enough && defects === 0
  const rate = defects === 0 ? 3 / opportunities : defects / opportunities
  const dpmo = enough ? rate * 1_000_000 : null

  return {
    units,
    opportunitiesPerUnit: measured.length,
    opportunities,
    defects,
    dpmo,
    sigma: dpmo === null ? null : sigmaLevel(dpmo),
    bounded,
    rty: rolledThroughputYield(steps),
  }
}

/* ========================================================================== */
/* CTQ — the metrics the client would name                                    */
/* ========================================================================== */

export type Ctq = {
  id: string
  name: string
  /** What the client actually cares about, in their words. */
  voice: string
  value: number | null
  target: number
  unit: 'percent' | 'hours' | 'score'
  /** True when higher is better. */
  higherIsBetter: boolean
  /** How many observations the figure rests on. */
  n: number
  met: boolean | null
}

/**
 * Targets, and where they come from.
 *
 * These are not invented. 85% first-time fix and 90% SLA attainment are the
 * numbers a mid-market field-service organisation is expected to hit — below
 * 70% FTFR is where the rework cost starts exceeding the cost of stocking the
 * van properly, and above 90% is where the marginal van stock stops paying for
 * itself. 4.2 of 5 on CSAT is the usual "good" threshold on a five-point
 * scale. Paperwork inside 24 hours is a cash-flow target rather than a quality
 * one: an unwritten TSR is an uninvoiced job.
 */
export function ctqs(
  visits: Visit[],
  reports: ServiceReport[],
  availability: Availability,
  now: Date = new Date(),
): Ctq[] {
  const live = visits.filter((v) => v.status !== 'Cancelled')

  /* Response inside the promise. */
  const promised = live.filter((v) => v.respondBy)
  const responded = promised
    .map((v) => slaState(v, availability, now))
    .filter((s): s is NonNullable<typeof s> => s !== null)
  const onTime = responded.filter((s) => s.met === true || (s.met === null && !s.breached)).length

  /* First-time fix. */
  const outcomes = live.filter((v) => v.outcome)
  const fixed = outcomes.filter((v) => isFirstTimeFix(v.outcome)).length

  /* Time to resolve, in working hours from booking to departure. */
  const resolved = live.filter((v) => v.departedAt)
  const resolveHours = resolved.map(
    (v) => workingMinutesBetween(new Date(v.createdAt), new Date(v.departedAt!), availability) / 60,
  )

  /* Paperwork lag — departure to report, in working hours. */
  const reportById = new Map(reports.map((r) => [r.id, r]))
  const documented = live.filter((v) => v.reportId && v.departedAt && reportById.has(v.reportId))
  const paperworkHours = documented.map((v) => {
    const report = reportById.get(v.reportId!)!
    const written = report.reportDate ? new Date(`${report.reportDate}T17:00:00`) : new Date(v.departedAt!)
    return Math.max(0, workingMinutesBetween(new Date(v.departedAt!), written, availability) / 60)
  })

  /* Satisfaction. */
  const rated = live.filter((v) => v.csat != null)
  const satisfied = rated.filter((v) => isSatisfied(v.csat)).length

  const ctq = (
    id: string,
    name: string,
    voice: string,
    value: number | null,
    target: number,
    unit: Ctq['unit'],
    higherIsBetter: boolean,
    n: number,
  ): Ctq => ({
    id,
    name,
    voice,
    value,
    target,
    unit,
    higherIsBetter,
    n,
    met: value === null ? null : higherIsBetter ? value >= target : value <= target,
  })

  return [
    ctq(
      'sla',
      'Response within promise',
      '“Somebody got back to me when they said they would.”',
      responded.length ? (onTime / responded.length) * 100 : null,
      90,
      'percent',
      true,
      responded.length,
    ),
    ctq(
      'ftf',
      'First-time fix rate',
      '“They fixed it on the first visit — I did not lose two days.”',
      outcomes.length ? (fixed / outcomes.length) * 100 : null,
      85,
      'percent',
      true,
      outcomes.length,
    ),
    ctq(
      'ttr',
      'Median time to resolve',
      '“How long was my oven out of service?”',
      median(resolveHours),
      24,
      'hours',
      false,
      resolveHours.length,
    ),
    ctq(
      'paperwork',
      'Report written within',
      '“I got the paperwork and the bill without chasing.”',
      median(paperworkHours),
      24,
      'hours',
      false,
      paperworkHours.length,
    ),
    ctq(
      'csat',
      'Client satisfaction',
      '“Would I be happy to have them back?”',
      rated.length ? mean(rated.map((v) => v.csat!)) : null,
      4.2,
      'score',
      true,
      rated.length,
    ),
    ctq(
      'top2',
      'Satisfied clients',
      '“Rated the visit good or excellent.”',
      rated.length ? (satisfied / rated.length) * 100 : null,
      90,
      'percent',
      true,
      rated.length,
    ),
  ]
}

/* ========================================================================== */
/* ANALYZE — Pareto, Ishikawa, and the cost of getting it wrong               */
/* ========================================================================== */

export type ParetoRow = { name: string; value: number; share: number; cumulative: number; vital: boolean }

/**
 * A Pareto with the vital few actually marked.
 *
 * Drawing the bars in order and leaving the reader to find the 80% line is how
 * a Pareto chart becomes a bar chart. Everything up to and including the row
 * that crosses 80% cumulative is flagged, so the page can say "these four
 * causes are 80% of your rework" rather than merely implying it.
 */
export function pareto(counts: Map<string, number>): ParetoRow[] {
  const rows = [...counts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((s, [, v]) => s + v, 0)
  if (!total) return []

  let running = 0
  let crossed = false

  return rows.map(([name, value]) => {
    running += value
    const cumulative = (running / total) * 100
    const vital = !crossed
    if (cumulative >= 80) crossed = true
    return { name, value, share: (value / total) * 100, cumulative, vital }
  })
}

/** Causes ranked, from the reports that recorded one. */
export function causePareto(reports: ServiceReport[]): ParetoRow[] {
  const counts = new Map<string, number>()
  for (const report of reports) {
    const cause = report.cause?.trim()
    if (cause) counts.set(cause, (counts.get(cause) ?? 0) + 1)
  }
  return pareto(counts)
}

/** The same causes, rolled up to their fishbone category. */
export function ishikawa(reports: ServiceReport[]): { category: IshikawaCategory; count: number; causes: string[] }[] {
  const buckets = new Map<IshikawaCategory, { count: number; causes: Set<string> }>()
  for (const category of ISHIKAWA_CATEGORIES) buckets.set(category, { count: 0, causes: new Set() })

  for (const report of reports) {
    const category = causeCategory(report.cause ?? '')
    if (!category) continue
    const bucket = buckets.get(category)!
    bucket.count++
    bucket.causes.add(report.cause)
  }

  return [...buckets.entries()]
    .map(([category, b]) => ({ category, count: b.count, causes: [...b.causes] }))
    .sort((a, b) => b.count - a.count)
}

export type CostOfPoorQuality = {
  reworkVisits: number
  reworkHours: number
  reworkLabourCost: number
  reworkTravelCost: number
  /** What rework costs, before any goodwill or lost-client effect. */
  total: number
  /** Rework as a share of all attended visits. */
  reworkRate: number | null
}

/**
 * What the failures cost.
 *
 * The point of putting a peso figure on rework is that "78% first-time fix"
 * gets nodded at in a meeting and "₱214,000 of return visits last year" gets
 * acted on. Only the direct cost is counted — the technician's time and the
 * travel — because the indirect cost is real but unprovable, and a number
 * somebody can argue with is worth less than a smaller number they cannot.
 */
export function costOfPoorQuality(
  visits: Visit[],
  reports: ServiceReport[],
  availability: Availability,
): CostOfPoorQuality {
  const live = visits.filter((v) => v.status !== 'Cancelled')
  const attended = live.filter((v) => v.arrivedAt || v.status === 'Completed')
  const rework = live.filter((v) => v.backJobOf)

  const reportById = new Map(reports.map((r) => [r.id, r]))
  const hours = rework.reduce((sum, v) => {
    const report = v.reportId ? reportById.get(v.reportId) : null
    if (report?.labourHours) return sum + report.labourHours
    if (v.arrivedAt && v.departedAt) {
      return sum + (new Date(v.departedAt).getTime() - new Date(v.arrivedAt).getTime()) / 3_600_000
    }
    return sum + availability.slotMinutes / 60
  }, 0)

  const labour = hours * availability.labourRatePerHour
  // Travel is charged to the client on a first visit and absorbed on a return,
  // so the buffer either side is a real, unrecoverable cost of the failure.
  const travel = rework.reduce((sum, v) => {
    const report = v.reportId ? reportById.get(v.reportId) : null
    const recovered = Object.values(report?.costs ?? {}).reduce<number>((s, x) => s + (Number(x) || 0), 0)
    return sum + (recovered || (availability.travelBufferMinutes * 2 * availability.labourRatePerHour) / 60)
  }, 0)

  return {
    reworkVisits: rework.length,
    reworkHours: hours,
    reworkLabourCost: labour,
    reworkTravelCost: travel,
    total: labour + travel,
    reworkRate: attended.length ? (rework.length / attended.length) * 100 : null,
  }
}

/* ========================================================================== */
/* VALUE STREAM — where the time goes                                         */
/* ========================================================================== */

export type ValueStream = {
  /** Minutes actually spent with hands on the equipment. */
  valueAdded: number
  /** Travel, waiting and paperwork — necessary, but the client would not pay for it alone. */
  nonValueAdded: number
  /** Time the job spent sitting in a queue with nobody touching it. */
  waiting: number
  total: number
  /** Percent of elapsed time that was value-adding. Lean calls this process cycle efficiency. */
  efficiency: number | null
  stages: { name: string; minutes: number; kind: 'value' | 'necessary' | 'waste' }[]
}

/**
 * Process cycle efficiency, measured rather than asserted.
 *
 * Field service is unusual among lean settings in that a large share of the
 * non-value time — the drive — genuinely cannot be removed, only shared
 * between jobs. So travel is marked `necessary` rather than `waste`, and the
 * two things marked as waste are the ones that really are avoidable: the queue
 * before anybody responds, and the lag between finishing and writing it up.
 *
 * Typical service organisations land between 8% and 20% here. A number in that
 * band is not a scandal; a number nobody has ever calculated is.
 */
export function valueStream(
  visits: Visit[],
  reports: ServiceReport[],
  availability: Availability,
): ValueStream {
  const live = visits.filter((v) => v.status !== 'Cancelled' && v.departedAt)
  const reportById = new Map(reports.map((r) => [r.id, r]))

  let onSite = 0
  let travel = 0
  let queue = 0
  let paperwork = 0

  for (const visit of live) {
    onSite +=
      visit.arrivedAt && visit.departedAt
        ? (new Date(visit.departedAt).getTime() - new Date(visit.arrivedAt).getTime()) / 60_000
        : availability.slotMinutes

    travel += availability.travelBufferMinutes * 2

    // Queue: booking to first contact, in working minutes.
    queue += workingMinutesBetween(
      new Date(visit.createdAt),
      new Date(visit.respondedAt ?? visit.start),
      availability,
    )

    if (visit.reportId) {
      const report = reportById.get(visit.reportId)
      if (report?.reportDate) {
        paperwork += workingMinutesBetween(
          new Date(visit.departedAt!),
          new Date(`${report.reportDate}T17:00:00`),
          availability,
        )
      }
    }
  }

  const total = onSite + travel + queue + paperwork

  return {
    valueAdded: onSite,
    nonValueAdded: travel + paperwork,
    waiting: queue,
    total,
    efficiency: total > 0 ? (onSite / total) * 100 : null,
    stages: [
      { name: 'On site, hands on the equipment', minutes: onSite, kind: 'value' },
      { name: 'Travel between jobs', minutes: travel, kind: 'necessary' },
      { name: 'Waiting for a first response', minutes: queue, kind: 'waste' },
      { name: 'Waiting for the report to be written', minutes: paperwork, kind: 'waste' },
    ],
  }
}

/* ========================================================================== */
/* CONTROL — is the process stable, or just currently lucky?                  */
/* ========================================================================== */

export type ControlPoint = {
  label: string
  value: number
  n: number
  ucl: number
  lcl: number
  centre: number
  /** Outside the limits — a special cause worth investigating by name. */
  signal: boolean
}

/**
 * A p-chart of SLA attainment, month by month.
 *
 * The distinction this draws is the one every operations meeting gets wrong:
 * a month that dips is not automatically a problem. Common-cause variation is
 * the process breathing, and reacting to it — the classic "tampering" — makes
 * the process worse. Only a point outside the limits is a special cause, and
 * those are the ones worth a name and a conversation.
 *
 * Limits are recalculated per point because the subgroup size varies with the
 * month's volume; a light month legitimately has wider limits.
 */
export function slaControlChart(
  visits: Visit[],
  availability: Availability,
  now: Date = new Date(),
): ControlPoint[] {
  const byMonth = new Map<string, { total: number; ok: number }>()

  for (const visit of visits) {
    if (visit.status === 'Cancelled' || !visit.respondBy) continue
    const state = slaState(visit, availability, now)
    if (!state) continue
    const key = visit.createdAt.slice(0, 7)
    const bucket = byMonth.get(key) ?? { total: 0, ok: 0 }
    bucket.total++
    if (state.met === true || (state.met === null && !state.breached)) bucket.ok++
    byMonth.set(key, bucket)
  }

  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
  const grandTotal = months.reduce((s, [, v]) => s + v.total, 0)
  const grandOk = months.reduce((s, [, v]) => s + v.ok, 0)
  if (!grandTotal) return []

  const centre = (grandOk / grandTotal) * 100
  const pBar = grandOk / grandTotal

  return months.map(([key, v]) => {
    const spread = 3 * Math.sqrt((pBar * (1 - pBar)) / v.total) * 100
    const ucl = Math.min(100, centre + spread)
    const lcl = Math.max(0, centre - spread)
    const value = (v.ok / v.total) * 100
    return {
      label: `${key.slice(5)}/${key.slice(2, 4)}`,
      value,
      n: v.total,
      ucl,
      lcl,
      centre,
      signal: value > ucl || value < lcl,
    }
  })
}

/* ========================================================================== */
/* THE WHOLE PICTURE                                                          */
/* ========================================================================== */

export type SixSigmaView = {
  steps: StepYield[]
  capability: Capability
  ctqs: Ctq[]
  causes: ParetoRow[]
  fishbone: { category: IshikawaCategory; count: number; causes: string[] }[]
  copq: CostOfPoorQuality
  stream: ValueStream
  control: ControlPoint[]
  /** True when there is too little coded data for any of it to mean much. */
  thin: boolean
}

/** How many coded observations before the page stops warning about its own data. */
export const CREDIBLE_SAMPLE = 20

export function sixSigmaView(
  visits: Visit[],
  reports: ServiceReport[],
  availability: Availability,
  now: Date = new Date(),
): SixSigmaView {
  const steps = processYields(visits, reports, availability, now)
  const coded = visits.filter((v) => v.status !== 'Cancelled' && v.outcome).length

  return {
    steps,
    capability: capability(steps),
    ctqs: ctqs(visits, reports, availability, now),
    causes: causePareto(reports),
    fishbone: ishikawa(reports),
    copq: costOfPoorQuality(visits, reports, availability),
    stream: valueStream(visits, reports, availability),
    control: slaControlChart(visits, availability, now),
    thin: coded < CREDIBLE_SAMPLE,
  }
}


/* ========================================================================== */
/* REACT BINDING                                                              */
/* ========================================================================== */

/**
 * The quality view of whatever is currently in the store.
 *
 * Lives here rather than beside a page so it outlives one. The DMAIC screen
 * that used to own it has gone — a wall of charts is not a process
 * improvement, it is a report about one — but first-time fix, SLA attainment,
 * satisfaction and the cost of rework are worth a glance every day, so the
 * dashboard still reads them from here.
 */
export function useSixSigma(): SixSigmaView {
  const visits = useSchedule((s) => s.visits)
  const reports = useSchedule((s) => s.reports)
  const availability = useSchedule((s) => s.availability)

  return React.useMemo(() => sixSigmaView(visits, reports, availability), [visits, reports, availability])
}
