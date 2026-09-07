import * as React from 'react'
import {
  ArrowRightLeft,
  Award,
  PackageCheck,
  Banknote,
  GitBranch,
  Megaphone,
  Percent,
  Plus,
  ShoppingCart,
  Target as TargetIcon,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react'
import { dataset } from '@/data/dataset'
import { salesDashboard, type SalesDashboard } from '@/data/analytics'
import { daysUntil, money, moneyCompact, num, percent, signedPercent } from '@/lib/format'
import {
  PIPELINE_STAGES,
  type Campaign,
  type Delivery,
  type Lead,
  type PriceRow,
  type Quotation,
  type ReturnDoc,
  type SalesOrder,
  type SalesTarget,
} from '@/data/transactions'
import type { Customer } from '@/data/master'
import {
  ChartCard,
  DonutChart,
  RankedBars,
  TrendChart,
  BarSeriesChart,
} from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import {
  DashboardShell,
  type FullPeriod,
  type Grain,
  type ReportOption,
} from '@/components/dashboard/DashboardShell'
import { ResourcePage } from '@/components/data/ResourcePage'
import { queryClient, useResource } from '@/lib/api'
import { convertQuotation, dashboardWindowQuery, liveApi, releaseOrder } from '@/lib/adminApi'
import { cols } from '@/components/data/columns'
import { RecordForm } from '@/components/data/RecordForm'
import * as forms from './forms'
import { CustomerDetail } from './CustomerDetail'
import { RoutePlanPanel } from './RoutePlan'
import { EmptyState, ErrorState, SkeletonDashboard, useToast } from '@/components/ui/feedback'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar, Badge, Button, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

/** Formats a KPI that the system genuinely has no data for yet. */
const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

function Dashboard() {
  const [period, setPeriod] = React.useState<FullPeriod>('last_12m')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [grain, setGrain] = React.useState<Grain | null>(null)

  // One request, one payload: every figure below is aggregated server-side from
  // the same orders, leads and targets the list pages show, over exactly the
  // window the Period + Bucket filter asks for.
  const endpoint = `sales/dashboard?${dashboardWindowQuery(period, { from, to, grain: grain ?? undefined })}`
  const { data, isLoading, error, refetch } = useResource<SalesDashboard>(endpoint, salesDashboard, {
    enabled: period !== 'custom' || (!!from && !!to),
  })

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { kpis, trend: fullTrend, channels, customers, pipeline, window: win } = data
  const targets = data.targets.slice().sort((a, b) => b.attainment - a.attainment)

  const periodRevenue = fullTrend.reduce((sum, r) => sum + r.revenue, 0)
  const periodTarget = fullTrend.reduce((sum, r) => sum + r.target, 0)
  const periodProfit = fullTrend.reduce((sum, r) => sum + r.grossProfit, 0)

  // Guards for the empty install: a fresh database has no orders, and dividing
  // by a zero target would put NaN% on the screen.
  const safe = (numerator: number, denominator: number) => (denominator ? (numerator / denominator) * 100 : 0)
  const channelTotal = channels.reduce((s, c) => s + c.value, 0)

  const reportOptions: ReportOption[] = [
    {
      id: 'kpis',
      label: 'Executive summary',
      description: 'Headline revenue, margin, pipeline and win-rate figures.',
      build: () => [
        {
          kind: 'summary',
          title: 'Executive Summary',
          items: [
            { label: 'Revenue (period)', value: money(periodRevenue, { decimals: false }), note: `${percent(safe(periodRevenue, periodTarget))} of target` },
            { label: 'Gross profit', value: money(periodProfit, { decimals: false }), note: `${percent(safe(periodProfit, periodRevenue))} margin` },
            { label: 'Open pipeline', value: money(kpis.openPipeline, { decimals: false }) },
            { label: 'Win rate', value: percent(kpis.winRate) },
            { label: 'Average order value', value: money(kpis.avgOrderValue, { decimals: false }) },
            { label: 'Active customers', value: num(kpis.activeCustomers) },
            { label: 'Open quotations', value: num(kpis.openQuotes) },
            { label: 'On-time delivery', value: orDash(kpis.onTimeDelivery, percent) },
          ],
        },
      ],
    },
    {
      id: 'trend',
      label: 'Revenue vs target by month',
      description: 'Month-by-month revenue, cost of sales, gross profit and target.',
      build: () => [
        {
          kind: 'table',
          title: 'Revenue vs Target',
          columns: ['Month', 'Revenue', 'Cost of sales', 'Gross profit', 'Margin', 'Target', 'Variance'],
          rows: fullTrend.map((r) => [
            r.month,
            money(r.revenue, { decimals: false }),
            money(r.cost, { decimals: false }),
            money(r.grossProfit, { decimals: false }),
            percent(safe(r.grossProfit, r.revenue)),
            money(r.target, { decimals: false }),
            money(r.revenue - r.target, { decimals: false }),
          ]),
          total: [
            'TOTAL',
            money(periodRevenue, { decimals: false }),
            money(fullTrend.reduce((s, r) => s + r.cost, 0), { decimals: false }),
            money(periodProfit, { decimals: false }),
            percent(safe(periodProfit, periodRevenue)),
            money(periodTarget, { decimals: false }),
            money(periodRevenue - periodTarget, { decimals: false }),
          ],
        },
      ],
    },
    {
      id: 'channels',
      label: 'Revenue by channel',
      description: 'Share of revenue across supermarket, wholesale, HoReCa and more.',
      build: () => [
        {
          kind: 'table',
          title: 'Revenue by Channel',
          columns: ['Channel', 'Revenue', 'Share'],
          rows: channels.map((c) => [
            c.name,
            money(c.value, { decimals: false }),
            percent(safe(c.value, channelTotal)),
          ]),
        },
      ],
    },
    {
      id: 'customers',
      label: 'Top customers',
      description: 'Highest-billing accounts for the period.',
      build: () => [
        {
          kind: 'table',
          title: 'Top Customers',
          columns: ['Rank', 'Customer', 'Revenue'],
          rows: customers.map((c, i) => [i + 1, c.name, money(c.value, { decimals: false })]),
        },
      ],
    },
    {
      id: 'pipeline',
      label: 'Pipeline by stage',
      description: 'Open opportunity value and probability-weighted forecast.',
      build: () => [
        {
          kind: 'table',
          title: 'Pipeline by Stage',
          columns: ['Stage', 'Opportunities', 'Value', 'Weighted forecast'],
          rows: pipeline.map((p) => [p.stage, p.count, money(p.value, { decimals: false }), money(p.weighted, { decimals: false })]),
          total: [
            'TOTAL',
            pipeline.reduce((s, p) => s + p.count, 0),
            money(pipeline.reduce((s, p) => s + p.value, 0), { decimals: false }),
            money(pipeline.reduce((s, p) => s + p.weighted, 0), { decimals: false }),
          ],
        },
      ],
    },
    {
      id: 'reps',
      label: 'Quota attainment by representative',
      description: 'Quota, actual, attainment and payable commission.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Quota Attainment',
          columns: ['Representative', 'Territory', 'Quota', 'Actual', 'Attainment', 'Commission'],
          rows: targets.map((t) => [
            t.rep,
            t.territory,
            money(t.quota, { decimals: false }),
            money(t.actual, { decimals: false }),
            percent(t.attainment),
            money(t.commission, { decimals: false }),
          ]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Sales & Marketing"
      description="Revenue performance, pipeline health and commercial execution across every channel and territory."
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
      reportTitle="Sales Performance Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'sales-dashboard',
        rows: fullTrend,
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Revenue', value: (r) => r.revenue },
          { header: 'Cost of sales', value: (r) => r.cost },
          { header: 'Gross profit', value: (r) => r.grossProfit },
          { header: 'Target', value: (r) => r.target },
        ],
      }}
    >
      <StatGrid>
        <StatTile
          label="Revenue this period"
          value={moneyCompact(kpis.revenueMtd)}
          delta={kpis.revenueChange}
          icon={TrendingUp}
          spark={{ data: fullTrend, dataKey: 'revenue' }}
        />
        <StatTile
          label="Gross margin"
          value={percent(kpis.grossMargin)}
          icon={Percent}
          hint="Target 22.0%"
          progress={{ value: safe(kpis.grossMargin, 22), target: '22.0%', tone: kpis.grossMargin >= 22 ? 'good' : 'warning' }}
        />
        <StatTile
          label="Open pipeline"
          value={moneyCompact(kpis.openPipeline)}
          icon={GitBranch}
          hint={`${num(kpis.openOpportunities)} open ${kpis.openOpportunities === 1 ? 'opportunity' : 'opportunities'}`}
        />
        <StatTile label="Win rate" value={percent(kpis.winRate)} icon={Award} hint="Closed-won vs closed-lost" />
      </StatGrid>

      <StatGrid>
        <StatTile label="Average order value" value={moneyCompact(kpis.avgOrderValue)} icon={ShoppingCart} hint="All confirmed orders" />
        <StatTile label="Orders this period" value={num(kpis.ordersThisMonth)} icon={Banknote} hint="Confirmed and delivered" />
        <StatTile label="Active customers" value={num(kpis.activeCustomers)} icon={Users} hint="Trading in the last 12 months" />
        <StatTile
          label="On-time delivery"
          value={orDash(kpis.onTimeDelivery, percent)}
          icon={Truck}
          hint={kpis.onTimeDelivery === null ? 'No completed deliveries yet' : 'Against promised date'}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Revenue vs target"
          subtitle="Monthly billed revenue against the approved plan"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'target', label: 'Target', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'grossProfit', label: 'Gross profit', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: fullTrend,
          }}
          footer={
            <span>
              Period revenue <strong className="text-ink">{moneyCompact(periodRevenue)}</strong> ·{' '}
              {periodTarget > 0 ? `${signedPercent(safe(periodRevenue - periodTarget, periodTarget))} vs target` : 'no quota set for the period'}
            </span>
          }
        >
          <TrendChart
            data={fullTrend}
            xKey="month"
            series={[
              { key: 'revenue', label: 'Revenue', slot: 1, kind: 'area' },
              { key: 'target', label: 'Target', slot: 2, kind: 'line', dashed: true },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Revenue by channel"
          subtitle="Where the revenue comes from"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Channel' },
              { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: channels,
          }}
        >
          <DonutChart data={channels} centerValue={moneyCompact(channelTotal)} centerLabel="Total revenue" />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Top customers"
          subtitle="Highest billed accounts over the trailing year"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Customer' },
              { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: customers,
          }}
        >
          <RankedBars data={customers} slot={1} />
        </ChartCard>

        <ChartCard
          title="Pipeline by stage"
          subtitle="Open opportunity value and weighted forecast"
          height={300}
          table={{
            columns: [
              { key: 'stage', label: 'Stage' },
              { key: 'count', label: 'Deals', align: 'right' },
              { key: 'value', label: 'Value', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'weighted', label: 'Weighted', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: pipeline,
          }}
          footer={
            <span>
              Weighted forecast{' '}
              <strong className="text-ink">{moneyCompact(kpis.weightedForecast)}</strong>
            </span>
          }
        >
          <BarSeriesChart
            data={pipeline}
            xKey="stage"
            series={[
              { key: 'value', label: 'Open value', slot: 1 },
              { key: 'weighted', label: 'Weighted forecast', slot: 2 },
            ]}
          />
        </ChartCard>
      </div>

      <Card data-print="keep">
        <CardHeader title="Quota attainment" subtitle="Sales representatives ranked by attainment against quota" />
        <div className="divide-y divide-line border-t border-line">
          {targets.length === 0 && (
            <EmptyState
              icon={TargetIcon}
              title="No quotas set for this year"
              description="Set a quota per representative under Targets & Commissions and attainment appears here."
            />
          )}
          {targets.slice(0, 8).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <Avatar name={t.rep} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-ink">{t.rep}</p>
                  <p className="tabular shrink-0 text-[13px] font-medium text-ink">{percent(t.attainment)}</p>
                </div>
                <ProgressBar
                  className="mt-1.5"
                  value={t.attainment}
                  tone={t.attainment >= 100 ? 'good' : t.attainment >= 85 ? 'brand' : t.attainment >= 65 ? 'warning' : 'critical'}
                />
                <p className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
                  <span>{t.territory}</span>
                  <span className="tabular">
                    {moneyCompact(t.actual)} of {moneyCompact(t.quota)}
                  </span>
                </p>
              </div>
              <Badge tone={t.status === 'Achieved' ? 'good' : t.status === 'On Track' ? 'info' : t.status === 'At Risk' ? 'warning' : 'critical'}>
                {t.status}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </DashboardShell>
  )
}

/* ========================================================================== */
/* Pipeline board                                                             */
/* ========================================================================== */

function Pipeline() {
  const { data: leads = [], isLoading } = useResource<Lead[]>('sales/leads', () => dataset().leads)
  const openStages = PIPELINE_STAGES.filter((s) => !s.startsWith('Closed'))
  const boardRef = React.useRef<HTMLDivElement>(null)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null)
  const canWrite = liveApi()

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['resource', 'sales/leads'] })

  const openLead = (lead?: Lead) => {
    setEditing((lead as unknown as Record<string, unknown>) ?? null)
    setFormOpen(true)
  }

  const open = leads.filter((l) => !l.stage.startsWith('Closed'))
  const totalOpen = open.reduce((s, l) => s + l.value, 0)

  return (
    <div ref={boardRef}>
      <PageHeader
        title="Leads & Pipeline"
        description="Every open opportunity by stage, with the probability-weighted forecast for the quarter."
        meta={
          <>
            <Badge tone="brand">{moneyCompact(totalOpen)} open</Badge>
            <Badge tone="neutral">
              {open.length} {open.length === 1 ? 'opportunity' : 'opportunities'}
            </Badge>
          </>
        }
        actions={
          canWrite && (
            <Button variant="primary" size="sm" onClick={() => openLead()}>
              <Plus className="size-3.5" />
              New opportunity
            </Button>
          )
        }
      />

      {/* Horizontal board that scrolls inside itself — the page never does. */}
      <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:-mx-5 sm:px-5">
        <div className="flex min-w-max gap-3">
          {openStages.map((stage, i) => {
            const stageLeads = leads.filter((l) => l.stage === stage)
            const stageValue = stageLeads.reduce((s, l) => s + l.value, 0)
            return (
              <section key={stage} className="flex w-[19rem] shrink-0 flex-col" data-print="keep">
                <header className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: `var(--series-${i + 1})` }}
                      aria-hidden
                    />
                    {stage}
                  </span>
                  <span className="tabular text-[11px] text-ink-3">
                    {stageLeads.length} · {moneyCompact(stageValue)}
                  </span>
                </header>

                <div className="space-y-2">
                  {stageLeads.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onOpen={canWrite ? () => openLead(lead) : undefined} />
                  ))}
                  {stageLeads.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line py-8 text-center text-xs text-ink-3">
                      {isLoading ? 'Loading…' : 'No opportunities'}
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <RecordForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
        endpoint="sales/leads"
        title="opportunity"
        fields={forms.leadFields}
        defaults={forms.leadDefaults}
        record={editing}
      />
    </div>
  )
}

