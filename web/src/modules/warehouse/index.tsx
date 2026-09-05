import * as React from 'react'
import { AlertTriangle, ClipboardCheck, Loader2, Package, Printer, RefreshCw, Repeat } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { invalidateResource } from '@/lib/api'
import { num } from '@/lib/format'
import type {
  CycleCount,
  DockAppointmentRow,
  WarehouseBinRow,
  WarehouseIncidentRow,
  WarehouseSuggestionRow,
  Warehouse5sAuditRow,
  InboundDoc,
  OutboundDoc,
  ReplenishmentRow,
  StockRow,
  Transfer,
} from '@/data/transactions'
import type { Item, WarehouseSite } from '@/data/master'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { ResourcePage, AutoDetail } from '@/components/data/ResourcePage'
import { Dashboard } from './dashboard'
import { CycleCounts } from './counts'
import { DispatchBoard } from './dispatch'
import { Receiving } from './receiving'
import { SkuBuilder } from './components/SkuBuilder'
import { QrLabel } from './components/QrLabel'
import { Code128Barcode, printItemBarcodeLabel, printItemBarcodeSheet } from './components/Code128Barcode'
import { AdjustStock, BuildWave, RaiseRequisition, SuggestBinAction } from './actions'
import { recomputeAbcClasses, type ReplenishmentRow as ReplenishmentApiRow } from '@/lib/adminApi'
import * as forms from './forms'
import { cols } from '@/components/data/columns'
import { Button } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

function Items() {
  const toast = useToast()
  const c = cols<Item>()
  const [recomputing, setRecomputing] = React.useState(false)

  const recompute = async () => {
    setRecomputing(true)
    try {
      const { changed, total } = await recomputeAbcClasses()
      toast({
        tone: 'success',
        title: 'ABC classes recomputed',
        description: `${changed} of ${total} item(s) changed class, based on 90-day issued value.`,
      })
      void invalidateResource('warehouse/items')
    } catch (e) {
      toast({ tone: 'error', title: 'Could not recompute', description: (e as Error).message })
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <ResourcePage
      title="Item Master"
      description="Every SKU the business trades, with costing, packaging and replenishment parameters. Codes read COMPANY-CATEGORY-SEQUENCE — with a brand block when there is a brand — so a code says what it is without a lookup."
      endpoint="warehouse/items"
      loader={() => dataset().items}
      exportName="item-master"
      createLabel="New item"
      formFields={forms.itemFields}
      formDefaults={forms.itemDefaults}
      formExtras={(values) => <SkuBuilder values={values} />}
      formTitle="item"
      filters={[
        { columnId: 'category', label: 'Category' },
        { columnId: 'abc', label: 'ABC class' },
        { columnId: 'status', label: 'Status' },
      ]}
      actions={(rows) => (
        <>
          <Button variant="secondary" size="sm" onClick={() => void recompute()} disabled={recomputing}>
            {recomputing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            <span className="hidden sm:inline">Recompute ABC classes</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            title="Prints one tag per item currently shown — search or filter above to narrow it down first"
            onClick={() => {
              if (rows.length === 0) return
              printItemBarcodeSheet(rows, 'Item barcode tags')
            }}
          >
            <Printer className="size-3.5" />
            <span className="hidden sm:inline">Print barcode tags</span>
          </Button>
        </>
      )}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.sku} · ${row.category}`}
      detailActions={(row) => (
        <Button variant="secondary" size="sm" onClick={() => printItemBarcodeLabel(row)}>
          <Printer className="size-3.5" />
          Print barcode
        </Button>
      )}
      renderDetail={(row) => (
        <div className="space-y-4">
          <Code128Barcode value={row.barcode || row.sku} />
          <AutoDetail row={row} />
        </div>
      )}
      columns={[
        c.primary('name', 'Item', (row) => `${row.sku} · ${row.brand}`),
        c.text('legacySku', 'Old code', { secondary: true, mono: true }),
        c.text('category', 'Category'),
        c.text('uom', 'UoM', { secondary: true }),
        c.text('barcode', 'Barcode', { secondary: true, mono: true }),
        c.money('unitCost', 'Unit cost'),
        c.money('sellPrice', 'Sell price', { bold: true }),
        c.number('onHand', 'On hand'),
        c.number('reorderPoint', 'Reorder point', { secondary: true }),
        c.number('leadTimeDays', 'Lead time', { secondary: true, suffix: 'd' }),
        c.tag('abc', 'ABC', 'neutral'),
        c.date('abcComputedAt', 'ABC since', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Stock() {
  const c = cols<StockRow>()
  return (
    <ResourcePage
      title="Stock on Hand"
      description="Live balances by warehouse, bin, batch and expiry — the single source of truth for availability."
      endpoint="warehouse/stock"
      loader={() => dataset().stock}
      exportName="stock-on-hand"
      detailActions={(row, done) => (
        <>
          <AdjustStock row={row} done={done} />
          <SuggestBinAction row={row} />
        </>
      )}
      pageSize={25}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.sku} · ${row.warehouse} · Bin ${row.bin}`}
      columns={[
        c.primary('name', 'Item', (row) => `${row.sku} · ${row.warehouse}`),
        c.text('bin', 'Bin', { mono: true }),
        c.text('batch', 'Batch', { secondary: true, mono: true }),
        c.date('expiry', 'Expiry', { secondary: true, overdueWhenPast: true }),
        c.number('onHand', 'On hand'),
        c.number('allocated', 'Allocated', { secondary: true }),
        c.number('available', 'Available'),
        c.money('value', 'Stock value', { compact: true, bold: true }),
        c.status(),
      ]}
    />
  )
}

