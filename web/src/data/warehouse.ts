import { Rng } from './seed'
import { dataset } from './dataset'

/**
 * Warehouse floor operations — the vocabulary the department actually works in.
 *
 * Three processes live here, and they deliberately share one language:
 *
 *   receiving  → what arrived, in what condition, who witnessed it, where it went
 *   counting   → what the shelf says versus what the system says, twice a month
 *   dispatch   → what left, in what condition, whether it landed on time and in full
 *
 * The shared language is the condition check: the same physical / functional
 * grading, the same list of process stages, applied at every hand-over. That is
 * what makes "where did this get damaged" answerable instead of a guess — each
 * hand-over records a grade, so the first stage that reports a fault is the
 * stage it happened at.
 */

/** The SKU convention lives in its own import-free module — see `data/sku.ts`. */
export * from './sku'

/* ========================================================================== */
/* CONDITION & DAMAGE TAXONOMY                                                */
/* ========================================================================== */

type CheckTone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

/**
 * Two independent questions, because they fail independently: a generator can
 * arrive in a crushed carton and still start, and a pristine box can hold a
 * dead unit. Asking them separately is what makes the answer useful.
 */
export const PHYSICAL_STATES = [
  { id: 'intact', label: 'Intact', short: 'Intact', tone: 'good', severity: 0, hint: 'Carton and unit clean and whole.' },
  { id: 'scuffed', label: 'Scuffed / scratched', short: 'Scuffed', tone: 'warning', severity: 1, hint: 'Cosmetic only — still sellable.' },
  { id: 'dented', label: 'Dented / bent', short: 'Dented', tone: 'serious', severity: 2, hint: 'Deformed, contents look sound.' },
  { id: 'torn', label: 'Torn / seal opened', short: 'Torn', tone: 'serious', severity: 2, hint: 'Packaging integrity lost.' },
  { id: 'broken', label: 'Cracked / broken', short: 'Broken', tone: 'critical', severity: 3, hint: 'Physically failed.' },
  { id: 'wet', label: 'Water / heat exposure', short: 'Wet', tone: 'critical', severity: 3, hint: 'Soaked, rusted or heat-warped.' },
  { id: 'short', label: 'Missing parts', short: 'Short', tone: 'critical', severity: 3, hint: 'Incomplete against the pack list.' },
] as const

export type PhysicalState = (typeof PHYSICAL_STATES)[number]['id']

export const FUNCTIONAL_STATES = [
  { id: 'na', label: 'Not applicable', short: 'N/A', tone: 'neutral', severity: 0, hint: 'Nothing to switch on.' },
  { id: 'works', label: 'Tested — works', short: 'Works', tone: 'good', severity: 0, hint: 'Powered up and ran correctly.' },
  { id: 'weak', label: 'Intermittent', short: 'Intermittent', tone: 'warning', severity: 2, hint: 'Runs, but not reliably.' },
  { id: 'dead', label: 'Does not work', short: 'Dead', tone: 'critical', severity: 3, hint: 'Failed the function test.' },
] as const

export type FunctionalState = (typeof FUNCTIONAL_STATES)[number]['id']

/**
 * Where in the chain the fault was first seen.
 *
 * Recorded at every hand-over, not just when something is wrong — a run of
 * "clean at receiving, clean at putaway, damaged at picking" points at the
 * aisle, and no amount of arguing with the supplier would have found it.
 */
export const FAULT_STAGES = [
  'At supplier',
  'Inbound transit',
  'Receiving / unloading',
  'Putaway',
  'In storage',
  'Picking',
  'Packing',
  'Outbound transit',
  'At customer',
] as const

export type FaultStage = (typeof FAULT_STAGES)[number]

export const LIABILITIES = ['Supplier', 'Carrier', 'Warehouse', 'Customer', 'Undetermined'] as const
export type Liability = (typeof LIABILITIES)[number]

export type Verdict = 'Good' | 'Serviceable' | 'Defective' | 'Scrap'

export const VERDICT_TONE: Record<Verdict, CheckTone> = {
  Good: 'good',
  Serviceable: 'warning',
  Defective: 'serious',
  Scrap: 'critical',
}

export const DISPOSITIONS = [
  'Put away',
  'Quarantine',
  'Return to supplier',
  'Repair',
  'Salvage parts',
  'Scrap',
] as const

export type Disposition = (typeof DISPOSITIONS)[number]

