import type { FormField } from '@/components/data/RecordForm'

/**
 * Form definitions for Finance & Accounting.
 *
 * Nothing here asks for a figure the ledger already knows. There is no field
 * for an invoice's balance, an account's balance, a bill's ageing bucket, an
 * asset's net book value or a budget's actual spend — every one of those is
 * what has been posted, and offering it as an input is how a set of books stops
 * agreeing with itself.
 */

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

const ACCOUNTS = { endpoint: 'finance/accounts', label: 'name', sublabel: 'code' } as const
const DEPARTMENTS = { endpoint: 'hr/departments', label: 'name', sublabel: 'code' } as const
const EMPLOYEES = { endpoint: 'hr/employees', label: 'fullName', sublabel: 'employeeNo' } as const

/* -------------------------------------------------------------------------- */

export const accountFields: FormField[] = [
  { name: 'code', label: 'Account code', required: true, placeholder: '5310' },
  { name: 'name', label: 'Account name', required: true, placeholder: 'Interest Expense' },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'),
    hint: 'Decides which side the account increases on — assets and expenses debit, the rest credit.',
  },
  { name: 'subtype', label: 'Subtype', placeholder: 'Operating' },
  { name: 'parentId', label: 'Sits under', type: 'select', optionsFrom: ACCOUNTS, full: true },
  { name: 'level', label: 'Level', type: 'number', min: 0, max: 5 },
  {
    name: 'isPostable',
    label: 'Can be posted to',
    type: 'switch',
    hint: 'Turn off for a heading. Headings total their children and refuse journal lines.',
  },
  { name: 'isActive', label: 'Active', type: 'switch' },
]

export const accountDefaults = { isPostable: true, isActive: true, level: 2 }

/* -------------------------------------------------------------------------- */

export const journalFields: FormField[] = [
  { name: 'date', label: 'Entry date', type: 'date', required: true },
  {
    name: 'source',
    label: 'Source',
    type: 'select',
    required: true,
    options: choices('Manual', 'Sales', 'Purchases', 'Payroll', 'Cash', 'Adjusting', 'Depreciation'),
  },
  {
    name: 'memo',
    label: 'Memo',
    full: true,
    placeholder: 'Accrual for December utilities',
    hint: 'Saved as a draft. Posting is a separate step and only succeeds if the entry balances.',
  },
]

export const journalDefaults = { date: today(), source: 'Manual' }

/** Debits and credits. The editor totals both sides and shows the difference. */
export const journalLines = {
  itemsEndpoint: 'finance/accounts',
  kind: 'journal',
  title: 'Journal lines',
} as const

/* -------------------------------------------------------------------------- */

export const invoiceFields: FormField[] = [
  {
    name: 'customerId',
    label: 'Customer',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'sales/customers', label: 'name', sublabel: 'code' },
    full: true,
  },
  {
    name: 'salesOrderId',
    label: 'Sales order',
    type: 'select',
    optionsFrom: { endpoint: 'sales/orders', label: 'no', sublabel: 'customer' },
    full: true,
    hint: 'Optional. Links the invoice back to what was sold.',
  },
  { name: 'date', label: 'Invoice date', type: 'date', required: true },
  { name: 'due', label: 'Due date', type: 'date', required: true },
  {
    name: 'amount',
    label: 'Total amount',
    type: 'money',
    required: true,
    min: 0.01,
    hint: 'VAT inclusive — what the customer owes.',
  },
  {
    name: 'vat',
    label: 'of which VAT',
    type: 'money',
    min: 0,
    hint: 'Posted to Output VAT so the 2550M can be assembled rather than reconstructed.',
  },
  { name: 'collectorId', label: 'Collector', type: 'select', optionsFrom: EMPLOYEES },
  { name: 'memo', label: 'Description', full: true, placeholder: 'Kitchen equipment package' },
]

export const invoiceDefaults = { date: today(), amount: 0, vat: 0 }

/* -------------------------------------------------------------------------- */