function LeadCard({ lead, onOpen }: { lead: Lead; onOpen?: () => void }) {
  return (
    <article
      onClick={onOpen}
      className="card cursor-pointer p-3 transition-shadow hover:shadow-[var(--shadow-pop)]"
    >
      <p className="truncate text-[13px] font-medium text-ink">{lead.company}</p>
      <p className="mt-0.5 truncate text-[11px] text-ink-3">{lead.contact}</p>

      <p className="mt-2.5 text-[15px] font-semibold text-ink">{moneyCompact(lead.value)}</p>

      <div className="mt-2">
        <ProgressBar value={lead.probability} tone={lead.probability >= 70 ? 'good' : lead.probability >= 40 ? 'brand' : 'warning'} />
        <p className="mt-1 text-[11px] text-ink-3">{lead.probability}% probability</p>
      </div>

      <p className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-3">
        Next: <span className="text-ink-2">{lead.nextStep || 'not set'}</span>
      </p>

      <div className="mt-2 flex items-center gap-2">
        <Avatar name={lead.owner} size="xs" />
        <span className="truncate text-[11px] text-ink-3">{lead.owner || 'Unassigned'}</span>
        <Badge tone="neutral" className="ml-auto shrink-0">
          {lead.source}
        </Badge>
      </div>
    </article>
  )
}

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