export type ConditionCheck = {
  physical: PhysicalState
  functional: FunctionalState
  /** Where the fault arose. Ignored while the verdict is Good. */
  stage: FaultStage
  liability: Liability
  disposition: Disposition
  /** How many of the line's units this grade covers. */
  qty: number
  note?: string
}

export const CLEAN_CHECK: ConditionCheck = {
  physical: 'intact',
  functional: 'na',
  stage: 'Receiving / unloading',
  liability: 'Undetermined',
  disposition: 'Put away',
  qty: 0,
}

const physicalSeverity = (id: PhysicalState) => PHYSICAL_STATES.find((s) => s.id === id)?.severity ?? 0
const functionalSeverity = (id: FunctionalState) => FUNCTIONAL_STATES.find((s) => s.id === id)?.severity ?? 0

/**
 * The verdict is derived, never typed.
 *
 * Two people grading the same crate must reach the same word for it, otherwise
 * "defective" means whatever the person holding the scanner felt at the time.
 */
export function verdictFor(physical: PhysicalState, functional: FunctionalState): Verdict {
  const p = physicalSeverity(physical)
  const f = functionalSeverity(functional)
  if (p >= 3) return 'Scrap'
  if (f >= 2 || p === 2) return 'Defective'
  if (p === 1) return 'Serviceable'
  return 'Good'
}

/** What the verdict normally means for the goods. The user can override it. */
export function suggestedDisposition(verdict: Verdict): Disposition {
  return verdict === 'Good' || verdict === 'Serviceable' ? 'Put away' : verdict === 'Defective' ? 'Quarantine' : 'Scrap'
}

/** One line of plain English summarising a check, for logs and print-outs. */
export function describeCheck(check: ConditionCheck) {
  const verdict = verdictFor(check.physical, check.functional)
  const physical = PHYSICAL_STATES.find((s) => s.id === check.physical)?.label ?? check.physical
  const functional = FUNCTIONAL_STATES.find((s) => s.id === check.functional)?.label ?? check.functional
  if (verdict === 'Good') return `${physical}, ${functional.toLowerCase()}`
  return `${physical}, ${functional.toLowerCase()} — first seen at ${check.stage.toLowerCase()} (${check.liability.toLowerCase()})`
}

/* ========================================================================== */
/* STORAGE LOCATION GRID                                                      */
/* ========================================================================== */

export const GRID_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const
export const GRID_ROWS = 8

export function gridCells(): string[] {
  const cells: string[] = []
  for (let row = 1; row <= GRID_ROWS; row++) {
    for (const column of GRID_COLUMNS) cells.push(`${column}${row}`)
  }
  return cells
}

export function isGridCell(value: string) {
  return /^[A-H][1-8]$/.test(value.trim().toUpperCase())
}

/* ========================================================================== */
/* COUNT CYCLE — the 10th and the 25th                                        */
/* ========================================================================== */

