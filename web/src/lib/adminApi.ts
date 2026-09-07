import { API_BASE_URL } from './api'
import { useAuth } from '@/app/auth'

/**
 * Typed client for the administration endpoints.
 *
 * Unlike the read-only resource pages — which go through TanStack Query — these
 * are commands: they change configuration and need the caller to see the exact
 * validation message the API returned.
 */

export const liveApi = () => Boolean(import.meta.env.VITE_API_URL)

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Laravel's field-level validation errors, when it sent any. */
    readonly errors: Record<string, string[]> = {},
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** First message for a field, for inline display beside the input. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0]
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    credentials: 'include',
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      payload.message ?? `Request failed (${response.status}).`,
      response.status,
      payload.errors ?? {},
    )
  }

  return (payload.data ?? payload) as T
}

const get = <T>(path: string) => request<T>(path)
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) })
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

/* -------------------------------------------------------------------------- */
/* Generic records                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Create, update and delete for any endpoint in the server-side registry.
 *
 * The API validates and returns field-level errors, which `ApiError.errors`
 * carries straight back to the form so each message lands beside its input.
 */
export const createRecord = <T>(endpoint: string, values: Record<string, unknown>) =>
  post<T>(endpoint, values)

export const updateRecord = <T>(endpoint: string, id: number | string, values: Record<string, unknown>) =>
  put<T>(`${endpoint}/${id}`, values)

/**
 * `force` bypasses a delete guard (an approved payroll run, a closed period)
 * — the server only honours it for a super-admin, and it still fails loudly
 * for anything not carrying that role, so this is safe to expose here rather
 * than behind a second, separate endpoint.
 */
export const deleteRecord = (endpoint: string, id: number | string, force = false) =>
  del<{ deleted: boolean }>(`${endpoint}/${id}${force ? '?force=1' : ''}`)

/* -------------------------------------------------------------------------- */
/* Sales                                                                       */
/* -------------------------------------------------------------------------- */

/** Turns an accepted quotation into a confirmed sales order, lines and all. */
export const convertQuotation = (id: number | string, warehouseId?: number) =>
  post<{ id: number; no: string; total: number; marginPct: number }>(
    `sales/quotations/${id}/convert`,
    warehouseId ? { warehouseId } : {},
  )

/** Hands a confirmed order to the warehouse floor as a pick list. */
export const releaseOrder = (id: number | string) =>
  post<{ id: number; no: string; warehouse: string; lines: number }>(`sales/orders/${id}/release`)

/* -------------------------------------------------------------------------- */
/* Procurement                                                                 */
/* -------------------------------------------------------------------------- */

/** Opens a competitive tender for an approved requisition. */
export const requisitionToRfq = (id: number | string) =>
  post<{ id: number; no: string; closes: string | null }>(`procurement/requisitions/${id}/rfq`)

/** Raises a purchase order from a requisition, skipping tender. */
export const requisitionToOrder = (id: number | string, supplierId: number) =>
  post<{ id: number; no: string; total: number }>(`procurement/requisitions/${id}/order`, { supplierId })

/** Awards a bid and turns it into a purchase order. */
export const awardBid = (bidId: number | string) =>
  post<{ id: number; no: string; total: number; bidAmount: number; roundingDifference: number }>(
    `procurement/rfq-bids/${bidId}/award`,
  )

export type InvoiceMatch = {
  match: 'Matched' | '2-way only' | 'Price variance' | 'Qty variance' | 'Unmatched'
  orderedValue?: number
  receivedValue?: number
  billed?: number
  variance?: number
  hasReceipt?: boolean
  detail: string
}

/** Three-way match: order against receipts against the invoice. */
export const matchInvoice = (id: number | string) =>
  post<InvoiceMatch>(`procurement/supplier-invoices/${id}/match`)

/**
 * The evidence behind a supplier's score.
 *
 * Every component can be null: a supplier with no completed deliveries has no
 * delivery rate, and saying so is more use than showing them zero.
 */
export type Scorecard = {
  supplier: string
  code: string
  windowMonths: number
  windowFrom: string
  score: number | null
  sample: number
  components: Partial<Record<'delivery' | 'quality' | 'price', number>>
  weights: Record<'delivery' | 'quality' | 'price', number>
  ytdSpend: number
  accreditationExpired: boolean
  needsReview: boolean
  delivery: {
    rate: number | null
    completedOrders: number
    onTime: number
    late: number
    avgDaysLate: number | null
    openPastDue: number
    note: string
  }
  quality: { rate: number | null; receipts: number; received: number; rejected: number; note: string }
  price: {
    index: number | null
    itemsCompared: number
    items: { sku: string; name: string; ourPrice: number; marketPrice: number; variancePct: number }[]
    note: string
  }
}

export const getSupplierScorecard = (id: number | string) =>
  get<Scorecard>(`procurement/suppliers/${id}/scorecard`)

/** Re-scores every supplier from the documents. */
export const evaluateSuppliers = () =>
  post<{ suppliers: number; scored: number; noEvidence: number; evaluatedAt: string }>(
    'procurement/suppliers/evaluate',
  )

export const evaluateSupplier = (id: number | string) =>
  post<Scorecard>(`procurement/suppliers/${id}/evaluate`)

/* -------------------------------------------------------------------------- */
/* Warehouse                                                                   */
/* -------------------------------------------------------------------------- */

/** One SKU that needs reordering, with the evidence for why. */
export type ReplenishmentRow = {
  itemId: number
  sku: string
  name: string
  category: string | null
  uom: string
  available: number
  onHand: number
  reorderPoint: number
  reorderQty: number
  avgDailyDemand: number
  /** Null when nothing has been consumed — cover cannot be computed. */
  coverDays: number | null
  leadTimeDays: number
  suggestedQty: number
  unitCost: number
  suggestedValue: number
  supplier: string | null
  supplierId: number | null
  abc: string
  urgency: 'Critical' | 'High' | 'Medium' | 'Low'
}

/** Raises a purchase requisition for the chosen replenishment lines. */
export const replenishmentRequisition = (
  lines: { itemId: number; quantity: number }[],
  title?: string,
) =>
  post<{ id: number; no: string; lines: number; amount: number }>('warehouse/replenishment/requisition', {
    lines,
    ...(title ? { title } : {}),
  })

/** Corrects one stock line, recorded as a single-item cycle count. */
export const adjustStock = (body: {
  itemId: number
  warehouseId: number
  countedQuantity: number
  reason?: string
}) => post<{ id: number; no: string; valueVariance: number; variances: number }>('warehouse/stock/adjust', body)

/** Recomputes every active item's ABC class from real 90-day issued value. */
export const recomputeAbcClasses = () => post<{ changed: number; total: number }>('warehouse/abc/recompute')

export type BinSuggestion = {
  binId: number
  code: string
  zone: string | null
  aisle: string | null
  capacity: number
  occupied: number
  reason: string
}

/** A bin to put an item away in — a suggestion, not a lock. */
export const suggestBin = (itemId: number, warehouseId: number) =>
  post<BinSuggestion | null>('warehouse/bins/suggest', { itemId, warehouseId })

/** Groups the chosen pick lists into one released wave. */
export const buildWave = (body: { warehouseId: number; pickListIds: number[]; zone?: string; cutoffAt?: string }) =>
  post<{ id: number; waveNo: string; pickListCount: number }>('warehouse/waves', body)

/* -------------------------------------------------------------------------- */
/* Maintenance                                                                 */
/* -------------------------------------------------------------------------- */

/** One preventive schedule the generator turned into a job. */
export type GeneratedWorkOrder = {
  id: number
  no: string
  asset: string
  task: string
  schedule: string
  due: string | null
  priority: string
}

/**
 * Turns due preventive schedules into work orders.
 *
 * Skips any schedule that already has an open job, so running it twice does not
 * send two technicians to change the same oil.
 */
export const generatePreventive = (withinDays?: number, assetId?: number) =>
  post<{ created: number; workOrders: GeneratedWorkOrder[] }>('maintenance/preventive/generate', {
    ...(withinDays === undefined ? {} : { withinDays }),
    ...(assetId === undefined ? {} : { assetId }),
  })

/**
 * Finishes a job: issues its spare parts, returns the asset to service and
 * rolls the preventive schedule that raised it forward.
 */
export const completeWorkOrder = (
  id: number | string,
  body: {
    warehouseId?: number
    technicianId?: number
    laborCost?: number
    downtimeHours?: number
    meterReading?: number
    notes?: string
    parts?: { itemId: number; quantity: number }[]
  },
) =>
  post<{
    id: number
    no: string
    asset: string | null
    assetStatus: string | null
    partsCost: number
    laborCost: number
    totalCost: number
    partsIssued: number
    completedAt: string | null
  }>(`maintenance/work-orders/${id}/complete`, body)

/** Raises a corrective job against a logged breakdown. */
export const workOrderFromBreakdown = (
  id: number | string,
  body: { technicianId?: number; priority?: string } = {},
) =>
  post<{ id: number; no: string; asset: string | null; priority: string; due: string | null; technician: string | null }>(
    `maintenance/downtime/${id}/work-order`,
    body,
  )

/** Everything one asset has had done to it, and what it has cost. */
export type AssetHistory = {
  asset: {
    id: number
    code: string
    name: string
    category: string
    status: string
    criticality: string
    condition: string
    meterReading: number
    meterUnit: string
    meterSinceService: number
    acquisitionCost: number
    bookValue: number
    lastService: string | null
    nextService: string | null
  }
  workOrders: {
    id: number
    no: string
    summary: string
    type: string
    priority: string
    reported: string | null
    completed: string | null
    technician: string | null
    downtimeHours: number
    laborCost: number
    partsCost: number
    totalCost: number
    parts: { sku: string | null; name: string | null; quantity: number; lineTotal: number }[]
    status: string
  }[]
  downtime: {
    id: number
    date: string | null
    cause: string
    hours: number
    impact: string
    rootCause: string | null
    costImpact: number
    status: string
  }[]
  totals: {
    jobs: number
    openJobs: number
    maintenanceCost: number
    downtimeHours: number
    /** Upkeep as a share of what the asset cost. Null when cost is unknown. */
    costRatio: number | null
  }
}

export const getAssetHistory = (id: number | string) => get<AssetHistory>(`maintenance/assets/${id}/history`)

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

/** Posts a journal to the ledger. Refuses anything that does not balance. */
export const postJournal = (id: number | string) =>
  post<{ id: number; no: string; debit: number; credit: number; status: string; postedAt: string | null }>(
    `finance/journals/${id}/post`,
  )

/** Reverses a posted entry with a mirror-image entry. */
export const reverseJournal = (id: number | string, reason?: string) =>
  post<{ id: number; no: string; reverses: string; amount: number }>(`finance/journals/${id}/reverse`, {
    ...(reason ? { reason } : {}),
  })

export const postInvoice = (id: number | string) =>
  post<{ id: number; no: string; amount: number; balance: number; status: string }>(
    `finance/receivables/${id}/post`,
  )

export const postBill = (id: number | string) =>
  post<{ id: number; no: string; amount: number; balance: number; status: string }>(`finance/payables/${id}/post`)

/** Records money in and applies it across the customer's invoices. */
export const receivePayment = (body: {
  customerId: number
  bankAccountId?: number
  date?: string
  amount: number
  method?: string
  reference?: string
  allocations: { invoiceId: number; amount: number }[]
}) =>
  post<{ id: number; no: string; amount: number; unapplied: number; applied: number; settled: number }>(
    'finance/receivables/payment',
    body,
  )

/** Pays a supplier and applies it across their bills. */
export const payBills = (body: {
  supplierId: number
  bankAccountId?: number
  date?: string
  amount: number
  method?: string
  reference?: string
  allocations: { billId: number; amount: number }[]
}) =>
  post<{ id: number; no: string; amount: number; unapplied: number; applied: number; settled: number }>(
    'finance/payables/payment',
    body,
  )

export const approveExpense = (id: number | string) =>
  post<{ id: number; no: string; amount: number; account: string | null; journalNo: string | null; status: string }>(
    `finance/expenses/${id}/approve`,
  )

/** An employee's own money, paid back — distinct from the cash-advance liquidation `Expense` above. */
export type ReimbursementClaimRecord = {
  id: number
  claimNo: string
  employeeId: number
  employee: string | null
  category: 'Mileage' | 'Travel' | 'Meals' | 'Supplies' | 'Other'
  claimDate: string
  amount: number
  description: string | null
  receiptPath: string | null
  fuelRequestId: number | null
  fuelRequestReference: string | null
  distanceKm: number | null
  ratePerKm: number | null
  status: 'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Rejected'
  approvedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  paidAt: string | null
  paymentReference: string | null
}

/** Pre-fills a Mileage claim from a decided, personally-owned-vehicle trip. */
export const reimburseFuelRequest = (fuelRequestId: number) =>
  post<ReimbursementClaimRecord>(`maintenance/fuel-requests/${fuelRequestId}/reimburse`)

export const approveReimbursement = (id: number | string, note?: string) =>
  post<ReimbursementClaimRecord>(`finance/reimbursements/${id}/approve`, { note })

export const rejectReimbursement = (id: number | string, note: string) =>
  post<ReimbursementClaimRecord>(`finance/reimbursements/${id}/reject`, { note })

export const markReimbursementPaid = (id: number | string, paymentReference?: string) =>
  post<ReimbursementClaimRecord>(`finance/reimbursements/${id}/mark-paid`, { paymentReference })

