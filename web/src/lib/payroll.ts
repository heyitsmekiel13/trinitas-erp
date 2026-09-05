/**
 * Philippine payroll engine.
 *
 * Implements the statutory computations a semi-monthly PH payroll needs:
 * SSS, PhilHealth, Pag-IBIG, and BIR withholding tax, plus the Labor Code
 * premium multipliers for overtime, night differential, rest days and
 * holidays.
 *
 * Every rate below is a *policy value* that changes when the agencies issue a
 * new circular. They are gathered here — and surfaced in Admin → Payroll
 * Settings — so an update is a one-line change, never a hunt through code.
 *
 * Effective rates encoded here: SSS 15% (RA 11199 schedule, 2025 onwards),
 * PhilHealth 5% (UHC Act schedule), Pag-IBIG max ₱10,000 MFC (HDMF Circular
 * 460), BIR withholding under the TRAIN Law table effective 2023 onwards.
 */

export const STATUTORY_EFFECTIVITY = {
  sss: 'SSS Circular 2024-006 — 15% total rate, MSC ₱5,000–₱35,000',
  philhealth: 'UHC Act (RA 11223) — 5% premium, floor ₱10,000, ceiling ₱100,000',
  pagibig: 'HDMF Circular 460 — max monthly fund salary ₱10,000',
  withholding: 'BIR RR 8-2018 (TRAIN) — revised table effective 1 January 2023',
} as const

/** Standard hours in a working day. */
export const HOURS_PER_DAY = 8

/**
 * Days used to convert a daily rate into its monthly equivalent.
 * 313 = 365 days less 52 rest days, the DOLE factor for a 6-day workweek.
 */
export const WORKING_DAYS_FACTOR = 313
export const MONTHLY_EQUIVALENT_DAYS = WORKING_DAYS_FACTOR / 12 // ≈ 26.083

/* -------------------------------------------------------------------------- */
/* Labor Code premium multipliers                                             */
/* -------------------------------------------------------------------------- */

export const PREMIUMS = {
  /** Overtime beyond 8 hours on an ordinary working day. */
  overtime: 1.25,
  /** Night differential: +10% for hours worked between 10pm and 6am. */
  nightDifferential: 0.1,
  /** Work on a rest day or special non-working holiday. */
  restDay: 1.3,
  /** Work on a regular holiday. */
  regularHoliday: 2.0,
  /** Overtime worked on a rest day or holiday carries a further 30%. */
  premiumOvertime: 1.3,
} as const

/* -------------------------------------------------------------------------- */
/* SSS                                                                        */
/* -------------------------------------------------------------------------- */

export const SSS = {
  totalRate: 0.15,
  employeeRate: 0.05,
  employerRate: 0.1,
  mscFloor: 5_000,
  mscCeiling: 35_000,
  mscStep: 500,
  /** Employees' Compensation, employer-paid on top of the contribution. */
  ecFloor: 10,
  ecCeiling: 30,
  ecThreshold: 15_000,
  /** Mandatory Provident Fund applies to the MSC above this amount. */
  wispThreshold: 20_000,
} as const

/** Rounds monthly pay onto the SSS Monthly Salary Credit ladder. */
export function sssSalaryCredit(monthlyCompensation: number): number {
  if (monthlyCompensation <= SSS.mscFloor) return SSS.mscFloor
  const stepped = Math.round(monthlyCompensation / SSS.mscStep) * SSS.mscStep
  return Math.min(SSS.mscCeiling, Math.max(SSS.mscFloor, stepped))
}

export type SssContribution = {
  salaryCredit: number
  employee: number
  employer: number
  employerEc: number
  total: number
}

export function sssContribution(monthlyCompensation: number): SssContribution {
  const salaryCredit = sssSalaryCredit(monthlyCompensation)
  const employee = round2(salaryCredit * SSS.employeeRate)
  const employer = round2(salaryCredit * SSS.employerRate)
  const employerEc = salaryCredit >= SSS.ecThreshold ? SSS.ecCeiling : SSS.ecFloor
  return { salaryCredit, employee, employer, employerEc, total: round2(employee + employer + employerEc) }
}

/* -------------------------------------------------------------------------- */
/* PhilHealth                                                                 */
/* -------------------------------------------------------------------------- */

export const PHILHEALTH = {
  rate: 0.05,
  floor: 10_000,
  ceiling: 100_000,
  /** Premium is shared equally between employee and employer. */
  employeeShare: 0.5,
} as const

export type PhilhealthContribution = { base: number; employee: number; employer: number; total: number }