function Inbound() {
  const c = cols<InboundDoc>()
  return (
    <ResourcePage
      title="Expected Arrivals"
      description="Shipments the supplier has announced but the dock has not seen yet. They become receiving entries the moment a truck backs on."
      endpoint="warehouse/inbound"
      loader={() => dataset().inbound}
      exportName="inbound"
      createLabel="Announce shipment"
      formFields={forms.inboundFields}
      formDefaults={forms.inboundDefaults}
      formTitle="inbound shipment"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'warehouse', label: 'Warehouse' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.supplier} · ${row.reference}`}
      columns={[
        c.primary('no', 'Inbound', (row) => row.reference),
        c.text('supplier', 'Supplier'),
        c.text('warehouse', 'Warehouse', { secondary: true }),
        c.date('arrival', 'Arrival'),
        c.text('dock', 'Dock', { secondary: true }),
        c.number('pallets', 'Pallets'),
        c.number('linesTotal', 'Lines'),
        c.number('linesPutaway', 'Put away', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Outbound() {
  const c = cols<OutboundDoc>()
  return (
    <ResourcePage
      title="Pick Lists"
      description="Pick lists released to the floor and their line-level progress. The shipment itself is tracked on the dispatch board."
      endpoint="warehouse/outbound"
      loader={() => dataset().outbound}
      exportName="outbound"
      createLabel="New pick list"
      formFields={forms.outboundFields}
      formDefaults={forms.outboundDefaults}
      formTitle="pick list"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'wave', label: 'Wave' },
      ]}
      actions={(rows) => <BuildWave rows={rows} />}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.customer} · ${row.soNo}`}
      columns={[
        c.primary('no', 'Pick list', (row) => row.soNo),
        c.text('customer', 'Customer'),
        c.text('warehouse', 'Warehouse', { secondary: true }),
        c.text('wave', 'Wave', { secondary: true }),
        c.text('picker', 'Picker', { secondary: true }),
        c.date('cutoff', 'Cut-off'),
        c.number('lines', 'Lines'),
        c.number('linesPicked', 'Picked'),
        c.status(),
      ]}
    />
  )
}