function Customers() {
  const c = cols<Customer>()
  return (
    <ResourcePage
      title="Customers"
      description="Trading accounts with credit exposure, payment terms and assigned representative."
      endpoint="sales/customers"
      loader={() => dataset().customers}
      exportName="customers"
      createLabel="New customer"
      formFields={forms.customerFields}
      formDefaults={forms.customerDefaults}
      formTitle="customer"
      filters={[
        { columnId: 'channel', label: 'Channel' },
        { columnId: 'region', label: 'Region' },
        { columnId: 'status', label: 'Status' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Accounts" value={num(rows.length)} icon={Users} hint={`${num(rows.filter((r) => r.status === 'Active').length)} active`} />
          <StatTile
            label="Credit extended"
            value={moneyCompact(rows.reduce((s, r) => s + r.creditLimit, 0))}
            icon={Banknote}
          />
          <StatTile
            label="Outstanding balance"
            value={moneyCompact(rows.reduce((s, r) => s + r.balance, 0))}
            icon={Percent}
            hint={`${num(rows.filter((r) => r.creditLimit > 0 && r.balance >= r.creditLimit * 0.9).length)} near their limit`}
          />
          <StatTile label="On hold" value={num(rows.filter((r) => r.status === 'On Hold').length)} icon={TargetIcon} />
        </StatGrid>
      )}
      detailSize="xl"
      renderDetail={(row) => <CustomerDetail row={row} />}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.code} · ${row.channel}`}
      columns={[
        c.primary('name', 'Customer', (row) => `${row.code} · ${row.city}`),
        c.tag('channel', 'Channel', 'info'),
        c.text('region', 'Region', { secondary: true }),
        c.text('terms', 'Terms', { secondary: true }),
        c.money('creditLimit', 'Credit limit', { compact: true, secondary: true }),
        c.money('balance', 'Balance', { compact: true, bold: true }),
        c.money('ytdSales', 'YTD sales', { compact: true }),
        c.text('salesRep', 'Representative', { secondary: true }),
        c.date('lastOrder', 'Last order', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * Converts an accepted quotation into an order.
 *
 * The whole point of quoting is that the order should not be retyped: the API
 * copies the lines at their quoted prices, re-reads unit cost from the item
 * master so margin stays honest, and marks the quotation Won.
 */
function ConvertQuotation({ row, done }: { row: Quotation; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  // Only an offer the customer has actually accepted should become an order.
  if (!['Approved', 'Submitted'].includes(row.status)) return null

  const convert = async () => {
    setBusy(true)
    try {
      const order = await convertQuotation(row.id)
      toast({
        tone: 'success',
        title: `${order.no} created`,
        description: `${money(order.total)} · ${percent(order.marginPct)} margin`,
      })
      queryClient.invalidateQueries({ queryKey: ['resource', 'sales/orders'] })
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not convert', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={convert}>
      <ArrowRightLeft className="size-3.5" />
      Convert to order
    </Button>
  )
}

function Quotations() {
  const c = cols<Quotation>()
  return (
    <ResourcePage
      title="Quotations"
      description="Priced offers awaiting customer decision, with validity and approval state."
      endpoint="sales/quotations"
      loader={() => dataset().quotations}
      exportName="quotations"
      createLabel="New quotation"
      formFields={forms.quotationFields}
      formDefaults={forms.quotationDefaults}
      formTitle="quotation"
      formLines={{ itemsEndpoint: 'warehouse/items', priceField: 'sellPrice' }}
      filters={[{ columnId: 'status', label: 'Status' }]}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Open quotations" value={num(rows.filter((r) => ['Draft', 'Submitted', 'Approved'].includes(r.status)).length)} icon={Percent} />
          <StatTile
            label="Value quoted"
            value={moneyCompact(rows.reduce((s, r) => s + r.amount, 0))}
            icon={Banknote}
          />
          <StatTile
            label="Won"
            value={num(rows.filter((r) => r.status === 'Won').length)}
            icon={Award}
            hint={`${percent(rows.length ? (rows.filter((r) => r.status === 'Won').length / rows.length) * 100 : 0)} of all quotes`}
          />
          <StatTile
            label="Expiring soon"
            value={num(rows.filter((r) => r.validUntil && daysUntil(r.validUntil) >= 0 && daysUntil(r.validUntil) <= 7).length)}
            icon={TargetIcon}
            hint="Valid for 7 days or less"
          />
        </StatGrid>
      )}
      detailActions={(row, done) => <ConvertQuotation row={row} done={done} />}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.customer}
      columns={[
        c.primary('no', 'Quotation', (row) => row.customer),
        c.date('date', 'Issued'),
        c.date('validUntil', 'Valid until', { overdueWhenPast: true }),
        c.number('lines', 'Lines', { secondary: true }),
        c.money('amount', 'Amount', { bold: true }),
        c.percent('margin', 'Margin', { warnBelow: 12 }),
        c.text('owner', 'Owner', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * Hands a confirmed order to the warehouse.
 *
 * From this point the floor owns the order's progress — as the pick list moves
 * Released → Picking → Packed → Staged → Dispatched, the fulfilment bar on
 * this page follows it, and nobody in Sales types a percentage.
 */
function ReleaseOrder({ row, done }: { row: SalesOrder; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (['Draft', 'Cancelled', 'Delivered'].includes(row.status)) return null

  const release = async () => {
    setBusy(true)
    try {
      const pick = await releaseOrder(row.id)
      toast({
        tone: 'success',
        title: `${pick.no} released`,
        description: `${pick.lines} line${pick.lines === 1 ? '' : 's'} to ${pick.warehouse}`,
      })
      queryClient.invalidateQueries({ queryKey: ['resource', 'warehouse/outbound'] })
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not release', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={busy} onClick={release}>
      <PackageCheck className="size-3.5" />
      Release to warehouse
    </Button>
  )
}

function Orders() {
  const c = cols<SalesOrder>()
  return (
    <ResourcePage
      title="Sales Orders"
      description="Confirmed customer orders, their allocation against stock and fulfilment progress."
      endpoint="sales/orders"
      loader={() => dataset().salesOrders}
      exportName="sales-orders"
      createLabel="New order"
      formFields={forms.orderFields}
      formDefaults={forms.orderDefaults}
      formTitle="sales order"
      formLines={{ itemsEndpoint: 'warehouse/items', priceField: 'sellPrice' }}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'warehouse', label: 'Warehouse' },
      ]}
      stats={(rows) => {
        const billed = rows.filter((r) => r.status !== 'Draft' && r.status !== 'Cancelled')
        const value = billed.reduce((s, r) => s + r.amount, 0)
        const cost = billed.reduce((s, r) => s + r.cost, 0)
        return (
          <StatGrid>
            <StatTile label="Order value" value={moneyCompact(value)} icon={Banknote} hint={`${num(billed.length)} billable`} />
            <StatTile
              label="Gross margin"
              value={percent(value ? ((value - cost) / value) * 100 : 0)}
              icon={Percent}
              hint={`${moneyCompact(value - cost)} profit`}
            />
            <StatTile label="Awaiting fulfilment" value={num(rows.filter((r) => r.fulfilled < 100 && r.status !== 'Cancelled' && r.status !== 'Draft').length)} icon={Truck} />
            <StatTile
              label="Past promised date"
              value={num(rows.filter((r) => r.promisedDate && daysUntil(r.promisedDate) < 0 && r.status !== 'Delivered' && r.status !== 'Cancelled').length)}
              icon={TargetIcon}
              hint="Undelivered and overdue"
            />
          </StatGrid>
        )
      }}
      detailActions={(row, done) => <ReleaseOrder row={row} done={done} />}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.customer} · ${row.warehouse}`}
      columns={[
        c.primary('no', 'Order', (row) => row.customer),
        c.date('date', 'Order date'),
        c.date('promisedDate', 'Promised', { overdueWhenPast: true }),
        c.text('warehouse', 'Warehouse', { secondary: true }),
        c.number('lines', 'Lines', { secondary: true }),
        c.money('amount', 'Amount', { bold: true }),
        c.percent('margin', 'Margin', { warnBelow: 10 }),
        c.progress('fulfilled', 'Fulfilled', {
          tone: (v) => (v === 100 ? 'good' : v === 0 ? 'warning' : 'brand'),
        }),
        c.status(),
      ]}
    />
  )
}