/** Charges a month's depreciation across every asset that still owes one. */
export const runDepreciation = (month?: string) =>
  post<{
    posted: boolean
    month: string
    journalNo?: string
    assets: number
    amount: number
    message: string
    lines: { code: string; name: string; amount: number; netBookValue: number }[]
  }>('finance/fixed-assets/depreciation', month ? { month } : {})

export const fileTaxReturn = (id: number | string, body: { filedOn?: string; confirmationNo?: string } = {}) =>
  post<{ id: number; form: string; period: string; filedOn: string | null; status: string }>(
    `finance/tax-filings/${id}/file`,
    body,
  )

/** Re-reads every budget line's actual spend from the ledger. */
export const refreshBudgets = (year?: number) =>
  post<{ lines: number }>('finance/budgets/refresh', year ? { year } : {})

export const reconcileTransaction = (id: number | string, reconciled = true) =>
  post<{ id: number; reconciled: boolean; unreconciled: number; balance: number }>(
    `finance/bank-transactions/${id}/reconcile`,
    { reconciled },
  )

export const rebuildAccountBalances = () => post<{ accounts: number }>('finance/accounts/rebuild')

/** One row of the trial balance — the report that proves the ledger is sound. */
export type TrialBalance = {
  rows: { code: string; name: string; type: string; debit: number; credit: number; balance: number }[]
  totalDebit: number
  totalCredit: number
  /** False means something got into the ledger without going through posting. */
  balanced: boolean
  from: string | null
  to: string | null
}

export const getTrialBalance = (from?: string, to?: string) =>
  get<TrialBalance>(`finance/trial-balance${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`)

/* -------------------------------------------------------------------------- */
/* HR — self service                                                           */
/* -------------------------------------------------------------------------- */

/** One press of the clock. The server decides whether it is allowed. */
export type ClockAction = 'in' | 'break-out' | 'break-in' | 'out' | 'ot-in' | 'ot-out'

export type ClockState = {
  /**
   * off → working → on-break → working → done, with `on-overtime` reachable
   * only from `done` (regular shift closed) via a separate ot-in press —
   * straight-through overtime never leaves `done` at all, since it is read
   * automatically off the regular clock-out rather than a press of its own.
   */
  stage: 'off' | 'working' | 'on-break' | 'done' | 'on-overtime'
  workDate: string
  clockIn: string | null
  breakOut: string | null
  breakIn: string | null
  clockOut: string | null
  otClockIn: string | null
  otClockOut: string | null
  hoursWorked: number
  breakMinutes: number
  lateMinutes: number
  undertimeMinutes: number
  overtimeHours: number
  /** True when `overtimeHours` came from the explicit ot-in/ot-out pair rather than the automatic past-shift-end calculation. */
  overtimeIsLogged: boolean
  status: string
  shift: { name: string; startsAt: string; endsAt: string; graceMinutes: number; breakMinutes: number } | null
  /** Which of the six presses are live right now. */
  can: Record<ClockAction, boolean>
  serverTime: string
  /** Whether a punch has to carry a PIN, and whether this person has set one. */
  pinRequired: boolean
  pinSet: boolean
  pinLength: number
}

/**
 * A per-browser identifier kept in local storage.
 *
 * Not a security control — anybody can clear it. Its job is to make a shared
 * terminal visible: one kiosk keeps one id, so six people clocking in from it
 * shows up instead of vanishing.
 */
export function deviceId(): string {
  const key = 'trinitas.device'
  let id = localStorage.getItem(key)
  if (!id) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now().toString(36)).slice(0, 36)
    localStorage.setItem(key, id)
  }
  return id
}

/** Sets or changes the signed-in employee's punch PIN. */
export const setPunchPin = (pin: string, currentPin?: string) =>
  post<{ set: boolean; employee: string }>('me/pin', { pin, ...(currentPin ? { currentPin } : {}) })

export type PunchIntegrity = {
  config: {
    require_punch_pin: boolean
    restrict_punch_to_areas: boolean
    flag_shared_devices: boolean
    shared_device_threshold: number
    burst_window_seconds: number
    pin_length: number
  }
  flagged: {
    id: number
    employee: string | null
    employeeNo: string | null
    department: string | null
    action: ClockAction
    punchedAt: string | null
    deviceId: string | null
    ipAddress: string | null
    reason: string | null
  }[]
  sharedDevices: { deviceId: string; employees: number; punches: number; lastSeen: string | null }[]
  employeesWithoutPin: number
}

export const getPunchIntegrity = (withinDays?: number) =>
  get<PunchIntegrity>(`hr/punch-integrity${withinDays ? `?withinDays=${withinDays}` : ''}`)

/* -------------------------------------------------------------------------- */
/* Payroll                                                                     */
/* -------------------------------------------------------------------------- */

export type PayrollRunSummary = {
  id: number
  no: string
  period: string | null
  periodLabel: string | null
  /** The ids behind the names, so a draft run can be re-pointed without a lookup. */
  periodId: number | null
  groupId: number | null
  group: string | null
  headcount: number
  grossPay: number
  statutoryEmployee: number
  statutoryEmployer: number
  withholdingTax: number
  totalDeductions: number
  netPay: number
  employerCost: number
  status: 'Draft' | 'Computed' | 'Approved' | 'Released'
  approvedAt: string | null
  releasedAt: string | null
}

/** One itemised amount on a payslip, earning or deduction. */
export type PayslipLine = {
  id: number
  code: string
  label: string
  amount: number
  taxable?: boolean
  /** A loan collection. The balance is derived from it, so it cannot be deleted. */
  locked: boolean
}

export type RegisterLine = {
  otherDeductions: number
  deductionLines: PayslipLine[]
  earningLines: PayslipLine[]
  id: number
  employee: string
  employeeNo: string | null
  /** For the bank file — AUB's own credit-file template has a department column. */
  department: string | null
  dailyRate: number
  basicPay: number
  overtimePay: number
  nightDiffPay: number
  /** The five the engine leaves at zero — the only figures a person may set. */
  restDayPay: number
  holidayPay: number
  leavePay: number
  taxableAllowances: number
  nonTaxableAllowances: number
  grossPay: number
  lateDeduction: number
  undertimeDeduction: number
  absenceDeduction: number
  sss: number
  philhealth: number
  pagibig: number
  withholdingTax: number
  totalDeductions: number
  netPay: number
  /** Held back from this cut-off's release — the AUB workbook's own HOLD PAYROLL column. */
  holdAmount: number
  /** A lump correction from a past cut-off, settled in this one — the AUB workbook's own Retro adjustment column. */
  retroAdjustment: number
  atmAccount: string | null
  /** ATM, CASH or CHEQUE — only ATM belongs in a bank credit file. */
  paymentMode: 'ATM' | 'CASH' | 'CHEQUE'
  /** Set when something about this payslip needs a human to look. */
  notes: string | null
}

export type AuditIntegrityResult = {
  valid: boolean
  checked: number
  brokenAt: number | null
  reason: string | null
}

/** Walks the audit trail's hash chain. Read-only — touches no row. */
export const verifyAuditIntegrity = () => get<AuditIntegrityResult>('admin/audit-log/verify')

export type RemittanceSummary = {
  runs: number
  headcount: number
  agencies: { agency: string; employee: number; employer: number; total: number; reference: string }[]
}

/**
 * Creates the 24 semi-monthly cut-offs for a year. Safe to re-run.
 *
 * Pay dates follow the company's own pay schedule (Admin → System Settings →
 * Payroll), not a value passed here.
 */
export const generatePayrollPeriods = (year: number) =>
  post<{ created: number; year: number }>('hr/payroll-periods/generate', { year })

export type PayrollRegister = {
  run: PayrollRunSummary
  /** False once the run is approved or released. Decided by the server. */
  editable: boolean
  payslips: RegisterLine[]
}

export const getRegister = (runId: number) =>
  get<PayrollRegister>(`hr/payroll-runs/${runId}/register`)

/**
 * The company's own AUB HRIS workbook — every sheet exactly as uploaded,
 * with the green input columns filled from this run's real payroll. See
 * `AubTemplateExporter` (API) for exactly what is and isn't filled.
 */