export const billFields: FormField[] = [
  {
    name: 'supplierId',
    label: 'Supplier',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'procurement/suppliers', label: 'name', sublabel: 'code' },
    full: true,
  },
  {
    name: 'supplierInvoiceId',
    label: 'Supplier invoice',
    type: 'select',
    optionsFrom: { endpoint: 'procurement/supplier-invoices', label: 'no', sublabel: 'supplier' },
    full: true,
    hint: 'Optional. Links the bill to the invoice Procurement matched.',
  },
  { name: 'date', label: 'Bill date', type: 'date', required: true },
  { name: 'due', label: 'Due date', type: 'date', required: true },
  { name: 'amount', label: 'Total amount', type: 'money', required: true, min: 0.01, hint: 'VAT inclusive.' },
  { name: 'vat', label: 'of which VAT', type: 'money', min: 0, hint: 'Claimed as Input VAT.' },
  {
    name: 'accountId',
    label: 'Charge to',
    type: 'select',
    optionsFrom: ACCOUNTS,
    full: true,
    hint: 'Which expense or asset account the bill lands in. Defaults to Utilities.',
  },
  { name: 'memo', label: 'Description', full: true, placeholder: 'Warehouse supplies for July' },
]

export const billDefaults = { date: today(), amount: 0, vat: 0 }

/* -------------------------------------------------------------------------- */

export const bankAccountFields: FormField[] = [
  { name: 'name', label: 'Account name', required: true, placeholder: 'BDO Operating' },
  { name: 'bank', label: 'Bank', required: true, placeholder: 'BDO Unibank' },
  { name: 'accountNo', label: 'Account number', required: true, placeholder: '0011-2233-4455' },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('Operating', 'Payroll', 'Savings', 'Time Deposit'),
  },
  { name: 'currency', label: 'Currency', required: true, placeholder: 'PHP' },
  {
    name: 'glAccountId',
    label: 'General ledger account',
    type: 'select',
    optionsFrom: ACCOUNTS,
    full: true,
    hint: 'The cash account this bank posts through.',
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Active', 'Dormant', 'Closed'),
    hint: 'The balance is the sum of the statement lines and is not entered here.',
  },
]

export const bankAccountDefaults = { type: 'Operating', currency: 'PHP', status: 'Active' }

/* -------------------------------------------------------------------------- */

export const bankTransactionFields: FormField[] = [
  {
    name: 'bankAccountId',
    label: 'Bank account',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'finance/bank-accounts', label: 'name', sublabel: 'bank' },
    full: true,
  },
  { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'reference', label: 'Reference', placeholder: 'CHK-40021' },
  { name: 'debit', label: 'Money in', type: 'money', min: 0 },
  { name: 'credit', label: 'Money out', type: 'money', min: 0 },
  { name: 'description', label: 'Description', full: true, placeholder: 'Deposit — customer collection' },
]

export const bankTransactionDefaults = { date: today(), debit: 0, credit: 0 }

/* -------------------------------------------------------------------------- */

export const expenseFields: FormField[] = [
  { name: 'employeeId', label: 'Claimed by', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'departmentId', label: 'Department', type: 'select', optionsFrom: DEPARTMENTS },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: choices('Travel', 'Meals', 'Fuel', 'Supplies', 'Representation', 'Utilities', 'Repairs', 'Communication'),
    hint: 'Decides the expense account unless one is chosen below.',
  },
  { name: 'date', label: 'Expense date', type: 'date', required: true },
  { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01 },
  {
    name: 'fundType',
    label: 'Paid from',
    type: 'select',
    required: true,
    options: choices('Reimbursement', 'Petty Cash', 'Corporate Card', 'Cash Advance'),
    hint: 'Petty cash comes out of the tin; everything else is owed back to whoever paid.',
  },
  { name: 'accountId', label: 'Charge to', type: 'select', optionsFrom: ACCOUNTS, full: true },
  { name: 'description', label: 'Description', full: true, placeholder: 'Delivery fuel, Tagum route' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Submitted', 'For Approval', 'Rejected'),
    hint: 'Approving the claim is a separate action — it is what posts it to the ledger.',
  },
]

export const expenseDefaults = { date: today(), amount: 0, fundType: 'Reimbursement', status: 'Draft' }

/* -------------------------------------------------------------------------- */

/**
 * The genuine article: an employee paid out of pocket (or drove their own
 * car) and wants it back — not the cash-advance liquidation `expenseFields`
 * above covers. A mileage claim raised from a personal-vehicle trip arrives
 * pre-filled through its own action rather than this form; this is for
 * everything else, and for editing a mileage claim afterwards.
 */
