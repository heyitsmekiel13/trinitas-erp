import * as React from 'react'
import {
  AlertTriangle,
  Banknote,
  BookOpen,
  Building2,
  Coins,
  CreditCard,
  Percent,
  Receipt,
  Wallet,
} from 'lucide-react'
import { dataset } from '@/data/dataset'
import { moneyCompact, num } from '@/lib/format'
import type {
  Account,
  ApBill,
  ArInvoice,
  BankAccount,
  BudgetLine,
  Expense,
  FixedAssetRow,
  JournalEntry,
  TaxFiling,
} from '@/data/finance'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { Dashboard } from './dashboard'
import { Statements } from './statements'
import * as actions from './actions'
import * as forms from './forms'
import { Reimbursements } from './Reimbursements'

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

function ChartOfAccounts() {
  const c = cols<Account>()
  return (
    <ResourcePage
      title="Chart of Accounts"
      description="The account tree every transaction in the ERP posts against. A balance is the sum of what has been posted to it — it is never entered."
      endpoint="finance/accounts"
      loader={() => dataset().accounts}
      exportName="chart-of-accounts"
      createLabel="New account"
      formFields={forms.accountFields}
      formDefaults={forms.accountDefaults}
      formTitle="account"
      pageSize={50}
      filters={[
        { columnId: 'type', label: 'Type' },
        { columnId: 'subtype', label: 'Sub-type' },
      ]}
      detailTitle={(row) => `${row.code} — ${row.name}`}
      detailSubtitle={(row) => `${row.type} · ${row.subtype}`}
      columns={[
        c.primary('code', 'Code', (row) => row.name),
        c.tag('type', 'Type', 'info'),
        c.text('subtype', 'Sub-type', { secondary: true }),
        c.text('normal', 'Normal balance', { secondary: true }),
        c.money('balance', 'Balance', { compact: true, bold: true }),
        c.status(),
      ]}
    />
  )
}