export async function downloadAubTemplate(runId: number, filename: string) {
  const token = useAuth.getState().token
  const response = await fetch(`${API_BASE_URL}/hr/payroll-runs/${runId}/aub-template`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError('Could not build the AUB workbook.', response.status)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Gaps that would make the AUB workbook wrong or ambiguous — name collisions, missing ATM accounts, etc. Informational only. */
export const getAubWarnings = (runId: number) =>
  get<{ data: string[] }>(`hr/payroll-runs/${runId}/aub-warnings`).then((r) => r.data)

/* -------------------------------------------------------------------------- */
/* Payslip adjustments                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Sets the amounts on a payslip that a person is allowed to set.
 *
 * Only the five the engine cannot know, and the account. Gross, taxable
 * income, tax, deductions and net are recomputed by the server from those, so
 * there is deliberately no way to send them.
 */
export const adjustPayslip = (
  payslipId: number,
  values: Partial<{
    restDayPay: number
    holidayPay: number
    leavePay: number
    taxableAllowances: number
    nonTaxableAllowances: number
    holdAmount: number
    retroAdjustment: number
    atmAccount: string
    notes: string
  }>,
) => patch<PayrollRegister>(`hr/payslips/${payslipId}`, values)

/** Adds an employee the run missed — a mid-cut-off hire, a late transfer. */
export const addPayslip = (runId: number, employeeId: number) =>
  post<{ id: number }>(`hr/payroll-runs/${runId}/payslips`, { employeeId })

/** Takes a payslip off the run, handing back any loan instalment it collected. */
export const deletePayslip = (payslipId: number) =>
  del<PayrollRegister>(`hr/payslips/${payslipId}`)

/** An itemised one-off: a rice subsidy, a uniform charge. */
export const addPayslipLine = (
  payslipId: number,
  values: { kind: 'earning' | 'deduction'; label: string; amount: number; code?: string; taxable?: boolean },
) => post<PayrollRegister>(`hr/payslips/${payslipId}/lines`, values)

export const deletePayslipLine = (lineId: number) =>
  del<PayrollRegister>(`hr/payslip-lines/${lineId}`)

/** Rebuilds every payslip from attendance and the statutory tables. */
export const computeRun = (runId: number) =>
  post<{ payslips: number; gross: number; net: number; employerCost: number; run: PayrollRunSummary }>(
    `hr/payroll-runs/${runId}/compute`,
  )

export const approveRun = (runId: number) => post<PayrollRunSummary>(`hr/payroll-runs/${runId}/approve`)
export const releaseRun = (runId: number) => post<PayrollRunSummary>(`hr/payroll-runs/${runId}/release`)

export const getRemittances = (periodId?: number) =>
  get<RemittanceSummary>(`hr/remittances${periodId ? `?periodId=${periodId}` : ''}`)

/* -------------------------------------------------------------------------- */
/* Statutory reports                                                           */
/* -------------------------------------------------------------------------- */

export type LegalEntitySummary = {
  id: number
  name: string
  legalName: string | null
  tin: string | null
  sssEmployerNo: string | null
  philhealthEmployerNo: string | null
  pagibigEmployerNo: string | null
  pagibigBranchCode: string | null
  address: string | null
  zipCode: string | null
  phone: string | null
}

export type AgencyCode = 'sss' | 'philhealth' | 'pagibig'

export type AgencyScheduleRow = {
  employeeId: number
  employeeNo: string | null
  name: string
  firstName: string | null
  lastName: string | null
  middleName: string | null
  birthDate: string | null
  tin: string | null
  number: string | null
  employee: number
  employer: number
  /** Employees' Compensation — SSS only. Null (not 0) for the other agencies, which have no equivalent. */
  ec: number | null
  total: number
}

export type AgencySchedule = {
  agency: AgencyCode
  year: number
  month: number
  legalEntity: LegalEntitySummary | null
  rows: AgencyScheduleRow[]
  totals: { employee: number; employer: number; ec: number | null; total: number }
}

export const getAgencySchedule = (agency: AgencyCode, year: number, month: number, legalEntityId?: number) =>
  get<AgencySchedule>(
    `hr/reports/agency/${agency}?${new URLSearchParams({
      year: String(year),
      month: String(month),
      ...(legalEntityId ? { legalEntityId: String(legalEntityId) } : {}),
    })}`,
  )

export type ThirteenthMonthRow = {
  employeeId: number
  employeeNo: string | null
  name: string
  totalBasicPay: number
  thirteenthMonthDue: number
}

export type ThirteenthMonthReport = {
  year: number
  legalEntity: LegalEntitySummary | null
  rows: ThirteenthMonthRow[]
  totalDue: number
}

export const getThirteenthMonth = (year: number, legalEntityId?: number) =>
  get<ThirteenthMonthReport>(
    `hr/reports/thirteenth-month?${new URLSearchParams({
      year: String(year),
      ...(legalEntityId ? { legalEntityId: String(legalEntityId) } : {}),
    })}`,
  )

export type Bir2316Row = {
  employeeId: number
  employeeNo: string | null
  name: string
  tin: string | null
  grossCompensation: number
  nonTaxableCompensation: number
  taxableCompensation: number
  taxWithheld: number
}

export type Bir2316Report = {
  year: number
  legalEntity: LegalEntitySummary | null
  rows: Bir2316Row[]
}

export const getBir2316 = (year: number, legalEntityId?: number) =>
  get<Bir2316Report>(
    `hr/reports/bir2316?${new URLSearchParams({
      year: String(year),
      ...(legalEntityId ? { legalEntityId: String(legalEntityId) } : {}),
    })}`,
  )

/* -------------------------------------------------------------------------- */
/* Recruitment                                                                 */
/* -------------------------------------------------------------------------- */

/** The fields a CV parser can suggest. Same names on both sides of the wire. */
export type ParsedResumeFields = Partial<
  Record<
    | 'firstName' | 'middleName' | 'lastName' | 'suffix' | 'fullName'
    | 'email' | 'phone'
    | 'addressLine' | 'city' | 'province' | 'postalCode'
    | 'birthdate' | 'gender' | 'civilStatus' | 'nationality'
    | 'educationLevel' | 'school' | 'course' | 'yearGraduated'
    | 'yearsExperience' | 'currentEmployer' | 'currentTitle'
    | 'linkedinUrl' | 'portfolioUrl',
    string | number
  >
>

/** What was read out of an upload, before anybody has agreed to any of it. */
export type ResumeRead = {
  token: string
  status: 'Parsed' | 'Unreadable'
  /** How the text was got out: 'pdf', 'docx', 'ocr', … — 'ocr' is worth showing. */
  method: string
  confidence: number
  fields: ParsedResumeFields
  skills: string[]
  notes: string[]
  filename: string
}

/**
 * The screening opinion, with its reasoning attached.
 *
 * Deliberately shaped so the screen cannot show the number without the
 * reasons: `score` is meaningless on its own, and every field beside it exists
 * so a recruiter can disagree with a specific line rather than with a verdict.
 */
export type Assessment = {
  score: number
  band: 'Strong match' | 'Possible' | 'Weak match' | 'Not enough to say'
  summary: string
  /** How much of the advert was checkable at all, 0-100. */
  confidence: number
  /** Whether this posting is supervisory or above — the leadership and tenure-stability signals only ever appear when it is. */
  managerial: boolean
  signals: {
    label: string
    status: 'met' | 'partial' | 'missing' | 'unknown'
    ratio: number
    detail: string
  }[]
  /** Each qualification line on the advert, and what in the CV decided it. */
  requirements: { text: string; status: 'met' | 'partial' | 'missing'; evidence: string[] }[]
  matchedSkills: string[]
  missingSkills: string[]
  /** Facts worth knowing that deliberately do not move the score. */
  concerns: string[]
  assessedAt: string
}

/** One job on a parsed CV, with the dates it was actually held. */
export type ParsedPosition = {
  title?: string
  employer?: string
  from?: string
  to?: string
  current?: boolean
  months?: number
}

export type ApplicantDetail = {
  id: number
  code: string
  reference: string | null
  name: string
  firstName: string | null
  middleName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  position: string | null
  positionId: number | null
  requisition: string | null
  department: string | null
  posting: string | null
  postingSlug: string | null
  source: string
  appliedVia: string
  applied: string | null
  stage: string
  rating: number | null
  expectedSalary: number | null
  recruiter: string | null

  personal: {
    birthdate: string | null
    gender: string | null
    civilStatus: string | null
    nationality: string | null
    addressLine: string | null
    city: string | null
    province: string | null
    postalCode: string | null
  }
  background: {
    educationLevel: string | null
    school: string | null
    course: string | null
    yearGraduated: number | null
    yearsExperience: number | null
    currentEmployer: string | null
    currentTitle: string | null
    availableFrom: string | null
    linkedinUrl: string | null
    portfolioUrl: string | null
  }
  skills: string[]
  coverLetter: string | null
  screeningNotes: string | null
  matchScore: number | null
  assessment: Assessment | null
  consentedAt: string | null
  /** Null until an offer has gone out. */
  offer: OfferTerms | null

  /**
   * The CV on file. `parsedFields` is what the reader thought, kept apart from
   * the stored values above so the screen can offer them rather than apply
   * them — a suggestion that overwrites a record silently is not a suggestion.
   */
  resume: {
    filename: string | null
    mime: string | null
    bytes: number | null
    uploadedAt: string | null
    status: 'None' | 'Parsed' | 'Unreadable'
    confidence: number
    method: string | null
    notes: string[]
    parsedFields: ParsedResumeFields
    parsedSkills: string[]
    /* Read as structure rather than as form fields — shown, not offered. */
    positions: ParsedPosition[]
    education: { school?: string; course?: string; year?: number }[]
    certifications: string[]
    languages: string[]
    excerpt: string
  } | null

  /** Exactly the moves the server will accept — never offer anything else. */
  allowedMoves: string[]
  canHire: boolean
}

export type RecruitmentPipeline = {
  stages: { stage: string; count: number; oldestDays: number }[]
  active: number
  hiredThisMonth: number
  openRequisitions: number
  seatsToFill: number
}

export const getPipeline = () => get<RecruitmentPipeline>('hr/recruitment/pipeline')
export const getApplicant = (id: number) => get<ApplicantDetail>(`hr/applicants/${id}/detail`)
export const moveApplicant = (id: number, stage: string) =>
  post<ApplicantDetail>(`hr/applicants/${id}/move`, { stage })

/** The terms of an offer, as they were put in writing. */
export type OfferTerms = {
  position: string | null
  salary: number | null
  dailyRate: number | null
  deMinimis: number | null
  orientationAt: string | null
  orientationVenue: string | null
  startDate: string | null
  expiresOn: string | null
  notes: string | null
  sentAt: string | null
  response: 'Accepted' | 'Declined' | null
  respondedAt: string | null
  declineReason: string | null
}

/** The offer email exactly as it would go out. Built by the same code that sends it. */
export type OfferPreview = {
  subject: string
  companyName: string
  firstName: string
  position: string
  department: string | null
  branch: string | null
  salary: string | null
  dailyRate: string | null
  deMinimis: string | null
  startDate: string | null
  expiresOn: string | null
  orientationDate: string | null
  orientationTime: string | null
  orientationVenue: string | null
  notes: string | null
  reference: string | null
  acceptUrl: string | null
  declineUrl: string | null
}

export type OfferInput = {
  position?: string
  salary: number
  /** What the letter states. Derived from the monthly salary when left out. */
  dailyRate?: number
  deMinimis?: number
  startDate?: string
  expiresOn?: string
  orientationAt?: string
  orientationVenue?: string
  notes?: string
}

export const previewOffer = (id: number, terms: Partial<OfferInput>) =>
  post<OfferPreview>(`hr/applicants/${id}/offer/preview`, terms)

/** Records the offer and emails it. The stage follows the act. */
export const sendOffer = (id: number, terms: OfferInput) =>
  post<ApplicantDetail & { offerSent: boolean; offerMessage: string }>(`hr/applicants/${id}/offer`, terms)

/** For the half of candidates who answer by phone rather than by link. */
export const recordOfferResponse = (id: number, decision: 'Accepted' | 'Declined', reason?: string) =>
  post<ApplicantDetail>(`hr/applicants/${id}/offer/response`, { decision, ...(reason ? { reason } : {}) })

/**
 * Opens the offer letter or the referral slip as a Word file.
 *
 * The same documents the candidate receives, built by the same code — a
 * recruiter checking the wording of a probation clause should not have to
 * email it to themselves first. Fetched rather than linked because the route
 * needs the bearer token.
 */
export async function openOfferDocument(id: number, which: 'letter' | 'referral'): Promise<void> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/hr/applicants/${id}/offer/document?document=${which}`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })

  if (!response.ok) {
    throw new ApiError('That document could not be built.', response.status)
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')

  link.href = url
  link.download =
    which === 'referral' ? 'Referral Slip.pdf' : 'Employment Offer.pdf'
  link.click()

  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Creates the 201 file and the sign-in. The password is returned once. */
export const hireApplicant = (
  id: number,
  body: {
    firstName: string
    lastName: string
    middleName?: string
    employeeNo?: string
    email?: string
    mobile?: string
    positionId?: number
    departmentId?: number
    branchId?: number
    payrollGroupId?: number
    shiftId?: number
    dateHired?: string
    employmentStatus?: string
    salary?: number
  },
) =>
  post<{
    employee: { id: number; employeeNo: string; name: string; dateHired: string | null }
    credentials: { username?: string; password?: string; employee?: string; mustChange?: boolean }
    /* What the application could not answer, handed back at the one moment
       somebody is certainly looking at the screen. */
    profile: ProfileStatus & { missing: ProfileGap[] }
  }>(`hr/applicants/${id}/hire`, body)

/* -------------------------------------------------------------------------- */
/* Resumes and applicant intake                                                */
/* -------------------------------------------------------------------------- */

/**
 * Reads a CV for the intake form.
 *
 * The file is held server-side under the returned token, so creating the
 * applicant afterwards quotes the token rather than uploading the document a
 * second time.
 */
export function readResumeForIntake(file: File): Promise<ResumeRead> {
  const body = new FormData()
  body.append('resume', file)

  return request<ResumeRead>('hr/recruitment/parse-resume', { method: 'POST', body })
}

/** Creates an applicant from the full HR intake form. */
export const createApplicantIntake = (values: Record<string, unknown>) =>
  post<{ id: number; code: string; name: string; stage: string; resumeAttached: boolean }>(
    'hr/recruitment/intake',
    values,
  )

/** Corrects an applicant's details. Only the fields sent are written. */
export const updateApplicantDetails = (id: number, values: Record<string, unknown>) =>
  patch<ApplicantDetail>(`hr/applicants/${id}/details`, values)

/** Attaches or replaces the CV on an existing applicant, and re-reads it. */
export function uploadApplicantResume(id: number, file: File): Promise<ApplicantDetail> {
  const body = new FormData()
  body.append('resume', file)

  return request<ApplicantDetail>(`hr/applicants/${id}/resume`, { method: 'POST', body })
}

/**
 * Opens an applicant's CV.
 *
 * Fetched rather than linked because the route needs the bearer token, which
 * an `<a href>` cannot send — and because a resume should not have a URL that
 * works for anybody who is handed it.
 */
export async function openApplicantResume(id: number): Promise<void> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/hr/applicants/${id}/resume`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })

  if (!response.ok) {
    throw new ApiError('That CV could not be opened.', response.status)
  }

  const url = URL.createObjectURL(await response.blob())

  window.open(url, '_blank', 'noopener')

  // Long enough for the new tab to have taken the blob; the object URL would
  // otherwise be held for the life of the document.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/* -------------------------------------------------------------------------- */
/* Onboarding — the 201 files that are not finished yet                        */
/* -------------------------------------------------------------------------- */

/** One field a 201 file is missing, and what its absence costs. */
export type ProfileGap = {
  key: string
  label: string
  /**
   * blocking = they cannot be paid · attendance = lateness cannot be judged ·
   * statutory = a government filing will be wrong · record = the file is thin.
   */
  severity: 'blocking' | 'attendance' | 'statutory' | 'record'
  why: string
}

export type ProfileStatus = {
  status: 'Cannot be paid' | 'Filings incomplete' | 'Thin' | 'For review' | 'Complete'
  gaps: number
  blocking: number
  statutory: number
  summary: string
}

export type OnboardingRow = ProfileStatus & {
  id: number
  employeeNo: string
  name: string
  position: string | null
  department: string | null
  branch: string | null
  dateHired: string | null
  daysSinceHired: number | null
  /** True when the record was created by hiring an applicant. */
  fromHire: boolean
}

export type OnboardingFile = ProfileStatus & {
  id: number
  employeeNo: string
  name: string
  dateHired: string | null
  completedAt: string | null
  missing: ProfileGap[]
  /** Set when the file cannot be signed off yet, and says why. */
  blockedReason: string | null
  applicantId: number | null
  applicantCode: string | null
}

export const getOnboarding = () =>
  get<{
    employees: OnboardingRow[]
    counts: { total: number; blocking: number; statutory: number; fromHire: number }
  }>('hr/onboarding')

export const getEmployeeFile = (id: number) =>
  get<OnboardingFile>(`hr/employees/${id}/onboarding`)

/** Signs a 201 file off. Refuses while payroll would still break on it. */
export const completeEmployeeFile = (id: number) =>
  post<OnboardingFile>(`hr/employees/${id}/onboarding/complete`)

export const reopenEmployeeFile = (id: number) =>
  post<OnboardingFile>(`hr/employees/${id}/onboarding/reopen`)

/* -------------------------------------------------------------------------- */
/* Onboarding tasks — the new-hire checklist                                  */
/* -------------------------------------------------------------------------- */

export type OnboardingTaskItem = {
  id: number
  employee_id: number
  key: string
  category: 'Documentation' | 'IT Access' | 'Training' | 'Compliance'
  title: string
  description: string | null
  due_date: string | null
  status: 'Pending' | 'Done'
  completed_at: string | null
  completedBy: { id: number; name: string } | null
}

export type OnboardingTaskCompletion = { percent: number; done: number; total: number; overdue: number }

export type EmployeeOnboardingChecklist = {
  employeeId: number
  employeeNo: string
  name: string
  items: OnboardingTaskItem[]
  completion: OnboardingTaskCompletion
}

export type OnboardingTaskOutstandingRow = OnboardingTaskCompletion & {
  id: number
  employeeNo: string
  name: string
  department: string | null
  branch: string | null
}

export const getOnboardingTasks = (employeeId: number) =>
  get<EmployeeOnboardingChecklist>(`hr/employees/${employeeId}/onboarding-tasks`)

