import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Car,
  ExternalLink,
  Fuel as FuelIcon,
  Gauge,
  HardHat,
  Timer,
  Wrench,
} from 'lucide-react'
import { FuelRequests } from './FuelRequests'
import { FuelApprovalsLog } from './FuelApprovalsLog'
import { dataset } from '@/data/dataset'
import { moneyCompact, num } from '@/lib/format'
import type { DowntimeEvent, FuelLog, PmSchedule, Vehicle, WorkOrder } from '@/data/transactions'
import type { Asset } from '@/data/master'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { Button } from '@/components/ui/primitives'
import { Dashboard } from './dashboard'
import { CompleteWorkOrder, GeneratePreventive, RaiseFromBreakdown } from './actions'
import * as forms from './forms'

const SPARE_PART_CATEGORIES = ['Industrial Supplies', 'Electrical', 'Safety & PPE']

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

function Assets() {
  const c = cols<Asset>()
  return (
    <ResourcePage
      title="Asset Register"
      description="Every serialised asset the business maintains, with book value, condition and service dates."
      endpoint="maintenance/assets"
      loader={() => dataset().assets}
      exportName="asset-register"
      createLabel="New asset"
      formFields={forms.assetFields}
      formDefaults={forms.assetDefaults}
      formTitle="asset"
      filters={[
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
        { columnId: 'criticality', label: 'Criticality' },
      ]}
      detailTitle={(row) => `${row.code} — ${row.name}`}
      detailSubtitle={(row) => `${row.category} · ${row.site}`}
      columns={[
        c.primary('code', 'Asset', (row) => row.name),
        c.tag('category', 'Category', 'info'),
        c.text('site', 'Location', { secondary: true }),
        c.money('acquisitionCost', 'Acquisition', { compact: true, secondary: true }),
        c.money('bookValue', 'Book value', { compact: true, bold: true }),
        c.number('meterReading', 'Meter'),
        c.level('criticality', 'Criticality', { High: 'critical', Medium: 'warning', Low: 'neutral' }),
        c.level('condition', 'Condition', { Excellent: 'good', Good: 'good', Fair: 'warning', Poor: 'critical' }),
        c.date('nextService', 'Next service', { overdueWhenPast: true }),
        c.status(),
      ]}
    />
  )
}