function Deliveries() {
  const c = cols<Delivery>()
  return (
    <ResourcePage
      title="Deliveries"
      description="Dispatch schedule, assigned vehicle and driver, and proof-of-delivery status."
      endpoint="sales/deliveries"
      loader={() => dataset().deliveries}
      exportName="deliveries"
      createLabel="New delivery"
      formFields={forms.deliveryFields}
      formDefaults={forms.deliveryDefaults}
      formTitle="delivery"
      formExtras={(values) => <RoutePlanPanel values={values} />}
      filters={[{ columnId: 'status', label: 'Status' }]}
      stats={(rows) => {
        const planned = rows.filter((r) => (r.distanceKm ?? 0) > 0)
        return (
          <StatGrid>
            <StatTile label="In transit" value={num(rows.filter((r) => r.status === 'In Transit').length)} icon={Truck} hint={`${num(rows.filter((r) => r.status === 'Scheduled').length)} scheduled`} />
            <StatTile
              label="Distance planned"
              value={`${num(planned.reduce((s, r) => s + (r.distanceKm ?? 0), 0))} km`}
              icon={TargetIcon}
              hint={`${num(planned.length)} run${planned.length === 1 ? '' : 's'} costed`}
            />
            <StatTile
              label="Fuel budget"
              value={moneyCompact(rows.reduce((s, r) => s + (r.fuelCost ?? 0), 0))}
              icon={Banknote}
              hint={`${num(rows.reduce((s, r) => s + (r.fuelLitres ?? 0), 0), 1)} litres`}
            />
            <StatTile
              label="Awaiting proof of delivery"
              value={num(rows.filter((r) => r.status === 'Delivered' && !r.podReceived).length)}
              icon={Percent}
              hint="Signed POD not yet received"
            />
          </StatGrid>
        )
      }}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.customer}
      columns={[
        c.primary('no', 'Delivery', (row) => row.soNo),
        c.text('customer', 'Customer'),
        c.date('scheduled', 'Scheduled'),
        c.text('vehicle', 'Vehicle', { secondary: true }),
        c.text('driver', 'Driver', { secondary: true }),
        c.number('pallets', 'Pallets'),
        c.status(),
      ]}
    />
  )
}

