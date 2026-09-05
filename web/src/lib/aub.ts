import type { MasterfileEmployee } from '@/data/payroll'
import { isoDate } from './format'

/**
 * AUB payroll interchange.
 *
 * Two files matter to the bank:
 *  1. The **masterfile upload** — the 32-column enrolment template, headers
 *     reproduced verbatim below. A single renamed or reordered column makes
 *     AUB reject the batch, so this list is the contract and must not drift.
 *  2. The **credit file** — account number and net pay for the disbursement.
 *
 * Import runs the same columns in reverse and reports data-quality problems
 * rather than silently accepting them.
 */

/** Column headers exactly as AUB publishes them. Order is significant. */
export const AUB_HEADERS = [
  'EMPLOYEE NO.',
  'FIRST NAME',
  'MIDDLE NAME',
  'LAST NAME',
  'SUFFIX',
  'BIRTH DATE (MM/DD/YYY)',
  'CIVIL STATUS(S/M/D/W)',
  'GROUP',
  'DEPARTMENT',
  'BRANCH/UNIT',
  'POSITION TITLE',
  'LEVEL',
  'COSTCENTER',
  'EMPLOYMENT STATUS',
  'TIN NO.',
  'TAX EXEMPTED(YES/NO)',
  'SSS NO.',
  'SSS EXEMPTED(YES/NO)',
  'PHIC NO.',
  'PHIC EXEMPTED(YES/NO)',
  'PAGIBIG NO.',
  'PAG-IBIG EXEMPTED(YES/NO)',
  'ATM ACCT. NO.',
  'PAYROLL FREQUENCY (M/S/W/MM)',
  'SALARY(MUST NOT BE ZERO)',
  'PER HOUR(YES/NO)',
  'DATE HIRED (MM/DD/YYYY)',
  'PAYROLL GROUP',
  'PAYMENT MODE(CASH/CHEQUE/ATM)',
  'EMAILADDRESS',
  'CONFIDENTIAL(YES/NO)',
  'MINIMUMWAGEEARNER(YES/NO)',
] as const

/** AUB expects MM/DD/YYYY, not the ISO dates the database stores. */
function usDate(iso: string): string {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

function blank(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value).trim()
  return text === '' ? 'N/A' : text
}