export function philhealthContribution(monthlyCompensation: number): PhilhealthContribution {
  const base = Math.min(PHILHEALTH.ceiling, Math.max(PHILHEALTH.floor, monthlyCompensation))
  const total = round2(base * PHILHEALTH.rate)
  const employee = round2(total * PHILHEALTH.employeeShare)
  return { base, employee, employer: round2(total - employee), total }
}

/* -------------------------------------------------------------------------- */
/* Pag-IBIG (HDMF)                                                            */
/* -------------------------------------------------------------------------- */

export const PAGIBIG = {
  /** Contributions are computed on pay capped at this amount. */
  maxFundSalary: 10_000,
  lowerBracket: 1_500,
  employeeRateLow: 0.01,
  employeeRateHigh: 0.02,
  employerRate: 0.02,
} as const

export type PagibigContribution = { base: number; employee: number; employer: number; total: number }

export function pagibigContribution(monthlyCompensation: number): PagibigContribution {
  const base = Math.min(PAGIBIG.maxFundSalary, monthlyCompensation)
  const employeeRate = base <= PAGIBIG.lowerBracket ? PAGIBIG.employeeRateLow : PAGIBIG.employeeRateHigh
  const employee = round2(base * employeeRate)
  const employer = round2(base * PAGIBIG.employerRate)
  return { base, employee, employer, total: round2(employee + employer) }
}

/* -------------------------------------------------------------------------- */
/* BIR withholding tax                                                        */
/* -------------------------------------------------------------------------- */

export type PayFrequency = 'daily' | 'weekly' | 'semi-monthly' | 'monthly'

type TaxBracket = { over: number; baseTax: number; rate: number }

/** Revised withholding tax tables, effective 1 January 2023 (TRAIN Law). */
export const WITHHOLDING_TABLES: Record<PayFrequency, TaxBracket[]> = {
  daily: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 685, baseTax: 0, rate: 0.15 },
    { over: 1_096, baseTax: 61.65, rate: 0.2 },
    { over: 2_192, baseTax: 280.85, rate: 0.25 },
    { over: 5_479, baseTax: 1_102.6, rate: 0.3 },
    { over: 21_918, baseTax: 6_034.3, rate: 0.35 },
  ],
  weekly: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 4_808, baseTax: 0, rate: 0.15 },
    { over: 7_692, baseTax: 432.6, rate: 0.2 },
    { over: 15_385, baseTax: 1_971.2, rate: 0.25 },
    { over: 38_462, baseTax: 7_740.45, rate: 0.3 },
    { over: 153_846, baseTax: 42_355.65, rate: 0.35 },
  ],
  'semi-monthly': [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 10_417, baseTax: 0, rate: 0.15 },
    { over: 16_667, baseTax: 937.5, rate: 0.2 },
    { over: 33_333, baseTax: 4_270.7, rate: 0.25 },
    { over: 83_333, baseTax: 16_770.7, rate: 0.3 },
    { over: 333_333, baseTax: 91_770.7, rate: 0.35 },
  ],
  monthly: [
    { over: 0, baseTax: 0, rate: 0 },
    { over: 20_833, baseTax: 0, rate: 0.15 },
    { over: 33_333, baseTax: 1_875, rate: 0.2 },
    { over: 66_667, baseTax: 8_541.8, rate: 0.25 },
    { over: 166_667, baseTax: 33_541.8, rate: 0.3 },
    { over: 666_667, baseTax: 183_541.8, rate: 0.35 },
  ],
}

export function withholdingTax(taxableIncome: number, frequency: PayFrequency = 'semi-monthly'): number {
  if (taxableIncome <= 0) return 0
  const table = WITHHOLDING_TABLES[frequency]
  // Walk down to the highest bracket the income clears.
  let bracket = table[0]!
  for (const candidate of table) {
    if (taxableIncome > candidate.over) bracket = candidate
    else break
  }
  if (bracket.rate === 0) return 0
  return round2(bracket.baseTax + (taxableIncome - bracket.over) * bracket.rate)
}

/* -------------------------------------------------------------------------- */
/* Payslip computation                                                        */
/* -------------------------------------------------------------------------- */

export type RateType = 'hourly' | 'monthly'

export type PayrollEmployee = {
  id: string
  employeeNo: string
  fullName: string
  /** Hourly rate when `rateType` is hourly, otherwise the monthly rate. */
  salary: number
  rateType: RateType
  payFrequency: PayFrequency
  /** Minimum wage earners are exempt from tax on statutory pay components. */
  minimumWageEarner: boolean
  taxExempt: boolean
  sssExempt: boolean
  philhealthExempt: boolean
  pagibigExempt: boolean
}

