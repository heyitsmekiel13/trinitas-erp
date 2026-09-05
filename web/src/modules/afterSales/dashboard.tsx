import * as React from 'react'
import { Banknote, Fuel, Gauge, Repeat, ShieldCheck, Smile, Target, Timer, TrendingDown, Users, Wrench } from 'lucide-react'
import { money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart, ChartCard, DonutChart, RankedBars } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, type Period, type ReportOption } from '@/components/dashboard/DashboardShell'
import { ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'
import { PRIORITIES } from '@/data/afterSales'
import { useAfterSales } from './useAfterSales'
import { useSixSigma } from './leanSixSigma'

/**
 * The After-Sales dashboard.
 *
 * Built around the one question the revenue workbook cannot answer as it
 * stands: what is a service call actually worth once the truck has been paid
 * for. Fuel, meals and barge are recorded per job and recovered from the
 * client, so they belong beside the revenue rather than in a column nobody
 * totals.
 */
export function Dashboard() {
  const [period, setPeriod] = React.useState<Period>('12m')
  const { isLoading, error, refetch, summary, response, requests } = useAfterSales()
  const quality = useSixSigma()

  const ctq = (id: string) => quality.ctqs.find((c) => c.id === id) ?? null
  const sla = ctq('sla')
  const ftf = ctq('ftf')
  const csat = ctq('csat')

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading) return <SkeletonDashboard />

  const open = requests.filter((r) => r.status !== 'Done' && r.status !== 'Cancelled')
  const fuel = summary.byCost.find((c) => c.name === 'Fuel')?.value ?? 0

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Service summary',
      description: 'Revenue, recovered costs and job mix.',
      build: () => [
        {
          kind: 'summary',
          title: 'After-Sales Summary',
          items: [
            { label: 'Service revenue', value: money(summary.revenue, { decimals: false }) },
            { label: 'Recovered costs', value: money(summary.costs, { decimals: false }) },
            { label: 'Total billed', value: money(summary.billed, { decimals: false }) },
            {
              label: 'Cost ratio',
              value: summary.costRatio === null ? '—' : percent(summary.costRatio),
              note: 'Reimbursables against service revenue',
            },
            { label: 'Jobs recorded', value: num(summary.jobs), note: `${num(summary.billedJobs)} billed` },
            {
              label: 'Average billed job',
              value: summary.averageTicket === null ? '—' : money(summary.averageTicket, { decimals: false }),
            },
          ],
        },
      ],
    },
    {
      id: 'type',
      label: 'Revenue by work type',
      description: 'What the money is earned doing.',
      build: () => [
        {
          kind: 'table',
          title: 'Revenue by Work Type',
          columns: ['Work type', 'Jobs', 'Revenue', 'Share'],
          rows: summary.byType.map((t) => [
            t.name,
            num(t.jobs),
            money(t.value, { decimals: false }),
            percent(summary.revenue ? (t.value / summary.revenue) * 100 : 0),
          ]),
          total: ['TOTAL', num(summary.jobs), money(summary.revenue, { decimals: false }), '100.0%'],
        },
      ],
    },
    {
      id: 'month',
      label: 'Monthly revenue and cost',
      description: 'The trend the workbook keeps on separate tabs.',
      build: () => [
        {
          kind: 'table',
          title: 'Monthly Revenue and Cost',
          columns: ['Month', 'Jobs', 'Revenue', 'Costs', 'Net'],
          rows: summary.byMonth.map((m) => [
            m.month,
            num(m.jobs),
            money(m.revenue, { decimals: false }),
            money(m.costs, { decimals: false }),
            money(m.revenue - m.costs, { decimals: false }),
          ]),
        },
      ],
    },
    {
      id: 'technicians',
      label: 'Technician workload',
      description: 'Jobs attended and revenue credited, split across a pair.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Technician Workload',
          columns: ['Technician', 'Jobs', 'Revenue credited'],
          rows: summary.technicians.map((t) => [t.name, num(t.jobs), money(t.revenue, { decimals: false })]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="After-Sales"
      description="Service revenue, the cost of getting there, and where the technicians' time goes — from the repair requests, service reports and revenue workbook combined."
      period={period}
      onPeriodChange={setPeriod}
      reportTitle="After-Sales Service Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'after-sales-monthly',
        rows: summary.byMonth,
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Jobs', value: (r) => r.jobs },
          { header: 'Revenue', value: (r) => r.revenue },
          { header: 'Costs', value: (r) => r.costs },
          { header: 'Net', value: (r) => r.revenue - r.costs },
        ],
      }}
    >
      <StatGrid>
        <StatTile
          label="Service revenue"
          value={moneyCompact(summary.revenue)}
          icon={Banknote}
          hint={`${num(summary.billedJobs)} billed job${summary.billedJobs === 1 ? '' : 's'}`}
        />
        <StatTile
          label="Recovered costs"
          value={moneyCompact(summary.costs)}
          icon={Fuel}
          hint="Fuel, meals, barge and accommodation"
        />
        <StatTile
          label="Cost ratio"
          value={summary.costRatio === null ? '—' : percent(summary.costRatio)}
          icon={TrendingDown}
          hint="Reimbursables against service revenue"
          progress={
            summary.costRatio === null
              ? undefined
              : {
                  value: Math.min(100, summary.costRatio),
                  tone: summary.costRatio > 40 ? 'critical' : summary.costRatio > 25 ? 'warning' : 'good',
                }
          }
        />
        <StatTile
          label="Average billed job"
          value={summary.averageTicket === null ? '—' : moneyCompact(summary.averageTicket)}
          icon={Wrench}
          hint="Service fee only, before reimbursables"
        />
      </StatGrid>

      {/*
          The quality row, which the dashboard previously had no equivalent of.

          Every figure here carries its denominator in the hint, because a
          100% first-time fix rate on three jobs is not a result and a tile
          that shows it as one gets a team congratulated for nothing.
      */}
      <StatGrid>
        <StatTile
          label="Response within promise"
          value={sla?.value === null || !sla ? '—' : percent(sla.value)}
          icon={ShieldCheck}
          hint={sla?.n ? `${num(sla.n)} measured · target ${percent(sla.target)}` : 'no promises measured yet'}
          progress={
            sla?.value == null
              ? undefined
              : { value: sla.value, tone: sla.value >= 90 ? 'good' : sla.value >= 75 ? 'warning' : 'critical' }
          }
        />
        <StatTile
          label="First-time fix rate"
          value={ftf?.value == null ? '—' : percent(ftf.value)}
          icon={Target}
          hint={ftf?.n ? `${num(ftf.n)} classified · target ${percent(ftf.target)}` : 'no outcomes classified yet'}
          progress={
            ftf?.value == null
              ? undefined
              : { value: ftf.value, tone: ftf.value >= 85 ? 'good' : ftf.value >= 70 ? 'warning' : 'critical' }
          }
        />
        <StatTile
          label="Cost of rework"
          value={quality.copq.total ? moneyCompact(quality.copq.total) : '—'}
          icon={Repeat}
          inverse
          hint={
            quality.copq.reworkVisits
              ? `${num(quality.copq.reworkVisits)} return visit${quality.copq.reworkVisits === 1 ? '' : 's'}, labour and travel`
              : 'no return visits linked yet'
          }
        />
        <StatTile
          label="Client satisfaction"
          value={csat?.value == null ? '—' : `${num(csat.value, 1)} / 5`}
          icon={Smile}
          hint={csat?.n ? `${num(csat.n)} rated after the visit` : 'nobody has rated a visit yet'}
        />
      </StatGrid>

      <StatGrid>
        <StatTile label="Jobs recorded" value={num(summary.jobs)} icon={Wrench} hint="Across every month on file" />
        <StatTile
          label="Open requests"
          value={num(open.length)}
          icon={Timer}
          hint={`${num(requests.filter((r) => r.status === 'Pending').length)} not yet triaged`}
        />
        {/*
            Renamed, because it never measured response.

            `responseTimes` compares when a request arrived with when the job
            was repaired, which is time to *resolution*. Labelling that
            "response" made the figure look ten times worse than the promise it
            appeared to be reported against, and no SLA in the module was ever
            measured against it. The real response clock now runs on live
            visits and appears in the row above.
        */}
        <StatTile
          label="Median time to repair"
          value={response.medianHours === null ? '—' : `${num(response.medianHours, 1)} h`}
          icon={Gauge}
          hint={
            response.matched === 0
              ? 'No imported request could be matched to a job'
              : `request to repair, on ${num(response.matched)} matched ticket${response.matched === 1 ? '' : 's'}`
          }
        />
        <StatTile
          label="Technicians active"
          value={num(summary.technicians.length)}
          icon={Users}
          hint={summary.technicians[0] ? `busiest: ${summary.technicians[0].name}` : undefined}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Revenue against the cost of getting there"
          subtitle="Every month on file, from the revenue workbook"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'jobs', label: 'Jobs', align: 'right' },
              { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'costs', label: 'Costs', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: summary.byMonth,
          }}
          footer={
            <span>
              Fuel alone is <strong className="text-ink">{money(fuel, { decimals: false })}</strong> —{' '}
              {percent(summary.revenue ? (fuel / summary.revenue) * 100 : 0)} of service revenue
            </span>
          }
        >
          <BarSeriesChart
            data={summary.byMonth}
            xKey="month"
            format="money"
            series={[
              { key: 'revenue', label: 'Revenue', slot: 1 },
              { key: 'costs', label: 'Costs', slot: 2 },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Where the money is earned"
          subtitle="Revenue by work type"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Work type' },
              { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: summary.byType,
          }}
        >
          <DonutChart
            data={summary.byType.map((t) => ({ name: t.name, value: t.value }))}
            format="money"
            centerValue={moneyCompact(summary.revenue)}
            centerLabel="Revenue"
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="What the travel costs"
          subtitle="Reimbursables recovered from clients"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Cost' },
              { key: 'value', label: 'Total', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: summary.byCost,
          }}
        >
          <RankedBars data={summary.byCost} slot={2} />
        </ChartCard>

        <ChartCard
          title="Revenue by client segment"
          subtitle="Which accounts the service business actually serves"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Segment' },
              { key: 'jobs', label: 'Jobs', align: 'right' },
              { key: 'value', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: summary.byClientType,
          }}
        >
          <RankedBars data={summary.byClientType.map((c) => ({ name: c.name, value: c.value }))} slot={1} />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card data-print="keep">
          <CardHeader
            title="Technician workload"
            subtitle="Jobs attended; revenue split where two attended together"
          />
          <div className="divide-y divide-line border-t border-line">
            {summary.technicians.slice(0, 8).map((tech) => (
              <div key={tech.name} className="px-4 py-2.5 sm:px-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-ink">{tech.name}</p>
                  <p className="tabular shrink-0 text-[13px] text-ink-2">
                    {num(tech.jobs)} job{tech.jobs === 1 ? '' : 's'} · {moneyCompact(tech.revenue)}
                  </p>
                </div>
                <ProgressBar
                  className="mt-1.5"
                  value={summary.technicians[0] ? (tech.jobs / summary.technicians[0].jobs) * 100 : 0}
                  tone="brand"
                />
              </div>
            ))}
          </div>
        </Card>

        <Card data-print="keep">
          <CardHeader
            title="Priority definitions"
            subtitle="What the intake form asks the client to choose, and the response each one earns"
            action={<Badge tone="brand">SLA</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {PRIORITIES.map((p) => (
              <div key={p.level} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <Badge tone={p.tone as 'critical'}>{p.label}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{p.summary}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{p.detail}</p>
                </div>
                <span className="tabular shrink-0 text-[12px] font-medium text-ink-2">
                  {p.respondHours < 24 ? `${p.respondHours} h` : `${p.respondHours / 24} d`}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DashboardShell>
  )
}