export type CountCycle = {
  /** `2026-08-10`. Stable across reloads, so "counted this cycle" survives. */
  id: string
  label: string
  /** The cut-off the count is due on. */
  dueOn: string
  /** First day of the window this count covers. */
  opensOn: string
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function makeCycle(year: number, month: number, day: 10 | 25): CountCycle {
  const due = new Date(year, month, day)
  // The window runs from the day after the previous cut-off.
  const opens = day === 25 ? new Date(year, month, 11) : new Date(year, month - 1, 26)
  return {
    id: iso(due),
    label: `${MONTH_SHORT[due.getMonth()]} ${day} count`,
    dueOn: due.toISOString(),
    opensOn: opens.toISOString(),
  }
}

/** The cycle currently being counted — the most recent cut-off on or before today. */
export function cycleFor(date = new Date()): CountCycle {
  const day = date.getDate()
  const year = date.getFullYear()
  const month = date.getMonth()
  if (day >= 25) return makeCycle(year, month, 25)
  if (day >= 10) return makeCycle(year, month, 10)
  // Before the 10th we are still closing out last month's 25th.
  const previous = new Date(year, month - 1, 25)
  return makeCycle(previous.getFullYear(), previous.getMonth(), 25)
}

export function nextCycleAfter(cycle: CountCycle): CountCycle {
  const due = new Date(cycle.dueOn)
  if (due.getDate() === 10) return makeCycle(due.getFullYear(), due.getMonth(), 25)
  const next = new Date(due.getFullYear(), due.getMonth() + 1, 10)
  return makeCycle(next.getFullYear(), next.getMonth(), 10)
}

/** Days from today to the cut-off. Negative means the count is running late. */
export function daysToCycleDue(cycle: CountCycle) {
  const due = new Date(cycle.dueOn)
  due.setHours(23, 59, 59, 999)
  return Math.ceil((due.getTime() - Date.now()) / 86_400_000)
}

/* ========================================================================== */
/* COUNT SHEET                                                                */
/* ========================================================================== */

export const COUNT_AREAS = ['Showroom', 'Warehouse', 'Quarantine'] as const
export type CountArea = (typeof COUNT_AREAS)[number]

export const COUNT_CONDITIONS = ['Good', 'Defective', 'Scrap', 'Salvage'] as const
export type CountCondition = (typeof COUNT_CONDITIONS)[number]

export const COUNT_CONDITION_TONE: Record<CountCondition, CheckTone> = {
  Good: 'good',
  Defective: 'warning',
  Scrap: 'critical',
  Salvage: 'info' as CheckTone,
}

/** `Showroom|Good` → quantity. Flat so the tally survives JSON round-trips. */
export type Tally = Record<string, number>

export const tallyKey = (area: CountArea, condition: CountCondition) => `${area}|${condition}`

export function tallyTotal(tally: Tally) {
  return Object.values(tally).reduce((sum, qty) => sum + (Number(qty) || 0), 0)
}

export function tallyForArea(tally: Tally, area: CountArea) {
  return COUNT_CONDITIONS.reduce((sum, condition) => sum + (Number(tally[tallyKey(area, condition)]) || 0), 0)
}

export function tallyForCondition(tally: Tally, condition: CountCondition) {
  return COUNT_AREAS.reduce((sum, area) => sum + (Number(tally[tallyKey(area, condition)]) || 0), 0)
}

export type CountLine = {
  id: string
  sku: string
  legacySku: string
  name: string
  category: string
  abc: 'A' | 'B' | 'C'
  barcode: string
  unitCost: number
  /** What the books say is on the shelf right now. */
  systemCount: number
  /** Below this the item is flagged low regardless of variance. */
  threshold: number
  /** What was physically found, split by area and condition. */
  tally: Tally
  locations: string[]
  note: string
  /** The cycle this line was last signed off in. Empty means never counted. */
  countedCycleId: string
  countedBy: string
  countedAt: string | null
}

export type CountSheet = {
  /** One sheet per warehouse per cycle. */
  id: string
  no: string
  cycleId: string
  warehouse: string
  generatedAt: string
  lines: CountLine[]
  /** Set when the sheet is posted; posting freezes it. */
  postedAt: string | null
  postedBy: string
}

export const variance = (line: CountLine) => tallyTotal(line.tally) - line.systemCount

export const variancePct = (line: CountLine) =>
  line.systemCount === 0 ? (tallyTotal(line.tally) === 0 ? 0 : 100) : (variance(line) / line.systemCount) * 100

/**
 * True when this line still owes the current cycle a count.
 *
 * This one comparison is the whole "stop nagging me" behaviour: a line signed
 * off during the open cycle is done, and only comes back when the next cut-off
 * starts a new cycle id.
 */
export const needsRecount = (line: CountLine, cycleId: string) => line.countedCycleId !== cycleId

export function sheetProgress(sheet: CountSheet, cycleId: string) {
  const done = sheet.lines.filter((line) => !needsRecount(line, cycleId))
  return {
    counted: done.length,
    total: sheet.lines.length,
    pct: sheet.lines.length ? (done.length / sheet.lines.length) * 100 : 0,
    variances: done.filter((line) => variance(line) !== 0).length,
    valueVariance: done.reduce((sum, line) => sum + variance(line) * line.unitCost, 0),
    accuracy: done.length ? (done.filter((line) => variance(line) === 0).length / done.length) * 100 : null,
  }
}

/**
 * The shape a stock row must have to be countable.
 *
 * Written structurally rather than importing `StockRow`, because these rows
 * come from the live API on a real install and from the preview dataset
 * otherwise — the two agree on these fields, and nothing else is needed.
 */
export type CountableStock = {
  sku: string
  name: string
  category: string
  warehouse: string
  onHand: number
  available: number
  unitCost: number
  abc: 'A' | 'B' | 'C'
  /** Last time this line was physically counted here. Null/absent means never. */
  lastCountedAt?: string | null
}

/** How long a class can go between counts before it is overdue — the deck's A/B/C rhythm. */
const COUNT_INTERVAL_DAYS: Record<'A' | 'B' | 'C', number> = { A: 90, B: 180, C: 270 }

/**
 * Whether a line actually owes a count, rather than merely being eligible for
 * one.
 *
 * Never counted is always due — there is no evidence it is fine. Otherwise
 * it is due once its class's interval has elapsed since the cut-off this
 * cycle counts as of, not since today, so a sheet generated for a past cycle
 * still asks the right question for that moment.
 */
export function dueForCount(row: CountableStock, cycle: CountCycle): boolean {
  if (!row.lastCountedAt) return true

  const dueOn = new Date(cycle.dueOn).getTime()
  const lastCounted = new Date(row.lastCountedAt).getTime()
  const daysSince = (dueOn - lastCounted) / 86_400_000

  return daysSince >= COUNT_INTERVAL_DAYS[row.abc]
}

export type CountableItem = {
  sku: string
  legacySku?: string | null
  barcode?: string | null
  reorderPoint?: number | null
}

/** How many cut-offs have passed since the epoch — drives the rotation. */
function cycleOrdinal(cycle: CountCycle) {
  const due = new Date(cycle.dueOn)
  return due.getFullYear() * 24 + due.getMonth() * 2 + (due.getDate() === 25 ? 1 : 0)
}

/**
 * Builds the count sheet for a cycle.
 *
 * A catalogue of a couple of thousand lines cannot be counted twice a month,
 * and counting an empty bin proves nothing. So each sheet is a *slice*:
 *
 *   - Lines holding stock come first. They are the ones where a variance is
 *     possible and where it costs money.
 *   - Within that, only lines actually **due** make the sheet — an A-class
 *     line overdue by its 90-day interval, a B by 180, a C by 270 (never
 *     counted always qualifies), plus anything at or below its reorder point
 *     regardless of interval, because that is exactly the kind of line that
 *     goes wrong between scheduled counts. The twice-monthly cut-off is still
 *     when the sheet is generated; it no longer decides which lines are on it.
 *   - The window then advances one sheet-length per cut-off, so successive
 *     cycles walk through whatever is still due instead of re-counting the
 *     same forty lines forever.
 *
 * Stock and items are passed in rather than read from the preview dataset, so
 * the sheet counts whatever the system actually holds.
 */
export function generateCountSheet(
  warehouse: string,
  cycle: CountCycle,
  source: { stock: CountableStock[]; items: CountableItem[] },
  limit = 40,
): CountSheet {
  const { stock, items } = source
  const rng = new Rng(Number(cycle.id.replace(/-/g, '')) % 2_147_483_647)

  const byItem = new Map<string, CountableStock>()
  for (const row of stock.filter((s) => s.warehouse === warehouse)) {
    if (!byItem.has(row.sku)) byItem.set(row.sku, row)
  }

  const itemBySku = new Map(items.map((item) => [item.sku, item]))
  const all = [...byItem.values()]

  const holding = all.filter((row) => row.onHand > 0)
  const pool = holding.length ? holding : all

  const due = pool.filter((row) => {
    const item = itemBySku.get(row.sku)
    const belowReorder = item?.reorderPoint != null && row.available <= item.reorderPoint
    return belowReorder || dueForCount(row, cycle)
  })

  // Highest value at risk first, so a short sheet still covers the money.
  const ordered = [...(due.length ? due : pool)].sort(
    (a, b) => b.onHand * b.unitCost - a.onHand * a.unitCost || a.sku.localeCompare(b.sku),
  )

  const offset = ordered.length > limit ? (cycleOrdinal(cycle) * limit) % ordered.length : 0
  // Wraps, so the last sheet of a pass is full rather than a stub.
  const chosen = [...ordered, ...ordered].slice(offset, offset + Math.min(limit, ordered.length))

  return {
    id: `${warehouse}|${cycle.id}`,
    no: `CC-${cycle.id.replace(/-/g, '')}`,
    cycleId: cycle.id,
    warehouse,
    generatedAt: new Date().toISOString(),
    postedAt: null,
    postedBy: '',
    lines: chosen.map((row, i) => {
      const item = itemBySku.get(row.sku)
      return {
        id: `${cycle.id}-${i + 1}`,
        sku: row.sku,
        legacySku: item?.legacySku ?? row.sku,
        name: row.name,
        category: row.category,
        abc: row.abc,
        barcode: item?.barcode ?? '',
        unitCost: row.unitCost,
        systemCount: row.onHand,
        threshold: item?.reorderPoint ?? 0,
        tally: {},
        locations: [rng.pick(gridCells())],
        note: '',
        countedCycleId: '',
        countedBy: '',
        countedAt: null,
      }
    }),
  }
}

/* ========================================================================== */
/* RECEIVING                                                                  */
/* ========================================================================== */

export const RECEIVING_STATUSES = [
  'Pending Inspection',
  'Inspecting',
  'Accepted',
  'Partially Accepted',
  'Rejected',
  'Put Away',
] as const

export type ReceivingStatus = (typeof RECEIVING_STATUSES)[number]

export type ReceivingLine = {
  id: string
  sku: string
  name: string
  uom: string
  qtyExpected: number
  qtyReceived: number
  /** Units that failed the check. Drives the damage note and the verdict. */
  qtyDamaged: number
  check: ConditionCheck
}

export type ReceivingEntry = {
  id: string
  ref: string
  supplier: string
  poNo: string | null
  warehouse: string
  status: ReceivingStatus
  startedAt: string
  endedAt: string | null
  lines: ReceivingLine[]
  /** Everyone physically present for the check — the audit trail that matters. */
  witnesses: string[]
  notes: string
  locations: string[]
  createdBy: string
}

export function processingMinutes(entry: Pick<ReceivingEntry, 'startedAt' | 'endedAt'>) {
  if (!entry.endedAt) return null
  return Math.max(0, Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 60_000))
}