function WorkOrders() {
  const c = cols<WorkOrder>()
  return (
    <ResourcePage
      title="Work Orders"
      description="Corrective and preventive jobs with the labour, parts and downtime each one consumed. Completing a job issues its spare parts and returns the asset to service."
      endpoint="maintenance/work-orders"
      loader={() => dataset().workOrders}
      exportName="work-orders"
      createLabel="New work order"
      formFields={forms.workOrderFields}
      formLines={forms.workOrderLines}
      formDefaults={forms.workOrderDefaults}
      formTitle="work order"
      detailActions={(row, done) => <CompleteWorkOrder row={row} done={done} />}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'type', label: 'Type' },
        { columnId: 'priority', label: 'Priority' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.asset} · ${row.summary ?? row.assetName}`}
      columns={[
        c.primary('no', 'Work order', (row) => row.summary ?? `${row.asset} — ${row.assetName}`),
        c.text('asset', 'Asset', { secondary: true }),
        c.tag('type', 'Type', 'info'),
        c.level('priority', 'Priority', { Critical: 'critical', High: 'serious', Medium: 'warning', Low: 'neutral' }),
        c.date('reported', 'Reported'),
        c.date('due', 'Due', { overdueWhenPast: true }),
        c.text('technician', 'Technician', { secondary: true }),
        c.number('downtimeHours', 'Downtime', { decimals: 1, suffix: ' h' }),
        c.money('laborCost', 'Labour', { compact: true, secondary: true }),
        c.money('partsCost', 'Parts', { compact: true, secondary: true }),
        c.money('totalCost', 'Total', { compact: true, bold: true }),
        c.status(),
      ]}
    />
  )
}

function Preventive() {
  const c = cols<PmSchedule>()
  return (
    <ResourcePage
      title="Preventive Schedules"
      description="Time and meter based maintenance plans. Raising due jobs turns them into work orders — a plan nobody converts is a spreadsheet."
      endpoint="maintenance/preventive"
      loader={() => dataset().pmSchedules}
      exportName="pm-schedules"
      createLabel="New schedule"
      formFields={forms.preventiveFields}
      formDefaults={forms.preventiveDefaults}
      formTitle="schedule"
      actions={<GeneratePreventive />}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'frequency', label: 'Frequency' },
      ]}
      detailTitle={(row) => row.code}
      detailSubtitle={(row) => `${row.asset} · ${row.task}`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Live schedules" value={num(rows.filter((r) => r.status !== 'Inactive').length)} icon={CalendarClock} />
          <StatTile
            label="Overdue"
            value={num(rows.filter((r) => r.status === 'Overdue').length)}
            icon={AlertTriangle}
            hint="Past the date the plan itself set"
          />
          <StatTile label="Due shortly" value={num(rows.filter((r) => r.status === 'Due').length)} icon={Timer} hint="Within a week" />
          <StatTile
            label="Average compliance"
            value={`${Math.round(rows.reduce((s, r) => s + r.compliance, 0) / Math.max(1, rows.length))}%`}
            icon={Gauge}
            hint="Share of jobs finished before their due date"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('code', 'Schedule', (row) => row.task),
        c.text('assetName', 'Asset', { secondary: true }),
        c.tag('frequency', 'Frequency', 'info'),
        c.date('lastDone', 'Last done', { secondary: true }),
        c.date('nextDue', 'Next due', { overdueWhenPast: true }),
        c.text('assignedTo', 'Assigned to', { secondary: true }),
        c.progress('compliance', 'Compliance', {
          tone: (v) => (v >= 90 ? 'good' : v >= 75 ? 'brand' : 'warning'),
        }),
        c.status(),
      ]}
    />
  )
}

function Fleet() {
  const c = cols<Vehicle>()
  return (
    <ResourcePage
      title="Fleet & Vehicles"
      description="Delivery fleet with odometer, service interval and the statutory documents that must stay current."
      endpoint="maintenance/fleet"
      loader={() => dataset().vehicles}
      exportName="fleet"
      createLabel="Add vehicle"
      formFields={forms.vehicleFields}
      formDefaults={forms.vehicleDefaults}
      formTitle="vehicle"
      filters={[{ columnId: 'status', label: 'Status' }]}
      detailTitle={(row) => `${row.code} — ${row.plate}`}
      detailSubtitle={(row) => row.model}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Fleet size" value={num(rows.length)} icon={Car} />
          <StatTile label="Available" value={num(rows.filter((r) => r.status === 'Available').length)} icon={Gauge} />
          <StatTile
            label="Registration expiring"
            value={num(rows.filter((r) => new Date(r.registrationExpiry).getTime() - Date.now() < 60 * 86_400_000).length)}
            icon={CalendarClock}
            hint="Within 60 days"
          />
          <StatTile
            label="Avg efficiency"
            value={`${(rows.reduce((s, r) => s + r.fuelEfficiency, 0) / Math.max(1, rows.length)).toFixed(2)} km/L`}
            icon={FuelIcon}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('plate', 'Vehicle', (row) => `${row.code} · ${row.model}`),
        c.text('driver', 'Driver'),
        c.text('site', 'Base', { secondary: true }),
        c.level('ownership', 'Ownership', { CO: 'brand', PO: 'warning', 'R&C': 'info' }),
        c.text('vehicleType', 'Type', { secondary: true }),
        c.number('odometer', 'Odometer', { suffix: ' km' }),
        c.number('kmSinceService', 'Since service', { suffix: ' km' }),
        c.number('fuelEfficiency', 'Efficiency', { decimals: 2, suffix: ' km/L' }),
        c.date('registrationExpiry', 'Registration', { overdueWhenPast: true }),
        c.date('insuranceExpiry', 'Insurance', { secondary: true, overdueWhenPast: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * Fuel & Consumption, as two views of one subject.
 *
 * The issuance log answers "what did we put in"; the trip requests answer "was
 * that reasonable". They were never going to be one table — one is a receipt
 * and the other is an authorisation — but they are the same conversation, so
 * they are one destination.
 */
function FuelArea() {
  const [tab, setTab] = React.useState<'log' | 'requests'>('log')

  return (
    <>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-surface-2 p-1" data-print="hide">
        {(
          [
            ['log', 'Issuance log'],
            ['requests', 'Trip requests'],
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

      {tab === 'log' ? <FuelPage /> : <FuelRequests />}
    </>
  )
}

function FuelPage() {
  const c = cols<FuelLog>()
  return (
    <ResourcePage
      title="Fuel & Consumption"
      description="Fuel issuance per vehicle. Distance, economy and the anomaly flag are worked out from the odometer against the previous fill — none of it is typed."
      endpoint="maintenance/fuel"
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.open('/fuel-request', '_blank', 'noopener')}
        >
          <ExternalLink className="size-3.5" />
          New fuel request
        </Button>
      }
      loader={() => dataset().fuelLogs}
      exportName="fuel-logs"
      createLabel="Record issuance"
      formFields={forms.fuelFields}
      formDefaults={forms.fuelDefaults}
      formTitle="fuel issuance"
      pageSize={25}
      filters={[
        { columnId: 'vehicle', label: 'Vehicle' },
        { columnId: 'station', label: 'Station' },
        { columnId: 'review', label: 'Review' },
      ]}
      detailTitle={(row) => `${row.vehicle} — ${row.liters} L`}
      detailSubtitle={(row) => row.station}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Litres issued" value={num(rows.reduce((s, r) => s + r.liters, 0))} icon={FuelIcon} />
          <StatTile label="Fuel cost" value={moneyCompact(rows.reduce((s, r) => s + r.cost, 0))} icon={FuelIcon} />
          <StatTile
            label="Average efficiency"
            value={`${(
              rows.filter((r) => r.kmPerLiter > 0).reduce((s, r) => s + r.kmPerLiter, 0) /
              Math.max(1, rows.filter((r) => r.kmPerLiter > 0).length)
            ).toFixed(2)} km/L`}
            icon={Gauge}
            hint="First fill on a vehicle has nothing to measure against"
          />
          <StatTile
            label="Flagged issuances"
            value={num(rows.filter((r) => r.flagged).length)}
            icon={AlertTriangle}
            hint="Under 75% of the vehicle's own baseline"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('vehicle', 'Vehicle', (row) => row.driver),
        c.date('date', 'Date'),
        c.number('liters', 'Litres', { decimals: 1 }),
        c.money('cost', 'Cost'),
        c.number('odometer', 'Odometer', { suffix: ' km', secondary: true }),
        c.number('distance', 'Distance', { suffix: ' km', secondary: true }),
        c.number('kmPerLiter', 'Efficiency', { decimals: 2, suffix: ' km/L' }),
        c.text('station', 'Station', { secondary: true }),
        c.level('review', 'Review', { Check: 'critical', Normal: 'good' }),
      ]}
    />
  )
}

/**
 * A spare part is an item plus what is on the shelf — not a stock balance row.
 * One part held in two warehouses is one line here, because a technician asks
 * "have we got one?" rather than "which bin is it in?".
 */
type SparePartRow = {
  id: number
  sku: string
  name: string
  category: string | null
  uom: string
  unitCost: number
  reorderPoint: number
  reorderQty: number
  leadTimeDays: number
  supplier: string | null
  onHand: number
  available: number
  value: number
  status: 'In Stock' | 'Low Stock' | 'Out of Stock'
}

function SpareParts() {
  const c = cols<SparePartRow>()
  return (
    <ResourcePage
      title="Spare Parts"
      description="Critical spares held in the warehouse, so a repair is never blocked waiting on a part. Marked on the item master and consumed by work orders."
      endpoint="maintenance/spare-parts"
      loader={() =>
        dataset()
          .stock.filter((s) => SPARE_PART_CATEGORIES.includes(s.category))
          .map((s, index) => ({
            id: index + 1,
            sku: s.sku,
            name: s.name,
            category: s.category,
            uom: 'PIECE',
            unitCost: s.unitCost,
            reorderPoint: 0,
            reorderQty: 0,
            leadTimeDays: 0,
            supplier: null,
            onHand: s.onHand,
            available: s.available,
            value: s.value,
            status: (s.available <= 0 ? 'Out of Stock' : 'In Stock') as SparePartRow['status'],
          }))
      }
      exportName="spare-parts"
      pageSize={25}
      filters={[
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.sku} · ${row.category}`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Parts held" value={num(rows.length)} icon={Wrench} />
          <StatTile label="Stock value" value={moneyCompact(rows.reduce((s, r) => s + r.value, 0))} icon={Wrench} />
          <StatTile
            label="Running short"
            value={num(rows.filter((r) => r.status === 'Low Stock' || r.status === 'Out of Stock').length)}
            icon={AlertTriangle}
            hint="At or below the reorder point"
          />
          <StatTile
            label="Out of stock"
            value={num(rows.filter((r) => r.status === 'Out of Stock').length)}
            icon={HardHat}
            hint="A repair needing one of these is blocked"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Part', (row) => row.sku),
        c.text('category', 'Category'),
        c.text('supplier', 'Supplier', { secondary: true }),
        c.number('onHand', 'On hand'),
        c.number('available', 'Available'),
        c.number('reorderPoint', 'Reorder point', { secondary: true }),
        c.number('leadTimeDays', 'Lead time', { secondary: true, suffix: 'd' }),
        c.money('unitCost', 'Unit cost', { secondary: true }),
        c.money('value', 'Value', { compact: true, bold: true }),
        c.status(),
      ]}
    />
  )
}

