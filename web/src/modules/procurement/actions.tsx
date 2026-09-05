import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Calculator, FileCheck2, Gavel, ScanSearch } from 'lucide-react'
import { fetchResource, queryClient, useResource } from '@/lib/api'
import {
  awardBid,
  evaluateSupplier,
  evaluateSuppliers,
  liveApi,
  matchInvoice,
  requisitionToOrder,
  requisitionToRfq,
} from '@/lib/adminApi'
import { money, percent } from '@/lib/format'
import { useToast } from '@/components/ui/feedback'
import { Button, Combobox, Field, type ComboOption } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import type { Requisition, Rfq, SupplierInvoice } from '@/data/transactions'
import type { Supplier } from '@/data/master'

/**
 * The actions that move a procurement document to the next stage.
 *
 * Each one lives in the detail dialog of the document it acts on, so the thing
 * you are looking at is the thing you are advancing. They all invalidate the
 * lists downstream of them — awarding a bid creates a purchase order, and the
 * orders page should show it without a manual refresh.
 */

const refresh = (...endpoints: string[]) =>
  endpoints.forEach((endpoint) => queryClient.invalidateQueries({ queryKey: ['resource', endpoint] }))

/* -------------------------------------------------------------------------- */

/** Opens a competitive tender for an approved requisition. */
export function RequisitionToRfq({ row, done }: { row: Requisition; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (row.status !== 'Approved') return null

  const go = async () => {
    setBusy(true)
    try {
      const rfq = await requisitionToRfq(row.id)
      toast({ tone: 'success', title: `${rfq.no} opened`, description: `Closes ${rfq.closes ?? 'in two weeks'}` })
      refresh('procurement/rfqs', 'procurement/dashboard')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not open a tender', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={go}>
      <Gavel className="size-3.5" />
      Go to tender
    </Button>
  )
}

/**
 * Raises a purchase order straight from a requisition.
 *
 * The route for a repeat buy that does not need tender, so it asks which
 * supplier rather than guessing.
 */
export function RequisitionToOrder({ row, done }: { row: Requisition; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [supplierId, setSupplierId] = React.useState<string | number | null>(null)
  const [busy, setBusy] = React.useState(false)

  const { data: suppliers = [] } = useResource<Supplier[]>('procurement/suppliers', () => [])

  if (row.status !== 'Approved') return null

  const options: ComboOption[] = suppliers
    .filter((s) => s.status !== 'Blacklisted')
    .map((s) => ({ value: Number(s.id), label: s.name, sublabel: s.category }))

  const go = async () => {
    if (!supplierId) return
    setBusy(true)
    try {
      const order = await requisitionToOrder(row.id, Number(supplierId))
      toast({ tone: 'success', title: `${order.no} raised`, description: money(order.total) })
      refresh('procurement/orders', 'procurement/requisitions', 'procurement/dashboard')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not raise an order', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ArrowRightLeft className="size-3.5" />
        Raise order
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Raise a purchase order"
        description={`${row.no} — ${row.title}. Lines carry over at their estimated cost; correct them once the supplier confirms.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} disabled={!supplierId} onClick={go}>
              Raise order
            </Button>
          </>
        }
      >
        <Field label="Supplier" required composite hint="Blacklisted suppliers are excluded.">
          <Combobox
            value={supplierId}
            options={options}
            onChange={setSupplierId}
            allowClear={false}
            placeholder="Choose a supplier…"
          />
        </Field>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Awards the RFQ to one of its bidders.
 *
 * Presented as a comparison rather than a dropdown: price, lead time and
 * technical score side by side, because the cheapest bid is not automatically
 * the right one.
 */
type BidRow = {
  id: number
  rfqId: number
  supplier: string
  amount: number
  leadTimeDays: number
  technicalScore: number
  isAwarded: boolean
}

export function AwardRfq({ row, done }: { row: Rfq; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<number | null>(null)

  // Fetched when the dialog opens, not from the shared list cache. Bids arrive
  // while a tender is open, and telling a buyer there are none because the
  // list was read five minutes ago would be worse than telling them nothing.
  const { data: bids = [], isLoading } = useQuery({
    queryKey: ['rfq-bids-for-award', row.id],
    enabled: open,
    staleTime: 0,
    queryFn: () => fetchResource<BidRow[]>('procurement/rfq-bids'),
  })

  if (row.status === 'Awarded' || row.status === 'Cancelled') return null

  const mine = bids.filter((b) => Number(b.rfqId) === Number(row.id))
  const cheapest = mine.length ? Math.min(...mine.map((b) => b.amount)) : 0

  const award = async (bidId: number) => {
    setBusy(bidId)
    try {
      const order = await awardBid(bidId)
      toast({
        tone: 'success',
        title: `${order.no} raised`,
        description:
          order.roundingDifference !== 0
            ? `${money(order.total)} — ${money(Math.abs(order.roundingDifference))} rounding against the bid`
            : money(order.total),
      })
      refresh('procurement/rfqs', 'procurement/rfq-bids', 'procurement/orders', 'procurement/dashboard')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not award', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Gavel className="size-3.5" />
        Award
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={`Award ${row.no}`}
        description={`Estimated at ${money(row.estimatedValue, { decimals: false })}. Awarding creates a purchase order priced from the winning bid.`}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        {isLoading ? (
          <p className="py-6 text-center text-sm text-ink-3">Loading bids…</p>
        ) : mine.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">
            No bids recorded against this tender yet. Add them under Supplier Bids first.
          </p>
        ) : (
          <div className="space-y-2">
            {mine
              .slice()
              .sort((a, b) => a.amount - b.amount)
              .map((bid) => {
                const saving = row.estimatedValue - bid.amount
                return (
                  <div
                    key={bid.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {bid.supplier}
                        {bid.amount === cheapest && (
                          <span className="ml-2 text-[10px] font-semibold tracking-wide text-good uppercase">
                            lowest
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-3">
                        <span className="tabular">{bid.leadTimeDays} day lead</span>
                        <span className="tabular">Technical {bid.technicalScore}/100</span>
                        <span className="tabular">
                          {saving >= 0 ? 'Saves ' : 'Over by '}
                          {money(Math.abs(saving), { decimals: false })}
                        </span>
                      </p>
                    </div>
                    <span className="tabular text-[15px] font-semibold text-ink">{money(bid.amount)}</span>
                    <Button
                      variant="primary"
                      size="xs"
                      loading={busy === bid.id}
                      onClick={() => award(bid.id)}
                    >
                      Award
                    </Button>
                  </div>
                )
              })}
          </div>
        )}
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Three-way match on demand.
 *
 * Compares the invoice against the order and against what actually arrived,
 * and says which of the three disagrees. It never blocks payment — it makes
 * sure whoever approves it knows.
 */
export function MatchInvoice({ row, done }: { row: SupplierInvoice; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const result = await matchInvoice(row.id)
      toast({
        tone: result.match === 'Matched' ? 'success' : 'warning',
        title: result.match,
        description: result.detail,
      })
      refresh('procurement/supplier-invoices', 'procurement/dashboard')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not match', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={run}>
      <ScanSearch className="size-3.5" />
      Run three-way match
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Re-scores every supplier from the documents.
 *
 * Deliberately a button rather than a background job: an evaluation that runs
 * silently overnight leaves nobody able to say when the numbers last moved, and
 * a buyer reviewing a supplier wants today's figures, not last night's.
 */
export function EvaluateSuppliers() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const run = async () => {
    setBusy(true)
    try {
      const result = await evaluateSuppliers()
      toast({
        tone: 'success',
        title: `${result.scored} supplier${result.scored === 1 ? '' : 's'} scored`,
        description:
          result.noEvidence > 0
            ? `${result.noEvidence} had no deliveries or receipts to score against.`
            : 'Every supplier had evidence to score against.',
      })
      refresh('procurement/supplier-performance', 'procurement/suppliers', 'procurement/dashboard')
      queryClient.invalidateQueries({ queryKey: ['supplier-scorecard'] })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not run the evaluation', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={run}>
      <Calculator className="size-3.5" />
      Run evaluation
    </Button>
  )
}

/** Re-scores the one supplier whose card is open. */
export function EvaluateSupplier({ row, done }: { row: Supplier; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const run = async () => {
    setBusy(true)
    try {
      const card = await evaluateSupplier(row.id)
      toast({
        tone: 'success',
        title: card.score === null ? 'Nothing to score yet' : `Score ${card.score}/100`,
        description:
          card.sample === 0
            ? 'No completed deliveries or receipts in the window.'
            : `From ${card.sample} document${card.sample === 1 ? '' : 's'}.`,
      })
      refresh('procurement/supplier-performance', 'procurement/suppliers')
      queryClient.invalidateQueries({ queryKey: ['supplier-scorecard', Number(row.id)] })
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not re-score', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={run}>
      <Calculator className="size-3.5" />
      Re-score
    </Button>
  )
}

/** Shown on a posted receipt so the buyer can see the order caught up. */
export function ReceiptPosted({ percentReceived }: { percentReceived: number }) {
  return (
    <span className="mr-auto flex items-center gap-1.5 text-[12px] text-ink-3">
      <FileCheck2 className="size-3.5 text-good" />
      Order now {percent(percentReceived)} received
    </span>
  )
}
