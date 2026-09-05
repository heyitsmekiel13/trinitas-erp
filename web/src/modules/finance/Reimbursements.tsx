import * as React from 'react'
import { Banknote, Check, Coins, Receipt, XCircle } from 'lucide-react'
import { queryClient } from '@/lib/api'
import {
  approveReimbursement,
  liveApi,
  markReimbursementPaid,
  rejectReimbursement,
  type ReimbursementClaimRecord,
} from '@/lib/adminApi'
import { moneyCompact, num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * Reimbursement Claims.
 *
 * Paying an employee back for their own money — a mileage trip in a
 * personally-owned vehicle, a client lunch, a Grab fare — which is a
 * different document from Expenses & Petty Cash next door: that page settles
 * money already advanced under a fund type, this page starts from nothing
 * and ends in a payment. A mileage claim usually arrives already filled in,
 * raised from the trip that earned it (Maintenance → Fuel & Consumption);
 * everything else is entered here directly.
 */

const refresh = () => queryClient.invalidateQueries({ queryKey: ['resource', 'finance/reimbursements'] })

function DecideClaim({ row, done }: { row: ReimbursementClaimRecord; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [action, setAction] = React.useState<'reject' | 'markPaid' | null>(null)
  const [note, setNote] = React.useState('')
  const [paymentReference, setPaymentReference] = React.useState('')

  if (!liveApi()) return null

  const approve = async () => {
    setBusy(true)
    try {
      const result = await approveReimbursement(row.id)
      toast({ tone: 'success', title: `${result.claimNo} approved`, description: 'It can now be marked paid.' })
      refresh()
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not approve', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const confirmReject = async () => {
    if (!note.trim()) return toast({ tone: 'error', title: 'Say why', description: 'A rejection needs a reason.' })
    setBusy(true)
    try {
      const result = await rejectReimbursement(row.id, note.trim())
      toast({ tone: 'success', title: `${result.claimNo} rejected` })
      refresh()
      setAction(null)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not reject', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const confirmPaid = async () => {
    setBusy(true)
    try {
      const result = await markReimbursementPaid(row.id, paymentReference.trim() || undefined)
      toast({ tone: 'success', title: `${result.claimNo} marked paid` })
      refresh()
      setAction(null)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not mark it paid', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {row.status === 'Submitted' && (
        <>
          <Button variant="danger" size="sm" onClick={() => setAction('reject')}>
            <XCircle className="size-3.5" />
            Reject
          </Button>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void approve()}>
            <Check className="size-3.5" />
            Approve
          </Button>
        </>
      )}

      {row.status === 'Approved' && (
        <Button variant="secondary" size="sm" onClick={() => setAction('markPaid')}>
          <Banknote className="size-3.5" />
          Mark paid
        </Button>
      )}

      {action === 'reject' && (
        <Modal
          open
          onClose={() => setAction(null)}
          title={`Reject ${row.claimNo}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void confirmReject()}>
                Reject claim
              </Button>
            </>
          }
        >
          <Field label="Reason" required hint="Shown to the person who filed the claim.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" autoFocus />
          </Field>
        </Modal>
      )}

      {action === 'markPaid' && (
        <Modal
          open
          onClose={() => setAction(null)}
          title={`Mark ${row.claimNo} paid`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAction(null)} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void confirmPaid()}>
                Confirm paid
              </Button>
            </>
          }
        >
          <Field label="Payment reference" hint="Cheque no., transfer reference — whatever proves it went out.">
            <Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} autoFocus />
          </Field>
        </Modal>
      )}
    </>
  )
}

export function Reimbursements() {
  const c = cols<ReimbursementClaimRecord>()

  return (
    <ResourcePage
      title="Reimbursement Claims"
      description="An employee's own money, paid back — mileage, travel, meals, anything spent out of pocket on the company's business."
      endpoint="finance/reimbursements"
      loader={() => []}
      exportName="reimbursement-claims"
      createLabel="New claim"
      formFields={forms.reimbursementFields}
      formDefaults={forms.reimbursementDefaults}
      formTitle="claim"
      detailActions={(row, done) => <DecideClaim row={row} done={done} />}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'category', label: 'Category' },
      ]}
      detailTitle={(row) => row.claimNo}
      detailSubtitle={(row) => `${row.employee ?? '—'} · ${row.category}`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Claims" value={num(rows.length)} icon={Receipt} />
          <StatTile
            label="Awaiting a decision"
            value={moneyCompact(rows.filter((r) => r.status === 'Submitted').reduce((s, r) => s + r.amount, 0))}
            icon={Coins}
            hint={`${rows.filter((r) => r.status === 'Submitted').length} claims`}
          />
          <StatTile
            label="Approved, unpaid"
            value={moneyCompact(rows.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.amount, 0))}
            icon={Banknote}
          />
          <StatTile
            label="Paid"
            value={moneyCompact(rows.filter((r) => r.status === 'Paid').reduce((s, r) => s + r.amount, 0))}
            icon={Check}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('claimNo', 'Claim', (row) => row.employee ?? '—'),
        c.tag('category', 'Category', 'info'),
        c.date('claimDate', 'Date'),
        c.money('amount', 'Amount', { bold: true }),
        c.text('fuelRequestReference', 'Trip', { secondary: true }),
        c.status(),
      ]}
    />
  )
}