type TechnicianRow = {
  id: number
  code: string
  name: string
  position: string | null
  openJobs: number
  completedJobs: number
  overdueJobs: number
  hoursLogged: number
  avgRepairHours: number | null
  availability: string
}

function Technicians() {
  const c = cols<TechnicianRow>()

  // Preview twin of the server's technician-load calculation.
  const load = (): TechnicianRow[] => {
    const d = dataset()
    return d.employees
      .filter((e) => e.department === 'Maintenance' && e.status !== 'Resigned')
      .map((e, index) => {
        const jobs = d.workOrders.filter((w) => w.technician === e.name)
        const completed = jobs.filter((w) => w.status === 'Completed')
        const open = jobs.filter((w) => ['Open', 'Assigned', 'In Progress', 'On Hold'].includes(w.status))
        return {
          id: index + 1,
          code: e.id,
          name: e.name,
          position: e.position,
          openJobs: open.length,
          completedJobs: completed.length,
          overdueJobs: open.filter((w) => new Date(w.due).getTime() < Date.now()).length,
          hoursLogged: Number(jobs.reduce((s, w) => s + w.downtimeHours, 0).toFixed(1)),
          avgRepairHours: completed.length
            ? Number((completed.reduce((s, w) => s + w.downtimeHours, 0) / completed.length).toFixed(1))
            : null,
          availability: open.length > 9 ? 'Overloaded' : open.length > 5 ? 'Busy' : 'Available',
        }
      })
      .sort((a, b) => b.openJobs - a.openJobs)
  }

  return (
    <ResourcePage
      title="Technicians"
      description="Maintenance crew with current job load and repair history — derived from the work orders assigned to them, so it cannot be out of date."
      endpoint="maintenance/technician-load"
      loader={load}
      exportName="technicians"
      filters={[{ columnId: 'availability', label: 'Availability' }]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => row.position ?? 'Maintenance'}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Technicians" value={num(rows.length)} icon={HardHat} />
          <StatTile label="Open jobs" value={num(rows.reduce((s, r) => s + r.openJobs, 0))} icon={Wrench} />
          <StatTile
            label="Overdue jobs"
            value={num(rows.reduce((s, r) => s + r.overdueJobs, 0))}
            icon={AlertTriangle}
            hint="Past their due date"
          />
          <StatTile
            label="Overloaded"
            value={num(rows.filter((r) => r.availability === 'Overloaded').length)}
            icon={Timer}
            hint="More than nine open jobs"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Technician', (row) => row.position ?? 'Maintenance'),
        c.text('code', 'Employee no', { secondary: true, mono: true }),
        c.number('openJobs', 'Open jobs'),
        c.number('overdueJobs', 'Overdue'),
        c.number('completedJobs', 'Completed'),
        c.number('hoursLogged', 'Hours logged', { decimals: 1 }),
        c.number('avgRepairHours', 'Avg repair', { decimals: 1, suffix: ' h' }),
        c.level('availability', 'Availability', { Available: 'good', Busy: 'warning', Overloaded: 'critical' }),
      ]}
    />
  )
}