export const getOnboardingTasksOutstanding = () =>
  get<{ employees: OnboardingTaskOutstandingRow[]; counts: { total: number; overdue: number } }>(
    'hr/onboarding-tasks/outstanding',
  )

export const completeOnboardingTask = (taskId: number) =>
  post<OnboardingTaskItem>(`hr/onboarding-tasks/${taskId}/complete`)

export const reopenOnboardingTask = (taskId: number) =>
  post<OnboardingTaskItem>(`hr/onboarding-tasks/${taskId}/reopen`)

/* -------------------------------------------------------------------------- */
/* Offboarding — the clearance process a separation starts                    */
/* -------------------------------------------------------------------------- */

export type OffboardingTaskItem = {
  id: number
  offboarding_case_id: number
  key: string
  category: 'Property Turnover' | 'Access Revocation' | 'Clearance' | 'Documentation' | 'Finance'
  title: string
  description: string | null
  status: 'Pending' | 'Done'
  completed_at: string | null
  completedBy: { id: number; name: string } | null
}

export type OffboardingCaseDetail = {
  id: number
  employeeId: number
  employeeNo: string
  name: string
  department: string | null
  branch: string | null
  reason: 'Resignation' | 'Termination' | 'End of Contract' | 'Retirement'
  initiatedBy: string | null
  lastWorkingDay: string | null
  clearanceStatus: 'Pending' | 'In Progress' | 'Cleared'
  exitInterviewCompleted: boolean
  finalPayStatus: 'Pending' | 'Processing' | 'Released'
  notes: string | null
  closedAt: string | null
  /** Null while open. 'Cancelled' means the case was called off, not finished. */
  outcome: 'Completed' | 'Cancelled' | null
  cancelReason: string | null
  items: OffboardingTaskItem[]
  completion: { percent: number; done: number; total: number }
  /** True when `initiate` found a case already open rather than starting one. */
  wasAlreadyOpen: boolean
}

export type OffboardingHistoryRow = {
  id: number
  employeeId: number
  employeeNo: string | null
  name: string | null
  department: string | null
  branch: string | null
  reason: OffboardingCaseDetail['reason']
  closedAt: string | null
  outcome: 'Completed' | 'Cancelled'
  cancelReason: string | null
}

export type EmployeeOffboardingCase = {
  id: number
  reason: OffboardingCaseDetail['reason']
  clearanceStatus: OffboardingCaseDetail['clearanceStatus']
  finalPayStatus: OffboardingCaseDetail['finalPayStatus']
  lastWorkingDay: string | null
  closedAt: string | null
  open: boolean
}

export type OffboardingCaseRow = {
  id: number
  employeeId: number
  employeeNo: string
  name: string
  department: string | null
  branch: string | null
  reason: OffboardingCaseDetail['reason']
  lastWorkingDay: string | null
  clearanceStatus: OffboardingCaseDetail['clearanceStatus']
  finalPayStatus: OffboardingCaseDetail['finalPayStatus']
  percent: number
  done: number
  total: number
}

export const getOffboardingCases = () =>
  get<{ cases: OffboardingCaseRow[]; counts: { total: number; pendingClearance: number; pendingFinalPay: number } }>(
    'hr/offboarding',
  )

export const getOffboardingCase = (caseId: number) => get<OffboardingCaseDetail>(`hr/offboarding/${caseId}`)

export const initiateOffboarding = (employeeId: number, reason: OffboardingCaseDetail['reason'], lastWorkingDay?: string) =>
  post<OffboardingCaseDetail>(`hr/employees/${employeeId}/offboarding/initiate`, { reason, lastWorkingDay })

export const updateOffboardingCase = (caseId: number, values: Record<string, unknown>) =>
  patch<OffboardingCaseDetail>(`hr/offboarding/${caseId}`, values)

export const closeOffboardingCase = (caseId: number) => post<OffboardingCaseDetail>(`hr/offboarding/${caseId}/close`)

export const cancelOffboardingCase = (caseId: number, reason: string) =>
  post<OffboardingCaseDetail>(`hr/offboarding/${caseId}/cancel`, { reason })

export const completeOffboardingTask = (taskId: number) =>
  post<OffboardingCaseDetail>(`hr/offboarding-tasks/${taskId}/complete`)

export const reopenOffboardingTask = (taskId: number) =>
  post<OffboardingCaseDetail>(`hr/offboarding-tasks/${taskId}/reopen`)

export const getOffboardingHistory = () => get<OffboardingHistoryRow[]>('hr/offboarding/history')

/** Every offboarding case an employee has ever had — for the Masterfile record. */
export const getEmployeeOffboardingCases = (employeeId: number) =>
  get<EmployeeOffboardingCase[]>(`hr/employees/${employeeId}/offboarding`)

/* -------------------------------------------------------------------------- */
/* Wage orders — a DOLE rate, keyed in once, propagated automatically         */
/* -------------------------------------------------------------------------- */

export type WageOrderRow = {
  id: number
  label: string
  orderNo: string | null
  regionLabel: string
  dailyRate: number
  effectiveDate: string | null
  notes: string | null
  branches: { id: number; name: string }[]
  createdBy: string | null
  appliedAt: string | null
  appliedBy: string | null
  adjustmentsCount: number
}

export type WageOrderPreview = {
  affected: number
  belowRate: number
  employees: { employee: string; employeeNo: string; currentDailyRate: number }[]
}

export type WageOrderApplyResult = {
  adjusted: number
  alreadyCompliant: number
  employees: { employee: string; employeeNo: string; oldDailyRate: number; newDailyRate: number }[]
}

export const getWageOrders = () => get<WageOrderRow[]>('hr/wage-orders')

export const createWageOrder = (body: {
  label: string
  orderNo?: string
  regionLabel: string
  dailyRate: number
  effectiveDate: string
  notes?: string
  branchIds: number[]
}) => post<WageOrderRow>('hr/wage-orders', body)

export const previewWageOrder = (id: number) => get<WageOrderPreview>(`hr/wage-orders/${id}/preview`)

export const applyWageOrder = (id: number) => post<WageOrderApplyResult>(`hr/wage-orders/${id}/apply`)

export type BranchOption = { id: number; code: string; name: string }

export const getBranchUnits = () => get<BranchOption[]>('hr/branch-units')

/* -------------------------------------------------------------------------- */
/* 201 documents — the paperwork behind the 201 file                          */
/* -------------------------------------------------------------------------- */

export type DocumentType = {
  id: number
  key: string
  name: string
  category: 'Pre-Employment' | 'Government-Mandated' | 'Contract' | 'Performance' | 'Separation'
  required: boolean
  expires: boolean
  validity_months: number | null
  sort_order: number
}

export type DocumentChecklistItem = {
  documentTypeId: number
  key: string
  name: string
  category: DocumentType['category']
  required: boolean
  expires: boolean
  validityMonths: number | null
  documentId: number | null
  status: 'Missing' | 'Pending' | 'Verified' | 'Rejected' | 'Expired'
  originalName: string | null
  uploadedAt: string | null
  uploadedBy: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  expiryDate: string | null
  notes: string | null
}

export type DocumentCompletion = {
  percent: number
  verified: number
  required: number
  missing: number
  expiringSoon: number
}

export type EmployeeChecklist = {
  employeeId: number
  employeeNo: string
  name: string
  items: DocumentChecklistItem[]
  completion: DocumentCompletion
}

export type DocumentOutstandingRow = DocumentCompletion & {
  id: number
  employeeNo: string
  name: string
  department: string | null
  branch: string | null
}

export const getDocumentTypes = () => get<DocumentType[]>('hr/document-types')

export const getEmployeeChecklist = (employeeId: number) =>
  get<EmployeeChecklist>(`hr/employees/${employeeId}/documents`)

export const getDocumentsOutstanding = () =>
  get<{ employees: DocumentOutstandingRow[]; counts: { total: number; missing: number; expiringSoon: number } }>(
    'hr/documents/outstanding',
  )

/** Uploads (or replaces) one document against one employee's checklist slot. */
export function uploadEmployeeDocument(
  employeeId: number,
  documentTypeId: number,
  file: File,
  expiryDate?: string,
) {
  const form = new FormData()
  form.append('document_type_id', String(documentTypeId))
  form.append('file', file)
  if (expiryDate) form.append('expiry_date', expiryDate)

  return request<DocumentChecklistItem>(`hr/employees/${employeeId}/documents`, { method: 'POST', body: form })
}

export const verifyDocument = (documentId: number) =>
  post<DocumentChecklistItem>(`hr/documents/${documentId}/verify`)

export const rejectDocument = (documentId: number, notes: string) =>
  post<DocumentChecklistItem>(`hr/documents/${documentId}/reject`, { notes })

export const deleteDocument = (documentId: number) => del<{ deleted: boolean }>(`hr/documents/${documentId}`)

