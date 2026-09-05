import { Rng, docNo } from './seed'
import type { Customer, Employee, Supplier } from './master'
import type { SalesOrder, SupplierInvoice } from './transactions'

const YEAR = new Date().getFullYear()

/* -------------------------------------------------------------------------- */
/* Chart of accounts                                                           */
/* -------------------------------------------------------------------------- */

export type Account = {
  id: string
  code: string
  name: string
  type: 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense'
  subtype: string
  normal: 'Debit' | 'Credit'
  level: number
  balance: number
  status: 'Active' | 'Inactive'
}

const COA_TEMPLATE: [string, string, Account['type'], string, number][] = [
  ['1000', 'ASSETS', 'Asset', 'Header', 0],
  ['1100', 'Current Assets', 'Asset', 'Header', 1],
  ['1110', 'Cash on Hand', 'Asset', 'Cash', 2],
  ['1120', 'Cash in Bank — BDO Operating', 'Asset', 'Cash', 2],
  ['1121', 'Cash in Bank — BPI Payroll', 'Asset', 'Cash', 2],
  ['1130', 'Accounts Receivable — Trade', 'Asset', 'Receivable', 2],
  ['1135', 'Allowance for Doubtful Accounts', 'Asset', 'Contra-Asset', 2],
  ['1140', 'Merchandise Inventory', 'Asset', 'Inventory', 2],
  ['1145', 'Goods in Transit', 'Asset', 'Inventory', 2],
  ['1150', 'Input VAT', 'Asset', 'Tax', 2],
  ['1160', 'Prepaid Expenses', 'Asset', 'Prepayment', 2],
  ['1200', 'Non-Current Assets', 'Asset', 'Header', 1],
  ['1210', 'Property, Plant & Equipment', 'Asset', 'Fixed Asset', 2],
  ['1215', 'Accumulated Depreciation', 'Asset', 'Contra-Asset', 2],
  ['1220', 'Transportation Equipment', 'Asset', 'Fixed Asset', 2],
  ['2000', 'LIABILITIES', 'Liability', 'Header', 0],
  ['2110', 'Accounts Payable — Trade', 'Liability', 'Payable', 2],
  ['2120', 'Accrued Expenses', 'Liability', 'Payable', 2],
  ['2130', 'Output VAT', 'Liability', 'Tax', 2],
  ['2140', 'Withholding Tax Payable', 'Liability', 'Tax', 2],
  ['2150', 'SSS / PhilHealth / Pag-IBIG Payable', 'Liability', 'Statutory', 2],
  ['2210', 'Long-term Loans Payable', 'Liability', 'Loan', 2],
  ['3000', 'EQUITY', 'Equity', 'Header', 0],
  ['3110', 'Share Capital', 'Equity', 'Capital', 2],
  ['3120', 'Retained Earnings', 'Equity', 'Earnings', 2],
  ['4000', 'REVENUE', 'Revenue', 'Header', 0],
  ['4110', 'Sales — Trade', 'Revenue', 'Operating', 2],
  ['4120', 'Sales Returns & Allowances', 'Revenue', 'Contra-Revenue', 2],
  ['4130', 'Sales Discounts', 'Revenue', 'Contra-Revenue', 2],
  ['4200', 'Other Income', 'Revenue', 'Non-operating', 2],
  ['5000', 'EXPENSES', 'Expense', 'Header', 0],
  ['5110', 'Cost of Goods Sold', 'Expense', 'COGS', 2],
  ['5210', 'Salaries & Wages', 'Expense', 'Operating', 2],
  ['5220', 'Employee Benefits', 'Expense', 'Operating', 2],
  ['5230', 'Rent Expense', 'Expense', 'Operating', 2],
  ['5240', 'Utilities', 'Expense', 'Operating', 2],
  ['5250', 'Fuel & Transportation', 'Expense', 'Operating', 2],
  ['5260', 'Repairs & Maintenance', 'Expense', 'Operating', 2],
  ['5270', 'Depreciation Expense', 'Expense', 'Operating', 2],
  ['5280', 'Marketing & Advertising', 'Expense', 'Operating', 2],
  ['5290', 'Professional Fees', 'Expense', 'Operating', 2],
  ['5310', 'Interest Expense', 'Expense', 'Non-operating', 2],
]

