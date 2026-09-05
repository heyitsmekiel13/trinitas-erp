import * as React from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Car,
  Fuel as FuelIcon,
  Gauge,
  HardHat,
  Package,
  Timer,
  Wrench,
} from 'lucide-react'
import { maintenanceDashboard, type MaintenanceDashboard } from '@/data/analytics'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart, ChartCard, DonutChart, RankedBars, TrendChart } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, type Period, type ReportOption } from '@/components/dashboard/DashboardShell'
import { useResource } from '@/lib/api'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { Avatar, Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'

/**
 * The Maintenance dashboard.
 *
 * Everything here is derived from documents somebody posted. Uptime is the
 * asset register counted by status, cost is labour plus the parts that were
 * actually issued off a shelf, and compliance is the share of preventive jobs
 * finished before their due date. None of it can flatter the department,
 * because none of it is typed.
 */

/** Formats a KPI the system genuinely has no data for yet. */
const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

export function Dashboard() {
  // The window is fixed at a rolling year server-side, so the period control
  // would be a lie — cost and downtime are always the trailing twelve months.
  const [period, setPeriod] = React.useState<Period>('12m')

  const { data, isLoading, error, refetch } = useResource<MaintenanceDashboard>(
    'maintenance/dashboard',
    maintenanceDashboard,
  )

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { kpis, trend, costByCategory, statusMix, worstAssets, technicians, upcoming, fleetAlerts } = data

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Maintenance summary',
      description: 'Availability, backlog, PM compliance and cost.',
      build: () => [
        {
          kind: 'summary',
          title: 'Maintenance Summary',
          items: [
            { label: 'Asset availability', value: orDash(kpis.assetUptime, percent), note: `${num(kpis.assetsInService)} in service` },
            { label: 'Open work orders', value: num(kpis.openWorkOrders), note: `${num(kpis.overdueWorkOrders)} past due` },
            { label: 'PM compliance', value: orDash(kpis.pmCompliance, percent), note: `${num(kpis.overduePm)} schedules overdue` },
            { label: 'Mean time to repair', value: orDash(kpis.mttrHours, (v) => `${num(v, 1)} h`) },
            { label: 'Downtime logged', value: `${num(kpis.downtimeHours)} h`, note: `${num(kpis.downtimeEvents)} events` },
            { label: 'Maintenance cost', value: money(kpis.maintenanceCost, { decimals: false }), note: `${money(kpis.partsCost, { decimals: false })} in parts` },
            { label: 'Cost of downtime', value: money(kpis.downtimeCost, { decimals: false }) },
            { label: 'Fleet available', value: `${kpis.vehiclesAvailable} / ${kpis.fleetSize}` },
          ],
        },
      ],
    },
    {
      id: 'downtime',
      label: 'Downtime and cost by month',
      description: 'Hours lost and maintenance spend, month by month.',
      build: () => [
        {
          kind: 'table',
          title: 'Downtime & Cost by Month',
          columns: ['Month', 'Downtime hours', 'Jobs completed', 'Maintenance cost'],
          rows: trend.map((t) => [t.month, t.downtimeHours, t.jobsCompleted, money(t.maintenanceCost, { decimals: false })]),
          total: [
            'TOTAL',
            Math.round(trend.reduce((s, t) => s + t.downtimeHours, 0) * 10) / 10,
            trend.reduce((s, t) => s + t.jobsCompleted, 0),
            money(trend.reduce((s, t) => s + t.maintenanceCost, 0), { decimals: false }),
          ],
        },
      ],
    },
    {
      id: 'assets',
      label: 'Costliest assets',
      description: 'Assets ranked by what they have cost to keep running.',
      build: () => [
        {
          kind: 'table',
          title: 'Assets by Maintenance Cost',
          columns: ['Asset', 'Category', 'Jobs', 'Downtime hours', 'Cost', 'Share of acquisition'],
          rows: worstAssets.map((a) => [
            a.name,
            a.category,
            a.jobs,
            a.downtimeHours,
            money(a.value, { decimals: false }),
            a.costRatio === null ? 'not recorded' : percent(a.costRatio),
          ]),
        },
      ],
    },
    {
      id: 'pm',
      label: 'Preventive schedules falling due',
      description: 'Plans overdue or due shortly, with who they are assigned to.',
      build: () => [
        {
          kind: 'table',
          title: 'Preventive Maintenance Due',
          columns: ['Code', 'Asset', 'Task', 'Frequency', 'Due', 'Days left', 'Assigned to', 'Status'],
          rows: upcoming.map((p) => [
            p.code,
            `${p.asset ?? '—'} — ${p.assetName ?? ''}`,
            p.task,
            p.frequency,
            p.due ? fmtDate(p.due) : 'on meter',
            p.daysLeft ?? '—',
            p.assignedTo ?? 'Unassigned',
            p.status,
          ]),
        },
      ],
    },
    {
      id: 'technicians',
      label: 'Technician workload',
      description: 'Open jobs and repair history per technician.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Technician Workload',
          columns: ['Technician', 'Position', 'Open', 'Overdue', 'Completed', 'Hours logged', 'Avg repair', 'Availability'],
          rows: technicians.map((t) => [
            t.name,
            t.position ?? '—',
            t.openJobs,
            t.overdueJobs,
            t.completedJobs,
            t.hoursLogged,
            t.avgRepairHours === null ? '—' : `${t.avgRepairHours} h`,
            t.availability,
          ]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Maintenance"
      description="Asset availability, the maintenance backlog and the cost of keeping the fleet and facility running."
      period={period}
      onPeriodChange={setPeriod}
      reportTitle="Maintenance & Asset Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'maintenance-trend',
        rows: trend,
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Downtime hours', value: (r) => r.downtimeHours },
          { header: 'Jobs completed', value: (r) => r.jobsCompleted },
          { header: 'Maintenance cost', value: (r) => r.maintenanceCost },
        ],
      }}
    >
      <StatGrid>
        <StatTile
          label="Asset availability"
          value={orDash(kpis.assetUptime, percent)}
          icon={Gauge}
          progress={
            kpis.assetUptime === null
              ? undefined
              : {
                  value: (kpis.assetUptime / 95) * 100,
                  target: '95.0%',
                  tone: kpis.assetUptime >= 95 ? 'good' : 'warning',
                }
          }
          hint={`${num(kpis.assetsInService)} asset${kpis.assetsInService === 1 ? '' : 's'} in service`}
        />
        <StatTile
          label="Open work orders"
          value={num(kpis.openWorkOrders)}
          icon={Wrench}
          hint={
            kpis.overdueWorkOrders > 0
              ? `${num(kpis.overdueWorkOrders)} past their due date`
              : `${num(kpis.criticalOpen)} at high or critical priority`
          }
        />
        <StatTile
          label="PM compliance"
          value={orDash(kpis.pmCompliance, percent)}
          icon={CalendarClock}
          hint={
            kpis.pmCompliance === null
              ? 'No preventive job finished yet'
              : `${num(kpis.overduePm)} overdue · ${num(kpis.duePm)} due shortly`
          }
        />
        <StatTile
          label="Mean time to repair"
          value={orDash(kpis.mttrHours, (v) => `${num(v, 1)} h`)}
          icon={Timer}
          hint={kpis.mttrHours === null ? 'No job has recorded downtime' : 'Across completed work orders'}
        />
      </StatGrid>

      <StatGrid>
        <StatTile
          label="Downtime logged"
          value={`${num(kpis.downtimeHours)} h`}
          icon={AlertTriangle}
          hint={`${num(kpis.downtimeEvents)} event${kpis.downtimeEvents === 1 ? '' : 's'} · ${moneyCompact(kpis.downtimeCost)} lost`}
        />
        <StatTile
          label="Maintenance cost"
          value={moneyCompact(kpis.maintenanceCost)}
          icon={Wrench}
          hint={`${moneyCompact(kpis.partsCost)} of it in parts · ${num(kpis.jobsCompleted)} job${kpis.jobsCompleted === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Out of service"
          value={num(kpis.breakdowns + kpis.underMaintenance)}
          icon={HardHat}
          hint={`${num(kpis.breakdowns)} broken down · ${num(kpis.underMaintenance)} being worked on`}
        />
        <StatTile
          label="Fleet available"
          value={`${kpis.vehiclesAvailable} / ${kpis.fleetSize}`}
          icon={Car}
          hint={
            kpis.documentsExpiring > 0
              ? `${num(kpis.documentsExpiring)} with papers expiring`
              : 'Registration and insurance current'
          }
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Downtime by month"
          subtitle="Hours the business lost to stopped equipment"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'downtimeHours', label: 'Downtime (h)', align: 'right' },
              { key: 'jobsCompleted', label: 'Jobs', align: 'right' },
              { key: 'maintenanceCost', label: 'Cost', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: trend,
          }}
          footer={
            <span>
              Hours and money are on different scales, so they are plotted separately below — never on one chart with
              two axes.
            </span>
          }
        >
          <BarSeriesChart
            data={trend}
            xKey="month"
            format="hours"
            series={[{ key: 'downtimeHours', label: 'Downtime hours', slot: 4 }]}
          />
        </ChartCard>

        <ChartCard
          title="Cost by asset category"
          subtitle="Where the maintenance money goes"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Category' },
              { key: 'value', label: 'Cost', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: costByCategory,
          }}
        >
          {costByCategory.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="Nothing costed yet"
              description="Complete a work order and its labour and parts appear here."
            />
          ) : (
            <DonutChart
              data={costByCategory}
              centerValue={moneyCompact(kpis.maintenanceCost)}
              centerLabel="Total cost"
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Maintenance spend"
          subtitle="Labour and parts on completed jobs, by month"
          height={280}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'maintenanceCost', label: 'Cost', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: trend,
          }}
        >
          <TrendChart
            data={trend}
            xKey="month"
            series={[{ key: 'maintenanceCost', label: 'Maintenance cost', slot: 4, kind: 'area' }]}
            showLegend={false}
          />
        </ChartCard>

        <ChartCard
          title="Asset status"
          subtitle="The register, excluding retired assets"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Status' },
              { key: 'value', label: 'Assets', align: 'right' },
            ],
            rows: statusMix,
          }}
        >
          {statusMix.length === 0 ? (
            <EmptyState title="No assets yet" description="Add one to the asset register." />
          ) : (
            <RankedBars data={statusMix} format="number" slot={4} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Costliest assets"
          subtitle="What each has cost to keep running — past its purchase price, the cheapest repair is a replacement"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Asset' },
              { key: 'jobs', label: 'Jobs', align: 'right' },
              { key: 'value', label: 'Cost', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              {
                key: 'costRatio',
                label: 'Of acquisition',
                align: 'right',
                format: (v) => (v === null ? '—' : percent(Number(v))),
              },
            ],
            rows: worstAssets,
          }}
        >
          {worstAssets.length === 0 ? (
            <EmptyState
              icon={Wrench}
              title="No completed jobs"
              description="Assets appear here once work has been done on them."
            />
          ) : (
            <RankedBars data={worstAssets} slot={4} emphasise={0} />
          )}
        </ChartCard>

        <Card data-print="keep">
          <CardHeader title="Technician workload" subtitle="Open jobs and repair history per technician" />
          <div className="divide-y divide-line border-t border-line">
            {technicians.length === 0 && (
              <EmptyState
                icon={HardHat}
                title="No technicians"
                description="Assign employees to the Maintenance department in HR."
              />
            )}
            {technicians.slice(0, 8).map((tech) => (
              <div key={tech.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Avatar name={tech.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-[13px] font-medium text-ink">{tech.name}</p>
                    <p className="tabular shrink-0 text-[13px] text-ink-3">{tech.openJobs} open</p>
                  </div>
                  <ProgressBar
                    className="mt-1.5"
                    value={Math.min(100, (tech.openJobs / 12) * 100)}
                    tone={tech.availability === 'Overloaded' ? 'critical' : tech.availability === 'Busy' ? 'warning' : 'good'}
                  />
                  <p className="mt-1 text-[11px] text-ink-3">
                    {tech.completedJobs} completed · {tech.hoursLogged} h logged
                    {tech.avgRepairHours !== null && ` · ${tech.avgRepairHours} h average repair`}
                    {tech.overdueJobs > 0 && <span className="text-critical"> · {tech.overdueJobs} overdue</span>}
                  </p>
                </div>
                <Badge
                  tone={tech.availability === 'Overloaded' ? 'critical' : tech.availability === 'Busy' ? 'warning' : 'good'}
                >
                  {tech.availability}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {(upcoming.length > 0 || fleetAlerts.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {upcoming.length > 0 && (
            <Card data-print="keep">
              <CardHeader
                title="Preventive work falling due"
                subtitle="Raise these as jobs before they become breakdowns"
                action={<Badge tone="warning">{num(upcoming.length)}</Badge>}
              />
              <div className="divide-y divide-line border-t border-line">
                {upcoming.map((pm) => (
                  <div key={pm.id} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{pm.task}</p>
                      <p className="text-[11px] text-ink-3">
                        {pm.code} · {pm.asset} — {pm.assetName}
                        {pm.assignedTo ? ` · ${pm.assignedTo}` : ' · unassigned'}
                      </p>
                    </div>
                    <Badge tone={pm.status === 'Overdue' ? 'critical' : 'warning'}>
                      {pm.daysLeft === null
                        ? 'on meter'
                        : pm.daysLeft < 0
                          ? `${Math.abs(pm.daysLeft)} days late`
                          : `${pm.daysLeft} days`}
                    </Badge>
                    <span className="tabular shrink-0 text-[13px] text-ink-2">
                      {pm.due ? fmtDate(pm.due) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {fleetAlerts.length > 0 && (
            <Card data-print="keep">
              <CardHeader
                title="Vehicle papers expiring"
                subtitle="A truck with lapsed registration is off the road whatever its condition"
                action={<Badge tone="warning">{num(fleetAlerts.length)}</Badge>}
              />
              <div className="divide-y divide-line border-t border-line">
                {fleetAlerts.map((alert, index) => (
                  <div key={`${alert.plate}-${alert.kind}-${index}`} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">
                        {alert.plate} — {alert.kind}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {alert.code}
                        {alert.model ? ` · ${alert.model}` : ''}
                      </p>
                    </div>
                    <Badge tone={alert.daysLeft <= 14 ? 'critical' : 'warning'}>
                      {alert.daysLeft < 0 ? `${Math.abs(alert.daysLeft)} days expired` : `${alert.daysLeft} days`}
                    </Badge>
                    <span className="tabular shrink-0 text-[13px] text-ink-2">{fmtDate(alert.expires)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {kpis.sparePartsShort > 0 && (
        <Card data-print="keep">
          <CardHeader
            title="Spare parts running short"
            subtitle="A repair blocked waiting on a part is downtime no technician can fix"
            action={
              <Badge tone="warning">
                <Package className="size-3" />
                {num(kpis.sparePartsShort)}
              </Badge>
            }
          />
          <p className="px-4 py-3 text-[13px] text-ink-2 sm:px-5">
            {num(kpis.sparePartsShort)} spare part{kpis.sparePartsShort === 1 ? ' is' : 's are'} at or below the reorder
            point. Raise a requisition from Warehouse → Replenishment.
          </p>
        </Card>
      )}

      {kpis.flaggedFuel > 0 && (
        <Card data-print="keep">
          <CardHeader
            title="Fuel issuances flagged"
            subtitle="Fills well under the vehicle's own running average — a leak or a siphon, and both are worth asking about"
            action={
              <Badge tone="critical">
                <FuelIcon className="size-3" />
                {num(kpis.flaggedFuel)}
              </Badge>
            }
          />
          <p className="px-4 py-3 text-[13px] text-ink-2 sm:px-5">
            {num(kpis.flaggedFuel)} issuance{kpis.flaggedFuel === 1 ? '' : 's'} in the last year fell below 75% of the
            vehicle's baseline economy. They are listed under Fuel & Consumption.
          </p>
        </Card>
      )}
    </DashboardShell>
  )
}