export async function downloadEmployeeDocument(documentId: number, filename: string) {
  const token = useAuth.getState().token
  const response = await fetch(`${API_BASE_URL}/hr/documents/${documentId}/download`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError('Could not download that document.', response.status)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/* -------------------------------------------------------------------------- */
/* Impersonation — "log in as"                                                */
/* -------------------------------------------------------------------------- */

export type ImpersonatableUser = {
  id: number
  name: string
  username: string
  email: string | null
  department: string | null
  status: string
}

export const listImpersonatableUsers = () => get<ImpersonatableUser[]>('admin/impersonation/users')

/** Mints a token for the target user — see ImpersonationController::start. */
export const startImpersonation = (userId: number) =>
  post<{ token: string; user: import('@/app/auth').AuthUser; expiresAt: string }>(`admin/impersonation/${userId}/start`)

/**
 * Ends the session from the inside — must be called while the *impersonated*
 * token is still the active one, before the caller swaps back to their own.
 * See useAuth().endImpersonation for the client-side half of "Return to admin".
 */
export const stopImpersonation = () => post<{ ended: boolean }>('admin/impersonation/stop')

/* -------------------------------------------------------------------------- */
/* ID cards                                                                    */
/* -------------------------------------------------------------------------- */

/** A row from the generic `hr/employees` resource, trimmed to what the ID card picker needs. */
export type EmployeeBasic = {
  id: number
  employeeNo: string
  fullName: string
  department: string | null
  positionTitle: string | null
}

export const listEmployeesBasic = () => get<EmployeeBasic[]>('hr/employees')

export type IdCard = {
  id: number
  employeeNo: string
  name: string
  position: string | null
  department: string | null
  branch: string | null
  status: 'Active' | 'Inactive'
  photoUrl: string | null
  publicToken: string
}

export const getIdCard = (employeeId: number) => get<IdCard>(`hr/employees/${employeeId}/id-card`)

export function uploadIdPhoto(employeeId: number, file: File) {
  const form = new FormData()
  form.append('photo', file)
  return request<IdCard>(`hr/employees/${employeeId}/id-card/photo`, { method: 'POST', body: form })
}

/** Invalidates every badge printed for this person so far — the lost/compromised-card action. */
export const regenerateIdToken = (employeeId: number) => post<IdCard>(`hr/employees/${employeeId}/id-card/regenerate-token`)

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export type Notification = {
  id: string
  tone: 'critical' | 'warning' | 'info'
  title: string
  meta: string
  detail: string
  /** Where to go to do something about it. */
  link: string
  /** Set only on a real per-event notice (an assignment, a mention, an escalation) — dismissible, unlike the aggregate cards. */
  noticeId?: number
}

/**
 * The bell.
 *
 * Only things that are true of this database and belong to the person reading
 * them. `unread` counts the ones that are not merely informational, so an
 * empty bell shows no dot — a permanent red dot is not a notification.
 */
export const getNotifications = () =>
  get<{ items: Notification[]; unread: number }>('notifications')

/** Dismisses one real event notice — assignment, mention or escalation — after it's been read. */
export const markNoticeRead = (noticeId: number) => post<{ id: number }>(`notifications/notices/${noticeId}`)

export type OcrHealth = { available: boolean; binary: string; version: string | null; note: string }

/** Whether scanned/photographed resumes can actually be read on this host. */
export const getOcrHealth = () => get<OcrHealth>('hr/ocr/health')

/* -------------------------------------------------------------------------- */
/* Job postings                                                                */
/* -------------------------------------------------------------------------- */

export type JobPostingDetail = {
  slug: string
  title: string
  department: string | null
  location: string | null
  employmentType: string
  workSetup: string
  experienceLevel: string
  summary: string | null
  openings: number
  postedOn: string | null
  closesOn: string | null
  responsibilities?: string[]
  qualifications?: string[]
  benefits?: string[]
}

/**
 * The words of an advert, written from the role itself.
 *
 * Nothing is saved — the draft comes back for somebody to read and edit. The
 * salary band says which of two things it is: `budget` means it was built
 * around the approved rate on the manpower request, `indicative` means it is a
 * market range that has not been checked against what this company pays.
 */
export type AdvertDraft = {
  title: string
  family: string
  experienceLevel: string
  employmentType: string
  workSetup: string
  summary: string
  responsibilities: string
  qualifications: string
  benefits: string
  salaryMin: number
  salaryMax: number
  salaryBasis: 'budget' | 'indicative'
  note: string
}

export const draftAdvert = (input: { positionId?: number; requisitionId?: number; title?: string }) =>
  post<AdvertDraft>('hr/job-postings/draft', input)

/* -------------------------------------------------------------------------- */
/* The vacancy archive                                                         */
/* -------------------------------------------------------------------------- */

export type ArchivedVacancy = {
  id: number
  no: string
  position: string | null
  department: string | null
  branch: string | null
  headcount: number
  filled: number
  archivedAt: string | null
  archivedBy: string | null
  reason: string | null
  applicants: number
  adverts: number
  /** Null when it may be destroyed; otherwise the sentence explaining why not. */
  blockedFrom: string | null
}

export const getVacancyArchive = () =>
  get<{ requisitions: ArchivedVacancy[]; counts: { total: number; deletable: number } }>(
    'hr/vacancy-archive',
  )

/**
 * Takes a vacancy off the board, and its advert off the careers site.
 *
 * Always allowed, because it loses nothing. The response says how many adverts
 * came down and how many applicants are still live against it — a recruiter
 * who has just archived a vacancy with three people mid-interview needs to
 * know that now.
 */
export const archiveVacancy = (id: number, reason?: string) =>
  post<{ no: string; adverts: number; applicants: number; message: string }>(
    `hr/requisitions/${id}/archive`,
    reason ? { reason } : {},
  )

/** Brings one back. Its advert returns as a draft, never re-published. */
export const restoreVacancy = (id: number) =>
  post<{ no: string; message: string }>(`hr/vacancy-archive/${id}/restore`)

/** Destroys it for good. Refuses when a hire or an application points at it. */
export const deleteVacancyForGood = (id: number) =>
  del<{ no: string; message: string }>(`hr/vacancy-archive/${id}`)

/** Drafts an advert from an approved manpower request, copying what it knows. */
export const postingFromRequisition = (requisitionId: number) =>
  post<JobPostingDetail>(`hr/requisitions/${requisitionId}/posting`)

/** Puts the advert on the careers site. Stamps the date it went live. */
export const publishPosting = (id: number, closesOn?: string) =>
  post<JobPostingDetail>(`hr/job-postings/${id}/publish`, closesOn ? { closesOn } : {})

export const closePosting = (id: number) =>
  post<{ slug: string; status: string }>(`hr/job-postings/${id}/close`)

/**
 * Re-reads every live application against the advert as it now stands.
 *
 * Needed because an assessment compares two documents and editing the advert
 * changes one of them — a tightened requirement would otherwise leave a page
 * of verdicts measured against a rule that no longer exists.
 */
export const reassessPosting = (id: number) =>
  post<{ assessed: number; bands: Record<string, number> }>(`hr/job-postings/${id}/reassess`)

export const reassessApplicant = (id: number) =>
  post<ApplicantDetail>(`hr/applicants/${id}/reassess`)

/* -------------------------------------------------------------------------- */
/* Performance                                                                 */
/* -------------------------------------------------------------------------- */

export type ReviewDetail = {
  id: number
  employee: string | null
  employeeNo: string | null
  department: string | null
  position: string | null
  period: string
  reviewer: string | null
  dueDate: string | null
  score: number | null
  rating: string | null
  strengths: string | null
  developmentAreas: string | null
  status: string
  allowedMoves: string[]
  /** What the band would be if it closed on this score — no surprises. */
  projectedRating: string | null
}

export type PerformanceSummary = {
  total: number
  completed: number
  inProgress: number
  notStarted: number
  overdue: number
  averageScore: number | null
  byRating: Record<string, number>
}

export const getPerformanceSummary = () => get<PerformanceSummary>('hr/performance/summary')
export const getReview = (id: number) => get<ReviewDetail>(`hr/reviews/${id}/detail`)
export const scoreReview = (
  id: number,
  body: { score: number; strengths?: string; developmentAreas?: string },
) => post<ReviewDetail>(`hr/reviews/${id}/score`, body)
export const moveReview = (id: number, status: string) =>
  post<ReviewDetail>(`hr/reviews/${id}/move`, { status })

export type CycleResult = {
  /** Reviews written. */
  created: number
  /** Employees who already had one for this period and were left alone. */
  skipped: number
  /** Created, but with nobody in the reporting line to conduct them. */
  noReviewer: number
  period: string
}

/** Opens a review cycle for a department, or for everyone. Safe to re-run. */
export const openReviewCycle = (body: { period: string; dueDate?: string; departmentId?: number }) =>
  post<CycleResult>('hr/performance/cycles', body)

/* -------------------------------------------------------------------------- */
/* HR dashboard                                                                */
/* -------------------------------------------------------------------------- */

/** How the trend is bucketed. The window's unit follows from it. */
export type HrGrain = 'day' | 'month' | 'year'

/** Named reporting windows. `custom` is the only one that reads from/to. */
export type HrPeriod =
  | 'today'
  | 'wtd'
  | 'mtd'
  | 'last_month'
  | 'qtd'
  | 'ytd'
  | 'last_12m'
  | 'all'
  | 'custom'

export type NamedValue = { name: string; value: number }

export type HrTrendPoint = {
  key: string
  label: string
  headcount: number
  hires: number
  exits: number
  days: number
  late: number
  absent: number
  hours: number
  overtime: number
}

export type HrDashboard = {
  kpis: {
    headcount: number
    regular: number
    probationary: number
    newThisMonth: number
    hiredInWindow: number
    hiredInWindowPrior: number
    exitsInWindow: number
    exitsInWindowPrior: number
    netHeadcountChange: number
    resigned: number
    futureHires: number
    attritionPct: number | null
    presentToday: number
    stillClockedIn: number
    lateToday: number
    onLeaveToday: number
    daysRecordedThisMonth: number
    hoursThisMonth: number
    hoursPrior: number
    overtimeThisMonth: number
    overtimePrior: number
    lateInstancesThisMonth: number
    /** Null until something has been recorded — zero would read as nobody turning up. */
    punctualityPct: number | null
    punctualityPctPrior: number | null
    absencesInWindow: number
    pendingLeave: number
    approvedLeaveThisMonth: number
    openCases: number
    casesThisWindow: number
    automaticCases: number
    unacknowledgedCases: number
    openRequisitions: number
    seatsToFill: number
    activeApplicants: number
    expiringCertifications: number
    withoutSignIn: number
  }
  trend: HrTrendPoint[]
  workforce: {
    headcount: number
    byDepartment: NamedValue[]
    byBranch: NamedValue[]
    byBusinessGroup: NamedValue[]
    byPayrollGroup: NamedValue[]
    byPosition: NamedValue[]
    byStatus: NamedValue[]
    byCivilStatus: NamedValue[]
    byTenure: NamedValue[]
    byAge: NamedValue[]
    regularisationDue: {
      employeeId: number
      employee: string
      employeeNo: string
      position: string | null
      department: string | null
      hired: string | null
      dueOn: string | null
      flagged: boolean
      flagReason: string | null
    }[]
  }
  compensation: {
    monthlyCost: number
    annualisedCost: number
    averageMonthly: number | null
    medianMonthly: number | null
    hourlyPaid: number
    monthlyPaid: number
    minimumWageEarners: number
    salaryBands: NamedValue[]
    costByDepartment: NamedValue[]
    costByPayrollGroup: NamedValue[]
  }
  payroll: {
    runs: number
    headcountPaid: number
    gross: number
    net: number
    netPrior: number
    statutoryEmployee: number
    statutoryEmployer: number
    withholdingTax: number
    totalDeductions: number
    employerCost: number
    awaitingApproval: number
    approvedNotReleased: number
    byPeriod: { name: string; gross: number; net: number; employerCost: number }[]
  }
  leave: {
    filedInWindow: number
    daysTaken: number
    pending: number
    byType: NamedValue[]
    byStatus: NamedValue[]
    balances: { name: string; credits: number; used: number; balance: number; utilisationPct: number | null }[]
  }
  discipline: { byType: NamedValue[]; watchlist: HrWatchlistRow[] }
  recruitment: {
    openRequisitions: number
    seatsToFill: number
    activeApplicants: number
    appliedInWindow: number
    hiredInWindow: number
    rejectedInWindow: number
    funnel: NamedValue[]
    bySource: NamedValue[]
    byPosition: NamedValue[]
  }
  performance: {
    total: number
    completed: number
    inProgress: number
    notStarted: number
    overdue: number
    completionPct: number | null
    averageScore: number | null
    byStatus: NamedValue[]
    byRating: NamedValue[]
    byCycle: { name: string; value: number; completed: number }[]
  }
  training: {
    sessionsInWindow: number
    sessionsCompleted: number
    attendeesInWindow: number
    certificatesHeld: number
    expiringSoon: number
    expiring: { employee: string | null; employeeNo: string | null; course: string | null; expiresOn: string | null }[]
    expired: number
  }
  compliance: {
    headcount: number
    gaps: NamedValue[]
    fullyDocumented: number
    withoutSignIn: number
    withoutShift: number
    withoutReportingLine: number
    withoutBankAccount: number
  }
  lifecycle: {
    voluntaryExitsInWindow: number
    involuntaryExitsInWindow: number
    voluntaryTurnoverPct: number | null
    involuntaryTurnoverPct: number | null
    timeToHireDays: number | null
    offersAnswered: number
    offerAcceptanceRate: number | null
    probationResolved: number
    probationConvertedToRegular: number
    probationConversionRate: number | null
  }
  documentVault: { percent: number; verified: number; required: number }
  alerts: { id: string; tone: 'critical' | 'warning' | 'info'; title: string; count: number; link: string }[]
  byDepartment: NamedValue[]
  infractionsByType: NamedValue[]
  watchlist: HrWatchlistRow[]
  pendingLeave: Record<string, unknown>[]
  onLeaveToday: Record<string, unknown>[]
  window: {
    period: HrPeriod
    grain: HrGrain
    from: string
    to: string
    label: string
    days: number
    compare: { from: string; to: string; label: string }
  }
  generatedAt: string
}

export type HrWatchlistRow = {
  employeeId: number
  name: string
  employeeNo: string
  department: string | null
  cases: number
  points: number
  openCases: number
  standing: string
  lastIncident: string | null
}

/**
 * The window is named rather than described.
 *
 * Only `custom` carries dates; every other period is resolved on the server,
 * so the label above the figures and the figures themselves come from one
 * calculation instead of two that could drift apart. `grain` is optional —
 * omitted, the server picks one that suits the length of the window.
 */
export const getHrDashboard = (
  period: HrPeriod,
  opts: { from?: string; to?: string; grain?: HrGrain } = {},
) =>
  get<HrDashboard>(
    `hr/dashboard?${new URLSearchParams({
      period,
      ...(opts.from ? { from: opts.from } : {}),
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.grain ? { grain: opts.grain } : {}),
    })}`,
  )

/* -------------------------------------------------------------------------- */
/* Dashboard windows — the same named-period + bucket resolution HR uses,     */
/* offered generically so every other module's dashboard can ask for it too. */
/* -------------------------------------------------------------------------- */

export type DashboardPeriod = HrPeriod
export type DashboardGrain = HrGrain

export type DashboardWindow = {
  period: DashboardPeriod
  grain: DashboardGrain
  from: string
  to: string
  label: string
  days: number
  compare: { from: string; to: string; label: string }
}

/** The query string a dashboard endpoint's `period`/`from`/`to`/`grain` params share. */
export function dashboardWindowQuery(
  period: DashboardPeriod,
  opts: { from?: string; to?: string; grain?: DashboardGrain } = {},
): string {
  return new URLSearchParams({
    period,
    ...(opts.from ? { from: opts.from } : {}),
    ...(opts.to ? { to: opts.to } : {}),
    ...(opts.grain ? { grain: opts.grain } : {}),
  }).toString()
}

/* -------------------------------------------------------------------------- */
/* Daily time record                                                           */
/* -------------------------------------------------------------------------- */

/** One calendar day in the cut-off — including the days nobody clocked in. */
export type DtrDay = {
  date: string
  day: string
  isWeekend: boolean
  holiday: string | null
  holidayType: string | null
  leaveType: string | null
  timeIn: string | null
  breakOut: string | null
  breakIn: string | null
  timeOut: string | null
  hoursWorked: number
  overtimeHours: number
  nightDiffHours: number
  lateMinutes: number
  undertimeMinutes: number
  breakMinutes: number
  status: string
  remarks: string | null
  /** Clocked in and never out — the commonest payroll dispute. */
  incomplete: boolean
}

export type Dtr = {
  employee: {
    id: number
    employeeNo: string
    name: string
    position: string | null
    department: string | null
    branch: string | null
    shift: string | null
    shiftHours: string | null
  }
  period: { from: string; to: string; label: string }
  days: DtrDay[]
  totals: {
    daysInPeriod: number
    daysPresent: number
    daysAbsent: number
    daysOnLeave: number
    restDays: number
    holidays: number
    hoursWorked: number
    overtimeHours: number
    nightDiffHours: number
    lateMinutes: number
    undertimeMinutes: number
    timesLate: number
    incompleteDays: number
  }
}

export type DtrPeriod = {
  id: number
  label: string
  from: string | null
  to: string | null
  status: string
}

export const listDtrPeriods = () => get<DtrPeriod[]>('hr/dtr/periods')

/** Self-service equivalents — reachable regardless of department-access, since they live under `me/`. */
export const listMyPayrollPeriods = () => get<DtrPeriod[]>('me/payroll-periods')
export const getMyAttendance = (window: { periodId?: number; from?: string; to?: string }) => {
  const query = new URLSearchParams()
  if (window.periodId) query.set('periodId', String(window.periodId))
  if (window.from) query.set('from', window.from)
  if (window.to) query.set('to', window.to)
  const qs = query.toString()
  return get<SelfService['attendance']>(`me/attendance${qs ? `?${qs}` : ''}`)
}

/** Either a payroll period or an explicit range — never both. */
export const getDtr = (employeeId: number, window: { periodId?: number; from?: string; to?: string }) =>
  get<Dtr>(
    `hr/dtr?${new URLSearchParams({
      employeeId: String(employeeId),
      ...(window.periodId ? { periodId: String(window.periodId) } : {}),
      ...(window.from ? { from: window.from } : {}),
      ...(window.to ? { to: window.to } : {}),
    })}`,
  )

/** The same record, for every employee in one payroll group over one cut-off. */
export const getDtrBulk = (payrollGroupId: number, window: { periodId?: number; from?: string; to?: string }) =>
  get<Dtr[]>(
    `hr/dtr/bulk?${new URLSearchParams({
      payrollGroupId: String(payrollGroupId),
      ...(window.periodId ? { periodId: String(window.periodId) } : {}),
      ...(window.from ? { from: window.from } : {}),
      ...(window.to ? { to: window.to } : {}),
    })}`,
  )

/* -------------------------------------------------------------------------- */
/* Org chart                                                                   */
/* -------------------------------------------------------------------------- */

export type OrgChartEmployee = {
  id: number
  name: string
  employeeNo: string | null
  title: string | null
  department: string | null
  businessGroupId: number | null
  businessGroup: string | null
  reportsToId: number | null
  photoUrl: string | null
  /** Where the card was last dragged to on the canvas. Null until someone has arranged it by hand. */
  x: number | null
  y: number | null
}

/** Every active employee, flat — the client builds the tree from `reportsToId`. */
export const getOrgChart = () => get<OrgChartEmployee[]>('hr/org-chart')

/** Saves where one card was dragged to — never changes who reports to whom. */
export const saveOrgChartPosition = (employeeId: number, x: number, y: number) =>
  post<{ id: number; x: number; y: number }>(`hr/org-chart/${employeeId}/position`, { x, y })

/** Reassigns who an employee reports to — a real 201-file change, not a layout preference. `managerId: null` clears it (makes them a root). */
export const reassignOrgChartManager = (employeeId: number, managerId: number | null) =>
  post<{ id: number; reportsToId: number | null }>(`hr/org-chart/${employeeId}/manager`, { managerId })

/* -------------------------------------------------------------------------- */
/* Training sessions                                                           */
/* -------------------------------------------------------------------------- */

export type TrainingAttendeeStatus = 'Enrolled' | 'Attended' | 'Absent' | 'Excused'

export type TrainingAttendee = {
  employeeId: number
  name: string
  employeeNo: string | null
  department: string | null
  status: TrainingAttendeeStatus
  score: number | null
  remarks: string | null
  /** Set once the session is completed and a certificate was earned. */
  certificateNo: string | null
}

export type TrainingSession = {
  id: number
  sessionNo: string
  title: string
  course: string | null
  courseId: number
  type: string | null
  provider: string | null
  validityMonths: number | null
  scheduledOn: string | null
  endsOn: string | null
  startsAt: string | null
  finishesAt: string | null
  venue: string | null
  trainer: string | null
  capacity: number | null
  passingScore: number | null
  notes: string | null
  status: 'Scheduled' | 'Ongoing' | 'Completed' | 'Cancelled'
  completedAt: string | null
  enrolled: number
  attended: number
  roster?: TrainingAttendee[]
}

export const listTrainingSessions = () => get<TrainingSession[]>('hr/training-sessions')
export const getTrainingSession = (id: number) => get<TrainingSession>(`hr/training-sessions/${id}`)

export const createTrainingSession = (body: {
  trainingCourseId: number
  title?: string
  scheduledOn: string
  endsOn?: string
  startsAt?: string
  finishesAt?: string
  venue?: string
  trainer?: string
  capacity?: number
  passingScore?: number
  notes?: string
  employeeIds?: number[]
}) => post<TrainingSession>('hr/training-sessions', body)

export const enrolInTraining = (id: number, employeeIds: number[]) =>
  post<{ added: number; session: TrainingSession }>(`hr/training-sessions/${id}/enrol`, { employeeIds })

export const removeTrainingAttendee = (id: number, employeeId: number) =>
  del<TrainingSession>(`hr/training-sessions/${id}/attendees/${employeeId}`)

export const markTrainingAttendance = (
  id: number,
  marks: { employeeId: number; status: TrainingAttendeeStatus; score?: number | null; remarks?: string | null }[],
) => post<{ updated: number; session: TrainingSession }>(`hr/training-sessions/${id}/attendance`, { marks })

/** Closes the session and issues certificates to everyone who attended and passed. */
export const completeTrainingSession = (id: number) =>
  post<{
    issued: number
    skipped: number
    certificates: { employee: string; employeeNo: string; certificateNo: string; expiresOn: string }[]
    session: TrainingSession
  }>(`hr/training-sessions/${id}/complete`)

export const reopenTrainingSession = (id: number) => post<TrainingSession>(`hr/training-sessions/${id}/reopen`)

/* -------------------------------------------------------------------------- */
/* Due process                                                                 */
/* -------------------------------------------------------------------------- */

export type DueProcessStep = {
  key: string
  title: string
  detail: string
  done: boolean
  on: string | null
  note: string | null
}

export type DueProcessState = {
  /** Misconduct runs on twin notices; a business reason runs on 30 days. */
  track: 'just-cause' | 'authorised-cause'
  steps: DueProcessStep[]
  warnings: { level: 'critical' | 'warning'; message: string }[]
  complete: boolean
  case?: { id: number; no: string; type: string; status: string; employee: string | null }
}

export const getDueProcess = (caseId: number) => get<DueProcessState>(`hr/cases/${caseId}/due-process`)

export const recordDueProcess = (
  caseId: number,
  body: Partial<{
    nteIssuedOn: string
    nteResponseDueOn: string
    nteDetails: string
    explanationReceivedOn: string
    explanation: string
    hearingOn: string
    hearingHeldOn: string
    hearingNotes: string
    decisionOn: string
    decisionFindings: string
    penalty: string
    preventiveSuspensionFrom: string
    preventiveSuspensionTo: string
    doleNotifiedOn: string
  }>,
) => post<DueProcessState>(`hr/cases/${caseId}/due-process`, body)

export type SelfService = {
  profile: {
    id: number
    employeeNo: string
    name: string
    firstName: string
    position: string | null
    /** Whether the punch clock's overtime pair should show — see PunchClock.tsx. */
    isManagerial: boolean
    department: string | null
    departmentCode: string | null
    branch: string | null
    group: string | null
    dateHired: string | null
    employmentStatus: string
    email: string | null
    birthDate: string | null
    civilStatus: string | null
    payrollGroup: string | null
    paymentMode: string | null
    tin: string | null
    sss: string | null
    philhealth: string | null
    pagibig: string | null
    mobile: string | null
    address: string | null
    shift: string | null
  }
  clock: ClockState
  attendance: {
    id: number
    date: string
    clockIn: string | null
    breakOut: string | null
    breakIn: string | null
    clockOut: string | null
    hoursWorked: number
    breakMinutes: number
    lateMinutes: number
    undertimeMinutes: number
    overtimeHours: number
    status: string
  }[]
  attendanceSummary: {
    daysThisMonth: number
    hoursThisMonth: number
    lateThisMonth: number
    lateMinutesThisMonth: number
    overtimeThisMonth: number
    absentThisMonth: number
  }
  leave: {
    balances: { type: string | null; typeId: number; entitled: number; used: number; balance: number }[]
    /** Every leave type that exists, whether or not this employee has a balance row for it yet. */
    leaveTypes: { id: number; name: string }[]
    requests: {
      id: number
      no: string
      type: string | null
      from: string | null
      to: string | null
      days: number
      reason: string | null
      filed: string | null
      approver: string | null
      status: string
    }[]
  }
  payslips: {
    id: number
    period: string
    grossPay: number
    totalDeductions: number
    netPay: number
    atmAccount: string | null
  }[]
  infractions: InfractionRecord
  /** Certifications this employee holds, with expiry worked out on read. */
  training: EmployeeCertificate[]
}

export type EmployeeCertificate = {
  id: number
  course: string
  type: string | null
  provider: string | null
  mandatory: boolean
  certificateNo: string | null
  completedOn: string | null
  expiresOn: string | null
  score: number | null
  venue: string | null
  trainer: string | null
  /** Null when the certification does not expire at all. */
  daysUntilExpiry: number | null
  state: 'Valid' | 'Expiring soon' | 'Expired'
}

export type InfractionRecord = {
  points: number
  standing: string
  windowDays: number
  open: number
  cases: {
    id: number
    no: string
    type: string
    reported: string | null
    severity: string
    action: string
    points: number
    details: string | null
    handler: string | null
    hearingOn: string | null
    acknowledgedAt: string | null
    automatic: boolean
    status: string
  }[]
}

export const getSelfService = () => get<SelfService>('me/hr')

export const getClockState = () => get<ClockState>('me/clock')

/** Records a punch and returns where the employee now stands. */
export const punchClock = (action: ClockAction, pin?: string) =>
  post<{
    action: ClockAction
    record: { id: number; date: string | null; hoursWorked: number; lateMinutes: number; status: string }
    clock: ClockState
  }>('me/clock/punch', { action, deviceId: deviceId(), ...(pin ? { pin } : {}) })

/** Files leave for the signed-in employee. */
export const fileOwnLeave = (body: {
  leaveTypeId: number
  startDate: string
  endDate: string
  days?: number
  reason?: string
}) =>
  post<{ id: number; no: string; type: string | null; days: number; balanceBefore: number; status: string }>(
    'me/leave',
    body,
  )

/**
 * Saves the "Personal and statutory" card on the employee's own screen.
 *
 * Narrow by design — see HrController::updateProfile. Nothing from the
 * "Employment" card beside it (position, department, salary, dates) is
 * reachable through this endpoint.
 */
export const updateMyProfile = (body: {
  civilStatus?: string | null
  email?: string | null
  mobile?: string | null
  address?: string | null
  paymentMode?: string | null
  tin?: string | null
  sss?: string | null
  philhealth?: string | null
  pagibig?: string | null
}) => put<SelfService['profile']>('me/profile', body)

/** Confirms receipt of an infraction notice. Not an admission. */
export const acknowledgeCase = (id: number | string) =>
  post<{ id: number; no: string; acknowledgedAt: string | null }>(`me/cases/${id}/acknowledge`)

/* -------------------------------------------------------------------------- */
/* Resignation                                                                 */
/* -------------------------------------------------------------------------- */

export type ResignationRequestDetail = {
  id: number
  employeeId: number
  employeeNo: string | null
  name: string | null
  department: string | null
  intendedLastDay: string | null
  reason: string | null
  status: 'Pending' | 'Approved' | 'Declined' | 'Cancelled'
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  offboardingCaseId: number | null
  submittedAt: string | null
}

/** Submits a resignation request for the signed-in employee. */
export const submitResignation = (intendedLastDay: string, reason?: string) =>
  post<ResignationRequestDetail>('me/resignation', { intendedLastDay, reason })

/** Withdraws the signed-in employee's own still-Pending resignation request. */
export const cancelMyResignation = () => post<ResignationRequestDetail>('me/resignation/cancel')

/**
 * One of the signed-in employee's own payslips, in full — same shape as the
 * HR-side `LivePayslip` (see `modules/hr/payslips.tsx`), scoped server-side
 * to this employee's own records only.
 */
export const getMyPayslip = (id: number) => get<import('@/modules/hr/payslips').LivePayslip>(`me/payslips/${id}`)

/** The signed-in employee's own most recent request, or null if they never filed one. */
export const getMyResignation = () => get<ResignationRequestDetail | null>('me/resignation')

/** Every resignation request still waiting on a decision. */
export const getPendingResignations = () => get<ResignationRequestDetail[]>('hr/resignations')

export const decideResignation = (id: number, decision: 'Approved' | 'Declined', note?: string) =>
  post<ResignationRequestDetail>(`hr/resignations/${id}/decide`, { decision, note })

/* -------------------------------------------------------------------------- */
/* Certificate of Employment                                                  */
/* -------------------------------------------------------------------------- */

export type CoeRequestType = 'Employment' | 'No Derogatory Record'

export type CoeRequestDetail = {
  id: number
  type: CoeRequestType
  employeeId: number
  employeeNo: string | null
  name: string | null
  department: string | null
  purpose: string | null
  includeSalary: boolean
  status: 'Pending' | 'Issued' | 'Declined'
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  submittedAt: string | null
}

/** Submits a certificate request (Employment, or No Derogatory Record) for the signed-in employee. */
export const submitCoeRequest = (purpose?: string, includeSalary?: boolean, type: CoeRequestType = 'Employment') =>
  post<CoeRequestDetail>('me/coe', { purpose, includeSalary, type })

/** Every COE request the signed-in employee has ever filed, newest first. */
export const getMyCoeRequests = () => get<CoeRequestDetail[]>('me/coe')

/** Every COE request still waiting on a decision. */
export const getPendingCoeRequests = () => get<CoeRequestDetail[]>('hr/coe')

export const decideCoeRequest = (id: number, decision: 'Issued' | 'Declined', note?: string) =>
  post<CoeRequestDetail>(`hr/coe/${id}/decide`, { decision, note })

async function downloadCoeDocument(path: string, filename: string) {
  const token = useAuth.getState().token
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError('Could not download that certificate.', response.status)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** The signed-in employee downloading their own issued certificate. */
export const downloadMyCoeDocument = (id: number, filename: string) => downloadCoeDocument(`me/coe/${id}/document`, filename)

/** HR downloading a certificate it just issued. */
export const downloadHrCoeDocument = (id: number, filename: string) => downloadCoeDocument(`hr/coe/${id}/document`, filename)

/**
 * Generic PDF download that surfaces the server's own error message rather
 * than a fixed one — the NTE/NOD endpoints refuse with a specific
 * instruction ("record the findings first") that is worth showing verbatim
 * rather than replacing with "could not download that document".
 */
async function downloadPdf(path: string, fallbackFilename: string) {
  const token = useAuth.getState().token
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })

  if (!response.ok) {
    let message = 'Could not download that document.'
    try {
      const body = (await response.json()) as { message?: string }
      if (body?.message) message = body.message
    } catch {
      /* not JSON — keep the fallback */
    }
    throw new ApiError(message, response.status)
  }

  const filename = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackFilename
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** The Notice to Explain, generated from the case's recorded due-process detail. */
export const downloadCaseNte = (caseId: number) => downloadPdf(`hr/cases/${caseId}/nte`, 'Notice to Explain.pdf')

/** The Notice of Decision, generated from the case's recorded findings. */
export const downloadCaseNod = (caseId: number) => downloadPdf(`hr/cases/${caseId}/nod`, 'Notice of Decision.pdf')

/** The signed performance review record — only available once the cycle is Completed. */
export const downloadReviewDocument = (reviewId: number) => downloadPdf(`hr/reviews/${reviewId}/document`, 'Performance Review.pdf')

/* -------------------------------------------------------------------------- */
/* Overtime pre-approval                                                      */
/* -------------------------------------------------------------------------- */

export type OvertimeRequestDetail = {
  id: number
  employeeId: number
  employeeNo: string | null
  name: string | null
  department: string | null
  workDate: string | null
  expectedStartAt: string | null
  expectedEndAt: string | null
  expectedHours: number | null
  reason: string | null
  status: 'Pending' | 'Approved' | 'Declined'
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  submittedAt: string | null
}

/** Submits an overtime pre-approval request for the signed-in employee. */
export const submitOvertimeRequest = (workDate: string, expectedStartAt: string, expectedEndAt: string, reason?: string) =>
  post<OvertimeRequestDetail>('me/overtime', { workDate, expectedStartAt, expectedEndAt, reason })

/** Every overtime request the signed-in employee has filed, newest first. */
export const getMyOvertimeRequests = () => get<OvertimeRequestDetail[]>('me/overtime')

/** Every overtime request still waiting on a decision. */
export const getPendingOvertimeRequests = () => get<OvertimeRequestDetail[]>('hr/overtime')

export const decideOvertimeRequest = (id: number, decision: 'Approved' | 'Declined', note?: string) =>
  post<OvertimeRequestDetail>(`hr/overtime/${id}/decide`, { decision, note })

/* -------------------------------------------------------------------------- */
/* Announcements, birthdays, anniversaries & holidays                         */
/* -------------------------------------------------------------------------- */

export type UpcomingEvent = {
  type: 'birthday' | 'anniversary' | 'holiday'
  date: string
  daysUntil: number
  employeeId: number | null
  employeeNo: string | null
  name: string
  department: string | null
  detail: string | null
}

/** Birthdays, hire anniversaries and holidays landing within the window, nearest first. */
export const getUpcomingEvents = (days = 30) => get<UpcomingEvent[]>(`hr/events/upcoming?days=${days}`)

export type MyAnnouncement = {
  id: number
  title: string
  body: string
  pinned: boolean
  publishedAt: string | null
  expiresAt: string | null
}

/** Active announcements for the signed-in employee's audience. */
export const getMyAnnouncements = () => get<MyAnnouncement[]>('me/announcements')

/* -------------------------------------------------------------------------- */
/* HR — administration                                                         */
/* -------------------------------------------------------------------------- */

export const decideLeave = (id: number | string, decision: 'Approved' | 'Rejected' | 'Cancelled') =>
  post<{ id: number; no: string; employee: string | null; days: number; balanceAfter: number; status: string }>(
    `hr/leaves/${id}/decide`,
    { decision },
  )

/** Raises cases for the tardiness and absence sitting in the attendance log. */
export const scanInfractions = (withinDays?: number) =>
  post<{
    scanned: number
    raised: number
    since: string
    cases: {
      no: string
      employee: string
      employeeNo: string
      type: string
      date: string
      severity: string
      action: string
      points: number
    }[]
  }>('hr/cases/scan', withinDays ? { withinDays } : {})

/** Opens a case by hand, for what attendance cannot see. */
export const raiseCase = (body: { employeeId: number; type: string; details?: string }) =>
  post<{ id: number; no: string; type: string; severity: string; action: string; points: number }>(
    'hr/cases/raise',
    body,
  )

export type WatchlistRow = {
  employeeId: number
  name: string
  employeeNo: string
  department: string | null
  cases: number
  points: number
  openCases: number
  standing: string
  lastIncident: string | null
}

export const getWatchlist = () => get<WatchlistRow[]>('hr/watchlist')

/** Puts an employee's sign-in back to the shared default. */
export const resetEmployeePassword = (id: number | string, mustChange = false) =>
  post<{ employee: string; username: string; password: string; mustChange: boolean }>(
    `hr/employees/${id}/reset-password`,
    { mustChange },
  )

/* -------------------------------------------------------------------------- */
/* Address lookup                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How far a resolved pin can be trusted.
 *
 * `rooftop` is the building, `street` the road it is on, `locality` the town.
 * The difference decides whether a driver can find the gate or only the
 * barangay, so it is shown rather than averaged away.
 */
export type GeocodePrecision = 'rooftop' | 'street' | 'locality'

export type GeocodeResult = {
  latitude: number
  longitude: number
  /** What the provider matched, so an obviously wrong hit is visible. */
  label: string
  source: 'google' | 'openstreetmap' | 'gazetteer' | 'manual'
  precision: GeocodePrecision
}

export type AddressParts = {
  street?: string
  barangay?: string
  city?: string
  province?: string
  postalCode?: string
}

/** Resolves a written address to a coordinate. */
export const geocodeAddress = (parts: AddressParts) => post<GeocodeResult>('geo/geocode', parts)

/** Reads a coordinate out of a pasted Google Maps link or a "lat, lng" pair. */
export const geocodePasted = (pasted: string) => post<GeocodeResult>('geo/geocode', { pasted })

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

export type ChecklistItem = { key: string; label: string; done: boolean; hint: string }

export type SystemStatus = {
  application: { name: string; environment: string; debug: boolean; version: string; laravel: string; php: string }
  database: {
    connected: boolean
    driver: string
    name: string | null
    host: string | null
    port: number | null
    version?: string
    migrated?: boolean
    tables?: number
    error?: string
  }
  connection: ConnectionInfo
  checklist: ChecklistItem[]
}

export type ConnectionInfo = {
  ip: string | null
  country: string | null
  city: string | null
  region: string | null
  latitude: number | null
  longitude: number | null
  isLocal: boolean
  allowed: boolean
  /** How far this connection sits from each configured area. */
  areas: { label: string; effect: 'allow' | 'block'; distanceKm: number; radiusKm: number; inside: boolean }[]
}

export const systemStatus = () => get<SystemStatus>('system/status')

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export type CompanySettings = {
  legal_name: string
  trade_name: string
  address: string
  tin: string
  phone: string
  email: string
  logo_path: string
  currency: string
  fiscal_year_start: number
  signatory_name?: string
  signatory_title?: string
}

export type SmtpSettings = {
  enabled: boolean
  host: string
  port: number
  encryption: 'tls' | 'ssl' | 'none'
  username: string
  /** Returned masked as '********' when one is stored. */
  password: string
  from_address: string
  from_name: string
  reply_to: string
}

export type SecuritySettings = {
  session_timeout_minutes: number
  require_auth_code: boolean
  max_failed_attempts: number
  lockout_minutes: number
  geo_fencing_enabled: boolean
  login_hours_enabled?: boolean
  min_password_length?: number
  audit_retention_days?: number
}

export type PayrollSettings = {
  statutory_schedule: 'first' | 'second' | 'split'
  working_days_factor: number
  hours_per_day: number
  /** Calendar day the 1st–15th cut-off pays out, same month. */
  first_half_pay_day: number
  /** Calendar day the 16th–end cut-off pays out, the following month. */
  second_half_pay_day: number
}

export const getCompanySettings = () => get<CompanySettings>('settings/company')
export const saveCompanySettings = (values: Partial<CompanySettings>) => put<CompanySettings>('settings/company', values)

export const getSmtpSettings = () => get<SmtpSettings>('settings/smtp')
export const saveSmtpSettings = (values: Partial<SmtpSettings>) => put<SmtpSettings>('settings/smtp', values)

export const getSecuritySettings = () => get<SecuritySettings>('settings/security')
export const saveSecuritySettings = (values: Partial<SecuritySettings>) => put<SecuritySettings>('settings/security', values)

/** Master switch and the roles that see every department regardless of the mapping below. */
export type DepartmentAccessSettings = {
  enabled: boolean
  bypass_roles: string[]
}

export const getDepartmentAccessSettings = () => get<DepartmentAccessSettings>('settings/department_access')
export const saveDepartmentAccessSettings = (values: Partial<DepartmentAccessSettings>) =>
  put<DepartmentAccessSettings>('settings/department_access', values)

/** One real org-chart department and which registry departments it may see. */
export type DepartmentAccessRow = {
  id: number
  code: string
  name: string
  allowedDepartments: string[]
  seesAll: boolean
  /** False when no rule has been saved for this department yet — it sees nothing until one is. */
  configured: boolean
}

export type DepartmentAccessIndex = {
  departments: DepartmentAccessRow[]
  availableDepartments: string[]
}

export const listDepartmentAccess = () => get<DepartmentAccessIndex>('admin/department-access')
export const saveDepartmentAccessRule = (hrDepartmentId: number, values: { allowedDepartments: string[]; seesAll: boolean }) =>
  put<DepartmentAccessRow>(`admin/department-access/${hrDepartmentId}`, values)

/** Who gets emailed (and who gets an in-app notice) for one automated event. */
export type NotificationRule = {
  id: number
  event: string
  name: string
  description: string | null
  emailEnabled: boolean
  inAppEnabled: boolean
  recipientRoles: string[]
  recipientEmails: string[] | null
}

export const listNotificationRules = () => get<NotificationRule[]>('admin/notification-rules')
export const saveNotificationRule = (
  id: number,
  values: Partial<Pick<NotificationRule, 'emailEnabled' | 'inAppEnabled' | 'recipientRoles' | 'recipientEmails'>>,
) => put<NotificationRule>(`admin/notification-rules/${id}`, values)

export type RoleSummary = { id: number; code: string; name: string; description: string | null }
export const listRoles = () => get<RoleSummary[]>('admin/roles')

/** The guardrails the whole ERP obeys. */
export type OperatingRules = {
  auto_post_inventory: boolean
  allow_negative_stock: boolean
  enforce_credit_limits: boolean
  batch_expiry_tracking: boolean
  require_two_factor_for_approvers: boolean
  lock_posted_periods: boolean
  default_vat_rate: number
  date_format: 'dmy' | 'mdy' | 'iso'
  base_currency: string
}

export const getOperatingRules = () => get<OperatingRules>('settings/operations')
export const saveOperatingRules = (values: Partial<OperatingRules> | Record<string, unknown>) =>
  put<OperatingRules>('settings/operations', values)

/**
 * Timekeeping switches.
 *
 * These decide what the punch clock asks for and what the integrity report
 * treats as suspicious. The API has always accepted them; this is the client
 * half that was missing, which is why the PIN could only be changed in the
 * database.
 */
export type TimekeepingSettings = {
  require_punch_pin: boolean
  restrict_punch_to_areas: boolean
  flag_shared_devices: boolean
  shared_device_threshold: number
  burst_window_seconds: number
  pin_length: number
}

export const getTimekeepingSettings = () => get<TimekeepingSettings>('settings/timekeeping')
export const saveTimekeepingSettings = (values: Partial<TimekeepingSettings>) =>
  put<TimekeepingSettings>('settings/timekeeping', values)

export const getPayrollSettings = () => get<PayrollSettings>('settings/payroll')
export const savePayrollSettings = (values: Partial<PayrollSettings>) => put<PayrollSettings>('settings/payroll', values)

/** Inputs to every delivery distance, ETA and fuel estimate. */
export type LogisticsSettings = {
  roadFactor: number
  averageSpeedKph: number
  handlingMinutes: number
  fuelPricePerLitre: number
  defaultKmPerLitre: number
  /** Pesos per km paid back for a trip made in a personally-owned vehicle. */
  ratePerKm: number
}

/**
 * Address lookup.
 *
 * The key is optional: without one, addresses resolve through OpenStreetMap,
 * which needs no account. Returned masked as '********' when one is stored.
 */
export type MapsSettings = {
  google_api_key: string
}

export const getMapsSettings = () => get<MapsSettings>('settings/maps')
export const saveMapsSettings = (values: Partial<MapsSettings>) => put<MapsSettings>('settings/maps', values)

export const getLogisticsSettings = () => get<LogisticsSettings>('settings/logistics')
export const saveLogisticsSettings = (values: Partial<LogisticsSettings>) =>
  put<LogisticsSettings>('settings/logistics', values)

export function uploadLogo(file: File) {
  const form = new FormData()
  form.append('logo', file)
  return request<{ path: string; url: string }>('settings/company/logo', { method: 'POST', body: form })
}

export const sendTestEmail = (to: string) => post<{ sent: boolean; error: string | null }>('settings/email/test', { to })

export const changeOwnPassword = (body: {
  current_password: string
  password: string
  password_confirmation: string
}) => post<{ changed: boolean }>('account/password', body)

/* -------------------------------------------------------------------------- */
/* Geo-IP                                                                      */
/* -------------------------------------------------------------------------- */

export type GeoRule = {
  id: number
  /** `area` is a point and a radius — see AccessMap. */
  kind: 'country' | 'ip' | 'cidr' | 'area'
  value: string
  label: string | null
  effect: 'allow' | 'block'
  notes: string | null
  is_active: boolean
  created_at: string
  latitude: number | null
  longitude: number | null
  radius_km: number
  city: string | null
  region: string | null
}

/** A Philippine place offered as a starting point for an area rule. */
export type GeoPreset = {
  name: string
  region: string
  latitude: number
  longitude: number
  radiusKm: number
}

export const listGeoPresets = () => get<GeoPreset[]>('admin/geo-rules/presets')

/** Fences an area: everything within `radiusKm` of the point. */
export const createGeoArea = (body: {
  value: string
  latitude: number
  longitude: number
  radius_km: number
  effect: 'allow' | 'block'
  label?: string
  region?: string
}) => post<GeoRule>('admin/geo-rules', { ...body, kind: 'area' })

export const updateGeoArea = (id: number, body: { radius_km?: number; label?: string }) =>
  patch<GeoRule>(`admin/geo-rules/${id}`, body)

/* -------------------------------------------------------------------------- */
/* Backup & restore                                                            */
/* -------------------------------------------------------------------------- */

export type BackupRecord = {
  id: number
  filename: string
  path: string
  size_bytes: number
  kind: 'manual' | 'scheduled' | 'pre-restore'
  status: 'Running' | 'Completed' | 'Failed'
  error: string | null
  created_at: string
}

export type BackupIndex = {
  backups: BackupRecord[]
  /** Row counts per table, largest first. */
  inventory: Record<string, number>
  /** Whether mysqldump was found; false means the PHP fallback is used. */
  mysqldump: boolean
  driver: string
}

export const listBackups = () => get<BackupIndex>('admin/backups')
export const createBackup = () => post<BackupRecord>('admin/backups')
export const deleteBackup = (id: number) => del<{ deleted: boolean }>(`admin/backups/${id}`)

/** Requires the caller to have typed RESTORE. */
export const restoreBackup = (id: number) =>
  post<{ restored: boolean; message: string }>(`admin/backups/${id}/restore`, { confirm: 'RESTORE' })

/**
 * Requires the caller to have typed the matching phrase — a longer one when
 * the masterfile goes too, so the shorter everyday phrase can never take the
 * 201 files with it by accident.
 */
export const clearTransactional = (includeMasterfile = false) =>
  post<{ cleared: Record<string, number>; rows: number; message: string }>('admin/backups/clear', {
    confirm: includeMasterfile ? 'CLEAR TRANSACTIONAL DATA AND MASTERFILE' : 'CLEAR TRANSACTIONAL DATA',
  })

export function uploadBackup(file: File) {
  const form = new FormData()
  form.append('file', file)
  return request<BackupRecord>('admin/backups/upload', { method: 'POST', body: form })
}

/** Streams the .sql file to the browser's download manager. */
export function downloadBackupUrl(id: number) {
  return `${API_BASE_URL}/admin/backups/${id}/download`
}

export async function downloadBackup(backup: BackupRecord) {
  const token = useAuth.getState().token
  const response = await fetch(downloadBackupUrl(backup.id), {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError('Could not download that backup.', response.status)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = backup.filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/* -------------------------------------------------------------------------- */
/* HR masterfile                                                               */
/* -------------------------------------------------------------------------- */

export type ImportIssue = {
  row: number
  employee_no: string
  severity: 'error' | 'warning'
  column: string
  message: string
}

export type ImportReport = {
  applied: boolean
  rows: number
  errors: number
  warnings: number
  issues: ImportIssue[]
  /** Row counts per table written, e.g. { employees_created: 112 }. */
  created: Record<string, number>
  default_password: string | null
}

/**
 * Uploads the AUB masterfile. With `dryRun` it only validates — nothing is
 * written — so HR can see exactly what will happen before committing.
 */
export function importEmployees(file: File, dryRun: boolean, createUsers = true) {
  const form = new FormData()
  form.append('file', file)
  form.append('dry_run', dryRun ? '1' : '0')
  form.append('create_users', createUsers ? '1' : '0')

  return request<ImportReport>('hr/employees/import', { method: 'POST', body: form })
}

/** Downloads the masterfile in AUB's exact 32-column layout. */
export async function downloadEmployeeExport() {
  const token = useAuth.getState().token
  const response = await fetch(`${API_BASE_URL}/hr/employees/export`, {
    headers: token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError('Could not export the masterfile.', response.status)

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `AUB_Payroll_Masterfile_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export const listGeoRules = () => get<GeoRule[]>('admin/geo-rules')
export const currentConnection = () => get<ConnectionInfo>('admin/geo-rules/current')
export const createGeoRule = (rule: Pick<GeoRule, 'kind' | 'value' | 'effect'> & { label?: string; notes?: string }) =>
  post<GeoRule>('admin/geo-rules', rule)
export const toggleGeoRule = (id: number, isActive: boolean) => patch<GeoRule>(`admin/geo-rules/${id}`, { is_active: isActive })
export const deleteGeoRule = (id: number) => del<{ deleted: boolean }>(`admin/geo-rules/${id}`)

/* -------------------------------------------------------------------------- */
/* Sign-in credentials                                                         */
/* -------------------------------------------------------------------------- */

export type CredentialResult = {
  id?: number
  status: 'sent' | 'failed' | 'no-email' | 'skipped'
  user: string
  email: string | null
  message: string
  /** Returned only when the email failed, so it can be passed on by hand. */
  password?: string
}

export type CredentialSummary = {
  sent: number
  failed: number
  skipped: number
  results: CredentialResult[]
}

/** How many accounts a bulk send would actually reach. */
export type CredentialReach = {
  active: number
  withEmail: number
  withoutEmail: number
  neverSignedIn: number
  mustChange: number
}

export const credentialReach = () => get<CredentialReach>('admin/credentials/reach')

export const sendCredentials = (userId: number) =>
  post<CredentialResult>(`admin/users/${userId}/credentials`, {})

export const sendCredentialsBulk = (payload: { ids?: number[]; scope?: 'with-email' | 'never-signed-in' }) =>
  post<CredentialSummary>('admin/credentials/send', payload)

/* -------------------------------------------------------------------------- */
/* Forgotten password                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Both calls are public, so neither confirms whether an account exists — the
 * reply is identical either way and only the mailbox tells the truth.
 */
export const forgotPassword = (username: string) =>
  post<{ sent: boolean; message: string; ttlMinutes: number }>('auth/forgot-password', { username })

/** Checks a code without spending it, so the reset screen can confirm it before asking for a new password. */
export const verifyResetCode = (username: string, code: string) =>
  post<{ valid: boolean }>('auth/verify-reset-code', { username, code })

export const resetPassword = (payload: {
  username: string
  code: string
  password: string
  password_confirmation: string
}) => post<{ reset: boolean; message: string }>('auth/reset-password', payload)

/* -------------------------------------------------------------------------- */
/* Fuel requests — the trip ticket                                             */
/* -------------------------------------------------------------------------- */

export type RoutePreview = {
  distanceKm: number
  durationMinutes: number
  /** Which service produced it — a road route and a ruler are not the same. */
  source: 'google' | 'osrm' | 'straight-line'
  note: string
  polyline: [number, number][]
  roundTrip: boolean
  vehicleOwnership: 'CO' | 'PO' | 'R&C'
  /* Only set for a company/rented vehicle — a personal vehicle prices as mileage instead, below. */
  kmPerLitre?: number
  reservePct?: number
  suggestedLitres?: number
  estimatedCost?: number
  /* Only set for a personally-owned vehicle. */
  mileageRate?: number
  mileageAmount?: number
}

export type FuelRequestLegRecord = {
  originLabel: string
  originLat: number
  originLng: number
  destinationLabel: string
  destinationLat: number
  destinationLng: number
  roundTrip: boolean
  distanceKm: number
  durationMinutes: number
  routeSource: 'google' | 'osrm' | 'straight-line'
}

export type FuelRequestRecord = {
  id: number
  reference: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Issued' | 'Cancelled'
  purpose: string
  /** Every destination the trip covers, in order — one leg is the common case. */
  legs: FuelRequestLegRecord[]
  vehicleId: number
  vehicle: string | null
  vehicleModel: string | null
  driverId: number | null
  driver: string | null
  driverEmail?: string | null
  requestedBy: string | null
  departAt: string | null
  eta?: string | null
  originLabel: string
  originLat: number
  originLng: number
  destinationLabel: string
  destinationLat: number
  destinationLng: number
  roundTrip: boolean
  distanceKm: number
  durationMinutes: number
  routeSource: 'google' | 'osrm' | 'straight-line'
  kmPerLitre: number
  reservePct: number
  suggestedLitres: number
  approvedLitres: number | null
  fuelPrice: number
  estimatedCost: number
  mileageRate: number | null
  mileageAmount: number | null
  approvedBy: string | null
  approvedByRole: string | null
  decidedAt: string | null
  decisionNote: string | null
  notes: string | null
  createdAt: string | null

  /* The purchase-order half of the printed form. */
  businessUnit: string | null
  supplier: string | null
  vehicleOwnership: 'CO' | 'PO' | 'R&C'
  poCategory: string | null
  products: string[]
  productOther: string | null
  unit: string
  /** Written on by the custodian once the station has billed it. */
  chargeInvoiceNo: string | null
}

/** Prices a route without saving anything. Called as the pins move. */
export const previewRoute = (body: {
  originLat: number
  originLng: number
  destinationLat: number
  destinationLng: number
  vehicleId?: number | null
  roundTrip?: boolean
  reservePct?: number
  fuelPrice?: number
  vehicleOwnership?: 'CO' | 'PO' | 'R&C'
}) => post<RoutePreview>('maintenance/fuel-requests/preview', body)

export const createFuelRequest = (body: Record<string, unknown>) =>
  post<FuelRequestRecord>('maintenance/fuel-requests', body)

export const getFuelRequest = (id: number) => get<FuelRequestRecord>(`maintenance/fuel-requests/${id}`)

export type FuelPriceToday = {
  price: number
  source: 'custom' | 'benchmark' | 'remembered' | 'manual'
  label: string
  /** When the price was *surveyed*, not when we fetched the page. */
  fetchedAt: string | null
  stale: boolean
  note: string
}

/** Today's diesel price. `refresh` bypasses the twelve-hour cache. */
export const getFuelPrice = (refresh = false) =>
  get<FuelPriceToday>(`maintenance/fuel-price${refresh ? '?refresh=1' : ''}`)

export type PlaceHit = {
  label: string
  detail: string
  latitude: number
  longitude: number
  kind: string
  source: string
}

/** Server-side place search. The browser tries Photon directly first. */
export const searchPlacesViaApi = (q: string, limit = 8) =>
  get<PlaceHit[]>(`geo/search?q=${encodeURIComponent(q)}&limit=${limit}`)

/** Amends a request that has not been decided yet. Recomputes the route. */
export const updateFuelRequest = (id: number, body: Record<string, unknown>) =>
  patch<FuelRequestRecord>(`maintenance/fuel-requests/${id}`, body)

/** Voids an authorisation but keeps the paper trail. */
export const cancelFuelRequest = (id: number, reason?: string) =>
  post<FuelRequestRecord>(`maintenance/fuel-requests/${id}/cancel`, { reason })

/** Only ever allowed before anybody has authorised fuel against it. */
export const deleteFuelRequest = (id: number) =>
  del<{ deleted: boolean; reference: string }>(`maintenance/fuel-requests/${id}`)

/** Closes the loop: the charge sales invoice the station billed it under. */
export const recordFuelInvoice = (id: number, chargeInvoiceNo: string) =>
  post<FuelRequestRecord>(`maintenance/fuel-requests/${id}/invoice`, { chargeInvoiceNo })

/**
 * Approves or rejects, and emails the requester and the driver.
 *
 * The result reports who it actually reached — "approved, but we have no email
 * address for the driver" belongs on screen, not in a log.
 */
export type FuelDecisionResult = FuelRequestRecord & {
  emailed: {
    recipients: { to: string; sent: boolean }[]
    /** Who could not be told, because we hold no address for them. */
    missing: string[]
  }
}

export const decideFuelRequest = (
  id: number,
  body: { decision: 'Approved' | 'Rejected'; approvedLitres?: number | null; note?: string },
) => post<FuelDecisionResult>(`maintenance/fuel-requests/${id}/decide`, body)