export function buildAccounts(rng: Rng): Account[] {
  return COA_TEMPLATE.map(([code, name, type, subtype, level], i) => ({
    id: `acc-${i + 1}`,
    code,
    name,
    type,
    subtype,
    normal: type === 'Asset' || type === 'Expense' ? 'Debit' : 'Credit',
    level,
    balance: subtype === 'Header' ? 0 : Math.round(rng.gaussian(4_800_000, 5_200_000, 12_000, 48_000_000)),
    status: 'Active',
  }))
}

/* -------------------------------------------------------------------------- */
/* Journals                                                                    */
/* -------------------------------------------------------------------------- */

export type JournalEntry = {
  id: string
  no: string
  date: string
  memo: string
  source: 'Sales' | 'Purchases' | 'Payroll' | 'Cash' | 'Adjusting' | 'Depreciation' | 'Manual'
  reference: string
  debit: number
  credit: number
  preparedBy: string
  status: 'Draft' | 'For Approval' | 'Posted' | 'Reversed'
}

export function buildJournals(rng: Rng, accountants: string[], count = 168): JournalEntry[] {
  const memos: Record<JournalEntry['source'], string[]> = {
    Sales: ['Sales invoice batch posting', 'Revenue recognition — trade', 'Sales returns adjustment'],
    Purchases: ['Supplier invoice accrual', 'Goods receipt accrual', 'Import duty capitalisation'],
    Payroll: ['Semi-monthly payroll accrual', 'Statutory contributions', '13th month provision'],
    Cash: ['Bank transfer between accounts', 'Customer collection deposit', 'Supplier payment run'],
    Adjusting: ['Prepaid expense amortisation', 'Inventory shrinkage write-off', 'FX revaluation'],
    Depreciation: ['Monthly depreciation run', 'Fleet depreciation'],
    Manual: ['Reclassification entry', 'Correction of prior posting'],
  }
  return Array.from({ length: count }, (_, i) => {
    const source = rng.pick(Object.keys(memos) as JournalEntry['source'][])
    const amount = Math.round(rng.gaussian(680_000, 720_000, 4_500, 6_400_000))
    return {
      id: `je-${i + 1}`,
      no: docNo('JV', YEAR, i + 1),
      date: rng.daysAgo(0, 190).toISOString(),
      memo: rng.pick(memos[source]),
      source,
      reference: `${rng.pick(['SO', 'PO', 'PR', 'BANK', 'HR'])}-${YEAR}-${rng.int(1000, 9999)}`,
      debit: amount,
      credit: amount,
      preparedBy: rng.pick(accountants),
      status: rng.weighted([
        ['Posted', 11],
        ['For Approval', 2],
        ['Draft', 1],
        ['Reversed', 1],
      ] as const),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Receivables & payables                                                      */
/* -------------------------------------------------------------------------- */

export type ArInvoice = {
  id: string
  no: string
  customer: string
  customerId: string
  soNo: string
  date: string
  due: string
  amount: number
  paid: number
  balance: number
  daysOverdue: number
  bucket: 'Current' | '1-30' | '31-60' | '61-90' | '90+'
  status: 'Draft' | 'Posted' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Cancelled'
  collector: string
}

export function buildArInvoices(rng: Rng, orders: SalesOrder[], collectors: string[], count = 214): ArInvoice[] {
  return Array.from({ length: count }, (_, i) => {
    const so = rng.pick(orders)
    const date = rng.daysAgo(0, 170)
    const due = new Date(date.getTime() + rng.pick([0, 15, 30, 45, 60]) * 86_400_000)
    const amount = so.amount
    const paidRatio = rng.weighted([
      [1, 9],
      [0, 4],
      [rng.float(0.15, 0.85), 3],
    ] as const)
    const paid = Math.round(amount * paidRatio)
    const balance = amount - paid
    const daysOverdue = balance > 0 ? Math.max(0, Math.round((Date.now() - due.getTime()) / 86_400_000)) : 0

    return {
      id: `ar-${i + 1}`,
      no: `INV-${YEAR}-${String(5000 + i)}`,
      customer: so.customer,
      customerId: so.customerId,
      soNo: so.no,
      date: date.toISOString(),
      due: due.toISOString(),
      amount,
      paid,
      balance,
      daysOverdue,
      bucket: daysOverdue === 0 ? 'Current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+',
      status: balance === 0 ? 'Paid' : daysOverdue > 0 ? 'Overdue' : paid > 0 ? 'Partially Paid' : 'Posted',
      collector: rng.pick(collectors),
    }
  })
}

export type ApBill = {
  id: string
  no: string
  supplier: string
  poNo: string
  date: string
  due: string
  amount: number
  paid: number
  balance: number
  daysToDue: number
  bucket: 'Current' | '1-30' | '31-60' | '61-90' | '90+'
  status: 'Draft' | 'Approved' | 'Scheduled' | 'Partially Paid' | 'Paid' | 'Overdue'
}

export function buildApBills(rng: Rng, invoices: SupplierInvoice[]): ApBill[] {
  return invoices.map((si, i) => {
    const paid = si.status === 'Paid' ? si.amount : rng.bool(0.3) ? Math.round(si.amount * rng.float(0.2, 0.8)) : 0
    const balance = si.amount - paid
    const daysToDue = Math.round((new Date(si.due).getTime() - Date.now()) / 86_400_000)
    const overdueDays = Math.max(0, -daysToDue)
    return {
      id: `ap-${i + 1}`,
      no: si.no.replace('SI', 'BILL'),
      supplier: si.supplier,
      poNo: si.poNo,
      date: si.date,
      due: si.due,
      amount: si.amount,
      paid,
      balance,
      daysToDue,
      bucket: balance === 0 || daysToDue >= 0 ? 'Current' : overdueDays <= 30 ? '1-30' : overdueDays <= 60 ? '31-60' : overdueDays <= 90 ? '61-90' : '90+',
      status:
        balance === 0
          ? 'Paid'
          : daysToDue < 0
            ? 'Overdue'
            : paid > 0
              ? 'Partially Paid'
              : rng.weighted([['Approved', 4], ['Scheduled', 3], ['Draft', 1]] as const),
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Banking, expenses, assets, tax, budget                                      */
/* -------------------------------------------------------------------------- */

export type BankAccount = {
  id: string
  name: string
  bank: string
  accountNo: string
  type: 'Operating' | 'Payroll' | 'Savings' | 'Time Deposit'
  currency: string
  balance: number
  unreconciled: number
  lastReconciled: string
  status: 'Active' | 'Dormant'
}

export function buildBankAccounts(rng: Rng): BankAccount[] {
  const defs: [string, string, BankAccount['type']][] = [
    ['Main Operating Account', 'BDO Unibank', 'Operating'],
    ['Payroll Disbursement', 'Bank of the Philippine Islands', 'Payroll'],
    ['Collections Depository', 'Metrobank', 'Operating'],
    ['Reserve Fund', 'Security Bank', 'Savings'],
    ['Time Deposit — 90 days', 'China Bank', 'Time Deposit'],
  ]
  return defs.map(([name, bank, type], i) => ({
    id: `bank-${i + 1}`,
    name,
    bank,
    accountNo: `****${rng.int(1000, 9999)}`,
    type,
    currency: 'PHP',
    balance: Math.round(rng.gaussian(9_800_000, 7_400_000, 480_000, 42_000_000)),
    unreconciled: rng.int(0, 34),
    lastReconciled: rng.daysAgo(1, 45).toISOString(),
    status: type === 'Time Deposit' ? 'Dormant' : 'Active',
  }))
}

export type Expense = {
  id: string
  no: string
  employee: string
  department: string
  category: 'Travel' | 'Meals' | 'Fuel' | 'Supplies' | 'Representation' | 'Utilities' | 'Repairs' | 'Communication'
  date: string
  amount: number
  fundType: 'Petty Cash' | 'Reimbursement' | 'Corporate Card' | 'Cash Advance'
  status: 'Draft' | 'Submitted' | 'For Approval' | 'Approved' | 'Liquidated' | 'Rejected'
}

export function buildExpenses(rng: Rng, employees: Employee[], count = 128): Expense[] {
  return Array.from({ length: count }, (_, i) => {
    const e = rng.pick(employees)
    return {
      id: `exp-${i + 1}`,
      no: docNo('EXP', YEAR, i + 1),
      employee: e.name,
      department: e.department,
      category: rng.pick(['Travel', 'Meals', 'Fuel', 'Supplies', 'Representation', 'Utilities', 'Repairs', 'Communication'] as const),
      date: rng.daysAgo(0, 120).toISOString(),
      amount: Math.round(rng.gaussian(6_800, 6_400, 320, 84_000)),
      fundType: rng.pick(['Petty Cash', 'Reimbursement', 'Corporate Card', 'Cash Advance'] as const),
      status: rng.weighted([
        ['Liquidated', 6],
        ['Approved', 3],
        ['For Approval', 3],
        ['Submitted', 2],
        ['Rejected', 1],
      ] as const),
    }
  })
}

export type FixedAssetRow = {
  id: string
  code: string
  name: string
  class: string
  acquired: string
  cost: number
  accumulatedDep: number
  netBookValue: number
  method: 'Straight Line' | 'Declining Balance'
  usefulLifeYears: number
  monthlyDep: number
  status: 'In Service' | 'Fully Depreciated' | 'Disposed' | 'Impaired'
}

export function buildFixedAssets(rng: Rng, count = 46): FixedAssetRow[] {
  const classes = ['Transportation Equipment', 'Warehouse Equipment', 'Office Equipment', 'Leasehold Improvements', 'Furniture & Fixtures', 'Computer Equipment']
  return Array.from({ length: count }, (_, i) => {
    const cost = Math.round(rng.gaussian(920_000, 780_000, 45_000, 4_800_000))
    const life = rng.pick([3, 5, 5, 7, 10])
    const ageYears = rng.float(0.2, life * 1.2)
    const accumulatedDep = Math.min(cost, Math.round((cost / life) * ageYears))
    const nbv = cost - accumulatedDep
    return {
      id: `fa-${i + 1}`,
      code: `FA-${String(i + 1).padStart(4, '0')}`,
      name: rng.pick(['Isuzu Elf Delivery Van', 'Toyota Forklift 2.5T', 'Server Rack & UPS', 'Pallet Racking System', 'Executive Office Suite', 'Laptop Fleet Batch', 'Warehouse Chiller Unit', 'CCTV System']),
      class: rng.pick(classes),
      acquired: new Date(Date.now() - ageYears * 365 * 86_400_000).toISOString(),
      cost,
      accumulatedDep,
      netBookValue: nbv,
      method: rng.weighted([['Straight Line', 8], ['Declining Balance', 2]] as const),
      usefulLifeYears: life,
      monthlyDep: Math.round(cost / life / 12),
      status: nbv <= 0 ? 'Fully Depreciated' : rng.weighted([['In Service', 12], ['Disposed', 1], ['Impaired', 1]] as const),
    }
  })
}

export type TaxFiling = {
  id: string
  form: string
  description: string
  period: string
  dueDate: string
  taxBase: number
  taxDue: number
  status: 'Not Started' | 'In Preparation' | 'For Review' | 'Filed' | 'Paid' | 'Overdue'
}

export function buildTaxFilings(rng: Rng): TaxFiling[] {
  const forms: [string, string][] = [
    ['2550M', 'Monthly VAT Declaration'],
    ['2550Q', 'Quarterly VAT Return'],
    ['1601-C', 'Withholding Tax — Compensation'],
    ['1601-EQ', 'Withholding Tax — Expanded'],
    ['1702Q', 'Quarterly Income Tax Return'],
    ['0619-E', 'Remittance — Expanded Withholding'],
    ['1604-C', 'Annual Information Return'],
  ]
  const months = ['January', 'February', 'March', 'April', 'May', 'June']
  return forms.flatMap(([form, description], fi) =>
    months.slice(0, form.includes('Q') ? 2 : 4).map((month, mi) => {
      const due = rng.daysAhead(-140, 60)
      const taxBase = Math.round(rng.gaussian(14_500_000, 6_200_000, 2_400_000, 42_000_000))
      return {
        id: `tax-${fi}-${mi}`,
        form,
        description,
        period: `${month} ${YEAR}`,
        dueDate: due.toISOString(),
        taxBase,
        taxDue: Math.round(taxBase * rng.float(0.01, 0.12)),
        status:
          due < new Date()
            ? rng.weighted([['Paid', 7], ['Filed', 2], ['Overdue', 1]] as const)
            : rng.weighted([['In Preparation', 3], ['For Review', 2], ['Not Started', 3]] as const),
      }
    }),
  )
}

export type BudgetLine = {
  id: string
  department: string
  account: string
  category: string
  annualBudget: number
  ytdBudget: number
  ytdActual: number
  committed: number
  variance: number
  variancePct: number
  status: 'Under Budget' | 'On Budget' | 'Over Budget'
}

export function buildBudgets(rng: Rng, departments: readonly string[]): BudgetLine[] {
  const accounts: [string, string][] = [
    ['5210', 'Salaries & Wages'],
    ['5230', 'Rent Expense'],
    ['5240', 'Utilities'],
    ['5250', 'Fuel & Transportation'],
    ['5260', 'Repairs & Maintenance'],
    ['5280', 'Marketing & Advertising'],
    ['5290', 'Professional Fees'],
  ]
  const rows: BudgetLine[] = []
  let n = 1
  for (const department of departments) {
    for (const [code, name] of rng.sample(accounts, rng.int(3, 6))) {
      const annualBudget = Math.round(rng.gaussian(4_200_000, 2_600_000, 480_000, 18_000_000) / 10_000) * 10_000
      const ytdBudget = Math.round(annualBudget * 0.5)
      const ytdActual = Math.round(ytdBudget * rng.gaussian(0.97, 0.19, 0.42, 1.55))
      const committed = Math.round(ytdBudget * rng.float(0.02, 0.18))
      const variance = ytdBudget - ytdActual
      const variancePct = Number(((variance / ytdBudget) * 100).toFixed(1))
      rows.push({
        id: `bud-${n++}`,
        department,
        account: `${code} · ${name}`,
        category: name,
        annualBudget,
        ytdBudget,
        ytdActual,
        committed,
        variance,
        variancePct,
        status: variancePct < -5 ? 'Over Budget' : variancePct > 8 ? 'Under Budget' : 'On Budget',
      })
    }
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/* Derived aggregates used by the finance dashboard                            */
/* -------------------------------------------------------------------------- */

export function agingBuckets(invoices: ArInvoice[]) {
  const buckets = ['Current', '1-30', '31-60', '61-90', '90+'] as const
  return buckets.map((bucket) => ({
    bucket,
    amount: invoices.filter((i) => i.balance > 0 && i.bucket === bucket).reduce((s, i) => s + i.balance, 0),
    count: invoices.filter((i) => i.balance > 0 && i.bucket === bucket).length,
  }))
}

export function topDebtors(invoices: ArInvoice[], customers: Customer[], limit = 8) {
  const byCustomer = new Map<string, number>()
  for (const inv of invoices) {
    if (inv.balance > 0) byCustomer.set(inv.customer, (byCustomer.get(inv.customer) ?? 0) + inv.balance)
  }
  return [...byCustomer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, balance]) => ({
      name,
      balance,
      terms: customers.find((c) => c.name === name)?.terms ?? 'Net 30',
    }))
}

export function supplierSpend(bills: ApBill[], suppliers: Supplier[], limit = 8) {
  const bySupplier = new Map<string, number>()
  for (const b of bills) bySupplier.set(b.supplier, (bySupplier.get(b.supplier) ?? 0) + b.amount)
  return [...bySupplier.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, spend]) => ({
      name,
      spend,
      category: suppliers.find((s) => s.name === name)?.category ?? 'General',
    }))
}
