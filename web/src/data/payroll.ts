import { Rng, personName } from './seed'
import {
  computePayslip,
  deriveRates,
  EMPTY_TIMECARD,
  type PayrollAdjustment,
  type PayrollConfig,
  type PayrollEmployee,
  type PayslipComputation,
  type TimeCard,
} from '@/lib/payroll'

/**
 * HR masterfile and payroll data, shaped to the AUB payroll upload template.
 *
 * The reference lists (business groups, branches, positions, pay rates,
 * payroll groups) are the client's real operating structure taken from the
 * uploaded template. Employee identities are generated — no real personal
 * data, statutory number or bank account is stored in the preview dataset.
 */

/* -------------------------------------------------------------------------- */
/* Reference data — the client's actual structure                             */
/* -------------------------------------------------------------------------- */

export const BUSINESS_GROUPS = ['PANADERO', 'PREMIUM KITCHEN EQUIPMENT', 'SMART HOME'] as const
export type BusinessGroup = (typeof BUSINESS_GROUPS)[number]

export const PAYROLL_GROUPS = ['TOP MANAGEMENT', 'PANADERO RANK AND FILE', 'PKE RANK AND FILE'] as const
export type PayrollGroupName = (typeof PAYROLL_GROUPS)[number]

/** JBYL retail branches plus the PKE and Smart Home units. */
export const BRANCH_UNITS = [
  'JBYL-AGTON',
  'JBYL-BALIOK',
  'JBYL-BANSALAN',
  'JBYL-CABANTIAN',
  'JBYL-CORONON',
  'JBYL-CROSSING BAYABAS',
  'JBYL-DIGOS APLAYA',
  'JBYL-KAPUTIAN',
  'JBYL-KM 5 BUHANGIN',
  'JBYL-MAKILALA 1',
  'JBYL-MAKILALA 2',
  'JBYL-MANDUG',
  'JBYL-MIDSAYAP',
  'JBYL-MLANG',
  'JBYL-OPERATIONS',
  'JBYL-PADADA',
  'JBYL-PEÑAPLATA 1',
  'JBYL-PEÑAPLATA 2',
  'JBYL-SAMAL 1',
  'JBYL-SAMAL 2',
  'JBYL-SAN ANTONIO',
  'JBYL-SANDAWA',
  'JBYL-SOUTH 1',
  'JBYL-SOUTH 2',
  'JBYL-SULOP',
  'JBYL-SUNSCOR',
  'JBYL-TORIL',
  'PKE',
  'SMART HOMES',
] as const

export const HR_DEPARTMENTS = [
  'JBYL',
  'ACCOUNTING',
  'WAREHOUSE',
  'OPERATIONS',
  'HR DEPARTMENT',
  'MAINTENANCE',
  'PROCUREMENT',
  'SALES',
  'PERFORMANCE AND PROCESS',
] as const

/** Position title with its job level, as used on the masterfile. */
type PositionDef = { title: string; level: 1 | 2 | 3 }

export const STORE_POSITIONS: PositionDef[] = [
  { title: 'CASHIER', level: 1 },
  { title: 'TRAINEE CASHIER', level: 1 },
  { title: 'BAKER', level: 1 },
  { title: 'TRAINEE BAKER', level: 1 },
  { title: 'HEAD BAKER', level: 1 },
  { title: 'CREW TRAINER', level: 1 },
  { title: 'TEAM LEADER', level: 1 },
  { title: 'TRAINEE TL', level: 1 },
  { title: 'CASHIER LIBOTER', level: 1 },
  { title: 'BRANCH TECHNICIAN', level: 1 },
]

export const MANAGEMENT_POSITIONS: PositionDef[] = [
  { title: 'AREA MANAGER', level: 3 },
  { title: 'AREA SUPERVISOR', level: 2 },
  { title: 'OPERATION MANAGER', level: 3 },
  { title: 'ACCOUNTING HEAD', level: 2 },
  { title: 'ACCOUNTING SUPERVISOR', level: 2 },
  { title: 'ACCOUNTING MANAGER', level: 3 },
  { title: 'AUDIT SUPERVISOR', level: 2 },
  { title: 'HR MANAGER', level: 3 },
  { title: 'HR COMPENSATION AND BENEFITS OFFICER', level: 2 },
  { title: 'SALES MANAGER', level: 3 },
  { title: 'PROCUREMENT MANAGER', level: 3 },
  { title: 'BUSINESS DEVELOPMENT MANAGER', level: 3 },
  { title: 'QMS TRAINING MANAGER', level: 3 },
  { title: 'TRAINING AND DEVELOPMENT SUPERVISOR', level: 2 },
  { title: 'TRAINING & DEVELOPMENT COMPLIANCE MANAGER', level: 3 },
  { title: 'PERFORMANCE AND PROCESS MANAGER', level: 3 },
  { title: 'TECHNICAL SUPERVISOR', level: 2 },
  { title: 'WAREHOUSE SUPERVISOR', level: 2 },
]

