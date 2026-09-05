import * as React from 'react'
import { ClipboardCheck, Layers, MapPin, Scale } from 'lucide-react'
import { queryClient } from '@/lib/api'
import { adjustStock, buildWave, liveApi, replenishmentRequisition, suggestBin, type ReplenishmentRow } from '@/lib/adminApi'
import { fmtDate, money, num } from '@/lib/format'
import { useToast } from '@/components/ui/feedback'
import { Button, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import type { OutboundDoc, StockRow } from '@/data/transactions'

/**
 * Warehouse actions that change something.
 *
 * Both go through documents rather than writing a balance directly — an
 * adjustment with nothing behind it is exactly what makes a stock figure
 * untrustworthy, and a reorder with no requisition skips the approval that
 * Procurement exists to apply.
 */

const refresh = (...endpoints: string[]) =>
  endpoints.forEach((endpoint) => queryClient.invalidateQueries({ queryKey: ['resource', endpoint] }))

/* -------------------------------------------------------------------------- */

/**
 * Corrects one stock line to a counted figure.
 *
 * Asks what was counted, not what the difference was — that is what the person
 * holding the clipboard actually knows. The correction is recorded as a
 * single-item cycle count so it carries who, when and why.
 */
export function AdjustStock({ row, done }: { row: StockRow; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [counted, setCounted] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const itemId = Number((row as unknown as { itemId?: number }).itemId ?? 0)
  const warehouseId = Number((row as unknown as { warehouseId?: number }).warehouseId ?? 0)

  if (!liveApi() || !itemId || !warehouseId) return null

  const open_ = () => {
    setCounted(String(row.onHand))
    setReason('')
    setOpen(true)
  }

  const submit = async () => {
    const quantity = Number(counted)
    if (!Number.isFinite(quantity) || quantity < 0) return

    setBusy(true)
    try {
      const result = await adjustStock({ itemId, warehouseId, countedQuantity: quantity, reason: reason || undefined })
      toast({
        tone: 'success',
        title: `${result.no} posted`,
        description:
          result.variances === 0
            ? 'The count matched — nothing to correct.'
            : `Stock corrected. Value variance ${money(result.valueVariance)}.`,
      })
      refresh('warehouse/stock', 'warehouse/cycle-counts', 'warehouse/movements', 'warehouse/dashboard')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not adjust', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const delta = Number(counted) - row.onHand

  return (
    <>
      <Button variant="secondary" size="sm" onClick={open_}>
        <Scale className="size-3.5" />
        Adjust
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Adjust stock"
        description={`${row.sku} at ${row.warehouse}. The system shows ${num(row.onHand)} on hand — enter what was actually counted.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={submit}>
              Post adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Counted quantity" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              autoFocus
            />
          </Field>

          {Number.isFinite(delta) && delta !== 0 && (
            <p className="rounded-lg bg-surface-2 p-2.5 text-[13px] text-ink-2">
              That is{' '}
              <strong className={delta > 0 ? 'text-good' : 'text-critical'}>
                {delta > 0 ? '+' : ''}
                {num(delta)}
              </strong>{' '}
              against the system figure.
            </p>
          )}

          <Field label="Reason" hint="Recorded on the count so the correction can be explained later.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two cases crushed in aisle" />
          </Field>
        </div>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Turns the replenishment list into a purchase requisition.
 *
 * Raises a requisition rather than an order, because deciding *what* to buy is
 * the warehouse's job and deciding *who from* and *whether* is Procurement's.
 */
export function RaiseRequisition({ rows }: { rows: ReplenishmentRow[] }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [chosen, setChosen] = React.useState<Record<number, string>>({})

  if (!liveApi()) return null

  // Default to everything that needs attention, at the suggested quantity.
  const start = () => {
    setChosen(Object.fromEntries(rows.map((r) => [r.itemId, String(r.suggestedQty)])))
    setOpen(true)
  }

  const lines = Object.entries(chosen)
    .map(([itemId, qty]) => ({ itemId: Number(itemId), quantity: Number(qty) }))
    .filter((l) => l.quantity > 0)

  const submit = async () => {
    setBusy(true)
    try {
      const result = await replenishmentRequisition(lines)
      toast({
        tone: 'success',
        title: `${result.no} raised`,
        description: `${result.lines} line${result.lines === 1 ? '' : 's'} · ${money(result.amount, { decimals: false })} — awaiting approval in Procurement.`,
      })
      refresh('procurement/requisitions', 'warehouse/replenishment', 'procurement/dashboard')
      setOpen(false)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not raise a requisition', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" onClick={start} disabled={rows.length === 0}>
        <ClipboardCheck className="size-3.5" />
        Raise requisition
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Raise a purchase requisition"
        description="Quantities start at the suggested figure. Set one to zero to leave it out."
        footer={
          <>
            <span className="mr-auto text-[13px] text-ink-2">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} disabled={lines.length === 0} onClick={submit}>
              Raise requisition
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.itemId}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{row.name}</p>
                <p className="text-[11px] text-ink-3">
                  {row.sku} · {row.available} available
                  {row.coverDays !== null ? ` · ${row.coverDays} days cover` : ' · no demand recorded'}
                  {row.supplier ? ` · ${row.supplier}` : ''}
                </p>
              </div>
              <label className="shrink-0">
                <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Quantity</span>
                <Input
                  type="number"
                  min={0}
                  className="h-8 w-24 text-[13px]"
                  value={chosen[row.itemId] ?? ''}
                  onChange={(e) => setChosen((c) => ({ ...c, [row.itemId]: e.target.value }))}
                />
              </label>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Groups pending pick lists into one real, released batch.
 *
 * Replaces typing "AM-1" into a text field with actually selecting which
 * lists ship together — the free-text `wave` field stays on the row for
 * display, but a shared `waveId` is what the two lists genuinely have in
 * common now. Only lists still `Released` and not already on a wave show up
 * here, so building a wave can never quietly re-batch work already picking.
 */
export function BuildWave({ rows }: { rows: OutboundDoc[] }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [chosen, setChosen] = React.useState<Record<string, boolean>>({})
  const [zone, setZone] = React.useState('')

  if (!liveApi()) return null

  const eligible = rows.filter((r) => r.status === 'Released' && !r.waveId)
  const warehouseIds = new Set(eligible.map((r) => r.warehouseId).filter((id): id is number => id != null))

  const start = () => {
    setChosen({})
    setZone('')
    setOpen(true)
  }

  const selected = eligible.filter((r) => chosen[r.id])
  // A wave is one warehouse's batch — mixing sites would ship together from
  // two different buildings, which is not a wave, it is a coincidence.
  const warehouseId = selected[0]?.warehouseId ?? null
  const mixedWarehouses = new Set(selected.map((r) => r.warehouseId)).size > 1

  const submit = async () => {
    if (!warehouseId || selected.length === 0) return

    setBusy(true)
    try {
      const result = await buildWave({
        warehouseId,
        pickListIds: selected.map((r) => Number(r.id)),
        zone: zone || undefined,
      })
      toast({
        tone: 'success',
        title: `${result.waveNo} released`,
        description: `${result.pickListCount} pick list(s) grouped and released together.`,
      })
      refresh('warehouse/outbound')
      setOpen(false)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not build the wave', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={start} disabled={eligible.length === 0}>
        <Layers className="size-3.5" />
        Build a wave
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Build a wave"
        description="Select released pick lists from one warehouse to group and release together."
        footer={
          <>
            <span className="mr-auto text-[13px] text-ink-2">
              {selected.length} list{selected.length === 1 ? '' : 's'} selected
            </span>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={selected.length === 0 || mixedWarehouses}
              onClick={submit}
            >
              Build &amp; release
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {mixedWarehouses && (
            <p className="rounded-lg bg-critical/10 p-2.5 text-[13px] text-critical">
              A wave is one warehouse's batch — the selected lists span {warehouseIds.size} warehouses.
            </p>
          )}

          <Field label="Zone" hint="Optional — narrows the wave to one picking zone.">
            <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. A" />
          </Field>

          <div className="space-y-2">
            {eligible.length === 0 && (
              <p className="text-[13px] text-ink-3">Nothing released is waiting to be grouped right now.</p>
            )}
            {eligible.map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-2 p-2.5"
              >
                <input
                  type="checkbox"
                  className="size-4"
                  checked={Boolean(chosen[row.id])}
                  onChange={(e) => setChosen((c) => ({ ...c, [row.id]: e.target.checked }))}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {row.no} · {row.customer}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {row.warehouse} · {row.lines} line{row.lines === 1 ? '' : 's'}
                    {row.cutoff ? ` · cut-off ${fmtDate(row.cutoff)}` : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Where to put this item away, on request.
 *
 * A suggestion shown on the stock line an item already sits on — the closest
 * real trigger point this schema has to "putaway time" without inventing a
 * bin-picker UI the receiving flow's own location grid does not use. Never
 * blocks anything: no bin tagged for the class, or no room left, just means
 * there is nothing to suggest.
 */
export function SuggestBinAction({ row }: { row: StockRow }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  const itemId = Number((row as unknown as { itemId?: number }).itemId ?? 0)
  const warehouseId = Number((row as unknown as { warehouseId?: number }).warehouseId ?? 0)

  if (!liveApi() || !itemId || !warehouseId) return null

  const check = async () => {
    setBusy(true)
    try {
      const suggestion = await suggestBin(itemId, warehouseId)
      if (!suggestion) {
        toast({
          tone: 'info',
          title: 'No bin to suggest',
          description: 'No active bin is tagged for this item\u2019s class with room left — place it by hand.',
        })
        return
      }
      toast({
        tone: 'success',
        title: `Try bin ${suggestion.code}`,
        description: `${suggestion.reason}${suggestion.zone ? ` · zone ${suggestion.zone}` : ''} · ${num(suggestion.capacity - suggestion.occupied)} of ${num(suggestion.capacity)} free.`,
      })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not suggest a bin', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={check}>
      <MapPin className="size-3.5" />
      Suggest a bin
    </Button>
  )
}
