import * as React from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Gauge,
  Package,
  Repeat,
  Timer,
  Warehouse as WarehouseIcon,
} from 'lucide-react'
import { warehouseDashboard, type WarehouseDashboard } from '@/data/analytics'
import {
  cycleFor,
  daysToCycleDue,
  damagedTotal,
  otifFor,
  otifRate,
  receivedTotal,
} from '@/data/warehouse'
import { useOps } from './ops'
import { useSeedFloor } from './useFloorData'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart, ChartCard, DonutChart, RankedBars } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, type FullPeriod, type Grain, type ReportOption } from '@/components/dashboard/DashboardShell'
import { useResource } from '@/lib/api'
import { dashboardWindowQuery } from '@/lib/adminApi'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'

/**
 * The Warehouse dashboard.
 *
 * Stock value is the sum of what is on the shelf at what it cost, and
 * throughput is the movement log counted by day — so both move when a receipt
 * is posted or a pick list is dispatched, and neither can disagree with the
 * stock list.
 */

/** Formats a KPI the system genuinely has no data for yet. */
const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

export function Dashboard() {
  // Stock balances are always a snapshot of right now; only the throughput
  // trend and its movement-based KPIs are scoped to this window.
  const [period, setPeriod] = React.useState<FullPeriod>('mtd')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [grain, setGrain] = React.useState<Grain | null>(null)

  const dispatches = useOps((s) => s.dispatches)
  const receipts = useOps((s) => s.receipts)

  useSeedFloor()

  const endpoint = `warehouse/dashboard?${dashboardWindowQuery(period, { from, to, grain: grain ?? undefined })}`
  const { data, isLoading, error, refetch } = useResource<WarehouseDashboard>(endpoint, warehouseDashboard, {
    enabled: period !== 'custom' || (!!from && !!to),
  })

  // OTIF is the department's headline number, so it is computed here from the
  // dispatch board rather than read off a stored figure that could drift.
  const otif = React.useMemo(() => otifRate(dispatches), [dispatches])
  const late = React.useMemo(
    () =>
      dispatches.filter((d) => {
        const result = otifFor(d)
        return result.settled ? result.onTime === false : new Date(d.promisedAt) < new Date()
      }).length,
    [dispatches],
  )
  const damage = React.useMemo(() => {
    const received = receipts.reduce((s, e) => s + receivedTotal(e), 0)
    const damaged = receipts.reduce((s, e) => s + damagedTotal(e), 0)
    return { received, damaged, rate: received ? (damaged / received) * 100 : null }
  }, [receipts])

  const cycle = React.useMemo(() => cycleFor(), [])
  const dueIn = daysToCycleDue(cycle)

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { kpis, throughput, statusMix, valueByCategory, valueByWarehouse, expiring, window: win } = data

  const categoryTotal = valueByCategory.reduce((s, c) => s + c.value, 0)
  const activeDays = throughput.filter((d) => d.movements > 0).length

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Stock summary',
      description: 'Value on hand, throughput and count accuracy.',
      build: () => [
        {
          kind: 'summary',
          title: 'Stock Summary',
          items: [
            { label: 'Stock value', value: money(kpis.stockValue, { decimals: false }) },
            { label: 'SKUs held', value: num(kpis.skusHeld), note: `${num(kpis.activeSkus)} active in the catalogue` },
            { label: 'Units on hand', value: num(kpis.unitsOnHand) },
            { label: 'Received (30 days)', value: num(kpis.unitsReceived) },
            { label: 'Issued (30 days)', value: num(kpis.unitsIssued) },
            { label: 'Inventory turns', value: orDash(kpis.inventoryTurns, (v) => `${num(v, 2)}×`) },
            { label: 'Count accuracy', value: orDash(kpis.countAccuracy, percent) },
            { label: 'Needs reordering', value: num(kpis.replenishmentLines), note: `${num(kpis.replenishmentCritical)} critical` },
          ],
        },
      ],
    },
    {
      id: 'throughput',
      label: 'Daily throughput',
      description: 'Units received and issued each day over the last 30 days.',
      build: () => [
        {
          kind: 'table',
          title: 'Daily Throughput',
          columns: ['Day', 'Received', 'Issued', 'Net', 'Movements'],
          rows: throughput.map((d) => [d.day, num(d.received), num(d.issued), num(d.received - d.issued), d.movements]),
          total: [
            'TOTAL',
            num(kpis.unitsReceived),
            num(kpis.unitsIssued),
            num(kpis.unitsReceived - kpis.unitsIssued),
            kpis.movements,
          ],
        },
      ],
    },
    {
      id: 'sites',
      label: 'Value by warehouse',
      description: 'Stock value, SKU count and pallet occupancy per site.',
      build: () => [
        {
          kind: 'table',
          title: 'Value by Warehouse',
          columns: ['Warehouse', 'Code', 'Stock value', 'Stock lines', 'Bins', 'Pallets used', 'Utilisation'],
          rows: valueByWarehouse.map((w) => [
            w.name,
            w.code,
            money(w.value, { decimals: false }),
            w.skus,
            w.bins,
            `${num(w.usedPallets)} of ${num(w.capacityPallets)}`,
            w.utilisation === null ? 'not recorded' : percent(w.utilisation),
          ]),
        },
      ],
    },
    {
      id: 'category',
      label: 'Value by category',
      description: 'Where the inventory money is tied up.',
      build: () => [
        {
          kind: 'table',
          title: 'Value by Category',
          columns: ['Category', 'Value', 'Share'],
          rows: valueByCategory.map((c) => [
            c.name,
            money(c.value, { decimals: false }),
            percent(categoryTotal ? (c.value / categoryTotal) * 100 : 0),
          ]),
        },
      ],
    },
    {
      id: 'expiring',
      label: 'Stock nearing expiry',
      description: 'Batches within 60 days of their expiry date.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Stock Nearing Expiry',
          columns: ['Item', 'Warehouse', 'Batch', 'Expires', 'Days left', 'On hand', 'Value'],
          rows: expiring.map((e) => [
            `${e.sku} — ${e.name}`,
            e.warehouse,
            e.batch ?? '—',
            e.expiry ? fmtDate(e.expiry) : '—',
            e.daysLeft ?? '—',
            num(e.onHand),
            money(e.value, { decimals: false }),
          ]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Warehouse"
      description="Stock on hand, what moved through the building, and where the inventory money is sitting."
      advanced={{
        period,
        onPeriod: setPeriod,
        from,
        to,
        onFrom: setFrom,
        onTo: setTo,
        grain,
        onGrain: setGrain,
        resolvedGrain: win.grain,
        windowLabel: win.label,
      }}
      reportTitle="Warehouse Operations Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'warehouse-throughput',
        rows: throughput,
        columns: [
          { header: 'Day', value: (r) => r.day },
          { header: 'Received', value: (r) => r.received },
          { header: 'Issued', value: (r) => r.issued },
          { header: 'Movements', value: (r) => r.movements },
        ],
      }}
    >
      {/* The department is measured on OTIF, so it leads — and the two halves
          it is made of sit next to it, because "85%" is not actionable until
          you know whether the problem is the clock or the quantity. */}
      <StatGrid>
        <StatTile
          label="OTIF"
          value={otif.rate == null ? '—' : percent(otif.rate)}
          icon={Gauge}
          hint={otif.rate == null ? 'no drops settled yet' : `across ${num(otif.settled)} settled drops`}
          progress={
            otif.rate == null
              ? undefined
              : { value: otif.rate, tone: otif.rate >= 95 ? 'good' : otif.rate >= 85 ? 'warning' : 'critical' }
          }
        />
        <StatTile
          label="On time"
          value={otif.onTime == null ? '—' : percent(otif.onTime)}
          icon={Timer}
          hint="delivered by the promised date"
        />
        <StatTile
          label="In full"
          value={otif.inFull == null ? '—' : percent(otif.inFull)}
          icon={ClipboardCheck}
          hint="every line at the quantity ordered"
        />
        <StatTile
          label="Running late"
          value={num(late)}
          icon={CalendarClock}
          hint={late === 0 ? 'nothing past its promise' : 'shipments past the promised date'}
        />
      </StatGrid>

      <StatGrid>
        <StatTile
          label="Stock value"
          value={moneyCompact(kpis.stockValue)}
          icon={Boxes}
          hint={`${num(kpis.skusHeld)} SKU${kpis.skusHeld === 1 ? '' : 's'} held · ${num(kpis.unitsOnHand)} units`}
        />
        <StatTile
          label="Received (30 days)"
          value={num(kpis.unitsReceived)}
          icon={ArrowDownToLine}
          hint={`${num(kpis.expectedInbound)} shipment${kpis.expectedInbound === 1 ? '' : 's'} still expected`}
        />
        <StatTile
          label="Issued (30 days)"
          value={num(kpis.unitsIssued)}
          icon={ArrowUpFromLine}
          hint={`${num(kpis.openPicks)} pick list${kpis.openPicks === 1 ? '' : 's'} open`}
        />
        <StatTile
          label="Inventory turns"
          value={orDash(kpis.inventoryTurns, (v) => `${num(v, 2)}×`)}
          icon={Repeat}
          hint={kpis.inventoryTurns === null ? 'No stock to turn over yet' : 'Annualised from 30 days'}
        />
      </StatGrid>

      <StatGrid>
        <StatTile
          label="Needs reordering"
          value={num(kpis.replenishmentLines)}
          icon={AlertTriangle}
          hint={kpis.replenishmentCritical > 0 ? `${num(kpis.replenishmentCritical)} critical` : 'None critical'}
        />
        <StatTile
          label="Count accuracy"
          value={orDash(kpis.countAccuracy, percent)}
          icon={ClipboardCheck}
          hint={
            kpis.countAccuracy === null
              ? 'No counts posted yet'
              : `${num(kpis.countVariances)} variance${kpis.countVariances === 1 ? '' : 's'} · ${money(kpis.countValueVariance, { decimals: false })}`
          }
        />
        <StatTile
          label="Expiring within 60 days"
          value={num(kpis.expiringSoon)}
          icon={Package}
          hint="Batches to move or write down"
        />
        <StatTile
          label="Transfers in transit"
          value={num(kpis.transfersInTransit)}
          icon={WarehouseIcon}
          hint="Left the source, not yet received"
        />
      </StatGrid>

      {/* What the floor is doing right now: the open count cycle, and what the
          dock has seen. Both are worked in Cycle Counts and Inbound. */}
      <StatGrid>
        <StatTile
          label={cycle.label}
          value={dueIn < 0 ? `${Math.abs(dueIn)}d overdue` : `${dueIn}d left`}
          icon={CalendarClock}
          hint="Counts run on the 10th and the 25th"
        />
        <StatTile
          label="Inbound damage rate"
          value={damage.rate == null ? '—' : percent(damage.rate)}
          icon={AlertTriangle}
          hint={`${num(damage.damaged)} unit${damage.damaged === 1 ? '' : 's'} graded short of good`}
        />
        <StatTile
          label="Units taken in"
          value={num(damage.received)}
          icon={ArrowDownToLine}
          hint="Counted onto the dock and graded"
        />
        <StatTile
          label="Awaiting inspection"
          value={num(receipts.filter((r) => r.status === 'Pending Inspection' || r.status === 'Inspecting').length)}
          icon={ClipboardCheck}
          hint="Deliveries still open on the dock"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Daily throughput"
          subtitle="Units received and issued, from the stock movement log"
          height={300}
          table={{
            columns: [
              { key: 'day', label: 'Day' },
              { key: 'received', label: 'Received', align: 'right' },
              { key: 'issued', label: 'Issued', align: 'right' },
              { key: 'movements', label: 'Movements', align: 'right' },
            ],
            rows: throughput,
          }}
          footer={
            <span>
              {num(kpis.movements)} movement{kpis.movements === 1 ? '' : 's'} across{' '}
              <strong className="text-ink">
                {activeDays} active day{activeDays === 1 ? '' : 's'}
              </strong>
            </span>
          }
        >
          <BarSeriesChart
            data={throughput}
            xKey="day"
            format="number"
            series={[
              { key: 'received', label: 'Received', slot: 1 },
              { key: 'issued', label: 'Issued', slot: 2 },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Stock health"
          subtitle="Stock lines by status"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Status' },
              { key: 'value', label: 'Lines', align: 'right' },
            ],
            rows: statusMix,
          }}
        >
          {statusMix.length === 0 ? (
            <EmptyState title="Nothing in stock" description="Post a goods receipt and stock appears here." />
          ) : (
            <DonutChart
              data={statusMix}
              format="number"
              centerValue={num(statusMix.reduce((s, m) => s + m.value, 0))}
              centerLabel="Stock lines"
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Value by category"
          subtitle="Where the inventory money is tied up"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Category' },
              { key: 'value', label: 'Value', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: valueByCategory,
          }}
        >
          <RankedBars data={valueByCategory} slot={1} />
        </ChartCard>

        <Card data-print="keep">
          <CardHeader title="Warehouses" subtitle="Stock value and pallet occupancy per site" />
          <div className="divide-y divide-line border-t border-line">
            {valueByWarehouse.length === 0 && (
              <EmptyState
                icon={WarehouseIcon}
                title="No warehouses yet"
                description="Add a site under Warehouses & Bins."
              />
            )}
            {valueByWarehouse.map((w) => (
              <div key={w.code} className="px-4 py-3 sm:px-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-ink">{w.name}</p>
                  <p className="tabular shrink-0 text-[13px] font-medium text-ink">
                    {moneyCompact(w.value)}
                  </p>
                </div>

                {w.utilisation === null ? (
                  <p className="mt-1.5 text-[11px] text-ink-3">Pallet capacity not recorded</p>
                ) : (
                  <>
                    <ProgressBar
                      className="mt-1.5"
                      value={Math.min(100, w.utilisation)}
                      tone={w.utilisation >= 90 ? 'critical' : w.utilisation >= 75 ? 'warning' : 'good'}
                    />
                    <p className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
                      <span>
                        {w.code} · {num(w.skus)} stock line{w.skus === 1 ? '' : 's'} · {num(w.bins)} bin
                        {w.bins === 1 ? '' : 's'}
                      </span>
                      <span className="tabular">
                        {num(w.usedPallets)} of {num(w.capacityPallets)} pallets
                      </span>
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {expiring.length > 0 && (
        <Card data-print="keep">
          <CardHeader
            title="Nearing expiry"
            subtitle="Batches within 60 days — move them, discount them or write them down"
            action={<Badge tone="warning">{num(expiring.length)}</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {expiring.map((e) => (
              <div key={`${e.sku}-${e.batch ?? 'none'}`} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{e.name}</p>
                  <p className="text-[11px] text-ink-3">
                    {e.sku} · {e.warehouse}
                    {e.batch ? ` · batch ${e.batch}` : ''}
                  </p>
                </div>
                <Badge tone={(e.daysLeft ?? 99) <= 14 ? 'critical' : 'warning'}>
                  {e.daysLeft === null ? 'no date' : `${e.daysLeft} days`}
                </Badge>
                <span className="tabular shrink-0 text-[13px] text-ink-2">{num(e.onHand)} units</span>
                <span className="tabular shrink-0 text-[13px] font-medium text-ink">
                  {money(e.value, { decimals: false })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </DashboardShell>
  )
}