export const PKE_POSITIONS: PositionDef[] = [
  { title: 'WAREHOUSE PERSONNEL', level: 1 },
  { title: 'SERVICE TECHNICIAN', level: 1 },
]

/** Regional minimum-wage derived hourly rates actually in use. */
export const HOURLY_RATES = [50.625, 57.5, 57.75, 63.75, 65.625, 87.5] as const

/* -------------------------------------------------------------------------- */
/* Masterfile record — one row of the AUB upload template                     */
/* -------------------------------------------------------------------------- */

export type EmploymentStatus = 'PROBATION' | 'REGULAR' | 'RESIGNED'
export type CivilStatus = 'S' | 'M' | 'D' | 'W'
export type YesNo = 'YES' | 'NO'

export type MasterfileEmployee = {
  id: string
  employeeNo: string
  firstName: string
  middleName: string
  lastName: string
  suffix: string
  fullName: string
  birthDate: string
  civilStatus: CivilStatus

  group: BusinessGroup
  department: string
  branchUnit: string
  positionTitle: string
  level: 1 | 2 | 3
  costCenter: string
  employmentStatus: EmploymentStatus

  tin: string
  taxExempted: YesNo
  sss: string
  sssExempted: YesNo
  phic: string
  phicExempted: YesNo
  pagibig: string
  pagibigExempted: YesNo

  atmAccount: string
  payrollFrequency: 'S' | 'M'
  salary: number
  perHour: YesNo
  dateHired: string
  payrollGroup: PayrollGroupName
  paymentMode: 'ATM' | 'CASH' | 'CHEQUE'
  emailAddress: string
  confidential: YesNo
  minimumWageEarner: YesNo

  /** Derived, not part of the upload template. */
  dailyRate: number
  monthlyEquivalent: number
}

/** Adapts a masterfile row into the shape the payroll engine consumes. */
export function toPayrollEmployee(row: MasterfileEmployee): PayrollEmployee {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    fullName: row.fullName,
    salary: row.salary,
    rateType: row.perHour === 'YES' ? 'hourly' : 'monthly',
    payFrequency: row.payrollFrequency === 'S' ? 'semi-monthly' : 'monthly',
    minimumWageEarner: row.minimumWageEarner === 'YES',
    taxExempt: row.taxExempted === 'YES',
    sssExempt: row.sssExempted === 'YES',
    philhealthExempt: row.phicExempted === 'YES',
    pagibigExempt: row.pagibigExempted === 'YES',
  }
}

/* -------------------------------------------------------------------------- */
/* Masterfile generation                                                      */
/* -------------------------------------------------------------------------- */

function statutoryNo(rng: Rng, digits: number) {
  let out = ''
  for (let i = 0; i < digits; i++) out += rng.int(0, 9)
  return out
}

