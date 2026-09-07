import * as React from 'react'
import { Building2, ClipboardCheck, FileSignature, Percent, PiggyBank, TrendingDown, Truck } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { procurementDashboard, type ProcurementDashboard } from '@/data/analytics'
import { money, moneyCompact, num, percent } from '@/lib/format'
import type { Supplier } from '@/data/master'
import { BarSeriesChart, ChartCard, DonutChart, RankedBars, TrendChart } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, type FullPeriod, type Grain, type ReportOption } from '@/components/dashboard/DashboardShell'
import { useResource } from '@/lib/api'
import { dashboardWindowQuery } from '@/lib/adminApi'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'

/**
 * The Procurement dashboard.
 *
 * Every figure is aggregated server-side from the same requisitions, orders,
 * receipts and invoices the list pages show, so a chart and a table can never
 * disagree. Supplier scorecards are the one exception: they are master data on
 * the supplier record, so they come from the supplier list directly.
 */

/** Formats a KPI the system genuinely has no data for yet. */
const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

export function Dashboard() {
  const [period, setPeriod] = React.useState<FullPeriod>('last_12m')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [grain, setGrain] = React.useState<Grain | null>(null)

  const endpoint = `procurement/dashboard?${dashboardWindowQuery(period, { from, to, grain: grain ?? undefined })}`
  const { data, isLoading, error, refetch } = useResource<ProcurementDashboard>(endpoint, procurementDashboard, {
    enabled: period !== 'custom' || (!!from && !!to),
  })
  const { data: suppliers = [] } = useResource<Supplier[]>('procurement/suppliers', () => dataset().suppliers)

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { kpis, trend: fullTrend, categories, suppliers: topSuppliers, pipeline, window: win } = data

  const periodSpend = fullTrend.reduce((s, r) => s + r.committed, 0)
  const periodReceived = fullTrend.reduce((s, r) => s + r.received, 0)
  const categoryTotal = categories.reduce((s, c) => s + c.value, 0)

  // A fresh install has no orders; dividing by zero would print NaN%.
  const safe = (numerator: number, denominator: number) => (denominator ? (numerator / denominator) * 100 : 0)
  // Unscored suppliers sort last: an absent score is not a high one.
  const scorecards = suppliers.slice().sort((a, b) => (b.scorecard ?? -1) - (a.scorecard ?? -1))
  const stage = (name: string) => pipeline.find((p) => p.stage === name)

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Procurement summary',
      description: 'Spend, open commitments, savings and payables.',
      build: () => [
        {
          kind: 'summary',
          title: 'Procurement Summary',
          items: [
            { label: 'Spend (period)', value: money(periodSpend, { decimals: false }) },
            {
              label: 'Delivered value',
              value: money(periodReceived, { decimals: false }),
              note: `${percent(safe(periodReceived, periodSpend))} of committed`,
            },
            { label: 'Average order value', value: money(kpis.avgOrderValue, { decimals: false }) },
            {
              label: 'Savings from tender',
              value: money(kpis.savings, { decimals: false }),
              note: `${percent(kpis.savingsRate)} below estimate`,
            },
            { label: 'Active suppliers', value: num(kpis.activeSuppliers) },
            { label: 'Open requisitions', value: num(kpis.openRequisitions) },
            { label: 'Payables outstanding', value: money(kpis.payablesOutstanding, { decimals: false }) },
            { label: 'Supplier on-time', value: orDash(kpis.onTimeDelivery, percent) },
          ],
        },
      ],
    },
    {
      id: 'spend',
      label: 'Spend by month',
      description: 'Committed purchase value against what has actually been delivered.',
      build: () => [
        {
          kind: 'table',
          title: 'Spend by Month',
          columns: ['Month', 'Committed', 'Delivered', 'Outstanding', 'Orders'],
          rows: fullTrend.map((t) => [
            t.month,
            money(t.committed, { decimals: false }),
            money(t.received, { decimals: false }),
            money(t.committed - t.received, { decimals: false }),
            t.orders,
          ]),
          total: [
            'TOTAL',
            money(periodSpend, { decimals: false }),
            money(periodReceived, { decimals: false }),
            money(periodSpend - periodReceived, { decimals: false }),
            fullTrend.reduce((s, t) => s + t.orders, 0),
          ],
        },
      ],
    },
    {
      id: 'pipeline',
      label: 'Purchasing pipeline',
      description: 'Where work is sitting between requisition and delivery.',
      build: () => [
        {
          kind: 'table',
          title: 'Purchasing Pipeline',
          columns: ['Stage', 'Documents', 'Value'],
          rows: pipeline.map((p) => [p.stage, p.count, money(p.value, { decimals: false })]),
          total: [
            'TOTAL',
            pipeline.reduce((s, p) => s + p.count, 0),
            money(pipeline.reduce((s, p) => s + p.value, 0), { decimals: false }),
          ],
        },
      ],
    },
    {
      id: 'category',
      label: 'Spend by category',
      description: 'Where purchasing budget is concentrated.',
      build: () => [
        {
          kind: 'table',
          title: 'Spend by Category',
          columns: ['Category', 'Spend', 'Share'],
          rows: categories.map((c) => [
            c.name,
            money(c.value, { decimals: false }),
            percent(safe(c.value, categoryTotal)),
          ]),
        },
      ],
    },
    {
      id: 'suppliers',
      label: 'Supplier scorecards',
      description: 'On-time, quality, price index and overall score per supplier.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Supplier Scorecards',
          columns: ['Supplier', 'Category', 'On-time %', 'Quality %', 'Price index', 'Score', 'Status'],
          rows: scorecards
            .slice(0, 25)
            .map((s) => [
              s.name,
              s.category ?? '—',
              s.onTimeRate ?? 'no data',
              s.qualityRate ?? 'no data',
              s.priceIndex ?? 'no data',
              s.scorecard ?? 'not scored',
              s.status,
            ]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Procurement"
      description="Purchasing performance, supplier reliability and the commitments already made against budget."
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
      reportTitle="Procurement Performance Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'procurement-dashboard',
        rows: fullTrend,
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Committed', value: (r) => r.committed },
          { header: 'Delivered', value: (r) => r.received },
          { header: 'Purchase orders', value: (r) => r.orders },
        ],
      }}
    >
      <StatGrid>
        <StatTile
          label="Spend this period"
          value={moneyCompact(kpis.spendMtd)}
          delta={kpis.spendChange}
          inverse
          icon={TrendingDown}
          spark={{ data: fullTrend, dataKey: 'committed' }}
        />
        <StatTile
          label="Awaiting delivery"
          value={moneyCompact(stage('Awaiting delivery')?.value ?? 0)}
          icon={ClipboardCheck}
          hint={`${num(stage('Awaiting delivery')?.count ?? 0)} order${stage('Awaiting delivery')?.count === 1 ? '' : 's'} outstanding`}
        />
        <StatTile
          label="Savings from tender"
          value={moneyCompact(kpis.savings)}
          icon={PiggyBank}
          hint={`${percent(kpis.savingsRate)} below estimate`}
        />
        <StatTile
          label="Supplier on-time"
          value={orDash(kpis.onTimeDelivery, percent)}
          icon={Truck}
          hint={kpis.onTimeDelivery === null ? 'Nothing fully received yet' : 'Completed orders vs expected date'}
        />
      </StatGrid>

      <StatGrid>
        <StatTile label="Active suppliers" value={num(kpis.activeSuppliers)} icon={Building2} hint="Accredited and trading" />
        <StatTile
          label="Open requisitions"
          value={num(kpis.openRequisitions)}
          icon={ClipboardCheck}
          hint={`${num(kpis.openRfqs)} out to tender`}
        />
        <StatTile
          label="Invoices matched"
          value={orDash(kpis.matchRate, percent)}
          icon={Percent}
          hint={`${num(kpis.invoicesMatched)} clean three-way match${kpis.invoicesMatched === 1 ? '' : 'es'}`}
        />
        <StatTile
          label="Payables outstanding"
          value={moneyCompact(kpis.payablesOutstanding)}
          icon={FileSignature}
          hint={kpis.invoicesOverdue > 0 ? `${num(kpis.invoicesOverdue)} overdue` : 'None overdue'}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Committed against delivered"
          subtitle="Purchase value ordered each month, and how much of it has arrived"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'committed', label: 'Committed', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'received', label: 'Delivered', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'orders', label: 'Orders', align: 'right' },
            ],
            rows: fullTrend,
          }}
          footer={
            <span>
              Period spend <strong className="text-ink">{moneyCompact(periodSpend)}</strong> ·{' '}
              {percent(safe(periodReceived, periodSpend))} delivered
            </span>
          }
        >
          <TrendChart
            data={fullTrend}
            xKey="month"
            series={[
              { key: 'committed', label: 'Committed', slot: 2, kind: 'area' },
              { key: 'received', label: 'Delivered', slot: 1, kind: 'line' },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Spend by category"
          subtitle="Concentration of purchasing"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Category' },
              { key: 'value', label: 'Spend', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: categories,
          }}
        >
          <DonutChart data={categories} centerValue={moneyCompact(categoryTotal)} centerLabel="Total spend" />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Top suppliers by spend"
          subtitle="Where the purchasing budget goes"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Supplier' },
              { key: 'value', label: 'Spend', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: topSuppliers,
          }}
        >
          <RankedBars data={topSuppliers} slot={2} />
        </ChartCard>

        <ChartCard
          title="Purchasing pipeline"
          subtitle="Value sitting at each stage between requisition and delivery"
          height={300}
          table={{
            columns: [
              { key: 'stage', label: 'Stage' },
              { key: 'count', label: 'Documents', align: 'right' },
              { key: 'value', label: 'Value', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: pipeline,
          }}
        >
          <BarSeriesChart data={pipeline} xKey="stage" series={[{ key: 'value', label: 'Value', slot: 2 }]} />
        </ChartCard>
      </div>

      <Card data-print="keep">
        <CardHeader title="Supplier scorecards" subtitle="Weighted on delivery, quality and price competitiveness" />
        <div className="divide-y divide-line border-t border-line">
          {scorecards.length === 0 && (
            <EmptyState
              icon={Building2}
              title="No suppliers yet"
              description="Add a supplier and their delivery and quality scores appear here."
            />
          )}
          {scorecards.slice(0, 8).map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-ink">{s.name}</p>
                  <p className="tabular shrink-0 text-[13px] font-medium text-ink">
                    {s.scorecard === null ? <span className="text-ink-3">Not scored</span> : `${s.scorecard}/100`}
                  </p>
                </div>
                {s.scorecard !== null && (
                  <ProgressBar
                    className="mt-1.5"
                    value={s.scorecard}
                    tone={s.scorecard >= 88 ? 'good' : s.scorecard >= 76 ? 'brand' : 'warning'}
                  />
                )}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-3">
                  <span>{s.category || 'Uncategorised'}</span>
                  <span className="tabular">On-time {orDash(s.onTimeRate, percent)}</span>
                  <span className="tabular">Quality {orDash(s.qualityRate, percent)}</span>
                </p>
              </div>
              <Badge tone={s.status === 'Active' ? 'good' : s.status === 'Probationary' ? 'warning' : 'critical'}>
                {s.status}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </DashboardShell>
  )
}
