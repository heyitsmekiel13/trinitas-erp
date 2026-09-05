import * as React from 'react'
import { CalendarClock, CheckCircle2, Plus, Wrench } from 'lucide-react'
import { queryClient, useResource } from '@/lib/api'
import {
  completeWorkOrder,
  generatePreventive,
  liveApi,
  workOrderFromBreakdown,
} from '@/lib/adminApi'
import { money, num } from '@/lib/format'
import { useToast } from '@/components/ui/feedback'
import { Button, Combobox, Field, Input, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import type { DowntimeEvent, WorkOrder } from '@/data/transactions'

/**
 * Maintenance actions that change something.
 *
 * All three write a document rather than a field. Completing a job issues the
 * parts it used; raising one from a breakdown links the failure to the fix; and
 * the preventive generator turns a plan into somebody's work. An asset's status
 * is never edited directly here — it moves because one of these happened.
 */

const refresh = (...endpoints: string[]) =>
  endpoints.forEach((endpoint) => queryClient.invalidateQueries({ queryKey: ['resource', endpoint] }))

const MAINTENANCE_KEYS = [
  'maintenance/work-orders',
  'maintenance/assets',
  'maintenance/preventive',
  'maintenance/downtime',
  'maintenance/dashboard',
  'maintenance/spare-parts',
]

type Option = { id: number; [key: string]: unknown }

/* -------------------------------------------------------------------------- */

/**
 * Finishes a work order.
 *
 * Asks for the four things only the technician knows — how long it took, what
 * labour cost, what the meter read, and which parts came off the shelf — and
 * lets every consequence follow from that. Parts are priced from the item
 * master, so there is nothing to type and nothing to get wrong.
 */
export function CompleteWorkOrder({ row, done }: { row: WorkOrder; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [labour, setLabour] = React.useState('')
  const [hours, setHours] = React.useState('')
  const [meter, setMeter] = React.useState('')
  const [warehouseId, setWarehouseId] = React.useState<number | null>(null)
  const [parts, setParts] = React.useState<{ itemId: number | null; quantity: number }[]>([])

  const { data: warehouses = [] } = useResource<Option[]>('warehouse/locations', () => [])
  const { data: spares = [] } = useResource<Option[]>('maintenance/spare-parts', () => [])

  const id = Number((row as unknown as { id?: number }).id ?? 0)
  const completed = row.status === 'Completed'

  if (!liveApi() || !id || completed || row.status === 'Cancelled') return null

  const start = () => {
    setLabour(String(row.laborCost ?? 0))
    setHours(String(row.downtimeHours ?? 0))
    setMeter('')
    setWarehouseId(Number((row as unknown as { warehouseId?: number }).warehouseId ?? 0) || null)
    setParts([])
    setOpen(true)
  }

  const usable = parts.filter((p) => p.itemId && p.quantity > 0)
  const partsCost = usable.reduce((sum, p) => {
    const item = spares.find((s) => Number(s.id) === p.itemId)
    return sum + Number(item?.unitCost ?? 0) * p.quantity
  }, 0)

  const submit = async () => {
    setBusy(true)
    try {
      const result = await completeWorkOrder(id, {
        laborCost: Number(labour) || 0,
        downtimeHours: Number(hours) || 0,
        ...(meter !== '' ? { meterReading: Number(meter) } : {}),
        ...(warehouseId ? { warehouseId } : {}),
        parts: usable.map((p) => ({ itemId: p.itemId as number, quantity: p.quantity })),
      })

      toast({
        tone: 'success',
        title: `${result.no} completed`,
        description:
          `${money(result.totalCost)} total` +
          (result.partsIssued > 0 ? ` · ${result.partsIssued} part line${result.partsIssued === 1 ? '' : 's'} issued` : '') +
          (result.assetStatus ? ` · ${result.asset} now ${result.assetStatus}` : ''),
      })
      refresh(...MAINTENANCE_KEYS, 'warehouse/stock', 'warehouse/movements')
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not complete', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={start}>
        <CheckCircle2 className="size-3.5" />
        Complete
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={`Complete ${row.no}`}
        description={`${row.asset} — ${row.summary ?? row.assetName}. Parts are costed from the item master and issued from stock.`}
        footer={
          <>
            <span className="mr-auto text-[13px] text-ink-2">
              Total{' '}
              <strong className="tabular text-ink">{money((Number(labour) || 0) + partsCost)}</strong>
            </span>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={submit}>
              Complete job
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Downtime (hours)">
              <Input type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} autoFocus />
            </Field>
            <Field label="Labour cost">
              <Input type="number" min={0} step="0.01" value={labour} onChange={(e) => setLabour(e.target.value)} />
            </Field>
            <Field label="Meter at service" hint="Optional">
              <Input type="number" min={0} value={meter} onChange={(e) => setMeter(e.target.value)} />
            </Field>
          </div>

          <Field
            label="Parts drawn from"
            hint="Where the spare parts come off. Required once there is a part on the job."
            required={usable.length > 0}
          >
            <Select
              value={String(warehouseId ?? '')}
              onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Choose…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {String(w.name ?? '')}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <header className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
              <h3 className="text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
                Spare parts used {usable.length > 0 && <span className="text-ink-3">· {usable.length}</span>}
              </h3>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => setParts((p) => [...p, { itemId: null, quantity: 1 }])}
              >
                <Plus className="size-3" />
                Add part
              </Button>
            </header>

            {parts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-5 text-center text-xs text-ink-3">
                No parts used — labour only.
              </p>
            ) : (
              <div className="space-y-2">
                {parts.map((part, index) => {
                  const item = spares.find((s) => Number(s.id) === part.itemId)
                  const cost = Number(item?.unitCost ?? 0)
                  const available = Number(item?.available ?? 0)

                  return (
                    <div key={index} className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <div className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
                        <Combobox
                          value={part.itemId}
                          allowClear={false}
                          placeholder="Choose a part…"
                          options={spares.map((s) => ({
                            value: Number(s.id),
                            label: String(s.name ?? ''),
                            sublabel: `${String(s.sku ?? '')} · ${num(Number(s.available ?? 0))} available`,
                          }))}
                          onChange={(itemId) =>
                            setParts((p) =>
                              p.map((l, i) => (i === index ? { ...l, itemId: itemId === null ? null : Number(itemId) } : l)),
                            )
                          }
                        />
                        <label className="block">
                          <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Qty</span>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            className="h-8 text-[13px]"
                            value={String(part.quantity)}
                            onChange={(e) =>
                              setParts((p) =>
                                p.map((l, i) => (i === index ? { ...l, quantity: Number(e.target.value) } : l)),
                              )
                            }
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setParts((p) => p.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </div>

                      {part.itemId != null && (
                        <p className="mt-1.5 text-[11px] text-ink-3">
                          {money(cost)} each · {money(cost * part.quantity)} for this line
                          {part.quantity > available && (
                            <span className="text-critical"> · only {num(available)} available</span>
                          )}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Turns preventive schedules that have fallen due into work orders.
 *
 * A plan nobody converts into a job is a spreadsheet. Running this is what puts
 * the PM programme in front of a technician — and it will not raise a second
 * job for a schedule that already has one open.
 */
export function GeneratePreventive() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const run = async () => {
    setBusy(true)
    try {
      const result = await generatePreventive()

      toast({
        tone: result.created > 0 ? 'success' : 'info',
        title: result.created > 0 ? `${result.created} work order${result.created === 1 ? '' : 's'} raised` : 'Nothing due',
        description:
          result.created > 0
            ? result.workOrders.map((w) => `${w.no} · ${w.asset} — ${w.task}`).join('\n')
            : 'No schedule has fallen due, or the ones that have already have a job open.',
      })
      refresh(...MAINTENANCE_KEYS)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not generate', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={run}>
      <CalendarClock className="size-3.5" />
      Raise due jobs
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Raises a corrective job against a logged breakdown.
 *
 * Priority defaults from the impact that was recorded — a stopped line or a
 * cold chain at risk is not a medium job — and the asset goes to Under
 * Maintenance, because it now is.
 */
export function RaiseFromBreakdown({ row, done }: { row: DowntimeEvent; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [technicianId, setTechnicianId] = React.useState<number | null>(null)
  const [priority, setPriority] = React.useState('')

  const { data: technicians = [] } = useResource<Option[]>('maintenance/technicians', () => [])

  const id = Number((row as unknown as { id?: number }).id ?? 0)
  const existing = (row as unknown as { workOrder?: string }).workOrder

  if (!liveApi() || !id || existing) return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await workOrderFromBreakdown(id, {
        ...(technicianId ? { technicianId } : {}),
        ...(priority ? { priority } : {}),
      })

      toast({
        tone: 'success',
        title: `${result.no} raised`,
        description: `${result.priority} priority on ${result.asset}${result.technician ? ` · assigned to ${result.technician}` : ' · unassigned'}.`,
      })
      refresh(...MAINTENANCE_KEYS)
      setOpen(false)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not raise a job', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Wrench className="size-3.5" />
        Raise work order
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Raise a work order"
        description={`${row.asset} — ${row.cause}. The asset moves to Under Maintenance.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={submit}>
              Raise work order
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Technician" hint="Leave unassigned and the job sits in the queue as Open.">
            <Select
              value={String(technicianId ?? '')}
              onChange={(e) => setTechnicianId(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Unassigned</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {String(t.name ?? '')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" hint={`Defaults from the recorded impact — ${row.impact}.`}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">From impact</option>
              {['Critical', 'High', 'Medium', 'Low'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </>
  )
}