function buildRow(
  rng: Rng,
  index: number,
  spec: {
    group: BusinessGroup
    department: string
    branchUnit: string
    position: PositionDef
    payrollGroup: PayrollGroupName
    perHour: boolean
  },
): MasterfileEmployee {
  const first = personName(rng).split(' ')[0]!
  const [, lastName] = personName(rng).split(' ')
  const middle = rng.bool(0.78) ? personName(rng).split(' ')[1]! : 'N/A'
  const suffix = rng.bool(0.05) ? rng.pick(['JR.', 'SR.', 'III']) : 'N/A'
  const fullName = `${first} ${lastName}`

  const salary = spec.perHour
    ? rng.weighted([
        [65.625, 8],
        [57.5, 3],
        [63.75, 2],
        [57.75, 2],
        [50.625, 1],
        [87.5, 1],
      ] as const)
    : Math.round(rng.gaussian(22_000, 8_500, 15_000, 45_000) / 500) * 500

  const rates = deriveRates({ salary, rateType: spec.perHour ? 'hourly' : 'monthly' })
  const employmentStatus: EmploymentStatus = rng.weighted([
    ['PROBATION', 7],
    ['REGULAR', 12],
    ['RESIGNED', 1],
  ] as const)

  // AUB prefixes differ by the bank product the payroll group is enrolled in.
  const atmPrefix = spec.payrollGroup === 'TOP MANAGEMENT' ? rng.pick(['9161', '9431']) : rng.pick(['9341', '9361'])

  return {
    id: `mf-${index + 1}`,
    employeeNo: `UNI${1400 + index}`,
    firstName: first.toUpperCase(),
    middleName: middle.toUpperCase(),
    lastName: lastName!.toUpperCase(),
    suffix,
    fullName,
    birthDate: rng.daysAgo(365 * 20, 365 * 55).toISOString(),
    civilStatus: rng.weighted([
      ['S', 8],
      ['M', 3],
      ['W', 1],
      ['D', 1],
    ] as const),

    group: spec.group,
    department: spec.department,
    branchUnit: spec.branchUnit,
    positionTitle: spec.position.title,
    level: spec.position.level,
    costCenter: 'N/A',
    employmentStatus,

    tin: rng.bool(0.86) ? statutoryNo(rng, 9) : 'N/A',
    taxExempted: 'NO',
    sss: statutoryNo(rng, 10),
    sssExempted: 'NO',
    phic: statutoryNo(rng, 12),
    phicExempted: 'NO',
    pagibig: statutoryNo(rng, 12),
    pagibigExempted: 'NO',

    atmAccount: `${atmPrefix}${statutoryNo(rng, 8)}`,
    payrollFrequency: 'S',
    salary,
    perHour: spec.perHour ? 'YES' : 'NO',
    dateHired: rng.daysAgo(20, 365 * 12).toISOString(),
    payrollGroup: spec.payrollGroup,
    paymentMode: 'ATM',
    emailAddress: rng.bool(0.18) ? `${first.toLowerCase()}.${lastName!.toLowerCase()}@gmail.com` : 'N/A',
    confidential: spec.payrollGroup === 'TOP MANAGEMENT' ? 'YES' : 'NO',
    minimumWageEarner: spec.perHour ? 'YES' : 'NO',

    dailyRate: rates.dailyRate,
    monthlyEquivalent: rates.monthlyEquivalent,
  }
}

/** Builds the masterfile at the same headcount mix as the uploaded template. */
export function buildMasterfile(rng: Rng): MasterfileEmployee[] {
  const rows: MasterfileEmployee[] = []
  const storeBranches = BRANCH_UNITS.filter((b) => b.startsWith('JBYL-') && b !== 'JBYL-OPERATIONS')

  // 90 Panadero rank and file across the retail branches.
  for (let i = 0; i < 90; i++) {
    rows.push(
      buildRow(rng, rows.length, {
        group: 'PANADERO',
        department: 'JBYL',
        branchUnit: rng.pick(storeBranches),
        position: rng.weighted([
          [STORE_POSITIONS[0]!, 36],
          [STORE_POSITIONS[1]!, 27],
          [STORE_POSITIONS[2]!, 13],
          [STORE_POSITIONS[3]!, 4],
          [STORE_POSITIONS[5]!, 4],
          [STORE_POSITIONS[4]!, 2],
          [STORE_POSITIONS[6]!, 1],
          [STORE_POSITIONS[7]!, 1],
          [STORE_POSITIONS[8]!, 1],
          [STORE_POSITIONS[9]!, 1],
        ] as const),
        payrollGroup: 'PANADERO RANK AND FILE',
        perHour: true,
      }),
    )
  }

  // 22 top management across both business groups.
  const mgmtSpecs: { group: BusinessGroup; department: string; branchUnit: string }[] = [
    { group: 'PANADERO', department: 'JBYL', branchUnit: 'JBYL-OPERATIONS' },
    { group: 'PANADERO', department: 'HR DEPARTMENT', branchUnit: 'JBYL-OPERATIONS' },
    { group: 'PREMIUM KITCHEN EQUIPMENT', department: 'ACCOUNTING', branchUnit: 'PKE' },
    { group: 'PREMIUM KITCHEN EQUIPMENT', department: 'OPERATIONS', branchUnit: 'PKE' },
    { group: 'PREMIUM KITCHEN EQUIPMENT', department: 'PROCUREMENT', branchUnit: 'PKE' },
    { group: 'PREMIUM KITCHEN EQUIPMENT', department: 'SALES', branchUnit: 'PKE' },
    { group: 'PREMIUM KITCHEN EQUIPMENT', department: 'PERFORMANCE AND PROCESS', branchUnit: 'PKE' },
    { group: 'SMART HOME', department: 'OPERATIONS', branchUnit: 'SMART HOMES' },
  ]
  for (let i = 0; i < 22; i++) {
    const spec = rng.pick(mgmtSpecs)
    rows.push(
      buildRow(rng, rows.length, {
        ...spec,
        position: rng.pick(MANAGEMENT_POSITIONS),
        payrollGroup: 'TOP MANAGEMENT',
        perHour: false,
      }),
    )
  }

  // 2 PKE rank and file.
  for (const position of PKE_POSITIONS) {
    rows.push(
      buildRow(rng, rows.length, {
        group: 'PREMIUM KITCHEN EQUIPMENT',
        department: position.title === 'SERVICE TECHNICIAN' ? 'MAINTENANCE' : 'WAREHOUSE',
        branchUnit: 'PKE',
        position,
        payrollGroup: 'PKE RANK AND FILE',
        perHour: true,
      }),
    )
  }

  return rows
}