/** One masterfile row in AUB column order. */
export function toAubRow(row: MasterfileEmployee): string[] {
  return [
    row.employeeNo,
    row.firstName,
    blank(row.middleName),
    row.lastName,
    blank(row.suffix),
    usDate(row.birthDate),
    row.civilStatus,
    row.group,
    row.department,
    row.branchUnit,
    row.positionTitle,
    String(row.level),
    blank(row.costCenter),
    row.employmentStatus,
    blank(row.tin),
    row.taxExempted,
    blank(row.sss),
    row.sssExempted,
    blank(row.phic),
    row.phicExempted,
    blank(row.pagibig),
    row.pagibigExempted,
    blank(row.atmAccount),
    row.payrollFrequency,
    String(row.salary),
    row.perHour,
    usDate(row.dateHired),
    row.payrollGroup,
    row.paymentMode,
    blank(row.emailAddress),
    row.confidential,
    row.minimumWageEarner,
  ]
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

function escapeCsv(value: string): string {
  // Long numeric identifiers (SSS, PhilHealth, ATM) must survive Excel, which
  // otherwise turns them into scientific notation or strips leading zeros.
  const needsQuote = /[",\n\r]/.test(value)
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([`﻿${content}`], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** CSV in the exact AUB template layout. */
export function exportAubMasterfileCsv(rows: MasterfileEmployee[], filename = 'AUB_Payroll_Masterfile') {
  const lines = [
    AUB_HEADERS.map(escapeCsv).join(','),
    ...rows.map((row) => toAubRow(row).map(escapeCsv).join(',')),
  ]
  download(lines.join('\r\n'), `${filename}_${isoDate(new Date())}.csv`, 'text/csv')
}

/**
 * Excel workbook in the AUB layout. Every cell is written as text so Excel
 * cannot mangle the statutory and account numbers.
 */
export function exportAubMasterfileExcel(rows: MasterfileEmployee[], filename = 'AUB_Payroll_Masterfile') {
  const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const head = AUB_HEADERS.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map((row) => `<tr>${toAubRow(row).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('')

  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
<style>
  td { mso-number-format:"\\@"; border:1px solid #D9DDE3; padding:4px 8px; font-family:Calibri; font-size:11pt; }
  th { background:#E11D34; color:#fff; font-weight:600; text-align:left; padding:6px 8px;
       border:1px solid #C2142B; font-family:Calibri; font-size:11pt; white-space:nowrap; }
</style></head><body>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`

  download(html, `${filename}_${isoDate(new Date())}.xls`, 'application/vnd.ms-excel')
}

/**
 * Disbursement file: what the bank credits, per account.
 *
 * Column layout is the company's own AUB PAYROLL sheet, reproduced exactly —
 * NAME, DEPARTMENT, AUB ACCOUNT NO., BANK CODE, AMOUNT — not a house format
 * invented for this system. Amounts are fixed to two decimals; banks reject
 * floating precision. BANK CODE stays blank on every row: everyone this file
 * includes is paid into an AUB account (same-bank transfer), and the column
 * only matters for an interbank PESONet payout, which is not a channel this
 * ERP has any record of yet — left in the layout rather than dropped, so a
 * preparer can still fill it in by hand for the rare case that needs it.
 */
export type CreditFileLine = {
  atmAccount: string | null
  employeeNo: string | null
  employee: string
  department: string | null
  netPay: number
  /** ATM, CASH or CHEQUE. Only ATM, with an account number on file, belongs in a bank file — see below. */
  paymentMode: 'ATM' | 'CASH' | 'CHEQUE'
}

const AUB_CREDIT_HEADERS = ['NAME', 'DEPARTMENT', 'AUB ACCOUNT NO.', 'BANK CODE', 'AMOUNT'] as const

/** One credit-file row, in column order. */
function toCreditRow(p: CreditFileLine): string[] {
  return [p.employee.toUpperCase(), p.department ?? '', p.atmAccount ?? '', '', p.netPay.toFixed(2)]
}

/**
 * Who the credit file leaves out, and why.
 *
 * "Allowed to fill out" is decided by the employee record, not guessed at
 * here: paid by cash or cheque, they were never on this channel; flagged ATM
 * but with no account number on file, the data is incomplete rather than the
 * person being ineligible. Either way, a cash- or cheque-paid employee (or
 * one with no account on record) going into the bank batch is not a smaller
 * mistake than leaving them off it — it is the same mistake with a bank
 * statement attached. The caller shows this so a preparer knows to pay them
 * by the channel they are actually on, or to chase the missing account
 * number, not just that the batch came out shorter than the headcount.
 */
export type AubCreditFileResult = {
  included: number
  excluded: { employee: string; employeeNo: string | null; reason: string; netPay: number }[]
}

/** Only an ATM-paid employee with a real account number on file belongs in the bank batch. */
function isBankable(p: CreditFileLine): boolean {
  return p.paymentMode === 'ATM' && Boolean(p.atmAccount && p.atmAccount.trim() !== '')
}

function excludeReason(p: CreditFileLine): string {
  return p.paymentMode !== 'ATM' ? `Paid by ${p.paymentMode.toLowerCase()}, not ATM` : 'No AUB account number on file'
}

function creditFileRows(payslips: CreditFileLine[]): { banked: CreditFileLine[]; result: AubCreditFileResult } {
  const payable = payslips.filter((p) => p.netPay > 0)
  const banked = payable.filter(isBankable)
  const excluded = payable.filter((p) => !isBankable(p))

  return {
    banked,
    result: {
      included: banked.length,
      excluded: excluded.map((p) => ({
        employee: p.employee,
        employeeNo: p.employeeNo,
        reason: excludeReason(p),
        netPay: p.netPay,
      })),
    },
  }
}

export function exportAubCreditFile(payslips: CreditFileLine[], periodLabel: string): AubCreditFileResult {
  const { banked, result } = creditFileRows(payslips)

  const lines = [
    AUB_CREDIT_HEADERS.join(','),
    ...banked.map((p) => toCreditRow(p).map(escapeCsv).join(',')),
  ]

  const total = banked.reduce((sum, p) => sum + p.netPay, 0)
  lines.push('')
  lines.push(escapeCsv(`TOTAL,,${banked.length} accounts,,${total.toFixed(2)}`))

  download(lines.join('\r\n'), `AUB_Payroll_${periodLabel.replace(/[^\w]+/g, '_')}.csv`, 'text/csv')

  return result
}

/** Same file, as a text-safe Excel workbook — account numbers survive Excel's own number mangling. */
export function exportAubCreditFileExcel(payslips: CreditFileLine[], periodLabel: string): AubCreditFileResult {
  const { banked, result } = creditFileRows(payslips)

  const esc = (v: string) => v.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const head = AUB_CREDIT_HEADERS.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = banked
    .map((p) => `<tr>${toCreditRow(p).map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`)
    .join('')
  const total = banked.reduce((sum, p) => sum + p.netPay, 0)
  const footer = `<tr><td colspan="4"><strong>TOTAL — ${banked.length} accounts</strong></td><td><strong>${total.toFixed(2)}</strong></td></tr>`

  const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
<style>
  td { mso-number-format:"\\@"; border:1px solid #D9DDE3; padding:4px 8px; font-family:Calibri; font-size:11pt; }
  th { background:#E11D34; color:#fff; font-weight:600; text-align:left; padding:6px 8px;
       border:1px solid #C2142B; font-family:Calibri; font-size:11pt; white-space:nowrap; }
</style></head><body>
<table><thead><tr>${head}</tr></thead><tbody>${body}${footer}</tbody></table></body></html>`

  download(html, `AUB_Payroll_${periodLabel.replace(/[^\w]+/g, '_')}_${isoDate(new Date())}.xls`, 'application/vnd.ms-excel')

  return result
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

export type ImportIssue = {
  row: number
  employeeNo: string
  column: string
  severity: 'error' | 'warning'
  message: string
}

export type ImportResult = {
  parsed: Partial<MasterfileEmployee>[]
  issues: ImportIssue[]
  headerMatches: boolean
  missingColumns: string[]
}

/** Splits a CSV line, honouring quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else inQuotes = false
      } else current += char
    } else if (char === '"') inQuotes = true
    else if (char === ',') {
      out.push(current)
      current = ''
    } else current += char
  }
  out.push(current)
  return out
}

const YES_NO = new Set(['YES', 'NO'])

/**
 * Parses an AUB masterfile CSV and reports every problem it finds.
 *
 * This deliberately validates rather than coerces: the uploaded template
 * contained real typos (`PANDERO`, `ACOUNTING MANAGER`, `AREA ASUPERVISOR`)
 * that would create duplicate reference records if imported silently.
 */
export function parseAubMasterfile(csv: string, knownGroups: readonly string[] = []): ImportResult {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const issues: ImportIssue[] = []

  if (lines.length === 0) {
    return { parsed: [], issues: [{ row: 0, employeeNo: '', column: '', severity: 'error', message: 'The file is empty.' }], headerMatches: false, missingColumns: [...AUB_HEADERS] }
  }

  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toUpperCase())
  const missingColumns = AUB_HEADERS.filter((h) => !header.includes(h.toUpperCase()))
  const index = (name: string) => header.indexOf(name.toUpperCase())

  const parsed: Partial<MasterfileEmployee>[] = []
  const seen = new Set<string>()

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!)
    const get = (name: string) => {
      const at = index(name)
      return at === -1 ? '' : (cells[at] ?? '').trim()
    }

    const employeeNo = get('EMPLOYEE NO.')
    if (!employeeNo) continue

    const rowNo = i + 1
    const add = (column: string, severity: ImportIssue['severity'], message: string) =>
      issues.push({ row: rowNo, employeeNo, column, severity, message })

    if (seen.has(employeeNo)) add('EMPLOYEE NO.', 'error', `Duplicate employee number ${employeeNo}.`)
    seen.add(employeeNo)

    if (!get('LAST NAME')) add('LAST NAME', 'error', 'Last name is required.')
    if (!get('FIRST NAME')) add('FIRST NAME', 'error', 'First name is required.')

    const salary = Number(get('SALARY(MUST NOT BE ZERO)'))
    if (!Number.isFinite(salary) || salary <= 0) add('SALARY', 'error', 'Salary must be greater than zero.')

    const perHour = get('PER HOUR(YES/NO)').toUpperCase()
    if (!YES_NO.has(perHour)) add('PER HOUR', 'error', `Expected YES or NO, found "${perHour}".`)

    const frequency = get('PAYROLL FREQUENCY (M/S/W/MM)').toUpperCase()
    if (!['M', 'S', 'W', 'MM'].includes(frequency)) add('PAYROLL FREQUENCY', 'error', `Unrecognised frequency "${frequency}".`)

    const mode = get('PAYMENT MODE(CASH/CHEQUE/ATM)').toUpperCase()
    const atm = get('ATM ACCT. NO.')
    if (mode === 'ATM' && (!atm || atm === 'N/A')) add('ATM ACCT. NO.', 'error', 'ATM payment requires an account number.')

    for (const flag of ['TAX EXEMPTED(YES/NO)', 'SSS EXEMPTED(YES/NO)', 'PHIC EXEMPTED(YES/NO)', 'PAG-IBIG EXEMPTED(YES/NO)', 'CONFIDENTIAL(YES/NO)', 'MINIMUMWAGEEARNER(YES/NO)']) {
      const value = get(flag).toUpperCase()
      if (value && !YES_NO.has(value)) add(flag, 'error', `Expected YES or NO, found "${value}".`)
    }

    // Statutory numbers are optional on enrolment but flagged so HR can chase.
    if (!get('TIN NO.') || get('TIN NO.').toUpperCase() === 'N/A') add('TIN NO.', 'warning', 'No TIN on file — required before the first tax remittance.')
    if (!get('SSS NO.') || get('SSS NO.').toUpperCase() === 'N/A') add('SSS NO.', 'warning', 'No SSS number on file.')

    const group = get('GROUP').toUpperCase()
    if (group && knownGroups.length && !knownGroups.includes(group)) {
      add('GROUP', 'warning', `"${group}" is not a registered business group — check for a typo before importing.`)
    }

    if (perHour === 'YES' && salary > 500) add('SALARY', 'warning', 'Marked per-hour but the rate looks like a monthly amount.')
    if (perHour === 'NO' && salary < 5_000) add('SALARY', 'warning', 'Marked monthly but the amount looks like an hourly rate.')

    parsed.push({
      employeeNo,
      firstName: get('FIRST NAME').toUpperCase(),
      middleName: get('MIDDLE NAME').toUpperCase(),
      lastName: get('LAST NAME').toUpperCase(),
      suffix: get('SUFFIX'),
      fullName: `${get('FIRST NAME')} ${get('LAST NAME')}`,
      civilStatus: (get('CIVIL STATUS(S/M/D/W)').toUpperCase() || 'S') as MasterfileEmployee['civilStatus'],
      department: get('DEPARTMENT'),
      branchUnit: get('BRANCH/UNIT'),
      positionTitle: get('POSITION TITLE'),
      costCenter: get('COSTCENTER'),
      tin: get('TIN NO.'),
      sss: get('SSS NO.'),
      phic: get('PHIC NO.'),
      pagibig: get('PAGIBIG NO.'),
      atmAccount: atm,
      salary,
      emailAddress: get('EMAILADDRESS'),
    })
  }

  return { parsed, issues, headerMatches: missingColumns.length === 0, missingColumns }
}