export function fmtMinutes(minutes: number | null) {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const receivedTotal = (entry: ReceivingEntry) => entry.lines.reduce((s, l) => s + l.qtyReceived, 0)
export const damagedTotal = (entry: ReceivingEntry) => entry.lines.reduce((s, l) => s + l.qtyDamaged, 0)

/** The status the lines imply. Offered as a suggestion, never forced. */
export function suggestedReceivingStatus(entry: ReceivingEntry): ReceivingStatus {
  const received = receivedTotal(entry)
  const damaged = damagedTotal(entry)
  if (received === 0) return 'Pending Inspection'
  if (damaged === 0) return 'Accepted'
  if (damaged >= received) return 'Rejected'
  return 'Partially Accepted'
}

/** Auto-drafted damage note, so nobody has to write the obvious part. */
export function draftDamageNote(lines: ReceivingLine[]) {
  const damaged = lines.filter((line) => line.qtyDamaged > 0)
  if (!damaged.length) return ''
  return damaged
    .map((line) => `${line.qtyDamaged} × ${line.sku} — ${describeCheck({ ...line.check, qty: line.qtyDamaged })}`)
    .join('\n')
}

export function buildReceivingEntries(): ReceivingEntry[] {
  const { purchaseOrders, sites, employees, items } = dataset()
  const rng = new Rng(918_273)
  const staff = employees.filter((e) => e.department === 'Warehouse' && e.status === 'Active').map((e) => e.name)
  const crew = staff.length ? staff : ['Ramon Dela Cruz', 'Ariel Santos', 'Katrina Reyes']

  const open = purchaseOrders.filter((po) => ['Approved', 'Partial', 'Completed'].includes(po.status)).slice(0, 9)

  return open.map((po, i) => {
    const started = rng.daysAgo(0, 12)
    const done = i > 2
    const ended = done ? new Date(started.getTime() + rng.int(25, 190) * 60_000) : null

    const lines: ReceivingLine[] = rng.sample(items, rng.int(2, 4)).map((item, j) => {
      const expected = rng.int(20, 240)
      const received = done ? expected - (rng.bool(0.25) ? rng.int(1, 8) : 0) : 0
      const damaged = done && rng.bool(0.3) ? rng.int(1, Math.max(2, Math.round(received * 0.05))) : 0
      const physical: PhysicalState = damaged ? rng.pick(['dented', 'torn', 'broken', 'wet'] as const) : 'intact'
      const functional: FunctionalState = damaged && rng.bool(0.35) ? 'dead' : 'na'

      return {
        id: `rl-${i + 1}-${j + 1}`,
        sku: item.sku,
        name: item.name,
        uom: item.uom,
        qtyExpected: expected,
        qtyReceived: received,
        qtyDamaged: damaged,
        check: {
          ...CLEAN_CHECK,
          physical,
          functional,
          stage: damaged ? rng.pick(['At supplier', 'Inbound transit', 'Receiving / unloading'] as const) : 'Receiving / unloading',
          liability: damaged ? rng.pick(['Supplier', 'Carrier', 'Undetermined'] as const) : 'Undetermined',
          disposition: suggestedDisposition(verdictFor(physical, functional)),
          qty: damaged,
        },
      }
    })

    const entry: ReceivingEntry = {
      id: `rcv-${i + 1}`,
      ref: `INB-${String(1001 + i).padStart(5, '0')}`,
      supplier: po.supplier,
      poNo: po.no,
      warehouse: rng.pick(sites).name,
      status: 'Pending Inspection',
      startedAt: started.toISOString(),
      endedAt: ended ? ended.toISOString() : null,
      lines,
      witnesses: rng.sample(crew, rng.int(1, 3)),
      notes: '',
      locations: rng.sample(gridCells(), rng.int(1, 3)),
      createdBy: rng.pick(crew),
    }

    entry.notes = draftDamageNote(lines)
    entry.status = done ? suggestedReceivingStatus(entry) : 'Pending Inspection'
    return entry
  })
}

/* ========================================================================== */
/* DISPATCH — pick, pack, deliver                                             */
/* ========================================================================== */

export const DISPATCH_STAGES = ['Open', 'Picking', 'Packed', 'Out for Delivery', 'Delivered', 'Completed'] as const
export type DispatchStage = (typeof DISPATCH_STAGES)[number]

/** The stage a confirmation moves the document *into*. Completed is a sign-off. */
export const stageIndex = (stage: DispatchStage) => DISPATCH_STAGES.indexOf(stage)

export const nextStage = (stage: DispatchStage): DispatchStage | null =>
  DISPATCH_STAGES[stageIndex(stage) + 1] ?? null

/** Which process stage a confirmation at this step is grading. */
export const STAGE_FAULT: Record<DispatchStage, FaultStage> = {
  Open: 'In storage',
  Picking: 'Picking',
  Packed: 'Packing',
  'Out for Delivery': 'Outbound transit',
  Delivered: 'At customer',
  Completed: 'At customer',
}

export type StageEvent = {
  stage: DispatchStage
  at: string
  by: string
  note: string
  /** Grades captured at this hand-over, one per line that was inspected. */
  checks: { sku: string; check: ConditionCheck }[]
}

export type DispatchLine = {
  id: string
  sku: string
  name: string
  uom: string
  qtyOrdered: number
  qtyPicked: number
  qtyDelivered: number
}

export type Dispatch = {
  id: string
  no: string
  soNo: string
  customer: string
  /** Free text plus the coordinates the map needs. */
  destination: { label: string; city: string; lat: number; lng: number }
  origin: { label: string; lat: number; lng: number }
  warehouse: string
  stage: DispatchStage
  promisedAt: string
  dispatchedAt: string | null
  deliveredAt: string | null
  driver: string
  vehicle: string
  lines: DispatchLine[]
  locations: string[]
  history: StageEvent[]
}

export const piecesOf = (d: Dispatch) => d.lines.reduce((s, l) => s + l.qtyOrdered, 0)
export const deliveredOf = (d: Dispatch) => d.lines.reduce((s, l) => s + l.qtyDelivered, 0)

/**
 * OTIF, decided line by line.
 *
 * On time is the promise against the delivery stamp. In full is every line
 * delivered at the ordered quantity — a short line makes the whole drop
 * incomplete, because that is how the customer experiences it. Both must hold.
 */
export type OtifResult = {
  settled: boolean
  onTime: boolean | null
  inFull: boolean | null
  otif: boolean | null
  hoursLate: number | null
  shortLines: number
}

export function otifFor(d: Dispatch): OtifResult {
  if (!d.deliveredAt) {
    return { settled: false, onTime: null, inFull: null, otif: null, hoursLate: null, shortLines: 0 }
  }
  const promised = new Date(d.promisedAt).getTime()
  const delivered = new Date(d.deliveredAt).getTime()
  const onTime = delivered <= promised
  const shortLines = d.lines.filter((l) => l.qtyDelivered < l.qtyOrdered).length
  const inFull = shortLines === 0
  return {
    settled: true,
    onTime,
    inFull,
    otif: onTime && inFull,
    hoursLate: onTime ? 0 : Math.round((delivered - promised) / 3_600_000),
    shortLines,
  }
}

export function otifRate(dispatches: Dispatch[]) {
  const settled = dispatches.map(otifFor).filter((r) => r.settled)
  if (!settled.length) return { rate: null, onTime: null, inFull: null, settled: 0 }
  const count = (predicate: (r: OtifResult) => boolean | null) => settled.filter((r) => predicate(r) === true).length
  return {
    rate: (count((r) => r.otif) / settled.length) * 100,
    onTime: (count((r) => r.onTime) / settled.length) * 100,
    inFull: (count((r) => r.inFull) / settled.length) * 100,
    settled: settled.length,
  }
}

/** Coordinates for the cities the demo customers sit in. */
const CITY_COORDS: Record<string, [number, number]> = {
  Muntinlupa: [14.4081, 121.0415],
  'Quezon City': [14.676, 121.0437],
  'Cebu City': [10.3157, 123.8854],
  'Davao City': [7.1907, 125.4553],
  Makati: [14.5547, 121.0244],
  Pasig: [14.5764, 121.0851],
  Caloocan: [14.6507, 120.9668],
  'Iloilo City': [10.7202, 122.5621],
  'Cagayan de Oro': [8.4542, 124.6319],
  Bacolod: [10.6407, 122.9689],
  Angeles: [15.1455, 120.5876],
  Baguio: [16.4023, 120.596],
  'Batangas City': [13.7565, 121.0583],
  'General Santos': [6.1164, 125.1716],
  'Zamboanga City': [6.9214, 122.079],
  Naga: [13.6218, 123.1948],
}

const WAREHOUSE_COORDS: Record<string, [number, number]> = {
  'Main Distribution Center': [14.4081, 121.0415],
  'North Luzon Branch': [15.1455, 120.5876],
  'Visayas Hub': [10.3157, 123.8854],
  'Mindanao Branch': [7.1907, 125.4553],
  'Metro Transit Hub': [14.5764, 121.0851],
}

export function coordsForCity(city: string): [number, number] {
  return CITY_COORDS[city] ?? [14.5995, 120.9842]
}

/* -------------------------------------------------------------------------- */
/* Building the board from live documents                                      */
/* -------------------------------------------------------------------------- */

/** A pick list as `warehouse/outbound` returns it. */
export type OutboundLike = {
  id: number | string
  no: string
  soNo?: string | null
  customer?: string | null
  warehouse?: string | null
  cutoff?: string | null
  packedAt?: string | null
  dispatchedAt?: string | null
  lines?: number | null
  linesPicked?: number | null
  picker?: string | null
  status: string
}

export type SiteLike = { name: string; latitude?: number | null; longitude?: number | null; city?: string | null }
export type CustomerLike = {
  name: string
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

/** Where a pick list's status sits on the dispatch ladder. */
const STAGE_FROM_STATUS: Record<string, DispatchStage> = {
  Released: 'Open',
  'On Hold': 'Open',
  Open: 'Open',
  Picking: 'Picking',
  Packed: 'Packed',
  Staged: 'Packed',
  Dispatched: 'Out for Delivery',
  Delivered: 'Delivered',
  Completed: 'Completed',
}

/**
 * Turns live pick lists into dispatch cards.
 *
 * The API reports a line *count*, not the lines themselves, so a shipment with
 * no itemised detail gets one aggregate line saying exactly that. Inventing
 * per-item rows to fill the condition check would be fabricating a pick list
 * nobody wrote — the check still works, it just grades the shipment as a whole.
 */
export function buildDispatchesFromOutbound(
  outbound: OutboundLike[],
  sites: SiteLike[],
  customers: CustomerLike[] = [],
): Dispatch[] {
  const siteByName = new Map(sites.map((s) => [s.name, s]))
  const customerByName = new Map(customers.map((c) => [c.name, c]))

  return outbound.map((doc): Dispatch => {
    const site = doc.warehouse ? siteByName.get(doc.warehouse) : undefined
    const customerName = doc.customer ?? 'Unnamed customer'
    const customer = customerByName.get(customerName)

    const [olat, olng] = [site?.latitude, site?.longitude].every((v) => typeof v === 'number')
      ? [site!.latitude as number, site!.longitude as number]
      : coordsForCity(site?.city ?? '')

    const [dlat, dlng] = [customer?.latitude, customer?.longitude].every((v) => typeof v === 'number')
      ? [customer!.latitude as number, customer!.longitude as number]
      : coordsForCity(customer?.city ?? '')

    const stage = STAGE_FROM_STATUS[doc.status] ?? 'Open'
    const qty = Math.max(1, Number(doc.lines) || 1)

    return {
      id: `live-${doc.id}`,
      no: doc.no,
      soNo: doc.soNo ?? '',
      customer: customerName,
      destination: { label: customerName, city: customer?.city ?? '—', lat: dlat, lng: dlng },
      origin: { label: doc.warehouse ?? 'Warehouse', lat: olat, lng: olng },
      warehouse: doc.warehouse ?? '',
      stage,
      // No promise date on the document means the cut-off is the best the
      // system knows; without either, OTIF stays unmeasured rather than guessed.
      promisedAt: doc.cutoff ?? doc.packedAt ?? doc.dispatchedAt ?? new Date().toISOString(),
      dispatchedAt: doc.dispatchedAt ?? null,
      deliveredAt: null,
      driver: doc.picker ?? '',
      vehicle: '',
      lines: [
        {
          id: `live-${doc.id}-1`,
          sku: doc.no,
          name: 'General shipment (no line items recorded)',
          uom: 'pcs',
          qtyOrdered: qty,
          qtyPicked: Number(doc.linesPicked) || 0,
          qtyDelivered: 0,
        },
      ],
      locations: [],
      history: [],
    }
  })
}

export function buildDispatches(): Dispatch[] {
  const { salesOrders, customers, employees, vehicles, items } = dataset()
  const rng = new Rng(556_611)
  const drivers = employees.filter((e) => e.department === 'Warehouse' && e.status === 'Active').map((e) => e.name)
  const crew = drivers.length ? drivers : ['Ramon Dela Cruz']
  const customerByName = new Map(customers.map((c) => [c.name, c]))

  const orders = salesOrders.filter((so) => ['Confirmed', 'Partial', 'Delivered'].includes(so.status)).slice(0, 22)

  return orders.map((so, i) => {
    const customer = customerByName.get(so.customer)
    const city = customer?.city ?? 'Muntinlupa'
    const [lat, lng] = coordsForCity(city)
    const [olat, olng] = WAREHOUSE_COORDS[so.warehouse] ?? WAREHOUSE_COORDS['Main Distribution Center']!

    // The first six seed one card into every stage so the flow is legible at a
    // glance; the rest fall where a real day puts them — mostly already gone.
    const stage =
      i < DISPATCH_STAGES.length
        ? DISPATCH_STAGES[i]!
        : rng.weighted([
            ['Completed', 6],
            ['Delivered', 4],
            ['Out for Delivery', 2],
            ['Packed', 2],
            ['Picking', 2],
            ['Open', 2],
          ] as const)
    const done = stageIndex(stage) >= stageIndex('Delivered')

    // Settled drops sit behind us; live ones are promised over the days ahead,
    // with a couple already past their promise so the "running late" count is
    // not a permanently empty tile.
    const promised = done ? rng.daysAgo(1, 12) : rng.daysAhead(-1, 7)

    // Failures are spaced rather than rolled, so the seeded OTIF lands in a
    // believable band instead of wherever the dice fell — roughly one drop in
    // six late, one in seven short.
    const ranLate = done && i % 6 === 2
    const cameUpShort = done && i % 7 === 3
    const delivered = done
      ? new Date(promised.getTime() + (ranLate ? rng.int(3, 26) : rng.int(-30, -1)) * 3_600_000)
      : null

    const lines: DispatchLine[] = rng.sample(items, rng.int(1, 4)).map((item, j) => {
      const ordered = rng.int(2, 40)
      const picked = stageIndex(stage) >= stageIndex('Picking') ? ordered : 0
      // Only the first line of a short drop comes up short — a partial delivery
      // is normally one item nobody could find, not the whole load.
      const short = cameUpShort && j === 0 ? rng.int(1, Math.max(1, Math.round(ordered * 0.2))) : 0
      return {
        id: `dl-${i + 1}-${j + 1}`,
        sku: item.sku,
        name: item.name,
        uom: item.uom,
        qtyOrdered: ordered,
        qtyPicked: picked,
        qtyDelivered: done ? ordered - short : 0,
      }
    })

    const history: StageEvent[] = DISPATCH_STAGES.slice(1, stageIndex(stage) + 1).map((s, k) => ({
      stage: s,
      at: new Date(promised.getTime() - (stageIndex(stage) - k) * 7_200_000).toISOString(),
      by: rng.pick(crew),
      note: '',
      checks: [],
    }))

    return {
      id: `dsp-${i + 1}`,
      no: `SOF-${2000 + i}`,
      soNo: so.no,
      customer: so.customer,
      destination: { label: so.customer, city, lat, lng },
      origin: { label: so.warehouse, lat: olat, lng: olng },
      warehouse: so.warehouse,
      stage,
      promisedAt: promised.toISOString(),
      dispatchedAt: stageIndex(stage) >= stageIndex('Out for Delivery') ? new Date(promised.getTime() - 10_800_000).toISOString() : null,
      deliveredAt: delivered ? delivered.toISOString() : null,
      driver: rng.pick(crew),
      vehicle: vehicles.length ? rng.pick(vehicles).code : 'TRK-001',
      lines,
      locations: rng.sample(gridCells(), rng.int(1, 2)),
      history,
    }
  })
}
