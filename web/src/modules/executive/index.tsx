import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  ClipboardCheck,
  Gauge,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { DEPARTMENTS } from '@/app/registry'
import { dataset } from '@/data/dataset'
import {
  cashflowTrend,
  departmentScorecard,
  executiveKpis,
  profitTrend,
  revenueByRegion,
  revenueTrend,
} from '@/data/analytics'
import { money, moneyCompact, num, percent } from '@/lib/format'
import { ChartCard, DonutChart, RankedBars, TrendChart } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, slicePeriod, type Period, type ReportOption } from '@/components/dashboard/DashboardShell'
import { Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'

/** Cross-department exceptions the leadership team must see first. */
function useAlerts() {
  return React.useMemo(() => {
    const d = dataset()
    const overdueAr = d.arInvoices.filter((i) => i.daysOverdue > 0)
    const lowStock = d.stock.filter((s) => s.status === 'Low Stock' || s.status === 'Out of Stock')
    const overduePm = d.pmSchedules.filter((p) => p.status === 'Overdue')
    const pendingReq = d.requisitions.filter((r) => r.status === 'For Approval')
    const expiring = d.contracts.filter((c) => c.status === 'Expiring')
    const openCases = d.cases.filter((c) => ['Open', 'Notice Issued', 'Hearing Scheduled'].includes(c.status))

    return [
      {
        tone: 'critical' as const,
        title: `${overdueAr.length} overdue invoices`,
        detail: `${moneyCompact(overdueAr.reduce((s, i) => s + i.balance, 0))} past due`,
        to: '/finance/receivables',
      },
      {
        tone: 'warning' as const,
        title: `${lowStock.length} SKUs below reorder point`,
        detail: 'Replenishment required to protect service level',
        to: '/warehouse/replenishment',
      },
      {
        tone: 'warning' as const,
        title: `${pendingReq.length} requisitions awaiting approval`,
        detail: `${moneyCompact(pendingReq.reduce((s, r) => s + r.amount, 0))} committed value`,
        to: '/procurement/requisitions',
      },
      {
        tone: 'serious' as const,
        title: `${overduePm.length} preventive services overdue`,
        detail: 'Rising breakdown risk across the fleet',
        to: '/maintenance/preventive',
      },
      {
        tone: 'serious' as const,
        title: `${expiring.length} supplier contracts expiring`,
        detail: 'Renew or re-tender within 60 days',
        to: '/procurement/contracts',
      },
      {
        tone: 'neutral' as const,
        title: `${openCases.length} open employee cases`,
        detail: 'Awaiting HR resolution',
        to: '/hr/cases',
      },
    ]
  }, [])
}

function Dashboard() {
  const [period, setPeriod] = React.useState<Period>('12m')

  const kpis = React.useMemo(() => executiveKpis(), [])
  const fullRevenue = React.useMemo(() => revenueTrend(), [])
  const revenue = React.useMemo(() => slicePeriod(fullRevenue, period), [fullRevenue, period])
  const profit = React.useMemo(() => slicePeriod(profitTrend(), period), [period])
  const cashflow = React.useMemo(() => slicePeriod(cashflowTrend(), period), [period])
  const regions = React.useMemo(() => revenueByRegion(), [])
  const scorecard = React.useMemo(() => departmentScorecard(), [])
  const alerts = useAlerts()

  const periodRevenue = revenue.reduce((s, r) => s + r.revenue, 0)
  const periodProfit = profit.reduce((s, r) => s + r.netProfit, 0)

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Company scorecard',
      description: 'Headline financial and operational figures across all departments.',
      build: () => [
        {
          kind: 'summary',
          title: 'Company Scorecard',
          items: [
            { label: 'Revenue', value: money(periodRevenue, { decimals: false }) },
            { label: 'Net profit', value: money(periodProfit, { decimals: false }), note: `${percent((periodProfit / (periodRevenue || 1)) * 100)} margin` },
            { label: 'Cash position', value: money(kpis.finance.cashPosition, { decimals: false }) },
            { label: 'Receivables', value: money(kpis.finance.receivables, { decimals: false }) },
            { label: 'Payables', value: money(kpis.finance.payables, { decimals: false }) },
            { label: 'Inventory value', value: money(kpis.warehouse.inventoryValue, { decimals: false }) },
            { label: 'Headcount', value: num(kpis.hr.headcount) },
            { label: 'Asset uptime', value: percent(kpis.maintenance.assetUptime) },
          ],
        },
      ],
    },
    {
      id: 'departments',
      label: 'Departmental health',
      description: 'Each department’s primary metric against its target.',
      build: () => [
        {
          kind: 'table',
          title: 'Departmental Health',
          columns: ['Department', 'Metric', 'Actual', 'Target', 'Status'],
          rows: scorecard.map((s) => [
            s.department,
            s.metric,
            `${s.value.toFixed(1)}${s.unit}`,
            `${s.target}${s.unit}`,
            s.value >= s.target ? 'On target' : 'Below target',
          ]),
        },
      ],
    },
    {
      id: 'pl',
      label: 'Profit & loss by month',
      description: 'Revenue, cost of sales, operating expense and net profit.',
      build: () => [
        {
          kind: 'table',
          title: 'Profit & Loss Summary',
          columns: ['Month', 'Revenue', 'Cost of sales', 'Operating expense', 'Net profit', 'Margin'],
          rows: profit.map((p) => [
            p.month,
            money(p.revenue, { decimals: false }),
            money(p.cogs, { decimals: false }),
            money(p.opex, { decimals: false }),
            money(p.netProfit, { decimals: false }),
            `${p.marginPct}%`,
          ]),
          total: [
            'TOTAL',
            money(profit.reduce((s, p) => s + p.revenue, 0), { decimals: false }),
            money(profit.reduce((s, p) => s + p.cogs, 0), { decimals: false }),
            money(profit.reduce((s, p) => s + p.opex, 0), { decimals: false }),
            money(periodProfit, { decimals: false }),
            percent((periodProfit / (periodRevenue || 1)) * 100),
          ],
        },
      ],
    },
    {
      id: 'cash',
      label: 'Cash flow',
      description: 'Collections, disbursements and running balance by month.',
      build: () => [
        {
          kind: 'table',
          title: 'Cash Flow',
          columns: ['Month', 'Collections', 'Disbursements', 'Net movement', 'Closing balance'],
          rows: cashflow.map((c) => [
            c.month,
            money(c.inflow, { decimals: false }),
            money(c.outflow, { decimals: false }),
            money(c.net, { decimals: false }),
            money(c.balance, { decimals: false }),
          ]),
        },
      ],
    },
    {
      id: 'alerts',
      label: 'Exceptions requiring attention',
      description: 'Cross-department items that are overdue or at risk.',
      build: () => [
        {
          kind: 'table',
          title: 'Exceptions Requiring Attention',
          columns: ['Item', 'Detail'],
          rows: alerts.map((a) => [a.title, a.detail]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Command Center"
      description="One view of the whole business — financial position, departmental health, and every exception that needs a decision."
      period={period}
      onPeriodChange={setPeriod}
      reportTitle="Executive Management Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'executive-summary',
        rows: profitTrend(),
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Revenue', value: (r) => r.revenue },
          { header: 'Cost of sales', value: (r) => r.cogs },
          { header: 'Operating expense', value: (r) => r.opex },
          { header: 'Net profit', value: (r) => r.netProfit },
        ],
      }}
    >
      <StatGrid>
        <StatTile
          label="Revenue"
          value={moneyCompact(periodRevenue)}
          delta={kpis.sales.revenueChange}
          icon={TrendingUp}
          spark={{ data: fullRevenue, dataKey: 'revenue' }}
        />
        <StatTile
          label="Net profit"
          value={moneyCompact(periodProfit)}
          icon={Banknote}
          hint={`${percent((periodProfit / (periodRevenue || 1)) * 100)} net margin`}
        />
        <StatTile label="Cash position" value={moneyCompact(kpis.finance.cashPosition)} icon={Wallet} hint="Across all bank accounts" />
        <StatTile
          label="Inventory value"
          value={moneyCompact(kpis.warehouse.inventoryValue)}
          icon={Boxes}
          hint={`${num(kpis.warehouse.skuCount)} active SKUs`}
        />
      </StatGrid>

      <StatGrid>
        <StatTile
          label="Overdue receivables"
          value={moneyCompact(kpis.finance.overdueReceivables)}
          icon={AlertTriangle}
          hint="Requires collection action"
        />
        <StatTile
          label="Open purchase commitments"
          value={moneyCompact(kpis.procurement.openPoValue)}
          icon={ClipboardCheck}
          hint={`${kpis.procurement.pendingApprovals} awaiting approval`}
        />
        <StatTile
          label="Asset uptime"
          value={percent(kpis.maintenance.assetUptime)}
          icon={Gauge}
          hint={`${kpis.maintenance.openWorkOrders} open work orders`}
        />
        <StatTile
          label="Headcount"
          value={num(kpis.hr.headcount)}
          icon={Users}
          hint={`${kpis.hr.openPositions} positions open`}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Profitability"
          subtitle="Revenue, cost of sales and net profit by month"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'cogs', label: 'Cost of sales', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'netProfit', label: 'Net profit', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: profit,
          }}
        >
          <TrendChart
            data={profit}
            xKey="month"
            series={[
              { key: 'revenue', label: 'Revenue', slot: 1, kind: 'area' },
              { key: 'cogs', label: 'Cost of sales', slot: 2, kind: 'line' },
              { key: 'netProfit', label: 'Net profit', slot: 3, kind: 'line' },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue by region"
          subtitle="Geographic concentration"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Region' },
              { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: regions,
          }}
        >
          <DonutChart data={regions} centerValue={moneyCompact(regions.reduce((s, r) => s + r.value, 0))} centerLabel="Total" />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Cash movement"
          subtitle="Collections against disbursements, with the closing balance"
          height={280}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'inflow', label: 'Collections', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'outflow', label: 'Disbursements', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'balance', label: 'Closing balance', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: cashflow,
          }}
        >
          <TrendChart
            data={cashflow}
            xKey="month"
            series={[
              { key: 'inflow', label: 'Collections', slot: 1, kind: 'area' },
              { key: 'outflow', label: 'Disbursements', slot: 2, kind: 'area' },
            ]}
          />
        </ChartCard>

        <Card data-print="keep">
          <CardHeader title="Needs attention" subtitle="Exceptions across every department" />
          <div className="divide-y divide-line border-t border-line">
            {alerts.map((alert) => (
              <Link
                key={alert.title}
                to={alert.to}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2 sm:px-5"
              >
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    alert.tone === 'critical'
                      ? 'bg-critical'
                      : alert.tone === 'warning'
                        ? 'bg-warning'
                        : alert.tone === 'serious'
                          ? 'bg-serious'
                          : 'bg-ink-3'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{alert.title}</span>
                  <span className="block truncate text-[11px] text-ink-3">{alert.detail}</span>
                </span>
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card data-print="keep">
        <CardHeader
          title="Departmental health"
          subtitle="Each department’s primary metric measured against its target"
        />
        <div className="grid gap-px overflow-hidden border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
          {scorecard.map((s) => {
            const dept = DEPARTMENTS.find((d) => d.id === s.id)
            const onTarget = s.value >= s.target
            return (
              <Link key={s.id} to={`/${s.id}`} className="group bg-surface p-4 transition-colors hover:bg-surface-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {dept && (
                      <span
                        className="flex size-7 items-center justify-center rounded-lg"
                        style={{ background: `color-mix(in srgb, var(--series-${dept.slot}) 14%, transparent)` }}
                      >
                        <dept.icon className="size-3.5" style={{ color: `var(--series-${dept.slot})` }} />
                      </span>
                    )}
                    <span className="text-[13px] font-medium text-ink">{s.department}</span>
                  </div>
                  <Badge tone={onTarget ? 'good' : 'warning'} dot>
                    {onTarget ? 'On target' : 'Below'}
                  </Badge>
                </div>

                <p className="mt-3 text-[22px] leading-none font-semibold text-ink">
                  {s.value.toFixed(1)}
                  {s.unit}
                </p>
                <p className="mt-1 text-[11px] text-ink-3">
                  {s.metric} · target {s.target}
                  {s.unit}
                </p>
                <ProgressBar
                  className="mt-2.5"
                  value={(s.value / s.target) * 100}
                  tone={onTarget ? 'good' : 'warning'}
                  label={`${s.department} ${s.metric}`}
                />
              </Link>
            )
          })}
        </div>
      </Card>

      <ChartCard
        title="Top customers"
        subtitle="Revenue concentration across the account base"
        height={260}
        table={{
          columns: [
            { key: 'name', label: 'Customer' },
            { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
          ],
          rows: dataset()
            .customers.slice()
            .sort((a, b) => b.ytdSales - a.ytdSales)
            .slice(0, 8)
            .map((c) => ({ name: c.name, value: c.ytdSales })),
        }}
      >
        <RankedBars
          slot={1}
          data={dataset()
            .customers.slice()
            .sort((a, b) => b.ytdSales - a.ytdSales)
            .slice(0, 8)
            .map((c) => ({ name: c.name, value: c.ytdSales, meta: `${c.channel} · ${c.region}` }))}
        />
      </ChartCard>
    </DashboardShell>
  )
}

export const PAGES: Record<string, React.ComponentType> = { '': Dashboard }