export const reimbursementFields: FormField[] = [
  { name: 'employeeId', label: 'Reimburse', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: choices('Mileage', 'Travel', 'Meals', 'Supplies', 'Other'),
  },
  { name: 'claimDate', label: 'Claim date', type: 'date', required: true },
  { name: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01 },
  { name: 'description', label: 'Description', full: true, placeholder: 'Grab fares, client visit in BGC' },
  {
    name: 'receiptPath',
    label: 'Receipt reference',
    hint: 'Required unless the category is Mileage, where the trip record is the evidence.',
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Submitted'),
    hint: 'Approving, rejecting or marking paid are separate actions on the claim itself.',
  },
]

export const reimbursementDefaults = { claimDate: today(), amount: 0, category: 'Other', status: 'Draft' }

/* -------------------------------------------------------------------------- */

export const fixedAssetFields: FormField[] = [
  { name: 'code', label: 'Asset code', required: true, placeholder: 'FA-0012' },
  { name: 'name', label: 'Description', required: true, placeholder: 'Isuzu Elf 6-wheeler' },
  { name: 'class', label: 'Asset class', placeholder: 'Transportation Equipment' },
  {
    name: 'assetId',
    label: 'Maintenance asset',
    type: 'select',
    optionsFrom: { endpoint: 'maintenance/assets', label: 'name', sublabel: 'code' },
    hint: 'Links the capitalised record to the asset Maintenance services.',
  },

  { section: 'Depreciation', name: 'acquired', label: 'Acquired on', type: 'date', required: true },
  { section: 'Depreciation', name: 'cost', label: 'Cost', type: 'money', required: true, min: 0 },
  {
    section: 'Depreciation',
    name: 'salvageValue',
    label: 'Salvage value',
    type: 'money',
    min: 0,
    hint: 'What it will still be worth at the end of its life. Depreciation stops here.',
  },
  {
    section: 'Depreciation',
    name: 'method',
    label: 'Method',
    type: 'select',
    required: true,
    options: choices('Straight Line', 'Declining Balance'),
  },
  {
    section: 'Depreciation',
    name: 'usefulLifeYears',
    label: 'Useful life (years)',
    type: 'number',
    required: true,
    min: 1,
    max: 60,
    hint: 'The monthly charge and net book value follow from cost, salvage and this.',
  },
  { section: 'Depreciation', name: 'disposedOn', label: 'Disposed on', type: 'date' },
  {
    section: 'Depreciation',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('In Service', 'Fully Depreciated', 'Disposed', 'Impaired'),
  },
]

export const fixedAssetDefaults = {
  method: 'Straight Line',
  usefulLifeYears: 5,
  status: 'In Service',
  cost: 0,
  salvageValue: 0,
  acquired: today(),
}

/* -------------------------------------------------------------------------- */

export const taxFilingFields: FormField[] = [
  { name: 'form', label: 'Form', required: true, placeholder: '2550M' },
  { name: 'description', label: 'Description', required: true, placeholder: 'Monthly VAT declaration' },
  { name: 'period', label: 'Period', required: true, placeholder: 'July 2026' },
  { name: 'dueDate', label: 'Due date', type: 'date', required: true },
  { name: 'taxBase', label: 'Tax base', type: 'money', min: 0 },
  { name: 'taxDue', label: 'Tax due', type: 'money', min: 0 },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Not Started', 'In Preparation', 'For Review', 'Paid'),
    hint: 'Overdue is worked out from the due date; Filed is reached by filing the return.',
  },
]

export const taxFilingDefaults = { status: 'Not Started', taxBase: 0, taxDue: 0 }

/* -------------------------------------------------------------------------- */

export const budgetFields: FormField[] = [
  { name: 'year', label: 'Year', type: 'number', required: true, min: 2000, max: 2100 },
  { name: 'departmentId', label: 'Department', type: 'select', required: true, optionsFrom: DEPARTMENTS },
  { name: 'accountId', label: 'Account', type: 'select', required: true, optionsFrom: ACCOUNTS, full: true },
  { name: 'annualBudget', label: 'Annual budget', type: 'money', required: true, min: 0 },
  {
    name: 'committed',
    label: 'Committed',
    type: 'money',
    min: 0,
    hint: 'Ordered but not yet invoiced. Actual spend is read from the ledger, not entered.',
  },
]

export const budgetDefaults = { year: new Date().getFullYear(), annualBudget: 0, committed: 0 }