function Journals() {
  const c = cols<JournalEntry>()
  return (
    <ResourcePage
      title="Journal Entries"
      description="Every posting to the general ledger. A draft is somebody's working; posting is a separate step, and only a balanced entry gets through it."
      endpoint="finance/journals"
      loader={() => dataset().journals}
      exportName="journal-entries"
      createLabel="New entry"
      formFields={forms.journalFields}
      formLines={forms.journalLines}
      formDefaults={forms.journalDefaults}
      formTitle="journal entry"
      detailActions={(row, done) => (
        <>
          <actions.PostJournal row={row} done={done} />
          <actions.ReverseJournal row={row} done={done} />
        </>
      )}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'source', label: 'Source' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.memo}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Entries" value={num(rows.length)} icon={BookOpen} />
          <StatTile
            label="Drafts"
            value={num(rows.filter((r) => r.status === 'Draft').length)}
            icon={AlertTriangle}
            hint="Not yet part of the ledger"
          />
          <StatTile label="Posted" value={num(rows.filter((r) => r.status === 'Posted').length)} icon={Receipt} />
          <StatTile
            label="Reversed"
            value={num(rows.filter((r) => r.status === 'Reversed').length)}
            icon={Percent}
            hint="Undone by a mirror entry, never deleted"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Entry', (row) => row.memo),
        c.date('date', 'Posting date'),
        c.tag('source', 'Source', 'info'),
        c.money('debit', 'Debit', { bold: true }),
        c.money('credit', 'Credit'),
        c.text('preparedBy', 'Prepared by', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Receivables() {
  const c = cols<ArInvoice>()
  return (
    <ResourcePage
      title="Accounts Receivable"
      description="Customer invoices, with ageing derived from the due date and the receipts against them. Nothing on this screen is typed."
      endpoint="finance/receivables"
      loader={() => dataset().arInvoices}
      exportName="receivables"
      createLabel="New invoice"
      formFields={forms.invoiceFields}
      formDefaults={forms.invoiceDefaults}
      formTitle="invoice"
      detailActions={(row, done) => (
        <>
          <actions.PostInvoice row={row} done={done} />
          <actions.ReceivePayment row={row} done={done} />
        </>
      )}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'bucket', label: 'Ageing' },
        { columnId: 'collector', label: 'Collector' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.customer}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Total outstanding" value={moneyCompact(rows.reduce((s, r) => s + r.balance, 0))} icon={Banknote} />
          <StatTile
            label="Overdue"
            value={moneyCompact(rows.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.balance, 0))}
            icon={AlertTriangle}
            hint={`${rows.filter((r) => r.daysOverdue > 0).length} invoices`}
          />
          <StatTile label="Collected" value={moneyCompact(rows.reduce((s, r) => s + r.paid, 0))} icon={Wallet} />
          <StatTile
            label="Over 90 days"
            value={moneyCompact(rows.filter((r) => r.bucket === '90+').reduce((s, r) => s + r.balance, 0))}
            icon={Receipt}
            hint="Escalate for legal demand"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Invoice', (row) => row.customer),
        c.date('date', 'Invoice date'),
        c.date('due', 'Due', { overdueWhenPast: true }),
        c.money('amount', 'Amount'),
        c.money('paid', 'Paid', { secondary: true }),
        c.money('balance', 'Balance', { bold: true }),
        c.number('daysOverdue', 'Days overdue'),
        c.level('bucket', 'Ageing', {
          Current: 'good',
          '1-30': 'warning',
          '31-60': 'serious',
          '61-90': 'serious',
          '90+': 'critical',
        }),
        c.text('collector', 'Collector', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

/** Rows from `finance/ar-receipts` and `finance/ap-payments`. */
type MoneyRow = {
  id: number
  no: string
  date: string
  amount: number
  unapplied: number
  method: string
  reference: string
  bank: string
  journalNo: string
  status: string
  customer?: string
  supplier?: string
  invoices?: number
  bills?: number
}

function Receipts() {
  const c = cols<MoneyRow>()
  return (
    <ResourcePage
      title="Customer Receipts"
      description="Money in, and which invoices each receipt settled. Raised from an invoice rather than keyed here, so it always carries its allocation."
      endpoint="finance/ar-receipts"
      loader={() => []}
      exportName="customer-receipts"
      pageSize={25}
      filters={[
        { columnId: 'method', label: 'Method' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.customer ?? ''}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile label="Received" value={moneyCompact(rows.reduce((s, r) => s + r.amount, 0))} icon={Banknote} />
          <StatTile label="Receipts" value={num(rows.length)} icon={Receipt} />
          <StatTile
            label="Unapplied"
            value={moneyCompact(rows.reduce((s, r) => s + r.unapplied, 0))}
            icon={AlertTriangle}
            hint="Received but not yet put against an invoice"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Receipt', (row) => row.customer ?? ''),
        c.date('date', 'Date'),
        c.money('amount', 'Amount', { bold: true }),
        c.money('unapplied', 'Unapplied', { secondary: true }),
        c.number('invoices', 'Invoices'),
        c.text('method', 'Method', { secondary: true }),
        c.text('reference', 'Reference', { secondary: true, mono: true }),
        c.text('bank', 'Bank', { secondary: true }),
        c.text('journalNo', 'Journal', { secondary: true, mono: true }),
        c.status(),
      ]}
    />
  )
}

function Payables() {
  const c = cols<ApBill>()
  return (
    <ResourcePage
      title="Accounts Payable"
      description="Supplier bills sequenced so nothing lapses and nothing pays early without reason. Days-to-due is signed: negative means they have been waiting."
      endpoint="finance/payables"
      loader={() => dataset().apBills}
      exportName="payables"
      createLabel="New bill"
      formFields={forms.billFields}
      formDefaults={forms.billDefaults}
      formTitle="bill"
      detailActions={(row, done) => (
        <>
          <actions.PostBill row={row} done={done} />
          <actions.PayBill row={row} done={done} />
        </>
      )}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'bucket', label: 'Ageing' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.supplier}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Total payable" value={moneyCompact(rows.reduce((s, r) => s + r.balance, 0))} icon={CreditCard} />
          <StatTile
            label="Due within 14 days"
            value={moneyCompact(
              rows.filter((r) => r.balance > 0 && r.daysToDue >= 0 && r.daysToDue <= 14).reduce((s, r) => s + r.balance, 0),
            )}
            icon={AlertTriangle}
          />
          <StatTile
            label="Overdue"
            value={moneyCompact(rows.filter((r) => r.status === 'Overdue').reduce((s, r) => s + r.balance, 0))}
            icon={AlertTriangle}
          />
          <StatTile label="Settled" value={moneyCompact(rows.reduce((s, r) => s + r.paid, 0))} icon={Wallet} />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Bill', (row) => row.supplier),
        c.text('poNo', 'PO reference', { secondary: true }),
        c.date('date', 'Bill date'),
        c.date('due', 'Due', { overdueWhenPast: true }),
        c.money('amount', 'Amount'),
        c.money('paid', 'Paid', { secondary: true }),
        c.money('balance', 'Balance', { bold: true }),
        c.number('daysToDue', 'Days to due'),
        c.level('bucket', 'Ageing', {
          Current: 'good',
          '1-30': 'warning',
          '31-60': 'serious',
          '61-90': 'serious',
          '90+': 'critical',
        }),
        c.status(),
      ]}
    />
  )
}