function Transfers() {
  const c = cols<Transfer>()
  return (
    <ResourcePage
      title="Stock Transfers"
      description="Movements between warehouses, including stock currently in transit."
      endpoint="warehouse/transfers"
      loader={() => dataset().transfers}
      exportName="stock-transfers"
      createLabel="New transfer"
      formFields={forms.transferFields}
      formDefaults={forms.transferDefaults}
      formLines={{ itemsEndpoint: 'warehouse/items', priceField: 'unitCost' }}
      formTitle="transfer"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'from', label: 'Origin' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.from} → ${row.to}`}
      columns={[
        c.primary('no', 'Transfer', (row) => `${row.from} → ${row.to}`),
        c.text('from', 'From', { secondary: true }),
        c.text('to', 'To', { secondary: true }),
        c.date('date', 'Raised'),
        c.date('eta', 'ETA', { overdueWhenPast: true }),
        c.number('lines', 'Lines', { secondary: true }),
        c.number('qty', 'Quantity'),
        c.money('value', 'Value', { compact: true, bold: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * The archive of posted counts.
 *
 * The live sheet lives on its own page — this is the history behind it, which
 * is what an auditor asks for and what a supervisor compares months against.
 */
function CountHistory() {
  const c = cols<CycleCount>()
  return (
    <ResourcePage
      title="Count History"
      description="Every count sheet already posted, the variances it surfaced, and the write-offs those variances required. The sheet for the open cycle is under Cycle Counts."
      endpoint="warehouse/cycle-counts"
      loader={() => dataset().cycleCounts}
      exportName="cycle-counts"
      createLabel="Schedule count"
      formFields={forms.cycleCountFields}
      formDefaults={forms.cycleCountDefaults}
      formLines={{ itemsEndpoint: 'warehouse/items' }}
      formTitle="cycle count"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'zone', label: 'Zone' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.warehouse} · ${row.zone}`}
      columns={[
        c.primary('no', 'Count', (row) => `${row.warehouse} · ${row.zone}`),
        // Both are also in the sub-label above, but a facet filter can only
        // bind to a real column — without these the Warehouse and Zone
        // dropdowns render and then fail to filter anything.
        c.text('warehouse', 'Warehouse', { secondary: true }),
        c.text('zone', 'Zone', { secondary: true }),
        c.date('date', 'Count date'),
        c.text('counter', 'Counted by', { secondary: true }),
        c.number('skusCounted', 'SKUs counted'),
        c.number('variances', 'Variances'),
        c.percent('accuracy', 'Accuracy', { warnBelow: 97 }),
        c.money('valueVariance', 'Value variance', { compact: true }),
        c.status(),
      ]}
    />
  )
}