function Returns() {
  const c = cols<ReturnDoc>()
  return (
    <ResourcePage
      title="Returns (RMA)"
      description="Customer returns with reason, disposition and the credit note they generate."
      endpoint="sales/returns"
      loader={() => dataset().returns}
      exportName="returns"
      createLabel="New RMA"
      formFields={forms.returnFields}
      formDefaults={forms.returnDefaults}
      formTitle="return"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'reason', label: 'Reason' },
        { columnId: 'disposition', label: 'Disposition' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Open RMAs" value={num(rows.filter((r) => ['Submitted', 'Approved'].includes(r.status)).length)} icon={TargetIcon} />
          <StatTile label="Credit value" value={moneyCompact(rows.reduce((s, r) => s + r.amount, 0))} icon={Banknote} />
          <StatTile
            label="Returning to stock"
            value={num(rows.filter((r) => r.disposition === 'Restock').length)}
            icon={Truck}
            hint="Goods fit to sell again"
          />
          <StatTile
            label="Scrapped"
            value={num(rows.filter((r) => r.disposition === 'Scrap').length)}
            icon={Percent}
            hint="Written off"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.customer}
      columns={[
        c.primary('no', 'RMA', (row) => row.customer),
        c.date('date', 'Date'),
        c.text('reason', 'Reason'),
        c.number('qty', 'Quantity'),
        c.money('amount', 'Credit value', { bold: true }),
        c.tag('disposition', 'Disposition', 'neutral', true),
        c.status(),
      ]}
    />
  )
}