function Downtime() {
  const c = cols<DowntimeEvent>()
  return (
    <ResourcePage
      title="Breakdown & Downtime"
      description="Failure log with root cause, so recurring problems get engineered out instead of repeatedly repaired. Raise a work order from a record to link the failure to the fix."
      endpoint="maintenance/downtime"
      loader={() => dataset().downtime}
      exportName="downtime-log"
      createLabel="Log breakdown"
      formFields={forms.downtimeFields}
      formDefaults={forms.downtimeDefaults}
      formTitle="breakdown"
      detailActions={(row, done) => <RaiseFromBreakdown row={row} done={done} />}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'cause', label: 'Cause' },
        { columnId: 'impact', label: 'Impact' },
      ]}
      detailTitle={(row) => `${row.asset} — ${row.cause}`}
      detailSubtitle={(row) => row.assetName}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Events logged" value={num(rows.length)} icon={AlertTriangle} />
          <StatTile label="Hours lost" value={`${num(Math.round(rows.reduce((s, r) => s + r.hours, 0)))} h`} icon={Timer} />
          <StatTile label="Cost impact" value={moneyCompact(rows.reduce((s, r) => s + r.costImpact, 0))} icon={Wrench} />
          <StatTile
            label="Recurring issues"
            value={num(rows.filter((r) => r.status === 'Recurring').length)}
            icon={HardHat}
            hint="Root cause not yet eliminated"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('asset', 'Asset', (row) => row.assetName),
        c.date('date', 'Occurred'),
        c.text('cause', 'Cause'),
        c.number('hours', 'Hours lost', { decimals: 1 }),
        c.tag('impact', 'Impact', 'warning', true),
        c.text('rootCause', 'Root cause', { secondary: true }),
        c.text('workOrder', 'Work order', { secondary: true, mono: true }),
        c.money('costImpact', 'Cost impact', { compact: true, bold: true }),
        c.level('status', 'Status', { Resolved: 'good', 'Under Investigation': 'warning', Recurring: 'critical' }),
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  assets: Assets,
  'work-orders': WorkOrders,
  preventive: Preventive,
  fleet: Fleet,
  fuel: FuelArea,
  'fuel-approvals-log': FuelApprovalsLog,
  'spare-parts': SpareParts,
  technicians: Technicians,
  downtime: Downtime,
}