export type TimeCard = {
  /** Hours actually worked within normal schedule. */
  regularHours: number
  overtimeHours: number
  nightDiffHours: number
  restDayHours: number
  regularHolidayHours: number
  specialHolidayHours: number
  lateMinutes: number
  undertimeMinutes: number
  absentDays: number
  /** Paid days not worked (approved leave with pay). */
  paidLeaveDays: number
}

export const EMPTY_TIMECARD: TimeCard = {
  regularHours: 0,
  overtimeHours: 0,
  nightDiffHours: 0,
  restDayHours: 0,
  regularHolidayHours: 0,
  specialHolidayHours: 0,
  lateMinutes: 0,
  undertimeMinutes: 0,
  absentDays: 0,
  paidLeaveDays: 0,
}

export type PayrollAdjustment = {
  code: string
  label: string
  amount: number
  kind: 'earning' | 'deduction'
  /** Earnings flagged taxable are added to the withholding base. */
  taxable?: boolean
}

export type PayrollConfig = {
  /**
   * Which cutoff carries the monthly SSS / PhilHealth / Pag-IBIG deduction.
   * PH practice varies; `split` halves it across both cutoffs.
   */
  statutorySchedule: 'first' | 'second' | 'split'
  /** Which half of the month this run covers. */
  half: 1 | 2
}