function Pricing() {
  const c = cols<PriceRow>()
  return (
    <ResourcePage
      title="Price Lists & Discounts"
      description="Tiered selling prices with the resulting margin, so no discount quietly goes below floor."
      endpoint="sales/price-lists"
      loader={() => dataset().priceRows}
      exportName="price-list"
      createLabel="New price rule"
      formFields={forms.priceFields}
      formDefaults={forms.priceDefaults}
      formTitle="price rule"
      filters={[
        { columnId: 'tier', label: 'Tier' },
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.sku} · ${row.tier}`}
      columns={[
        c.primary('name', 'Item', (row) => row.sku),
        c.tag('tier', 'Tier', 'brand'),
        c.text('category', 'Category', { secondary: true }),
        c.money('listPrice', 'List price'),
        c.percent('discount', 'Discount'),
        c.money('netPrice', 'Net price', { bold: true }),
        c.money('unitCost', 'Unit cost', { secondary: true }),
        c.percent('margin', 'Margin', { warnBelow: 10 }),
        c.date('effective', 'Effective', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Campaigns() {
  const c = cols<Campaign>()
  return (
    <ResourcePage
      title="Marketing Campaigns"
      description="Campaign spend against attributed revenue, so marketing budget is judged on return."
      endpoint="sales/campaigns"
      loader={() => dataset().campaigns}
      exportName="campaigns"
      createLabel="New campaign"
      formFields={forms.campaignFields}
      formDefaults={forms.campaignDefaults}
      formTitle="campaign"
      filters={[
        { columnId: 'channel', label: 'Channel' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => row.channel}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Campaigns running" value={num(rows.filter((r) => r.status === 'Active').length)} icon={Megaphone} />
          <StatTile label="Budget committed" value={moneyCompact(rows.reduce((s, r) => s + r.budget, 0))} icon={Banknote} />
          <StatTile label="Spend to date" value={moneyCompact(rows.reduce((s, r) => s + r.spend, 0))} icon={Percent} />
          <StatTile
            label="Attributed revenue"
            value={moneyCompact(rows.reduce((s, r) => s + r.revenue, 0))}
            icon={TrendingUp}
            hint={`Blended ROI ${(rows.reduce((s, r) => s + r.revenue, 0) / Math.max(1, rows.reduce((s, r) => s + r.spend, 0))).toFixed(2)}×`}
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Campaign', (row) => row.owner),
        c.tag('channel', 'Channel', 'info'),
        c.date('start', 'Start', { secondary: true }),
        c.date('end', 'End', { secondary: true }),
        c.money('budget', 'Budget', { compact: true }),
        c.money('spend', 'Spend', { compact: true }),
        c.number('leads', 'Leads', { secondary: true }),
        c.number('conversions', 'Conversions', { secondary: true }),
        c.money('revenue', 'Revenue', { compact: true, bold: true }),
        c.number('roi', 'ROI', { decimals: 2, suffix: '×' }),
        c.status(),
      ]}
    />
  )
}

function Targets() {
  const c = cols<SalesTarget>()
  return (
    <ResourcePage
      title="Targets & Commissions"
      description="Quota attainment per representative and the commission payable this cycle."
      endpoint="sales/targets"
      loader={() => dataset().targets}
      exportName="sales-targets"
      createLabel="Set quota"
      formFields={forms.targetFields}
      formDefaults={forms.targetDefaults}
      formTitle="target"
      filters={[{ columnId: 'status', label: 'Status' }]}
      detailTitle={(row) => row.rep}
      detailSubtitle={(row) => row.territory}
      stats={(rows) => (
        <StatGrid columns={3}>
          <StatTile label="Total quota" value={moneyCompact(rows.reduce((s, r) => s + r.quota, 0))} icon={TargetIcon} />
          <StatTile
            label="Total actual"
            value={moneyCompact(rows.reduce((s, r) => s + r.actual, 0))}
            icon={TrendingUp}
            hint={`${percent((rows.reduce((s, r) => s + r.actual, 0) / Math.max(1, rows.reduce((s, r) => s + r.quota, 0))) * 100)} attainment`}
          />
          <StatTile label="Commission payable" value={moneyCompact(rows.reduce((s, r) => s + r.commission, 0))} icon={Award} />
        </StatGrid>
      )}
      columns={[
        c.primary('rep', 'Representative', (row) => row.territory),
        c.money('quota', 'Quota', { compact: true }),
        c.money('actual', 'Actual', { compact: true, bold: true }),
        c.progress('attainment', 'Attainment', {
          tone: (v) => (v >= 100 ? 'good' : v >= 85 ? 'brand' : v >= 65 ? 'warning' : 'critical'),
        }),
        c.number('deals', 'Deals', { secondary: true }),
        c.percent('commissionRate', 'Rate', { secondary: true }),
        c.money('commission', 'Commission'),
        c.level('status', 'Standing', {
          Achieved: 'good',
          'On Track': 'info',
          'At Risk': 'warning',
          Behind: 'critical',
        }),
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  customers: Customers,
  pipeline: Pipeline,
  quotations: Quotations,
  orders: Orders,
  deliveries: Deliveries,
  returns: Returns,
  pricing: Pricing,
  campaigns: Campaigns,
  targets: Targets,
}