function Payments() {
  const c = cols<MoneyRow>()
  return (
    <ResourcePage
      title="Supplier Payments"
      description="Money out, and which bills each payment settled. One cheque routinely clears several bills, so the allocation is part of the document."
      endpoint="finance/ap-payments"
      loader={() => []}
      exportName="supplier-payments"
      pageSize={25}
      filters={[
        { columnId: 'method', label: 'Method' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.supplier ?? ''}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile label="Paid" value={moneyCompact(rows.reduce((s, r) => s + r.amount, 0))} icon={CreditCard} />
          <StatTile label="Payments" value={num(rows.length)} icon={Receipt} />
          <StatTile
            label="Unapplied"
            value={moneyCompact(rows.reduce((s, r) => s + r.unapplied, 0))}
            icon={AlertTriangle}
            hint="Paid but not yet put against a bill"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Payment', (row) => row.supplier ?? ''),
        c.date('date', 'Date'),
        c.money('amount', 'Amount', { bold: true }),
        c.money('unapplied', 'Unapplied', { secondary: true }),
        c.number('bills', 'Bills'),
        c.text('method', 'Method', { secondary: true }),
        c.text('reference', 'Reference', { secondary: true, mono: true }),
        c.text('bank', 'Bank', { secondary: true }),
        c.text('journalNo', 'Journal', { secondary: true, mono: true }),
        c.status(),
      ]}
    />
  )
}