export type PayslipComputation = {
  hourlyRate: number
  dailyRate: number
  monthlyEquivalent: number

  basicPay: number
  overtimePay: number
  nightDiffPay: number
  restDayPay: number
  holidayPay: number
  leavePay: number
  taxableAllowances: number
  nonTaxableAllowances: number
  grossPay: number

  lateDeduction: number
  undertimeDeduction: number
  absenceDeduction: number

  sss: SssContribution
  philhealth: PhilhealthContribution
  pagibig: PagibigContribution
  /** Employee-side statutory actually withheld this cutoff. */
  sssEmployee: number
  philhealthEmployee: number
  pagibigEmployee: number
  statutoryTotal: number

  taxableIncome: number
  withholdingTax: number

  otherDeductions: number
  totalDeductions: number
  netPay: number

  employerCost: number
  thirteenthMonthAccrual: number

  adjustments: PayrollAdjustment[]
  notes: string[]
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/** Derives hourly / daily / monthly-equivalent rates from whichever is stored. */
export function deriveRates(employee: Pick<PayrollEmployee, 'salary' | 'rateType'>) {
  if (employee.rateType === 'hourly') {
    const hourlyRate = employee.salary
    const dailyRate = hourlyRate * HOURS_PER_DAY
    return { hourlyRate, dailyRate, monthlyEquivalent: round2(dailyRate * MONTHLY_EQUIVALENT_DAYS) }
  }
  const monthlyEquivalent = employee.salary
  const dailyRate = round2((monthlyEquivalent * 12) / WORKING_DAYS_FACTOR)
  return { hourlyRate: round2(dailyRate / HOURS_PER_DAY), dailyRate, monthlyEquivalent }
}

/**
 * Computes one payslip for one cutoff.
 *
 * Hourly employees are paid for hours actually worked. Monthly-rate employees
 * receive half the monthly rate, less any late, undertime or absence.
 */
export function computePayslip(
  employee: PayrollEmployee,
  timeCard: TimeCard,
  adjustments: PayrollAdjustment[] = [],
  config: PayrollConfig = { statutorySchedule: 'second', half: 2 },
): PayslipComputation {
  const notes: string[] = []
  const { hourlyRate, dailyRate, monthlyEquivalent } = deriveRates(employee)

  /* ---- Earnings ---- */
  const basicPay =
    employee.rateType === 'hourly'
      ? round2(hourlyRate * timeCard.regularHours)
      : round2(employee.salary / 2)

  const overtimePay = round2(hourlyRate * PREMIUMS.overtime * timeCard.overtimeHours)
  const nightDiffPay = round2(hourlyRate * PREMIUMS.nightDifferential * timeCard.nightDiffHours)
  const restDayPay = round2(hourlyRate * PREMIUMS.restDay * timeCard.restDayHours)
  const holidayPay = round2(
    hourlyRate * PREMIUMS.regularHoliday * timeCard.regularHolidayHours +
      hourlyRate * PREMIUMS.restDay * timeCard.specialHolidayHours,
  )
  const leavePay = round2(dailyRate * timeCard.paidLeaveDays)

  const taxableAllowances = round2(
    adjustments.filter((a) => a.kind === 'earning' && a.taxable).reduce((sum, a) => sum + a.amount, 0),
  )
  const nonTaxableAllowances = round2(
    adjustments.filter((a) => a.kind === 'earning' && !a.taxable).reduce((sum, a) => sum + a.amount, 0),
  )

  /* ---- Time deductions ---- */
  const perMinute = hourlyRate / 60
  const lateDeduction = round2(perMinute * timeCard.lateMinutes)
  const undertimeDeduction = round2(perMinute * timeCard.undertimeMinutes)
  // Monthly-rate staff are paid a flat half-month, so absences are deducted.
  // Hourly staff simply are not paid for hours they did not work.
  const absenceDeduction = employee.rateType === 'monthly' ? round2(dailyRate * timeCard.absentDays) : 0

  const grossPay = round2(
    basicPay +
      overtimePay +
      nightDiffPay +
      restDayPay +
      holidayPay +
      leavePay +
      taxableAllowances +
      nonTaxableAllowances -
      lateDeduction -
      undertimeDeduction -
      absenceDeduction,
  )

  /* ---- Statutory contributions (computed monthly, withheld per schedule) ---- */
  const sss = sssContribution(monthlyEquivalent)
  const philhealth = philhealthContribution(monthlyEquivalent)
  const pagibig = pagibigContribution(monthlyEquivalent)

  const shareOfMonth =
    config.statutorySchedule === 'split' ? 0.5 : config.statutorySchedule === 'first' ? (config.half === 1 ? 1 : 0) : config.half === 2 ? 1 : 0

  const sssEmployee = employee.sssExempt ? 0 : round2(sss.employee * shareOfMonth)
  const philhealthEmployee = employee.philhealthExempt ? 0 : round2(philhealth.employee * shareOfMonth)
  const pagibigEmployee = employee.pagibigExempt ? 0 : round2(pagibig.employee * shareOfMonth)
  const statutoryTotal = round2(sssEmployee + philhealthEmployee + pagibigEmployee)

  if (shareOfMonth === 0) notes.push('Statutory contributions are withheld on the other cutoff of this month.')

  /* ---- Withholding tax ---- */
  // Statutory contributions are deductible from the tax base (NIRC Sec. 32).
  const taxableGross = round2(basicPay + overtimePay + nightDiffPay + restDayPay + holidayPay + leavePay + taxableAllowances)
  const taxableIncome = round2(Math.max(0, taxableGross - statutoryTotal - lateDeduction - undertimeDeduction - absenceDeduction))

  let tax = 0
  if (employee.taxExempt) {
    notes.push('Employee is flagged tax-exempt on the payroll masterfile.')
  } else if (employee.minimumWageEarner) {
    // RA 9504: statutory minimum wage earners are exempt on basic wage,
    // holiday pay, overtime, night differential and hazard pay.
    notes.push('Minimum wage earner — exempt from withholding tax on statutory pay (RA 9504).')
    const nonExemptBase = round2(Math.max(0, taxableAllowances - statutoryTotal))
    tax = withholdingTax(nonExemptBase, employee.payFrequency)
  } else {
    tax = withholdingTax(taxableIncome, employee.payFrequency)
  }

  /* ---- Other deductions ---- */
  const otherDeductions = round2(
    adjustments.filter((a) => a.kind === 'deduction').reduce((sum, a) => sum + a.amount, 0),
  )

  const totalDeductions = round2(statutoryTotal + tax + otherDeductions)
  const netPay = round2(grossPay - totalDeductions)

  const employerCost = round2(
    grossPay +
      (employee.sssExempt ? 0 : (sss.employer + sss.employerEc) * shareOfMonth) +
      (employee.philhealthExempt ? 0 : philhealth.employer * shareOfMonth) +
      (employee.pagibigExempt ? 0 : pagibig.employer * shareOfMonth),
  )

  return {
    hourlyRate,
    dailyRate,
    monthlyEquivalent,
    basicPay,
    overtimePay,
    nightDiffPay,
    restDayPay,
    holidayPay,
    leavePay,
    taxableAllowances,
    nonTaxableAllowances,
    grossPay,
    lateDeduction,
    undertimeDeduction,
    absenceDeduction,
    sss,
    philhealth,
    pagibig,
    sssEmployee,
    philhealthEmployee,
    pagibigEmployee,
    statutoryTotal,
    taxableIncome,
    withholdingTax: tax,
    otherDeductions,
    totalDeductions,
    netPay,
    employerCost,
    // 13th month accrues on basic pay only (Presidential Decree 851).
    thirteenthMonthAccrual: round2(basicPay / 12),
    adjustments,
    notes,
  }
}