/* -------------------------------------------------------------------------- */
/* Payroll periods and runs                                                   */
/* -------------------------------------------------------------------------- */

export type PayrollPeriod = {
  id: string
  code: string
  label: string
  year: number
  month: number
  half: 1 | 2
  periodStart: string
  periodEnd: string
  payDate: string
  status: 'Open' | 'Processing' | 'For Approval' | 'Approved' | 'Released' | 'Closed'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Semi-monthly cutoffs: 1–15 paid on the 25th, 16–EOM paid on the 10th. */
export function buildPeriods(count = 12): PayrollPeriod[] {
  const now = new Date()
  const periods: PayrollPeriod[] = []

  for (let i = count - 1; i >= 0; i--) {
    const anchor = new Date(now.getFullYear(), now.getMonth() - Math.floor(i / 2), 1)
    const half: 1 | 2 = i % 2 === 0 ? 2 : 1
    const year = anchor.getFullYear()
    const month = anchor.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()

    const periodStart = new Date(year, month, half === 1 ? 1 : 16)
    const periodEnd = new Date(year, month, half === 1 ? 15 : lastDay)
    const payDate = half === 1 ? new Date(year, month, 25) : new Date(year, month + 1, 10)

    periods.push({
      id: `pp-${year}-${month + 1}-${half}`,
      code: `${year}-${String(month + 1).padStart(2, '0')}-${half === 1 ? 'A' : 'B'}`,
      label: `${MONTHS[month]} ${half === 1 ? '1–15' : `16–${lastDay}`}, ${year}`,
      year,
      month: month + 1,
      half,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      payDate: payDate.toISOString(),
      status: 'Closed',
    })
  }

  // The newest two cutoffs are still moving through the approval chain.
  const last = periods.length - 1
  if (periods[last]) periods[last]!.status = 'Open'
  if (periods[last - 1]) periods[last - 1]!.status = 'For Approval'
  if (periods[last - 2]) periods[last - 2]!.status = 'Released'
  return periods
}

/** A generated timecard for one employee in one cutoff. */
export function buildTimeCard(rng: Rng, row: MasterfileEmployee): TimeCard {
  if (row.employmentStatus === 'RESIGNED') return { ...EMPTY_TIMECARD }

  // 11 working days is a typical semi-monthly cutoff on a 6-day week.
  const scheduledDays = rng.int(10, 13)
  const absentDays = rng.bool(0.12) ? rng.int(1, 2) : 0
  const workedDays = Math.max(0, scheduledDays - absentDays)

  return {
    regularHours: workedDays * 8,
    overtimeHours: rng.bool(0.45) ? Number(rng.float(1, 14).toFixed(2)) : 0,
    nightDiffHours: rng.bool(0.2) ? Number(rng.float(2, 16).toFixed(2)) : 0,
    restDayHours: rng.bool(0.15) ? rng.int(4, 8) : 0,
    regularHolidayHours: rng.bool(0.08) ? 8 : 0,
    specialHolidayHours: rng.bool(0.1) ? 8 : 0,
    lateMinutes: rng.bool(0.3) ? rng.int(5, 75) : 0,
    undertimeMinutes: rng.bool(0.08) ? rng.int(10, 60) : 0,
    absentDays,
    paidLeaveDays: rng.bool(0.1) ? rng.int(1, 2) : 0,
  }
}

export type Payslip = {
  id: string
  periodId: string
  employeeId: string
  employeeNo: string
  employee: string
  payrollGroup: PayrollGroupName
  branchUnit: string
  positionTitle: string
  atmAccount: string
  timeCard: TimeCard
  computation: PayslipComputation
  /** Flattened for tables, filters and export. */
  grossPay: number
  totalDeductions: number
  netPay: number
  status: 'Draft' | 'For Approval' | 'Approved' | 'Released'
}

export type PayrollRun = {
  id: string
  no: string
  periodId: string
  periodLabel: string
  payrollGroup: PayrollGroupName | 'ALL GROUPS'
  payDate: string
  headcount: number
  grossPay: number
  statutory: number
  withholdingTax: number
  otherDeductions: number
  totalDeductions: number
  netPay: number
  employerCost: number
  preparedBy: string
  status: PayrollPeriod['status']
}

/** Runs the engine over the whole masterfile for one cutoff. */
export function buildPayslips(
  rng: Rng,
  period: PayrollPeriod,
  masterfile: MasterfileEmployee[],
  config?: Partial<PayrollConfig>,
): Payslip[] {
  const runConfig: PayrollConfig = { statutorySchedule: 'second', half: period.half, ...config }

  return masterfile
    .filter((row) => row.employmentStatus !== 'RESIGNED')
    .map((row) => {
      const timeCard = buildTimeCard(rng, row)

      const adjustments: PayrollAdjustment[] = []
      if (row.payrollGroup === 'TOP MANAGEMENT') {
        adjustments.push({ code: 'ALLOW-COM', label: 'Communication allowance', amount: 1_000, kind: 'earning', taxable: false })
      }
      if (rng.bool(0.18)) {
        adjustments.push({ code: 'LOAN-SSS', label: 'SSS salary loan', amount: rng.int(300, 1_800), kind: 'deduction' })
      }
      if (rng.bool(0.1)) {
        adjustments.push({ code: 'CA', label: 'Cash advance', amount: rng.int(500, 3_000), kind: 'deduction' })
      }

      const computation = computePayslip(toPayrollEmployee(row), timeCard, adjustments, runConfig)

      return {
        id: `ps-${period.id}-${row.id}`,
        periodId: period.id,
        employeeId: row.id,
        employeeNo: row.employeeNo,
        employee: row.fullName,
        payrollGroup: row.payrollGroup,
        branchUnit: row.branchUnit,
        positionTitle: row.positionTitle,
        atmAccount: row.atmAccount,
        timeCard,
        computation,
        grossPay: computation.grossPay,
        totalDeductions: computation.totalDeductions,
        netPay: computation.netPay,
        status:
          period.status === 'Open'
            ? 'Draft'
            : period.status === 'For Approval'
              ? 'For Approval'
              : period.status === 'Released' || period.status === 'Closed'
                ? 'Released'
                : 'Approved',
      }
    })
}

export function summariseRun(
  period: PayrollPeriod,
  payslips: Payslip[],
  payrollGroup: PayrollRun['payrollGroup'],
  preparedBy: string,
  index: number,
): PayrollRun {
  const scoped = payrollGroup === 'ALL GROUPS' ? payslips : payslips.filter((p) => p.payrollGroup === payrollGroup)
  const sum = (pick: (p: Payslip) => number) => Math.round(scoped.reduce((total, p) => total + pick(p), 0) * 100) / 100

  return {
    id: `run-${period.id}-${index}`,
    no: `PR-${period.code}-${String(index + 1).padStart(2, '0')}`,
    periodId: period.id,
    periodLabel: period.label,
    payrollGroup,
    payDate: period.payDate,
    headcount: scoped.length,
    grossPay: sum((p) => p.computation.grossPay),
    statutory: sum((p) => p.computation.statutoryTotal),
    withholdingTax: sum((p) => p.computation.withholdingTax),
    otherDeductions: sum((p) => p.computation.otherDeductions),
    totalDeductions: sum((p) => p.computation.totalDeductions),
    netPay: sum((p) => p.computation.netPay),
    employerCost: sum((p) => p.computation.employerCost),
    preparedBy,
    status: period.status,
  }
}
