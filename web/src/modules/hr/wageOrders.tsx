import * as React from 'react'
import { AlertTriangle, Banknote, CheckCircle2, Plus, Zap } from 'lucide-react'
import { num } from '@/lib/format'
import {
  applyWageOrder, createWageOrder, getBranchUnits, getWageOrders, liveApi, previewWageOrder,
  type BranchOption, type WageOrderApplyResult, type WageOrderPreview, type WageOrderRow,
} from '@/lib/adminApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * A DOLE wage order, entered once, propagated automatically.
 *
 * The rate itself is not something this system can know on its own — DOLE
 * issues it, a person reads the bulletin and types the number in here, same
 * as any real payroll office. What was missing before this screen existed
 * was everything after that: matching the order to the right branches and
 * raising every minimum-wage earner below it, which used to mean opening the
 * masterfile and editing salaries one at a time, hoping nobody was missed.
 */

/* -------------------------------------------------------------------------- */
/* New wage order                                                             */
/* -------------------------------------------------------------------------- */

function NewWageOrderDialog({
  open,
  onClose,
  branches,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  branches: BranchOption[]
  onCreated: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [label, setLabel] = React.useState('')
  const [orderNo, setOrderNo] = React.useState('')
  const [regionLabel, setRegionLabel] = React.useState('')
  const [dailyRate, setDailyRate] = React.useState('')
  const [effectiveDate, setEffectiveDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [branchIds, setBranchIds] = React.useState<number[]>([])

  React.useEffect(() => {
    if (!open) return
    setLabel('')
    setOrderNo('')
    setRegionLabel('')
    setDailyRate('')
    setEffectiveDate(new Date().toISOString().slice(0, 10))
    setNotes('')
    setBranchIds([])
  }, [open])

  const toggleBranch = (id: number) => {
    setBranchIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  const canSubmit = label.trim() && regionLabel.trim() && Number(dailyRate) > 0 && effectiveDate && branchIds.length > 0

  const submit = async () => {
    setBusy(true)
    try {
      await createWageOrder({
        label: label.trim(),
        orderNo: orderNo.trim() || undefined,
        regionLabel: regionLabel.trim(),
        dailyRate: Number(dailyRate),
        effectiveDate,
        notes: notes.trim() || undefined,
        branchIds,
      })
      toast({ tone: 'success', title: 'Wage order created', description: 'Apply it to raise affected employees to the new rate.' })
      onCreated()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create the wage order.', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="New wage order"
      description="One rate, entered once — applying it raises every affected minimum-wage earner automatically."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>Create</Button>
        </>
      }
    >
      <div className="space-y-3 p-1">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Davao City Wage Order RB-XI-25"
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Order no. (optional)</label>
            <input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              placeholder="RB-XI-25"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Region / city</label>
            <input
              value={regionLabel}
              onChange={(e) => setRegionLabel(e.target.value)}
              placeholder="Davao City"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">New daily rate (₱)</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Effective date</label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-[11px] font-medium text-ink-3 uppercase">Applies to branches</label>
            <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-2">
              <input
                type="checkbox"
                checked={branches.length > 0 && branchIds.length === branches.length}
                ref={(el) => {
                  if (el) el.indeterminate = branchIds.length > 0 && branchIds.length < branches.length
                }}
                onChange={() => setBranchIds(branchIds.length === branches.length ? [] : branches.map((b) => b.id))}
              />
              Select all
            </label>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-[12px] text-ink-2">
                <input type="checkbox" checked={branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
          />
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Apply confirmation                                                          */
/* -------------------------------------------------------------------------- */

function ApplyDialog({
  order,
  onClose,
  onApplied,
}: {
  order: WageOrderRow
  onClose: () => void
  onApplied: () => void
}) {
  const toast = useToast()
  const [preview, setPreview] = React.useState<WageOrderPreview | null>(null)
  const [result, setResult] = React.useState<WageOrderApplyResult | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    previewWageOrder(order.id).then(setPreview).catch(() => setPreview(null))
  }, [order.id])

  const apply = async () => {
    setBusy(true)
    try {
      const r = await applyWageOrder(order.id)
      setResult(r)
      toast({ tone: 'success', title: `${r.adjusted} employee(s) adjusted` })
      onApplied()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not apply the wage order.', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Apply ${order.label}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>
          {!result && (
            <Button variant="primary" loading={busy} disabled={!preview || preview.belowRate === 0} onClick={() => void apply()}>
              Apply — raise {preview?.belowRate ?? 0} employee(s)
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 p-1 text-[13px] text-ink-2">
        {result ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-good">
              <CheckCircle2 className="size-4" />
              {result.adjusted} employee(s) raised to ₱{num(order.dailyRate, 2)}/day, {result.alreadyCompliant} already compliant.
            </p>
            {result.employees.map((e) => (
              <p key={e.employeeNo} className="text-[12px] text-ink-3">
                {e.employee} ({e.employeeNo}): ₱{num(e.oldDailyRate, 2)} → ₱{num(e.newDailyRate, 2)}
              </p>
            ))}
          </div>
        ) : !preview ? (
          <p>Loading…</p>
        ) : preview.belowRate === 0 ? (
          <p className="flex items-center gap-1.5 text-good">
            <CheckCircle2 className="size-4" />
            All {preview.affected} minimum-wage earner(s) at these branches already meet or exceed ₱{num(order.dailyRate, 2)}/day.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              {preview.belowRate} of {preview.affected} minimum-wage earner(s) at these branches are below ₱{num(order.dailyRate, 2)}/day and will be raised to it. This cannot be undone from this screen.
            </p>
            {preview.employees.map((e) => (
              <p key={e.employeeNo} className="text-[12px] text-ink-3">
                {e.employee} ({e.employeeNo}): currently ₱{num(e.currentDailyRate, 2)}/day
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

export function WageOrders() {
  const [rows, setRows] = React.useState<WageOrderRow[] | null>(null)
  const [branches, setBranches] = React.useState<BranchOption[]>([])
  const [creating, setCreating] = React.useState(false)
  const [applying, setApplying] = React.useState<WageOrderRow | null>(null)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getWageOrders().then(setRows).catch(() => setRows([]))
    getBranchUnits().then(setBranches).catch(() => setBranches([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const applied = (rows ?? []).filter((r) => r.appliedAt)
  const pending = (rows ?? []).filter((r) => !r.appliedAt)

  return (
    <div>
      <PageHeader
        title="Wage Orders"
        description="DOLE regional wage orders — enter the rate once, apply it to raise every affected minimum-wage earner automatically."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            New wage order
          </Button>
        }
      />

      <StatGrid className="mb-4">
        <StatTile label="Wage orders" value={num(rows?.length ?? 0)} icon={Banknote} />
        <StatTile label="Not yet applied" value={num(pending.length)} icon={AlertTriangle} hint="Waiting on a decision to apply" />
        <StatTile label="Applied" value={num(applied.length)} icon={CheckCircle2} />
      </StatGrid>

      {!liveApi() ? (
        <div className="card p-4 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to use Wage Orders.</div>
      ) : rows === null ? (
        <div className="card p-4 text-[13px] text-ink-3">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-4 text-[13px] text-ink-3">No wage orders yet — create one when DOLE issues a new rate.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Order</th>
                <th className="px-4 py-2.5 font-medium">Region</th>
                <th className="px-4 py-2.5 font-medium">Daily rate</th>
                <th className="px-4 py-2.5 font-medium">Effective</th>
                <th className="px-4 py-2.5 font-medium">Branches</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{row.label}</div>
                    {row.orderNo && <div className="text-[11px] text-ink-3">{row.orderNo}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{row.regionLabel}</td>
                  <td className="px-4 py-2.5 font-medium text-ink">₱{num(row.dailyRate, 2)}</td>
                  <td className="px-4 py-2.5 text-ink-2">{row.effectiveDate ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-2">{row.branches.map((b) => b.name).join(', ')}</td>
                  <td className="px-4 py-2.5">
                    {row.appliedAt ? (
                      <Badge tone="good">Applied — {row.adjustmentsCount} adjusted</Badge>
                    ) : (
                      <Badge tone="warning">Not yet applied</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {!row.appliedAt && (
                      <Button size="sm" variant="secondary" onClick={() => setApplying(row)}>
                        <Zap className="size-3.5" />
                        Apply
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewWageOrderDialog open={creating} onClose={() => setCreating(false)} branches={branches} onCreated={load} />

      {applying && (
        <ApplyDialog order={applying} onClose={() => setApplying(null)} onApplied={load} />
      )}
    </div>
  )
}
