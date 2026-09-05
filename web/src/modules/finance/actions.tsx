import * as React from 'react'
import { BookCheck, Check, CircleDollarSign, Landmark, RotateCcw, Undo2 } from 'lucide-react'
import { queryClient, useResource } from '@/lib/api'
import {
  approveExpense,
  fileTaxReturn,
  liveApi,
  payBills,
  postBill,
  postInvoice,
  postJournal,
  receivePayment,
  reconcileTransaction,
  refreshBudgets,
  reverseJournal,
  runDepreciation,
} from '@/lib/adminApi'
import { fmtDate, money, num } from '@/lib/format'
import { useToast } from '@/components/ui/feedback'
import { Button, Field, Input, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'

/**
 * Finance actions that change the books.
 *
 * Each one ends in a journal entry, and none of them lets a figure be typed
 * that the ledger should be deriving. Posting is deliberately a separate step
 * from saving: a draft is somebody's working, and only a balanced entry becomes
 * part of the record.
 */

const refresh = (...endpoints: string[]) =>
  endpoints.forEach((endpoint) => queryClient.invalidateQueries({ queryKey: ['resource', endpoint] }))

const FINANCE_KEYS = [
  'finance/dashboard',
  'finance/statements',
  'finance/accounts',
  'finance/journals',
  'finance/trial-balance',
]

type Row = Record<string, unknown>

const idOf = (row: Row) => Number(row.id ?? 0)

/* -------------------------------------------------------------------------- */

/** Posts a draft journal. The API refuses anything that does not balance. */
export function PostJournal({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi() || row.status !== 'Draft') return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await postJournal(idOf(row))
      toast({
        tone: 'success',
        title: `${result.no} posted`,
        description: `${money(result.debit)} on each side. Account balances updated.`,
      })
      refresh(...FINANCE_KEYS)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not post', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={submit}>
      <BookCheck className="size-3.5" />
      Post to ledger
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Reverses a posted entry.
 *
 * Deliberately not a delete: "we posted this and took it back" is a different
 * fact from "this never happened", and only one of them survives an audit.
 */
export function ReverseJournal({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  if (!liveApi() || row.status !== 'Posted') return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await reverseJournal(idOf(row), reason || undefined)
      toast({
        tone: 'success',
        title: `${result.no} posted`,
        description: `Reverses ${result.reverses} for ${money(result.amount)}. The original stays in the ledger, marked Reversed.`,
      })
      refresh(...FINANCE_KEYS)
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not reverse', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Undo2 className="size-3.5" />
        Reverse
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`Reverse ${String(row.no ?? '')}`}
        description="A new entry with the sides swapped is posted against it. Neither entry is deleted."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={submit}>
              Post reversal
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Recorded on the reversal so the correction can be explained later.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Posted to the wrong account" autoFocus />
        </Field>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/** Posts a draft invoice: receivable, revenue and the VAT owed. */
export function PostInvoice({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi() || row.status !== 'Draft') return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await postInvoice(idOf(row))
      toast({
        tone: 'success',
        title: `${result.no} posted`,
        description: `${money(result.amount)} receivable. Revenue and Output VAT booked.`,
      })
      refresh(...FINANCE_KEYS, 'finance/receivables')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not post', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={submit}>
      <BookCheck className="size-3.5" />
      Post to ledger
    </Button>
  )
}

/** Posts a draft bill: the expense, the VAT you can claim, and what you owe. */
export function PostBill({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi() || row.status !== 'Draft') return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await postBill(idOf(row))
      toast({
        tone: 'success',
        title: `${result.no} posted`,
        description: `${money(result.amount)} payable. Input VAT claimed.`,
      })
      refresh(...FINANCE_KEYS, 'finance/payables')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not post', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={submit}>
      <BookCheck className="size-3.5" />
      Post to ledger
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

type Settlement = {
  id: number
  no: string
  party: string
  balance: number
  due: string | null
  overdue: number
}

/**
 * Records money in or out and applies it across open documents.
 *
 * Allocation is the substance: "₱50,000 received" is bookkeeping, "₱50,000
 * against these three invoices" is what clears the ageing report and tells
 * collections who to stop chasing. The dialog defaults to settling the oldest
 * first, which is how it is actually done.
 */
function SettleDialog({
  direction,
  row,
  done,
}: {
  direction: 'receive' | 'pay'
  row: Row
  done: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [amount, setAmount] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [method, setMethod] = React.useState('Bank Transfer')
  const [bankAccountId, setBankAccountId] = React.useState<number | null>(null)
  const [chosen, setChosen] = React.useState<Record<number, string>>({})

  const receiving = direction === 'receive'
  const endpoint = receiving ? 'finance/receivables' : 'finance/payables'

  const { data: documents = [] } = useResource<Row[]>(endpoint, () => [])
  const { data: banks = [] } = useResource<Row[]>('finance/bank-accounts', () => [])

  const partyKey = receiving ? 'customerId' : 'supplierId'
  const partyId = Number(row[partyKey] ?? 0)
  const partyName = String(row[receiving ? 'customer' : 'supplier'] ?? '')

  // Every other open document for the same party, oldest first — a customer
  // paying an invoice is usually settling more than one.
  const open_: Settlement[] = React.useMemo(
    () =>
      documents
        .filter((d) => Number(d[partyKey] ?? 0) === partyId && Number(d.balance ?? 0) > 0.005)
        .map((d) => ({
          id: Number(d.id),
          no: String(d.no ?? ''),
          party: partyName,
          balance: Number(d.balance ?? 0),
          due: (d.due as string) ?? null,
          overdue: Number(receiving ? (d.daysOverdue ?? 0) : Math.max(0, -Number(d.daysToDue ?? 0))),
        }))
        .sort((a, b) => b.overdue - a.overdue),
    [documents, partyId, partyKey, partyName, receiving],
  )

  if (!liveApi() || !partyId || Number(row.balance ?? 0) <= 0.005) return null

  const start = () => {
    const outstanding = open_.reduce((s, d) => s + d.balance, 0)
    setAmount(String(Number(row.balance ?? 0)))
    setChosen({ [Number(row.id)]: String(Number(row.balance ?? 0)) })
    setReference('')
    setMethod('Bank Transfer')
    setBankAccountId(banks.length ? Number(banks[0].id) : null)
    void outstanding
    setOpen(true)
  }

  const allocations = Object.entries(chosen)
    .map(([id, value]) => ({ id: Number(id), amount: Number(value) }))
    .filter((a) => a.amount > 0)

  const appliedTotal = allocations.reduce((s, a) => s + a.amount, 0)
  const received = Number(amount) || 0
  const unapplied = Math.round((received - appliedTotal) * 100) / 100

  const submit = async () => {
    setBusy(true)
    try {
      const body = {
        bankAccountId: bankAccountId ?? undefined,
        amount: received,
        method,
        reference: reference || undefined,
      }

      const result = receiving
        ? await receivePayment({
            ...body,
            customerId: partyId,
            allocations: allocations.map((a) => ({ invoiceId: a.id, amount: a.amount })),
          })
        : await payBills({
            ...body,
            supplierId: partyId,
            allocations: allocations.map((a) => ({ billId: a.id, amount: a.amount })),
          })

      toast({
        tone: 'success',
        title: `${result.no} recorded`,
        description:
          `${money(result.amount)} across ${result.applied} document${result.applied === 1 ? '' : 's'}` +
          (result.settled > 0 ? ` · ${result.settled} settled in full` : '') +
          (result.unapplied > 0.005 ? ` · ${money(result.unapplied)} left unapplied` : ''),
      })
      refresh(...FINANCE_KEYS, endpoint, 'finance/ar-receipts', 'finance/ap-payments', 'finance/bank-transactions', 'finance/bank-accounts')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: receiving ? 'Could not record receipt' : 'Could not record payment', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={start}>
        <CircleDollarSign className="size-3.5" />
        {receiving ? 'Receive payment' : 'Pay'}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={receiving ? 'Record a customer receipt' : 'Pay a supplier'}
        description={`${partyName}. Apply the money across whichever documents it settles — oldest first by default.`}
        footer={
          <>
            <span className="mr-auto text-[13px] text-ink-2">
              {unapplied === 0 ? (
                'Fully applied'
              ) : unapplied > 0 ? (
                <>
                  <strong className="text-ink">{money(unapplied)}</strong> unapplied
                </>
              ) : (
                <span className="text-critical">Over-applied by {money(Math.abs(unapplied))}</span>
              )}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={received <= 0 || unapplied < -0.005}
              onClick={submit}
            >
              {receiving ? 'Record receipt' : 'Record payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={receiving ? 'Amount received' : 'Amount paid'} required>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {(receiving
                  ? ['Bank Transfer', 'Cash', 'Cheque', 'Online', 'Card']
                  : ['Bank Transfer', 'Cash', 'Cheque', 'Online']
                ).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bank account" hint="Leave blank for cash — no statement line is created.">
              <Select
                value={String(bankAccountId ?? '')}
                onChange={(e) => setBankAccountId(e.target.value === '' ? null : Number(e.target.value))}
              >
                <option value="">Cash on hand</option>
                {banks.map((b) => (
                  <option key={String(b.id)} value={String(b.id)}>
                    {String(b.name ?? '')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="CHK-40021" />
            </Field>
          </div>

          <div>
            <h3 className="mb-2 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
              Apply to {open_.length} open document{open_.length === 1 ? '' : 's'}
            </h3>
            <div className="space-y-2">
              {open_.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{doc.no}</p>
                    <p className="text-[11px] text-ink-3">
                      {money(doc.balance)} outstanding
                      {doc.due ? ` · due ${fmtDate(doc.due)}` : ''}
                      {doc.overdue > 0 ? ` · ${num(doc.overdue)} days late` : ''}
                    </p>
                  </div>
                  <label className="shrink-0">
                    <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Apply</span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-8 w-32 text-right text-[13px]"
                      value={chosen[doc.id] ?? ''}
                      onChange={(e) => setChosen((c) => ({ ...c, [doc.id]: e.target.value }))}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

export const ReceivePayment = ({ row, done }: { row: Row; done: () => void }) => (
  <SettleDialog direction="receive" row={row} done={done} />
)

export const PayBill = ({ row, done }: { row: Row; done: () => void }) => (
  <SettleDialog direction="pay" row={row} done={done} />
)

/* -------------------------------------------------------------------------- */

/** Approves an expense claim, which is what books it. */
export function ApproveExpense({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi() || ['Approved', 'Liquidated', 'Rejected'].includes(String(row.status))) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await approveExpense(idOf(row))
      toast({
        tone: 'success',
        title: `${result.no} approved`,
        description: `${money(result.amount)} charged to ${result.account ?? 'the default account'}${result.journalNo ? ` on ${result.journalNo}` : ''}.`,
      })
      refresh(...FINANCE_KEYS, 'finance/expenses')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not approve', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={submit}>
      <Check className="size-3.5" />
      Approve and post
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/** Charges a month's depreciation across every asset that still owes one. */
export function RunDepreciation() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await runDepreciation()
      toast({
        tone: result.posted ? 'success' : 'info',
        title: result.posted ? `${result.journalNo} posted` : 'Nothing to depreciate',
        description: result.posted
          ? `${money(result.amount)} across ${result.assets} asset${result.assets === 1 ? '' : 's'}.`
          : result.message,
      })
      refresh(...FINANCE_KEYS, 'finance/fixed-assets')
    } catch (e) {
      toast({ tone: 'error', title: 'Could not run depreciation', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={submit}>
      <RotateCcw className="size-3.5" />
      Run depreciation
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/** Marks a return filed and records the confirmation number. */
export function FileReturn({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [confirmation, setConfirmation] = React.useState('')

  if (!liveApi() || ['Filed', 'Paid'].includes(String(row.status))) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await fileTaxReturn(idOf(row), { confirmationNo: confirmation || undefined })
      toast({
        tone: 'success',
        title: `${result.form} filed`,
        description: `${result.period}${result.filedOn ? ` · ${fmtDate(result.filedOn)}` : ''}.`,
      })
      refresh(...FINANCE_KEYS, 'finance/tax-filings')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not file', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Landmark className="size-3.5" />
        Mark filed
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={`File ${String(row.form ?? '')}`}
        description={`${String(row.period ?? '')} — records the filing date and the BIR confirmation.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={submit}>
              Mark filed
            </Button>
          </>
        }
      >
        <Field label="Confirmation number" hint="From the eFPS or eBIRForms acknowledgement.">
          <Input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Ticks a statement line off against the books.
 *
 * Reconciliation is the one check the business cannot argue its way out of: the
 * bank knows what it holds, and a line nobody has matched is either a timing
 * difference or a mistake.
 */
export function Reconcile({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const reconciled = row.status === 'Reconciled'

  const submit = async () => {
    setBusy(true)
    try {
      const result = await reconcileTransaction(idOf(row), !reconciled)
      toast({
        tone: 'success',
        title: result.reconciled ? 'Line reconciled' : 'Reconciliation undone',
        description: `${num(result.unreconciled)} line${result.unreconciled === 1 ? '' : 's'} still to match · balance ${money(result.balance)}.`,
      })
      refresh(...FINANCE_KEYS, 'finance/bank-transactions', 'finance/bank-accounts')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={submit}>
      <Check className="size-3.5" />
      {reconciled ? 'Mark unreconciled' : 'Mark reconciled'}
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/** Re-reads every budget line's actual spend from the ledger. */
export function RefreshBudgets() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await refreshBudgets()
      toast({
        tone: 'success',
        title: 'Actuals refreshed',
        description: `${num(result.lines)} budget line${result.lines === 1 ? '' : 's'} re-read from the ledger.`,
      })
      refresh(...FINANCE_KEYS, 'finance/budgets')
    } catch (e) {
      toast({ tone: 'error', title: 'Could not refresh', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={submit}>
      <RotateCcw className="size-3.5" />
      Refresh actuals
    </Button>
  )
}
