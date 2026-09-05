import * as React from 'react'
import {
  AlertTriangle,
  ClipboardCheck,
  Clock,
  MapPin,
  PackageCheck,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { currentUser } from '@/app/auth'
import { dataset } from '@/data/dataset'
import { useResource } from '@/lib/api'
import { fmtDateTime, fromLocalInput, num, percent, toLocalInput as localStamp } from '@/lib/format'
import {
  CLEAN_CHECK,
  RECEIVING_STATUSES,
  damagedTotal,
  draftDamageNote,
  fmtMinutes,
  processingMinutes,
  receivedTotal,
  suggestedReceivingStatus,
  verdictFor,
  type ReceivingEntry,
  type ReceivingLine,
  type ReceivingStatus,
} from '@/data/warehouse'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Avatar, Badge, Button, Card, Input, Segmented, Select, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { ConditionCheckPanel, VerdictBadge } from './components/ConditionCheck'
import { LocationChips, LocationGrid } from './components/LocationGrid'
import { PeoplePicker } from './components/PeoplePicker'
import { useOps } from './ops'
import { useSeedFloor } from './useFloorData'

/**
 * Inbound receiving.
 *
 * The document is built around the moment it describes: a truck backs onto the
 * dock, somebody starts a clock, several people watch cartons come off, each
 * one is graded, and the whole lot is put somewhere. So the form asks for those
 * things in that order, and computes everything it can — the processing time
 * from the two stamps, the damage note from the graded lines, the status from
 * what was actually accepted.
 *
 * Two details do the heavy lifting. Lines are added by searching the item
 * master rather than typed, so a receipt can never invent a SKU that does not
 * exist. And the people present are recorded by tapping their card, because a
 * damage claim with three names on it is worth something and one with none is
 * worth nothing.
 */

const STATUS_TONE: Record<ReceivingStatus, 'neutral' | 'info' | 'good' | 'warning' | 'critical'> = {
  'Pending Inspection': 'warning',
  Inspecting: 'info',
  Accepted: 'good',
  'Partially Accepted': 'warning',
  Rejected: 'critical',
  'Put Away': 'good',
}

/** `INB-01009` — sequential, so a reference read over the phone is unambiguous. */
function nextReference(existing: ReceivingEntry[]) {
  const highest = existing.reduce((max, entry) => {
    const n = Number(/(\d+)$/.exec(entry.ref)?.[1] ?? 0)
    return Math.max(max, n)
  }, 1000)
  return `INB-${String(highest + 1).padStart(5, '0')}`
}

/** What the line editor needs from an item, live or preview. */
type SearchableItem = {
  sku: string
  name: string
  uom?: string | null
  legacySku?: string | null
  barcode?: string | null
}



/* -------------------------------------------------------------------------- */
/* Line editor                                                                 */
/* -------------------------------------------------------------------------- */

function LineEditor({
  lines,
  onChange,
}: {
  lines: ReceivingLine[]
  onChange: (next: ReceivingLine[]) => void
}) {
  // The real catalogue, so a receipt can never name a SKU that does not exist.
  const { data: items = [] } = useResource<SearchableItem[]>('warehouse/items', () => dataset().items)
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return items
      .filter((item) =>
        [item.sku, item.legacySku, item.name, item.barcode]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q)),
      )
      .slice(0, 6)
  }, [items, query])

  const patch = (id: string, next: Partial<ReceivingLine>) =>
    onChange(lines.map((line) => (line.id === id ? { ...line, ...next } : line)))

  const add = (sku: string) => {
    const item = items.find((i) => i.sku === sku)
    if (!item || lines.some((line) => line.sku === sku)) return
    onChange([
      ...lines,
      {
        id: `nl-${Date.now()}-${lines.length}`,
        sku: item.sku,
        name: item.name,
        uom: item.uom ?? 'pcs',
        qtyExpected: 0,
        qtyReceived: 0,
        qtyDamaged: 0,
        check: { ...CLEAN_CHECK, stage: 'Receiving / unloading' },
      },
    ])
    setQuery('')
  }

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Scan a barcode, or type a SKU, old code or description to add a line…"
          className="h-9 pl-8"
        />
        {matches.length > 0 && (
          <div className="animate-in absolute z-30 mt-1 w-full rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
            {matches.map((item) => {
              const already = lines.some((line) => line.sku === item.sku)
              return (
                <button
                  key={item.sku}
                  type="button"
                  disabled={already}
                  onClick={() => add(item.sku)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-3 disabled:opacity-40"
                >
                  <Plus className="size-3.5 shrink-0 text-brand-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{item.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">
                      {item.sku}
                      {item.legacySku && item.legacySku !== item.sku && (
                        <span className="font-sans"> · was {item.legacySku}</span>
                      )}
                    </span>
                  </span>
                  {already && <span className="shrink-0 text-[11px] text-ink-3">added</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
          <PackagePlus className="mx-auto size-5 text-ink-3" />
          <p className="mt-2 text-[13px] font-medium text-ink">No items added yet</p>
          <p className="mt-0.5 text-[11px] text-ink-3">Search above to confirm what is being received.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => {
            const open = expanded === line.id
            const graded = line.qtyDamaged > 0
            return (
              <div key={line.id} className="rounded-xl border border-line">
                <div className="flex flex-wrap items-end gap-3 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{line.name}</p>
                    <p className="truncate font-mono text-[11px] text-ink-3">{line.sku}</p>
                  </div>

                  <label className="shrink-0">
                    <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Expected</span>
                    <Input
                      type="number"
                      min={0}
                      value={line.qtyExpected || ''}
                      placeholder="0"
                      onChange={(e) => patch(line.id, { qtyExpected: Math.max(0, Number(e.target.value) || 0) })}
                      className="h-8 w-20 text-center text-[13px]"
                    />
                  </label>

                  <label className="shrink-0">
                    <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Received</span>
                    <Input
                      type="number"
                      min={0}
                      value={line.qtyReceived || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const qtyReceived = Math.max(0, Number(e.target.value) || 0)
                        patch(line.id, { qtyReceived, qtyDamaged: Math.min(line.qtyDamaged, qtyReceived) })
                      }}
                      className="h-8 w-20 text-center text-[13px]"
                    />
                  </label>

                  <label className="shrink-0">
                    <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase">Damaged</span>
                    <Input
                      type="number"
                      min={0}
                      max={line.qtyReceived}
                      value={line.qtyDamaged || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const qtyDamaged = Math.min(line.qtyReceived, Math.max(0, Number(e.target.value) || 0))
                        patch(line.id, {
                          qtyDamaged,
                          check: { ...line.check, qty: qtyDamaged },
                        })
                        if (qtyDamaged > 0) setExpanded(line.id)
                      }}
                      className={cn(
                        'h-8 w-20 text-center text-[13px]',
                        line.qtyDamaged > 0 && 'border-critical/50 text-critical',
                      )}
                    />
                  </label>

                  {graded && <VerdictBadge check={line.check} />}

                  <div className="flex shrink-0 gap-1">
                    {graded && (
                      <Button variant="secondary" size="xs" onClick={() => setExpanded(open ? null : line.id)}>
                        {open ? 'Hide check' : 'Grade it'}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${line.sku}`}
                      onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
                    >
                      <Trash2 className="size-3.5 text-critical" />
                    </Button>
                  </div>
                </div>

                {open && graded && (
                  <div className="animate-in border-t border-line p-3">
                    <ConditionCheckPanel
                      value={line.check}
                      maxQty={line.qtyReceived}
                      atStage="Receiving / unloading"
                      onChange={(check) => patch(line.id, { check, qtyDamaged: Math.max(1, check.qty) })}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Entry form                                                                  */
/* -------------------------------------------------------------------------- */

function EntryForm({
  entry,
  onClose,
}: {
  entry: ReceivingEntry | null
  onClose: () => void
}) {
  const ops = useOps()
  const toast = useToast()
  const sites = React.useMemo(() => dataset().sites, [])
  const [draft, setDraft] = React.useState<ReceivingEntry | null>(entry)
  const [noteTouched, setNoteTouched] = React.useState(false)

  React.useEffect(() => {
    setDraft(entry)
    setNoteTouched(Boolean(entry?.notes && entry.notes !== draftDamageNote(entry.lines)))
  }, [entry])

  if (!draft) return null

  const patch = (next: Partial<ReceivingEntry>) => setDraft({ ...draft, ...next })
  const minutes = processingMinutes(draft)
  const suggested = suggestedReceivingStatus(draft)
  const damaged = damagedTotal(draft)

  const save = () => {
    ops.saveReceipt({ ...draft, notes: noteTouched ? draft.notes : draftDamageNote(draft.lines) })
    toast({
      tone: damaged ? 'warning' : 'success',
      title: `${draft.ref} saved`,
      description: damaged
        ? `${num(damaged)} unit${damaged === 1 ? '' : 's'} flagged — the damage note has been drafted for you.`
        : `${num(receivedTotal(draft))} units received clean.`,
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      dirty
      title={entry?.ref && draft.lines.length ? `Receiving entry ${draft.ref}` : 'New receiving entry'}
      description="Everything the dock saw, in the order it happened."
      footer={
        <>
          <span className="mr-auto text-[12px] text-ink-3">
            {num(receivedTotal(draft))} received · {num(damaged)} damaged · {fmtMinutes(minutes)} on the dock
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!draft.supplier.trim()} onClick={save}>
            <PackageCheck className="size-3.5" />
            Save entry
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ------------------------------ Header ------------------------------ */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Reference <span className="font-normal text-ink-3 normal-case">— unique, issued in sequence</span>
            </span>
            <Input value={draft.ref} onChange={(e) => patch({ ref: e.target.value })} className="font-mono" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Supplier</span>
            <Input
              value={draft.supplier}
              onChange={(e) => patch({ supplier: e.target.value })}
              placeholder="Who delivered it"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Receiving warehouse
            </span>
            <Select value={draft.warehouse} onChange={(e) => patch({ warehouse: e.target.value })}>
              {sites.map((site) => (
                <option key={site.code} value={site.name}>
                  {site.name}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Status
              {draft.status !== suggested && (
                <button
                  type="button"
                  onClick={() => patch({ status: suggested })}
                  className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 normal-case dark:bg-brand-950 dark:text-brand-300"
                >
                  lines suggest “{suggested}” — apply
                </button>
              )}
            </span>
            <Select value={draft.status} onChange={(e) => patch({ status: e.target.value as ReceivingStatus })}>
              {RECEIVING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Started on the dock
            </span>
            <Input
              type="datetime-local"
              value={localStamp(draft.startedAt)}
              onChange={(e) => patch({ startedAt: fromLocalInput(e.target.value) ?? draft.startedAt })}
            />
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                Finished
              </span>
              <Input
                type="datetime-local"
                value={localStamp(draft.endedAt)}
                onChange={(e) => patch({ endedAt: fromLocalInput(e.target.value) })}
              />
            </label>
            <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-center">
              <p className="text-[10px] tracking-wide text-ink-3 uppercase">Processing</p>
              <p className="tabular text-[13px] font-semibold text-ink">{fmtMinutes(minutes)}</p>
            </div>
          </div>
        </div>

        {/* ------------------------------- Lines ------------------------------ */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
            <PackagePlus className="size-3.5 text-ink-3" />
            What is being received
          </h3>
          <LineEditor lines={draft.lines} onChange={(lines) => patch({ lines })} />
        </section>

        {/* ------------------------------ Witnesses ---------------------------- */}
        <section className="rounded-xl border border-line bg-surface-2 p-3">
          <PeoplePicker value={draft.witnesses} onChange={(witnesses) => patch({ witnesses })} />
        </section>

        {/* -------------------------------- Notes ------------------------------ */}
        <label className="block">
          <span className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
            Damage / discrepancy notes
            <span className="font-normal text-ink-3 normal-case">— drafted from the graded lines, edit freely</span>
            {noteTouched && (
              <button
                type="button"
                onClick={() => {
                  patch({ notes: draftDamageNote(draft.lines) })
                  setNoteTouched(false)
                }}
                className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-ink-2 normal-case"
              >
                re-draft
              </button>
            )}
          </span>
          <Textarea
            value={noteTouched ? draft.notes : draftDamageNote(draft.lines)}
            onChange={(e) => {
              setNoteTouched(true)
              patch({ notes: e.target.value })
            }}
            placeholder="Nothing to report."
            className="min-h-20 text-[13px]"
          />
        </label>

        {/* ------------------------------ Placement ---------------------------- */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
            <MapPin className="size-3.5 text-brand-500" />
            Storage location
          </h3>
          <p className="mb-2.5 text-[12px] text-ink-3">
            Click grid cells to pinpoint where this shipment is placed. Click multiple cells to select more than one
            placement; click a selected cell again to remove it.
          </p>
          <LocationGrid value={draft.locations} onChange={(locations) => patch({ locations })} />
        </section>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

type View = 'open' | 'closed' | 'all'

export function Receiving() {
  const ops = useOps()
  const receipts = useOps((s) => s.receipts)
  const toast = useToast()

  const [view, setView] = React.useState<View>('open')
  const [query, setQuery] = React.useState('')
  const [editing, setEditing] = React.useState<ReceivingEntry | null>(null)

  useSeedFloor()

  const stats = React.useMemo(() => {
    const received = receipts.reduce((s, e) => s + receivedTotal(e), 0)
    const damaged = receipts.reduce((s, e) => s + damagedTotal(e), 0)
    const timed = receipts.map(processingMinutes).filter((m): m is number => m !== null)
    return {
      received,
      damaged,
      damageRate: received ? (damaged / received) * 100 : null,
      avgMinutes: timed.length ? Math.round(timed.reduce((s, m) => s + m, 0) / timed.length) : null,
      awaiting: receipts.filter((e) => e.status === 'Pending Inspection' || e.status === 'Inspecting').length,
      unwitnessed: receipts.filter((e) => e.witnesses.length === 0).length,
    }
  }, [receipts])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return receipts.filter((entry) => {
      if (q && !`${entry.ref} ${entry.supplier} ${entry.poNo ?? ''} ${entry.warehouse}`.toLowerCase().includes(q)) {
        return false
      }
      const open = entry.status === 'Pending Inspection' || entry.status === 'Inspecting'
      if (view === 'open') return open
      if (view === 'closed') return !open
      return true
    })
  }, [receipts, query, view])

  const startNew = () =>
    setEditing({
      id: `rcv-${Date.now()}`,
      ref: nextReference(receipts),
      supplier: '',
      poNo: null,
      warehouse: dataset().sites[0]?.name ?? '',
      status: 'Pending Inspection',
      startedAt: new Date().toISOString(),
      endedAt: null,
      lines: [],
      witnesses: [],
      notes: '',
      locations: [],
      createdBy: currentUser().name,
    })

  return (
    <div>
      <PageHeader
        title="Inbound & Receiving"
        description="Every delivery that touches the dock, with the clock it took, the people who watched it come off, the condition each line arrived in, and where it was put."
        meta={
          <>
            <Badge tone="neutral">{num(receipts.length)} entries</Badge>
            {stats.unwitnessed > 0 && (
              <Badge tone="warning" dot>
                {stats.unwitnessed} with nobody recorded
              </Badge>
            )}
          </>
        }
        actions={
          <Button variant="primary" size="sm" onClick={startNew}>
            <Plus className="size-3.5" />
            New receiving entry
          </Button>
        }
      />

      <StatGrid className="mb-4">
        <StatTile
          label="Awaiting inspection"
          value={num(stats.awaiting)}
          icon={ClipboardCheck}
          hint={stats.awaiting === 0 ? 'the dock is clear' : 'still open on the dock'}
        />
        <StatTile label="Units received" value={num(stats.received)} icon={PackageCheck} hint="across every entry held" />
        <StatTile
          label="Damage rate"
          value={stats.damageRate == null ? '—' : percent(stats.damageRate)}
          icon={AlertTriangle}
          hint={`${num(stats.damaged)} unit${stats.damaged === 1 ? '' : 's'} graded short of good`}
        />
        <StatTile
          label="Avg time on dock"
          value={fmtMinutes(stats.avgMinutes)}
          icon={Clock}
          hint="start to finish, per delivery"
        />
      </StatGrid>

      <Card className="mb-4 p-3" data-print="hide">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a reference, supplier or PO…"
              className="h-9 pl-8"
            />
          </div>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'open', label: `On the dock (${stats.awaiting})` },
              { value: 'closed', label: 'Closed' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={PackagePlus}
            title="Nothing here"
            description="No receiving entry matches this view."
            action={
              <Button variant="primary" size="sm" onClick={startNew}>
                <Plus className="size-3.5" />
                New receiving entry
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) => {
            const minutes = processingMinutes(entry)
            const damaged = damagedTotal(entry)
            const flagged = entry.lines.filter((l) => verdictFor(l.check.physical, l.check.functional) !== 'Good')

            return (
              <Card key={entry.id} className="p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
                  <button
                    type="button"
                    onClick={() => setEditing(entry)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-ink">{entry.ref}</span>
                      <Badge tone={STATUS_TONE[entry.status]} dot>
                        {entry.status}
                      </Badge>
                      {entry.witnesses.length === 0 && (
                        <Badge tone="warning">
                          <AlertTriangle className="size-3" />
                          nobody recorded
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                      {entry.supplier || 'Supplier not set'}
                      {entry.poNo ? ` · ${entry.poNo}` : ''} · {entry.warehouse} · started {fmtDateTime(entry.startedAt)}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-4 text-[12px]">
                    <span className="text-center">
                      <span className="block text-[10px] tracking-wider text-ink-3 uppercase">Received</span>
                      <span className="tabular block font-semibold text-ink">{num(receivedTotal(entry))}</span>
                    </span>
                    <span className="text-center">
                      <span className="block text-[10px] tracking-wider text-ink-3 uppercase">Damaged</span>
                      <span className={cn('tabular block font-semibold', damaged ? 'text-critical' : 'text-ink-3')}>
                        {damaged ? num(damaged) : '—'}
                      </span>
                    </span>
                    <span className="text-center">
                      <span className="block text-[10px] tracking-wider text-ink-3 uppercase">On dock</span>
                      <span className="tabular block font-semibold text-ink">{fmtMinutes(minutes)}</span>
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {entry.witnesses.slice(0, 3).map((name) => (
                      <Avatar key={name} name={name} size="xs" />
                    ))}
                    {entry.witnesses.length > 3 && (
                      <span className="text-[11px] text-ink-3">+{entry.witnesses.length - 3}</span>
                    )}
                  </div>

                  <LocationChips locations={entry.locations} className="shrink-0" />

                  <div className="flex shrink-0 gap-1.5">
                    <Button variant="secondary" size="xs" onClick={() => setEditing(entry)}>
                      Open
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${entry.ref}`}
                      onClick={() => {
                        ops.removeReceipt(entry.id)
                        toast({ tone: 'info', title: `${entry.ref} removed` })
                      }}
                    >
                      <X className="size-3.5 text-ink-3" />
                    </Button>
                  </div>
                </div>

                {flagged.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                    {flagged.map((line) => (
                      <span key={line.id} className="flex items-center gap-1.5 text-[11px]">
                        <VerdictBadge check={line.check} />
                        <span className="font-mono text-ink-3">{line.sku}</span>
                        <span className="text-ink-2">
                          {line.qtyDamaged} · {line.check.stage} · {line.check.liability}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <EntryForm entry={editing} onClose={() => setEditing(null)} />
    </div>
  )
}