function Replenishment() {
  const c = cols<ReplenishmentRow>()
  return (
    <ResourcePage
      title="Replenishment"
      description="SKUs approaching or below reorder point, with the suggested purchase quantity and lead time."
      endpoint="warehouse/replenishment"
      loader={() => dataset().replenishment}
      exportName="replenishment"
      actions={(rows) => <RaiseRequisition rows={rows as unknown as ReplenishmentApiRow[]} />}
      pageSize={25}
      filters={[
        { columnId: 'urgency', label: 'Urgency' },
        { columnId: 'category', label: 'Category' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.sku} · ${row.supplier}`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Critical" value={num(rows.filter((r) => r.urgency === 'Critical').length)} icon={AlertTriangle} hint="Stock-out imminent" />
          <StatTile label="High priority" value={num(rows.filter((r) => r.urgency === 'High').length)} icon={Repeat} hint="Cover below lead time" />
          <StatTile label="Suggested lines" value={num(rows.filter((r) => r.suggestedQty > 0).length)} icon={ClipboardCheck} />
          <StatTile
            label="Avg cover"
            value={(() => {
              const withCover = rows.filter((r) => r.coverDays !== null)
              return withCover.length
                ? `${Math.round(withCover.reduce((s, r) => s + (r.coverDays ?? 0), 0) / withCover.length)} days`
                : '\u2014'
            })()}
            icon={Package}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Item', (row) => `${row.sku} · ${row.supplier}`),
        c.text('category', 'Category', { secondary: true }),
        c.number('available', 'Available'),
        c.number('reorderPoint', 'Reorder point', { secondary: true }),
        c.number('avgDailyDemand', 'Daily demand', { secondary: true }),
        c.number('coverDays', 'Cover days'),
        c.number('leadTimeDays', 'Lead time', { suffix: 'd', secondary: true }),
        c.number('suggestedQty', 'Suggested qty'),
        c.level('urgency', 'Urgency', { Critical: 'critical', High: 'serious', Medium: 'warning', Low: 'neutral' }),
      ]}
    />
  )
}

function Locations() {
  const c = cols<WarehouseSite>()
  return (
    <ResourcePage
      title="Warehouses & Bins"
      description="Site network with storage capacity, bin counts and the manager accountable for each."
      endpoint="warehouse/locations"
      loader={() => dataset().sites}
      exportName="warehouses"
      createLabel="New location"
      filters={[
        { columnId: 'type', label: 'Type' },
        { columnId: 'region', label: 'Region' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.code} · ${row.city}`}
      columns={[
        c.primary('name', 'Site', (row) => `${row.code} · ${row.city}`),
        c.tag('type', 'Type', 'info'),
        c.text('region', 'Region', { secondary: true }),
        c.number('capacityPallets', 'Capacity'),
        c.number('usedPallets', 'Used'),
        c.number('bins', 'Bins', { secondary: true }),
        c.text('manager', 'Manager', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Labels() {
  const c = cols<LabelPrintJobRow>()
  return (
    <ResourcePage
      title="Barcodes & Labels"
      description="The print queue for SKU, bin, pallet and price-tag labels — what template, how many, and which printer it's queued on."
      endpoint="warehouse/labels"
      loader={() => LABEL_PRINT_JOB_PREVIEW}
      exportName="label-print-jobs"
      createLabel="New print job"
      formFields={forms.labelFields}
      formDefaults={forms.labelDefaults}
      formTitle="print job"
      pageSize={25}
      filters={[
        { columnId: 'template', label: 'Template' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.template} · ${row.warehouse ?? 'no warehouse'}`}
      columns={[
        c.primary('no', 'Job', (row) => row.warehouse ?? ''),
        c.tag('template', 'Template', 'neutral'),
        c.number('quantity', 'Quantity'),
        c.text('printer', 'Printer', { secondary: true }),
        c.date('created', 'Queued'),
        c.status(),
      ]}
    />
  )
}

/** A job queues a template and a quantity, never one specific item — so unlike
 *  a bin or an item, there is no single barcode to preview per row. */
type LabelPrintJobRow = {
  id: number
  no: string
  template: string
  warehouse: string | null
  warehouseId: number | null
  quantity: number
  printer: string | null
  status: string
  created: string
}

const LABEL_PRINT_JOB_PREVIEW: LabelPrintJobRow[] = [
  {
    id: 1,
    no: 'LBL-0001',
    template: 'SKU Label',
    warehouse: 'Davao Main DC',
    warehouseId: 1,
    quantity: 250,
    printer: 'Zebra ZT411 — Receiving',
    status: 'Queued',
    created: new Date().toISOString(),
  },
  {
    id: 2,
    no: 'LBL-0002',
    template: 'Bin Label',
    warehouse: 'Davao Main DC',
    warehouseId: 1,
    quantity: 40,
    printer: 'Zebra ZT411 — Receiving',
    status: 'Completed',
    created: new Date(Date.now() - 86_400_000).toISOString(),
  },
]

/**
 * Bin locations.
 *
 * Separate from the warehouse list because a site has hundreds of them, and
 * putaway needs to pick one — a nested list on the location record would be
 * unusable at that volume.
 */
function Bins() {
  const c = cols<WarehouseBinRow>()
  return (
    <ResourcePage
      title="Bins"
      description="Every storage location inside a warehouse, with its zone, aisle and what is currently in it."
      endpoint="warehouse/bins"
      loader={() => [] as WarehouseBinRow[]}
      exportName="warehouse-bins"
      createLabel="New bin"
      formFields={forms.binFields}
      formDefaults={forms.binDefaults}
      formTitle="bin"
      pageSize={50}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'zone', label: 'Zone' },
        { columnId: 'status', label: 'Status' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Bins" value={num(rows.length)} icon={Package} hint={`${num(rows.filter((r) => r.status === 'Active').length)} in use`} />
          <StatTile label="Zones" value={num(new Set(rows.map((r) => r.zone).filter(Boolean)).size)} icon={ClipboardCheck} />
          <StatTile
            label="Occupied"
            value={num(rows.filter((r) => r.onHand > 0).length)}
            icon={Repeat}
            hint="Holding stock right now"
          />
          <StatTile
            label="Out of use"
            value={num(rows.filter((r) => r.status !== 'Active').length)}
            icon={AlertTriangle}
            hint="Blocked for putaway"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.code}
      detailSubtitle={(row) => row.warehouse}
      renderDetail={(row) => <QrLabel value={row.code} title={row.code} subtitle={`${row.warehouse} · ${row.zone || 'no zone'}`} />}
      columns={[
        c.primary('code', 'Bin', (row) => row.warehouse),
        c.text('zone', 'Zone', { secondary: true }),
        c.text('aisle', 'Aisle', { secondary: true }),
        c.number('capacity', 'Capacity'),
        c.tag('preferredClass', 'Preferred class', 'neutral'),
        c.number('onHand', 'On hand'),
        c.status(),
      ]}
    />
  )
}

/**
 * Safety/HSSE incidents.
 *
 * Deliberately its own table rather than the HR "Safety Incident" case type —
 * that one is structurally a disciplinary record against one employee, and a
 * forklift near-miss in Aisle 3 is not a disciplinary matter until an
 * investigation says it is.
 */
function Incidents() {
  const c = cols<WarehouseIncidentRow>()
  return (
    <ResourcePage
      title="Safety Incidents"
      description="Near-misses and incidents logged against a warehouse — hazard, severity, and what was done about it."
      endpoint="warehouse/incidents"
      loader={() => [] as WarehouseIncidentRow[]}
      exportName="warehouse-incidents"
      createLabel="Log an incident"
      formFields={forms.incidentFields}
      formDefaults={forms.incidentDefaults}
      formTitle="incident"
      pageSize={25}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'hazardType', label: 'Hazard' },
        { columnId: 'severity', label: 'Severity' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.warehouse} · ${row.hazardType}`}
      columns={[
        c.primary('no', 'Incident', (row) => row.warehouse),
        c.date('occurredOn', 'Occurred'),
        c.text('hazardType', 'Hazard', { secondary: true }),
        c.tag('severity', 'Severity', 'neutral'),
        c.text('location', 'Location', { secondary: true }),
        c.text('reportedBy', 'Reported by', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * 5S & Kaizen.
 *
 * A suggestion log and a 5S audit are the same idea seen two ways — one is
 * "here is an improvement", the other is "here is a score for how the zone
 * looks right now" — so they share a destination the way the Fuel module's
 * issuance log and trip requests do.
 */
function Suggestions() {
  const c = cols<WarehouseSuggestionRow>()
  return (
    <ResourcePage
      title="Improvement Suggestions"
      description="Ideas raised on the floor — 5S, safety, efficiency, quality — tracked from submission to outcome."
      endpoint="warehouse/suggestions"
      loader={() => [] as WarehouseSuggestionRow[]}
      exportName="warehouse-suggestions"
      createLabel="Raise a suggestion"
      formFields={forms.suggestionFields}
      formDefaults={forms.suggestionDefaults}
      formTitle="suggestion"
      pageSize={25}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.warehouse} · ${row.category}`}
      columns={[
        c.primary('no', 'Suggestion', (row) => row.warehouse),
        c.tag('category', 'Category', 'neutral'),
        c.text('zone', 'Zone', { secondary: true }),
        c.text('raisedBy', 'Raised by', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function FiveSAudits() {
  const c = cols<Warehouse5sAuditRow>()
  return (
    <ResourcePage
      title="5S Audits"
      description="Sort, Set in order, Shine, Standardize, Sustain — each scored 1-5 per zone, per audit."
      endpoint="warehouse/five-s-audits"
      loader={() => [] as Warehouse5sAuditRow[]}
      exportName="warehouse-5s-audits"
      createLabel="New audit"
      formFields={forms.auditFields}
      formDefaults={forms.auditDefaults}
      formTitle="5S audit"
      pageSize={25}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'zone', label: 'Zone' },
      ]}
      detailTitle={(row) => `${row.zone} — ${row.no}`}
      detailSubtitle={(row) => row.warehouse}
      columns={[
        c.primary('no', 'Audit', (row) => row.warehouse),
        c.text('zone', 'Zone', { secondary: true }),
        c.date('auditedOn', 'Date'),
        c.text('auditedBy', 'Audited by', { secondary: true }),
        c.number('sortScore', 'Sort', { secondary: true }),
        c.number('setScore', 'Set', { secondary: true }),
        c.number('shineScore', 'Shine', { secondary: true }),
        c.number('standardizeScore', 'Standardize', { secondary: true }),
        c.number('sustainScore', 'Sustain', { secondary: true }),
        c.number('totalScore', 'Total /25'),
      ]}
    />
  )
}

function KaizenArea() {
  const [tab, setTab] = React.useState<'suggestions' | 'audits'>('suggestions')

  return (
    <>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface-2 p-1" data-print="hide">
        {(
          [
            ['suggestions', 'Suggestions'],
            ['audits', '5S Audits'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              tab === id
                ? 'grad-brand rounded-lg px-4 py-2 text-[13px] font-medium text-white shadow-sm'
                : 'rounded-lg px-4 py-2 text-[13px] font-medium text-ink-2 hover:text-ink'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'suggestions' ? <Suggestions /> : <FiveSAudits />}
    </>
  )
}

/** Dock/yard appointment scheduling — a real booking, not a free-text label on a shipment. */
function DockSchedule() {
  const c = cols<DockAppointmentRow>()
  return (
    <ResourcePage
      title="Dock Schedule"
      description="Booked dock appointments — what is expected at which door, and when."
      endpoint="warehouse/docks"
      loader={() => [] as DockAppointmentRow[]}
      exportName="dock-schedule"
      createLabel="Book appointment"
      formFields={forms.dockAppointmentFields}
      formDefaults={forms.dockAppointmentDefaults}
      formTitle="dock appointment"
      pageSize={25}
      filters={[
        { columnId: 'warehouse', label: 'Warehouse' },
        { columnId: 'type', label: 'Direction' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => `${row.dockCode} — ${row.no}`}
      detailSubtitle={(row) => row.warehouse}
      columns={[
        c.primary('dockCode', 'Dock', (row) => row.warehouse),
        c.date('scheduledAt', 'Scheduled'),
        c.tag('type', 'Direction', 'neutral'),
        c.text('reference', 'Reference', { secondary: true }),
        c.text('carrier', 'Carrier', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  items: Items,
  stock: Stock,
  receiving: Receiving,
  inbound: Inbound,
  dispatch: DispatchBoard,
  outbound: Outbound,
  transfers: Transfers,
  counts: CycleCounts,
  'count-history': CountHistory,
  replenishment: Replenishment,
  locations: Locations,
  bins: Bins,
  labels: Labels,
  incidents: Incidents,
  kaizen: KaizenArea,
  docks: DockSchedule,
}