function Banking() {
  const c = cols<BankAccount>()
  return (
    <ResourcePage
      title="Banking & Cash"
      description="Bank accounts and the reconciliation backlog on each. A balance is the sum of its statement lines — the bank is the authority on it."
      endpoint="finance/bank-accounts"
      loader={() => dataset().bankAccounts}
      exportName="bank-accounts"
      createLabel="Add account"
      formFields={forms.bankAccountFields}
      formDefaults={forms.bankAccountDefaults}
      formTitle="bank account"
      filters={[{ columnId: 'type', label: 'Type' }]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.bank} · ${row.accountNo}`}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile label="Total cash" value={moneyCompact(rows.reduce((s, r) => s + r.balance, 0))} icon={Wallet} />
          <StatTile label="Accounts" value={num(rows.length)} icon={Banknote} />
          <StatTile
            label="Unreconciled lines"
            value={num(rows.reduce((s, r) => s + r.unreconciled, 0))}
            icon={AlertTriangle}
            hint="Statement lines nobody has ticked off"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Account', (row) => row.bank),
        c.text('accountNo', 'Account no.', { mono: true }),
        c.tag('type', 'Type', 'info'),
        c.money('balance', 'Balance', { bold: true }),
        c.number('unreconciled', 'Unreconciled'),
        c.date('lastReconciled', 'Last reconciled'),
        c.status(),
      ]}
    />
  )
}

type StatementRow = {
  id: number
  account: string
  date: string
  description: string
  reference: string
  debit: number
  credit: number
  journalNo: string
  status: string
}

function BankTransactions() {
  const c = cols<StatementRow>()
  return (
    <ResourcePage
      title="Bank Statement Lines"
      description="Every movement through the bank accounts. Receipts and payments create these automatically; the rest come off the statement."
      endpoint="finance/bank-transactions"
      loader={() => []}
      exportName="bank-transactions"
      createLabel="Add line"
      formFields={forms.bankTransactionFields}
      formDefaults={forms.bankTransactionDefaults}
      formTitle="statement line"
      detailActions={(row, done) => <actions.Reconcile row={row} done={done} />}
      pageSize={50}
      filters={[
        { columnId: 'account', label: 'Account' },
        { columnId: 'status', label: 'Reconciliation' },
      ]}
      detailTitle={(row) => row.description || 'Statement line'}
      detailSubtitle={(row) => row.account}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile label="Money in" value={moneyCompact(rows.reduce((s, r) => s + r.debit, 0))} icon={Banknote} />
          <StatTile label="Money out" value={moneyCompact(rows.reduce((s, r) => s + r.credit, 0))} icon={CreditCard} />
          <StatTile
            label="Unreconciled"
            value={num(rows.filter((r) => r.status === 'Unreconciled').length)}
            icon={AlertTriangle}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('date', 'Date', (row) => row.account),
        c.text('account', 'Account'),
        c.text('description', 'Description'),
        c.text('reference', 'Reference', { secondary: true, mono: true }),
        c.money('debit', 'Money in'),
        c.money('credit', 'Money out'),
        c.text('journalNo', 'Journal', { secondary: true, mono: true }),
        c.level('status', 'Reconciliation', { Reconciled: 'good', Unreconciled: 'warning' }),
      ]}
    />
  )
}

function Expenses() {
  const c = cols<Expense>()
  return (
    <ResourcePage
      title="Expenses & Petty Cash"
      description="Employee claims and revolving fund liquidation. Approving a claim is what posts it, and the category decides which account it lands in."
      endpoint="finance/expenses"
      loader={() => dataset().expenses}
      exportName="expenses"
      createLabel="New claim"
      formFields={forms.expenseFields}
      formDefaults={forms.expenseDefaults}
      formTitle="claim"
      detailActions={(row, done) => <actions.ApproveExpense row={row} done={done} />}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'category', label: 'Category' },
        { columnId: 'fundType', label: 'Fund type' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.employee} · ${row.category}`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Claims" value={num(rows.length)} icon={Receipt} />
          <StatTile
            label="Awaiting approval"
            value={moneyCompact(
              rows.filter((r) => ['Submitted', 'For Approval'].includes(r.status)).reduce((s, r) => s + r.amount, 0),
            )}
            icon={AlertTriangle}
            hint={`${rows.filter((r) => ['Submitted', 'For Approval'].includes(r.status)).length} claims`}
          />
          <StatTile
            label="Approved"
            value={moneyCompact(
              rows.filter((r) => ['Approved', 'Liquidated'].includes(r.status)).reduce((s, r) => s + r.amount, 0),
            )}
            icon={Coins}
          />
          <StatTile
            label="Petty cash"
            value={moneyCompact(rows.filter((r) => r.fundType === 'Petty Cash').reduce((s, r) => s + r.amount, 0))}
            icon={Wallet}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('no', 'Claim', (row) => row.employee),
        c.text('department', 'Department', { secondary: true }),
        c.tag('category', 'Category', 'info'),
        c.date('date', 'Date'),
        c.money('amount', 'Amount', { bold: true }),
        c.text('fundType', 'Fund type', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function FixedAssets() {
  const c = cols<FixedAssetRow>()
  return (
    <ResourcePage
      title="Fixed Assets"
      description="Capitalised assets. The monthly charge and net book value follow from cost, salvage and useful life; accumulated depreciation is what the runs have actually posted."
      endpoint="finance/fixed-assets"
      loader={() => dataset().fixedAssets}
      exportName="fixed-assets"
      createLabel="Capitalise asset"
      formFields={forms.fixedAssetFields}
      formDefaults={forms.fixedAssetDefaults}
      formTitle="fixed asset"
      actions={<actions.RunDepreciation />}
      filters={[
        { columnId: 'class', label: 'Class' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => `${row.code} — ${row.name}`}
      detailSubtitle={(row) => row.class}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Acquisition cost" value={moneyCompact(rows.reduce((s, r) => s + r.cost, 0))} icon={Building2} />
          <StatTile
            label="Accumulated depreciation"
            value={moneyCompact(rows.reduce((s, r) => s + r.accumulatedDep, 0))}
            icon={Percent}
          />
          <StatTile label="Net book value" value={moneyCompact(rows.reduce((s, r) => s + r.netBookValue, 0))} icon={BookOpen} />
          <StatTile
            label="Monthly charge"
            value={moneyCompact(rows.filter((r) => r.status === 'In Service').reduce((s, r) => s + r.monthlyDep, 0))}
            icon={Coins}
            hint="What the next depreciation run will post"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('code', 'Asset', (row) => row.name),
        c.text('class', 'Class'),
        c.date('acquired', 'Acquired'),
        c.money('cost', 'Cost', { compact: true }),
        c.money('accumulatedDep', 'Accum. depreciation', { compact: true, secondary: true }),
        c.money('netBookValue', 'Net book value', { compact: true, bold: true }),
        c.text('method', 'Method', { secondary: true }),
        c.number('usefulLifeYears', 'Life', { suffix: ' yrs', secondary: true }),
        c.money('monthlyDep', 'Monthly dep.', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Tax() {
  const c = cols<TaxFiling>()
  return (
    <ResourcePage
      title="Tax Management"
      description="Statutory filing calendar. A return goes overdue on its own — the BIR does not wait for somebody to change a dropdown."
      endpoint="finance/tax-filings"
      loader={() => dataset().taxFilings}
      exportName="tax-filings"
      createLabel="New filing"
      formFields={forms.taxFilingFields}
      formDefaults={forms.taxFilingDefaults}
      formTitle="filing"
      detailActions={(row, done) => <actions.FileReturn row={row} done={done} />}
      filters={[
        { columnId: 'form', label: 'Form' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => `${row.form} — ${row.period}`}
      detailSubtitle={(row) => row.description}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile
            label="Due"
            value={moneyCompact(rows.filter((r) => !['Filed', 'Paid'].includes(r.status)).reduce((s, r) => s + r.taxDue, 0))}
            icon={Percent}
          />
          <StatTile label="Overdue returns" value={num(rows.filter((r) => r.status === 'Overdue').length)} icon={AlertTriangle} />
          <StatTile label="Filed" value={num(rows.filter((r) => ['Filed', 'Paid'].includes(r.status)).length)} icon={Receipt} />
        </StatGrid>
      )}
      columns={[
        c.primary('form', 'Form', (row) => row.description),
        c.text('period', 'Period'),
        c.date('dueDate', 'Due date', { overdueWhenPast: true }),
        c.money('taxBase', 'Tax base', { compact: true, secondary: true }),
        c.money('taxDue', 'Tax due', { bold: true }),
        c.status(),
      ]}
    />
  )
}

function Budgets() {
  const c = cols<BudgetLine>()
  return (
    <ResourcePage
      title="Budgets vs Actuals"
      description="Departmental budgets against actual spend read from the ledger. Without that, budget and actual are two independent guesses printed side by side."
      endpoint="finance/budgets"
      loader={() => dataset().budgets}
      exportName="budgets"
      createLabel="New budget line"
      formFields={forms.budgetFields}
      formDefaults={forms.budgetDefaults}
      formTitle="budget line"
      actions={<actions.RefreshBudgets />}
      pageSize={25}
      filters={[
        { columnId: 'department', label: 'Department' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => `${row.department} — ${row.category}`}
      detailSubtitle={(row) => row.account}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Annual budget" value={moneyCompact(rows.reduce((s, r) => s + r.annualBudget, 0))} icon={BookOpen} />
          <StatTile label="YTD budget" value={moneyCompact(rows.reduce((s, r) => s + r.ytdBudget, 0))} icon={Percent} />
          <StatTile label="YTD actual" value={moneyCompact(rows.reduce((s, r) => s + r.ytdActual, 0))} icon={Coins} />
          <StatTile
            label="Lines over budget"
            value={num(rows.filter((r) => r.status === 'Over Budget').length)}
            icon={AlertTriangle}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('department', 'Department', (row) => row.account),
        c.text('category', 'Category'),
        c.money('annualBudget', 'Annual budget', { compact: true, secondary: true }),
        c.money('ytdBudget', 'YTD budget', { compact: true }),
        c.money('ytdActual', 'YTD actual', { compact: true, bold: true }),
        c.money('committed', 'Committed', { compact: true, secondary: true }),
        c.money('variance', 'Variance', { compact: true }),
        c.percent('variancePct', 'Variance %'),
        c.level('status', 'Status', { 'Under Budget': 'good', 'On Budget': 'info', 'Over Budget': 'critical' }),
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  coa: ChartOfAccounts,
  journals: Journals,
  receivables: Receivables,
  receipts: Receipts,
  payables: Payables,
  payments: Payments,
  banking: Banking,
  'bank-transactions': BankTransactions,
  expenses: Expenses,
  reimbursements: Reimbursements,
  'fixed-assets': FixedAssets,
  tax: Tax,
  budgets: Budgets,
  statements: Statements,
}
