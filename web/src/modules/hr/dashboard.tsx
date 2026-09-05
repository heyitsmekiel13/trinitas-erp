import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  HandCoins,
  RefreshCw,
  ShieldAlert,
  Star,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  getHrDashboard,
  liveApi,
  type HrDashboard,
  type HrGrain,
  type HrPeriod,
  type NamedValue,
} from '@/lib/adminApi'
import { daysUntil, fmtDate, moneyCompact, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Input } from '@/components/ui/primitives'
import { EmptyState, ErrorState, SkeletonDashboard, useToast } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DueCell, MiniTable, PersonCell } from '@/components/dashboard/MiniTable'
import {
  BarSeriesChart,
  BulletBars,
  ChartCard,
  CompositionTreemap,
  DonutChart,
  FunnelBars,
  GaugeArc,
  Histogram,
  RankedBars,
  ShareBar,
  TrendChart,
  WaterfallChart,
  type WaterfallStep,
} from '@/components/charts'

/**
 * The HR dashboard, on live figures.
 *
 * The window used to be assembled in the browser: a grain, two loose date
 * inputs, and a label worked out locally from all three. That meant the
 * caption above the numbers and the numbers themselves were computed in two
 * different places, in two different languages, and could disagree — and the
 * common questions ("this month", "last month", "year to date") each took a
 * grain change and two typed dates to ask.
 *
 * Now the period is named and the server resolves it. One calculation returns
 * the window, its label, the bucket size that suits its length, and the
 * equivalent window immediately before it, so every figure can be shown
 * against what it did last time.
 *
 * The second change was coverage. This screen reported headcount, attendance,
 * leave and discipline; payroll, compensation, recruitment, performance,
 * training and statutory coverage were not on it at all. Every domain the
 * module holds data for now has a section here.
 *
 * The third change is how those figures are drawn. Coverage arrived as a
 * ranked bar list per domain — fourteen cards that all looked alike, and
 * several of which were the wrong shape for their data: the hiring funnel was
 * re-sorted by size, so the fall between stages was gone; the age and tenure
 * bands were re-sorted too, so the distribution had no shape; leave showed
 * days taken with the entitlement they came out of relegated to a caption;
 * and gross, net, statutory and tax sat as six unrelated bars rather than one
 * subtraction. Each of those now uses a form that carries its own argument —
 * funnel, histogram, bullet, waterfall — and the rates that have a ceiling
 * (punctuality, review completion, documentation) are drawn against it.
 */

const PERIODS: { value: HrPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'wtd', label: 'WTD' },
  { value: 'mtd', label: 'MTD' },
  { value: 'last_month', label: 'Last month' },
  { value: 'qtd', label: 'QTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'last_12m', label: '12 months' },
  { value: 'all', label: 'All time' },
]

const GRAINS: { value: HrGrain; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
]

/** Percentage change, or undefined when there is no baseline to compare to. */
function delta(current: number, prior: number): number | undefined {
  if (!prior) return undefined
  return ((current - prior) / prior) * 100
}

/** Recharts wants an index signature; our typed rows do not have one. */
function rows(data: unknown[]): Record<string, unknown>[] {
  return data as Record<string, unknown>[]
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
        active
          ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
          : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

/**
 * The reporting filter.
 *
 * Presets first, because they answer almost every question asked of this
 * screen in one click. The custom range is there for the ones they do not,
 * and the grain is an override rather than a required choice — the server
 * already picks a sensible bucket size for the window, and making somebody
 * choose one before they can see anything was the old filter's real cost.
 */
function PeriodFilter({
  period,
  onPeriod,
  from,
  to,
  onFrom,
  onTo,
  grain,
  onGrain,
  resolvedGrain,
}: {
  period: HrPeriod
  onPeriod: (p: HrPeriod) => void
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  grain: HrGrain | null
  onGrain: (g: HrGrain | null) => void
  resolvedGrain: HrGrain | undefined
}) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-x-4 gap-y-3 p-3" data-print="hide">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Period</span>
        {PERIODS.map((p) => (
          <Chip key={p.value} active={period === p.value} onClick={() => onPeriod(p.value)}>
            {p.label}
          </Chip>
        ))}
        <Chip active={period === 'custom'} onClick={() => onPeriod('custom')}>
          Custom
        </Chip>
      </div>

      {period === 'custom' && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => onFrom(e.target.value)}
            aria-label="From"
            className="h-8 w-[9.5rem] text-[13px]"
          />
          <span className="text-[13px] text-ink-3">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => onTo(e.target.value)}
            aria-label="To"
            className="h-8 w-[9.5rem] text-[13px]"
          />
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Bucket</span>
        <Chip active={grain === null} onClick={() => onGrain(null)}>
          Auto{resolvedGrain && grain === null ? ` (${resolvedGrain})` : ''}
        </Chip>
        {GRAINS.map((g) => (
          <Chip key={g.value} active={grain === g.value} onClick={() => onGrain(g.value)}>
            {g.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}

/** A section heading with a rule, so the page reads as chapters not a wall. */
function Section({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mt-6 flex items-baseline gap-3 first:mt-0">
      <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">{title}</h2>
      {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      <div className="h-px flex-1 bg-line" />
    </div>
  )
}

/** A ranked breakdown that degrades to a message rather than an empty axis. */
function Breakdown({
  title,
  subtitle,
  data,
  format = 'number',
  height,
  showShare,
  rank,
  slot,
  colorful,
}: {
  title: string
  subtitle?: string
  data: NamedValue[]
  format?: 'number' | 'money'
  height?: number
  showShare?: boolean
  rank?: boolean
  slot?: number
  colorful?: boolean
}) {
  const shown = data.filter((d) => d.value > 0)

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      height={height}
      table={{
        columns: [
          { key: 'name', label: title },
          { key: 'value', label: 'Value', align: 'right' },
        ],
        rows: rows(data),
      }}
    >
      {shown.length === 0 ? (
        <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded yet.</p>
      ) : (
        <RankedBars data={shown} format={format} showShare={showShare} rank={rank} slot={slot} colorful={colorful} />
      )}
    </ChartCard>
  )
}

/** A distribution across ordered bands — drawn in the order the server sent. */
function Distribution({
  title,
  subtitle,
  data,
  slot,
  height,
}: {
  title: string
  subtitle?: string
  data: NamedValue[]
  slot?: number
  height?: number
}) {
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      height={height}
      table={{
        columns: [
          { key: 'name', label: 'Band', align: 'left' },
          { key: 'value', label: 'People', align: 'right' },
        ],
        rows: rows(data),
      }}
    >
      <Histogram data={data} slot={slot} />
    </ChartCard>
  )
}

export function Dashboard() {
  const toast = useToast()
  const navigate = useNavigate()
  const [period, setPeriod] = React.useState<HrPeriod>('ytd')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [grain, setGrain] = React.useState<HrGrain | null>(null)

  const [data, setData] = React.useState<HrDashboard | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(
        await getHrDashboard(period, {
          ...(period === 'custom' && from ? { from } : {}),
          ...(period === 'custom' && to ? { to } : {}),
          ...(grain ? { grain } : {}),
        }),
      )
    } catch (err) {
      setError(err)
      toast({ tone: 'error', title: 'Could not load the dashboard.', description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [period, from, to, grain, toast])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    // A custom range with only one end filled in is half a question; wait.
    if (period === 'custom' && (!from || !to)) return
    void load()
  }, [load, period, from, to])

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="HR Dashboard" description="Headcount, attendance, discipline and hiring." />
        <div className="card">
          <EmptyState
            icon={Users}
            title="The dashboard needs the live API"
            description="These figures are computed from the people record and the punch clock."
          />
        </div>
      </>
    )
  }

  const k = data?.kpis
  const compareLabel = data ? `vs ${data.window.compare.label}` : undefined
  const trend = data ? rows(data.trend) : []

  /**
   * Gross to net as one subtraction.
   *
   * "Other deductions" is what the run withheld beyond statutory and tax —
   * loans, advances, adjustments. Deriving it rather than dropping it keeps
   * the bars arriving exactly at net, which is the only reason to draw this
   * as a waterfall instead of six bars.
   */
  const payrollFlow: WaterfallStep[] = React.useMemo(() => {
    if (!data || data.payroll.runs === 0) return []
    const p = data.payroll
    const other = Math.max(p.totalDeductions - p.statutoryEmployee - p.withholdingTax, 0)
    return [
      { name: 'Gross', value: p.gross, kind: 'total' },
      { name: 'Statutory', value: p.statutoryEmployee, kind: 'subtract' },
      { name: 'Tax', value: p.withholdingTax, kind: 'subtract' },
      ...(other > 0 ? ([{ name: 'Other', value: other, kind: 'subtract' }] as WaterfallStep[]) : []),
      { name: 'Net', value: p.net, kind: 'total' },
    ]
  }, [data])

  return (
    <>
      <PageHeader
        title="HR Dashboard"
        description="Every HR domain on one page — headcount, pay, attendance, hiring, development and compliance."
        meta={
          data && (
            <>
              <Badge tone="neutral">{data.window.label}</Badge>
              <span className="text-[11px] text-ink-3">Updated {fmtDate(data.generatedAt)}</span>
            </>
          )
        }
        actions={
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <PeriodFilter
        period={period}
        onPeriod={setPeriod}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        grain={grain}
        onGrain={setGrain}
        resolvedGrain={data?.window.grain}
      />

      {error && !data && <ErrorState error={error} onRetry={() => void load()} />}
      {loading && !data && <SkeletonDashboard />}

      {/* What actually needs a person to act today — drawn from the same
          services that feed the notification bell, so this can never
          disagree with it. Leads the dashboard rather than sitting at the
          bottom: a number nobody has to act on is not why anyone opens this
          screen twice. */}
      {data && data.alerts.length > 0 && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.alerts.map((alert) => (
            <button
              key={alert.id}
              onClick={() => navigate(alert.link)}
              className={cn(
                'text-left',
                'flex items-center gap-2.5 rounded-xl border p-3 transition-colors hover:bg-surface-2',
                alert.tone === 'critical' ? 'border-critical/30 bg-critical/5'
                  : alert.tone === 'warning' ? 'border-warning/30 bg-warning/5'
                    : 'border-line bg-surface-2',
              )}
            >
              <AlertTriangle className={cn(
                'size-4 shrink-0',
                alert.tone === 'critical' ? 'text-critical' : alert.tone === 'warning' ? 'text-warning' : 'text-info',
              )} />
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-ink">{num(alert.count)}</p>
                <p className="truncate text-[11px] leading-tight text-ink-2">{alert.title}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {data && k && (
        <div className="space-y-4">
          {/* ---------------------------------------------------------- */}
          <Section title="Workforce" hint={data.window.label} />

          <StatGrid>
            <StatTile
              label="Headcount"
              value={num(k.headcount)}
              icon={Users}
              hint={k.futureHires ? `${num(k.futureHires)} not started` : 'On the books today'}
              // The composition is the second question every time, so it is
              // on the tile rather than a card further down.
              footer={
                k.regular + k.probationary > 0 ? (
                  <ShareBar
                    data={[
                      { name: 'Regular', value: k.regular },
                      { name: 'Probationary', value: k.probationary },
                    ]}
                  />
                ) : undefined
              }
            />
            <StatTile
              label="Hired in period"
              value={num(k.hiredInWindow)}
              delta={delta(k.hiredInWindow, k.hiredInWindowPrior)}
              deltaLabel={compareLabel}
              icon={UserPlus}
              hint={`${num(k.newThisMonth)} this month`}
              spark={{ data: trend, dataKey: 'hires', color: 'var(--series-2)' }}
            />
            <StatTile
              label="Exits in period"
              value={num(k.exitsInWindow)}
              delta={delta(k.exitsInWindow, k.exitsInWindowPrior)}
              deltaLabel={compareLabel}
              inverse
              icon={UserMinus}
              hint={k.attritionPct == null ? 'No attrition recorded' : `${k.attritionPct}% of headcount`}
              spark={{ data: trend, dataKey: 'exits', color: 'var(--series-4)' }}
            />
            <StatTile
              label="Net change"
              value={`${k.netHeadcountChange >= 0 ? '+' : ''}${num(k.netHeadcountChange)}`}
              icon={UserCheck}
              hint="Hires less exits, this period"
              spark={{ data: trend, dataKey: 'headcount', color: 'var(--series-1)' }}
            />
          </StatGrid>

          <ChartCard
            title="Headcount, hires and exits"
            subtitle={`Bucketed by ${data.window.grain} · ${data.window.label}`}
            height={300}
            table={{
              columns: [
                { key: 'label', label: 'Period' },
                { key: 'headcount', label: 'Headcount', align: 'right' },
                { key: 'hires', label: 'Hires', align: 'right' },
                { key: 'exits', label: 'Exits', align: 'right' },
              ],
              rows: trend,
            }}
          >
            <TrendChart
              data={trend}
              xKey="label"
              format="number"
              series={[
                { key: 'headcount', label: 'Headcount', kind: 'area', slot: 1 },
                { key: 'hires', label: 'Hires', slot: 2 },
                { key: 'exits', label: 'Exits', slot: 4 },
              ]}
            />
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Where people sit"
              subtitle="Every department, sized by headcount"
              table={{
                columns: [
                  { key: 'name', label: 'Department' },
                  { key: 'value', label: 'People', align: 'right' },
                ],
                rows: rows(data.workforce.byDepartment),
              }}
            >
              <CompositionTreemap data={data.workforce.byDepartment} />
            </ChartCard>

            <ChartCard
              title="Employment status"
              subtitle="The mix on the books today"
              table={{
                columns: [
                  { key: 'name', label: 'Status' },
                  { key: 'value', label: 'People', align: 'right' },
                ],
                rows: rows(data.workforce.byStatus),
              }}
            >
              {data.workforce.byStatus.every((s) => s.value === 0) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded yet.</p>
              ) : (
                <DonutChart
                  data={data.workforce.byStatus.filter((s) => s.value > 0)}
                  format="number"
                  centerLabel="On the books"
                  centerValue={num(k.headcount)}
                />
              )}
            </ChartCard>

            <Distribution
              title="Tenure"
              subtitle="How long people have been here — the shape, not the ranking"
              data={data.workforce.byTenure}
              slot={1}
            />
            <Distribution title="Age" subtitle="Bands in order" data={data.workforce.byAge} slot={7} />

            <Breakdown title="By branch" data={data.workforce.byBranch} showShare rank />
            <Breakdown title="Top positions" data={data.workforce.byPosition} showShare rank />
          </div>

          {data.workforce.regularisationDue.length > 0 && (
            <ChartCard
              title="Regularisation due"
              subtitle="Six months on probation resolves automatically — this is who it affects, and who is held back"
              height={undefined}
              action={<Badge tone="warning">{num(data.workforce.regularisationDue.length)} due</Badge>}
            >
              <MiniTable
                rows={data.workforce.regularisationDue}
                rowKey={(r) => r.employeeNo}
                columns={[
                  {
                    key: 'employee',
                    label: 'Employee',
                    render: (r) => (
                      <button onClick={() => navigate('/hr/employees')} className="text-left hover:underline">
                        <PersonCell name={r.employee} sub={r.employeeNo} />
                      </button>
                    ),
                  },
                  { key: 'position', label: 'Position', render: (r) => r.position ?? '—' },
                  { key: 'department', label: 'Department', render: (r) => r.department ?? '—' },
                  { key: 'hired', label: 'Hired', render: (r) => (r.hired ? fmtDate(r.hired) : '—') },
                  {
                    key: 'due',
                    label: 'Decision due',
                    render: (r) =>
                      r.dueOn ? <DueCell date={fmtDate(r.dueOn)} days={daysUntil(r.dueOn)} /> : '—',
                  },
                  {
                    key: 'status',
                    label: 'Auto-regularisation',
                    render: (r) =>
                      r.flagged ? (
                        <span title={r.flagReason ?? undefined}>
                          <Badge tone="critical">Held — needs a decision</Badge>
                        </span>
                      ) : (
                        <Badge tone="good">Will auto-regularise</Badge>
                      ),
                  },
                ]}
              />
            </ChartCard>
          )}

          {/* ---------------------------------------------------------- */}
          <Section title="Pay and cost" hint="Masterfile rates, and what payroll actually released" />

          <StatGrid>
            <StatTile
              label="Monthly payroll cost"
              value={moneyCompact(data.compensation.monthlyCost)}
              icon={HandCoins}
              hint={`${moneyCompact(data.compensation.annualisedCost)} annualised`}
            />
            <StatTile
              label="Average pay"
              value={data.compensation.averageMonthly == null ? '—' : moneyCompact(data.compensation.averageMonthly)}
              icon={Banknote}
              hint={
                data.compensation.medianMonthly == null
                  ? undefined
                  : `Median ${moneyCompact(data.compensation.medianMonthly)}`
              }
            />
            <StatTile
              label="Net released in period"
              value={moneyCompact(data.payroll.net)}
              delta={delta(data.payroll.net, data.payroll.netPrior)}
              deltaLabel={compareLabel}
              icon={Banknote}
              hint={`${num(data.payroll.runs)} run${data.payroll.runs === 1 ? '' : 's'} · ${num(
                data.payroll.headcountPaid,
              )} paid`}
            />
            <StatTile
              label="Pay basis"
              value={`${num(data.compensation.hourlyPaid)} / ${num(data.compensation.monthlyPaid)}`}
              icon={Clock}
              hint={`${num(data.compensation.minimumWageEarners)} on minimum wage`}
              footer={
                data.compensation.hourlyPaid + data.compensation.monthlyPaid > 0 ? (
                  <ShareBar
                    data={[
                      { name: 'Hourly', value: data.compensation.hourlyPaid },
                      { name: 'Monthly', value: data.compensation.monthlyPaid },
                    ]}
                  />
                ) : undefined
              }
            />
          </StatGrid>

          {(data.payroll.awaitingApproval > 0 || data.payroll.approvedNotReleased > 0) && (
            <p className="card flex items-center gap-2 p-3 text-[12px] text-warning">
              <AlertTriangle className="size-4 shrink-0" />
              {data.payroll.awaitingApproval > 0 &&
                `${data.payroll.awaitingApproval} run(s) computed and awaiting approval. `}
              {data.payroll.approvedNotReleased > 0 &&
                `${data.payroll.approvedNotReleased} approved but not yet released.`}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Gross to net"
              subtitle="What was withheld between the two, in this period"
              table={{
                columns: [
                  { key: 'name', label: 'Component' },
                  { key: 'value', label: 'Amount', align: 'right' },
                ],
                rows: rows([
                  { name: 'Gross pay', value: data.payroll.gross },
                  { name: 'Employee statutory', value: data.payroll.statutoryEmployee },
                  { name: 'Withholding tax', value: data.payroll.withholdingTax },
                  { name: 'Total deductions', value: data.payroll.totalDeductions },
                  { name: 'Net pay', value: data.payroll.net },
                  { name: 'Employer statutory', value: data.payroll.statutoryEmployer },
                  { name: 'Employer cost', value: data.payroll.employerCost },
                ]),
              }}
            >
              {payrollFlow.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No payroll computed in this period.
                </p>
              ) : (
                <WaterfallChart data={payrollFlow} />
              )}
            </ChartCard>

            <ChartCard
              title="Released by pay period"
              subtitle="Gross, net and the employer's total cost"
              table={{
                columns: [
                  { key: 'name', label: 'Period' },
                  { key: 'gross', label: 'Gross', align: 'right' },
                  { key: 'net', label: 'Net', align: 'right' },
                  { key: 'employerCost', label: 'Employer cost', align: 'right' },
                ],
                rows: rows(data.payroll.byPeriod),
              }}
            >
              {data.payroll.byPeriod.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No payroll computed in this period.
                </p>
              ) : (
                <BarSeriesChart
                  data={rows(data.payroll.byPeriod)}
                  xKey="name"
                  format="money"
                  series={[
                    { key: 'gross', label: 'Gross', slot: 1 },
                    { key: 'net', label: 'Net', slot: 3 },
                    { key: 'employerCost', label: 'Employer cost', slot: 2 },
                  ]}
                />
              )}
            </ChartCard>

            <Breakdown title="Cost by department" data={data.compensation.costByDepartment} format="money" showShare rank />
            <Breakdown
              title="Cost by payroll group"
              data={data.compensation.costByPayrollGroup}
              format="money"
              showShare
            />
            <Distribution
              title="Salary bands"
              subtitle="Monthly equivalent — where pay clusters"
              data={data.compensation.salaryBands}
              slot={3}
            />
            <ChartCard
              title="Statutory burden"
              subtitle="Employee side against employer side, this period"
              table={{
                columns: [
                  { key: 'name', label: 'Side' },
                  { key: 'value', label: 'Amount', align: 'right' },
                ],
                rows: rows([
                  { name: 'Employee statutory', value: data.payroll.statutoryEmployee },
                  { name: 'Employer statutory', value: data.payroll.statutoryEmployer },
                  { name: 'Withholding tax', value: data.payroll.withholdingTax },
                ]),
              }}
            >
              {data.payroll.runs === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No payroll computed in this period.
                </p>
              ) : (
                <DonutChart
                  data={[
                    { name: 'Employee statutory', value: data.payroll.statutoryEmployee },
                    { name: 'Employer statutory', value: data.payroll.statutoryEmployer },
                    { name: 'Withholding tax', value: data.payroll.withholdingTax },
                  ].filter((r) => r.value > 0)}
                  format="money"
                  centerLabel="Remitted"
                  centerValue={moneyCompact(
                    data.payroll.statutoryEmployee + data.payroll.statutoryEmployer + data.payroll.withholdingTax,
                  )}
                />
              )}
            </ChartCard>
          </div>

          {/* ---------------------------------------------------------- */}
          <Section title="Attendance and leave" />

          <StatGrid>
            <StatTile
              label="Present today"
              value={num(k.presentToday)}
              icon={UserCheck}
              hint={`${num(k.stillClockedIn)} still clocked in`}
              footer={
                k.presentToday + k.onLeaveToday > 0 ? (
                  <ShareBar
                    data={[
                      { name: 'On time', value: Math.max(k.presentToday - k.lateToday, 0) },
                      { name: 'Late', value: k.lateToday },
                      { name: 'On leave', value: k.onLeaveToday },
                    ]}
                  />
                ) : undefined
              }
            />
            <StatTile
              label="Hours in period"
              value={num(k.hoursThisMonth)}
              delta={delta(k.hoursThisMonth, k.hoursPrior)}
              deltaLabel={compareLabel}
              icon={Clock}
              hint={`${num(k.overtimeThisMonth)} overtime`}
              spark={{ data: trend, dataKey: 'hours', color: 'var(--series-1)' }}
            />
            <StatTile
              label="Overtime"
              value={num(k.overtimeThisMonth)}
              delta={delta(k.overtimeThisMonth, k.overtimePrior)}
              deltaLabel={compareLabel}
              inverse
              icon={Clock}
              hint="Hours beyond schedule"
              spark={{ data: trend, dataKey: 'overtime', color: 'var(--series-2)' }}
            />
            <StatTile
              label="Leave pending"
              value={num(k.pendingLeave)}
              icon={CalendarDays}
              hint={`${num(data.leave.daysTaken)} days taken in period`}
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Punctuality"
              subtitle={compareLabel}
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Measure' },
                  { key: 'value', label: 'Value', align: 'right' },
                ],
                rows: rows([
                  { name: 'Punctuality', value: k.punctualityPct ?? 0 },
                  { name: 'Prior period', value: k.punctualityPctPrior ?? 0 },
                  { name: 'Late instances', value: k.lateInstancesThisMonth },
                  { name: 'Absences', value: k.absencesInWindow },
                ]),
              }}
            >
              <GaugeArc
                value={k.punctualityPct}
                label="On time"
                caption={
                  k.punctualityPct == null
                    ? undefined
                    : `${num(k.lateInstancesThisMonth)} late · ${num(k.absencesInWindow)} absent`
                }
                bands={{ warn: 95, bad: 85 }}
              />
            </ChartCard>

            <ChartCard
              className="lg:col-span-2"
              title="Attendance over time"
              subtitle={`Bucketed by ${data.window.grain}`}
              height={240}
              table={{
                columns: [
                  { key: 'label', label: 'Period' },
                  { key: 'days', label: 'Days', align: 'right' },
                  { key: 'late', label: 'Late', align: 'right' },
                  { key: 'absent', label: 'Absent', align: 'right' },
                  { key: 'hours', label: 'Hours', align: 'right' },
                  { key: 'overtime', label: 'Overtime', align: 'right' },
                ],
                rows: trend,
              }}
            >
              <TrendChart
                data={trend}
                xKey="label"
                format="number"
                series={[
                  { key: 'days', label: 'Days recorded', kind: 'area', slot: 1 },
                  { key: 'late', label: 'Late', slot: 3 },
                  { key: 'absent', label: 'Absent', slot: 4 },
                  { key: 'overtime', label: 'Overtime hours', slot: 2 },
                ]}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Leave balances"
              subtitle="Taken against entitlement, this year"
              table={{
                columns: [
                  { key: 'name', label: 'Type' },
                  { key: 'credits', label: 'Credits', align: 'right' },
                  { key: 'used', label: 'Used', align: 'right' },
                  { key: 'balance', label: 'Balance', align: 'right' },
                ],
                rows: rows(data.leave.balances),
              }}
            >
              {data.leave.balances.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No leave balances for this year.
                </p>
              ) : (
                <BulletBars
                  format="number"
                  usedLabel="Taken"
                  capacityLabel="Credits"
                  data={data.leave.balances.map((b) => ({
                    name: b.name,
                    used: b.used,
                    capacity: b.credits,
                    meta:
                      b.utilisationPct == null
                        ? `${b.balance} left`
                        : `${b.utilisationPct}% taken · ${b.balance} left`,
                  }))}
                />
              )}
            </ChartCard>

            <ChartCard
              title="Leave filed"
              subtitle={`${num(data.leave.filedInWindow)} filed in period · ${num(data.leave.pending)} pending`}
              table={{
                columns: [
                  { key: 'name', label: 'Type' },
                  { key: 'value', label: 'Filings', align: 'right' },
                ],
                rows: rows(data.leave.byType),
              }}
              footer={
                data.leave.byStatus.some((s) => s.value > 0) ? (
                  <ShareBar data={data.leave.byStatus} />
                ) : undefined
              }
            >
              {data.leave.byType.every((t) => t.value === 0) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No leave filed in this period.
                </p>
              ) : (
                <DonutChart
                  data={data.leave.byType.filter((t) => t.value > 0)}
                  format="number"
                  centerLabel="Days taken"
                  centerValue={num(data.leave.daysTaken)}
                />
              )}
            </ChartCard>
          </div>

          {/* ---------------------------------------------------------- */}
          <Section title="Hiring" />

          <StatGrid>
            <StatTile
              label="Open vacancies"
              value={num(data.recruitment.openRequisitions)}
              icon={UserPlus}
              hint={`${num(data.recruitment.seatsToFill)} seats to fill`}
            />
            <StatTile
              label="In the pipeline"
              value={num(data.recruitment.activeApplicants)}
              icon={Users}
              hint={`${num(data.recruitment.appliedInWindow)} applied in period`}
            />
            <StatTile
              label="Hired in period"
              value={num(data.recruitment.hiredInWindow)}
              icon={UserCheck}
              hint={`${num(data.recruitment.rejectedInWindow)} rejected`}
              // Offer-to-hire is the ratio the pipeline is judged on; showing
              // it as a bar saves the reader dividing two figures on the tile.
              progress={
                data.recruitment.seatsToFill
                  ? {
                      value: Math.min((data.recruitment.hiredInWindow / data.recruitment.seatsToFill) * 100, 100),
                      target: `${num(data.recruitment.seatsToFill)} seats`,
                      tone: 'brand',
                    }
                  : undefined
              }
            />
            <StatTile
              label="Reviews overdue"
              value={num(data.performance.overdue)}
              icon={Star}
              inverse
              hint={`${num(data.performance.total)} review(s) in total`}
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Recruitment funnel"
              subtitle="In pipeline order — the fall between stages is the point"
              table={{
                columns: [
                  { key: 'name', label: 'Stage' },
                  { key: 'value', label: 'Candidates', align: 'right' },
                ],
                rows: rows(data.recruitment.funnel),
              }}
            >
              {data.recruitment.funnel.every((f) => f.value === 0) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  Nobody in the pipeline.
                </p>
              ) : (
                <FunnelBars data={data.recruitment.funnel} />
              )}
            </ChartCard>
            <Breakdown title="Applicants by source" data={data.recruitment.bySource} showShare rank slot={2} />
          </div>

          {data.recruitment.byPosition.length > 0 && (
            <Breakdown
              title="Vacancies by position"
              subtitle="Where the hiring load sits"
              data={data.recruitment.byPosition}
              showShare
              slot={5}
            />
          )}

          {/* ---------------------------------------------------------- */}
          <Section title="Performance and development" />

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Cycle completion"
              subtitle={
                data.performance.averageScore == null
                  ? 'No score recorded'
                  : `Average score ${data.performance.averageScore}`
              }
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Stage' },
                  { key: 'value', label: 'Reviews', align: 'right' },
                ],
                rows: rows(data.performance.byStatus),
              }}
            >
              <GaugeArc
                value={data.performance.completionPct}
                label="Reviews complete"
                caption={`${num(data.performance.completed)} of ${num(data.performance.total)}`}
                bands={{ warn: 80, bad: 50 }}
              />
            </ChartCard>

            <ChartCard
              title="Review status"
              subtitle="Where the cycle has got to"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Stage' },
                  { key: 'value', label: 'Reviews', align: 'right' },
                ],
                rows: rows(data.performance.byStatus),
              }}
            >
              {data.performance.total === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No reviews yet — start a cycle from the Performance page.
                </p>
              ) : (
                <DonutChart
                  data={data.performance.byStatus.filter((s) => s.value > 0)}
                  format="number"
                  centerLabel="Reviews"
                  centerValue={num(data.performance.total)}
                />
              )}
            </ChartCard>

            <ChartCard
              title="Ratings awarded"
              subtitle="Completed reviews only"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Rating' },
                  { key: 'value', label: 'Reviews', align: 'right' },
                ],
                rows: rows(data.performance.byRating),
              }}
            >
              <Histogram data={data.performance.byRating} slot={3} />
            </ChartCard>
          </div>

          {data.performance.byCycle.length > 0 && (
            <ChartCard
              title="Cycles"
              subtitle="Reviews raised against reviews finished"
              table={{
                columns: [
                  { key: 'name', label: 'Cycle' },
                  { key: 'value', label: 'Raised', align: 'right' },
                  { key: 'completed', label: 'Completed', align: 'right' },
                ],
                rows: rows(data.performance.byCycle),
              }}
            >
              <BarSeriesChart
                data={rows(data.performance.byCycle)}
                xKey="name"
                format="number"
                series={[
                  { key: 'value', label: 'Raised', slot: 1 },
                  { key: 'completed', label: 'Completed', slot: 3 },
                ]}
              />
            </ChartCard>
          )}

          <StatGrid>
            <StatTile
              label="Training sessions"
              value={num(data.training.sessionsInWindow)}
              icon={GraduationCap}
              hint={`${num(data.training.sessionsCompleted)} completed · ${num(
                data.training.attendeesInWindow,
              )} attendees`}
              progress={
                data.training.sessionsInWindow
                  ? {
                      value: (data.training.sessionsCompleted / data.training.sessionsInWindow) * 100,
                      tone: 'good',
                    }
                  : undefined
              }
            />
            <StatTile label="Certificates held" value={num(data.training.certificatesHeld)} icon={GraduationCap} />
            <StatTile
              label="Expiring in 90 days"
              value={num(data.training.expiringSoon)}
              icon={AlertTriangle}
              inverse
              hint={`${num(data.training.expired)} already expired`}
            />
            <StatTile
              label="Open cases"
              value={num(k.openCases)}
              icon={ShieldAlert}
              inverse
              hint={`${num(k.unacknowledgedCases)} unacknowledged`}
            />
          </StatGrid>

          {data.training.expiring.length > 0 && (
            <ChartCard
              title="Certifications expiring"
              subtitle="Next 90 days"
              height={undefined}
              action={<Badge tone="warning">{num(data.training.expiring.length)} expiring</Badge>}
            >
              <MiniTable
                rows={data.training.expiring}
                rowKey={(_, i) => i}
                columns={[
                  {
                    key: 'employee',
                    label: 'Employee',
                    render: (r) => <PersonCell name={r.employee} sub={r.employeeNo} />,
                  },
                  { key: 'course', label: 'Course', render: (r) => r.course ?? '—' },
                  {
                    key: 'expires',
                    label: 'Expires',
                    render: (r) =>
                      r.expiresOn ? <DueCell date={fmtDate(r.expiresOn)} days={daysUntil(r.expiresOn)} /> : '—',
                  },
                ]}
              />
            </ChartCard>
          )}

          {/* ---------------------------------------------------------- */}
          <Section title="Discipline" hint="Rolling window" />

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Cases by type"
              subtitle={`${num(k.casesThisWindow)} raised in period · ${num(k.automaticCases)} raised automatically`}
              table={{
                columns: [
                  { key: 'name', label: 'Type' },
                  { key: 'value', label: 'Cases', align: 'right' },
                ],
                rows: rows(data.discipline.byType),
              }}
            >
              {data.discipline.byType.every((t) => t.value === 0) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  No cases in this period.
                </p>
              ) : (
                <DonutChart
                  data={data.discipline.byType.filter((t) => t.value > 0)}
                  format="number"
                  centerLabel="Open"
                  centerValue={num(k.openCases)}
                />
              )}
            </ChartCard>

            <ChartCard
              title="Infraction watchlist"
              subtitle="Standing by accumulated points"
              height={undefined}
              action={
                data.watchlist.length > 0 ? <Badge tone="warning">{num(data.watchlist.length)} flagged</Badge> : undefined
              }
            >
              <MiniTable
                rows={data.watchlist}
                rowKey={(w) => w.employeeId}
                empty="Nobody on the watchlist."
                emptyIcon={CheckCircle2}
                columns={[
                  {
                    key: 'name',
                    label: 'Employee',
                    render: (w) => <PersonCell name={w.name} sub={w.employeeNo} />,
                  },
                  { key: 'cases', label: 'Cases', align: 'right', width: 'w-16', render: (w) => num(w.cases) },
                  {
                    key: 'points',
                    label: 'Points',
                    width: 'w-28',
                    // The bar is against the heaviest offender on the list, so
                    // "12 points" reads as a position rather than a bare count.
                    render: (w) => {
                      const worst = Math.max(...data.watchlist.map((x) => x.points), 1)
                      return (
                        <div className="flex items-center gap-2">
                          <span className="tabular w-6 text-right text-[12px] font-medium text-ink">
                            {num(w.points)}
                          </span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${(w.points / worst) * 100}%`,
                                background: w.openCases > 0 ? 'var(--color-critical)' : 'var(--color-warning)',
                              }}
                            />
                          </span>
                        </div>
                      )
                    },
                  },
                  {
                    key: 'standing',
                    label: 'Standing',
                    render: (w) => <Badge tone={w.openCases > 0 ? 'warning' : 'neutral'}>{w.standing}</Badge>,
                  },
                  {
                    key: 'last',
                    label: 'Last incident',
                    render: (w) => (w.lastIncident ? fmtDate(w.lastIncident) : '—'),
                  },
                ]}
              />
            </ChartCard>
          </div>

          {/* ---------------------------------------------------------- */}
          <Section title="Record completeness" hint="Gaps that stop payroll or remittance" />

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Fully documented"
              subtitle="TIN, SSS, PhilHealth and Pag-IBIG all on file"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Measure' },
                  { key: 'value', label: 'People', align: 'right' },
                ],
                rows: rows([
                  { name: 'Fully documented', value: data.compliance.fullyDocumented },
                  {
                    name: 'With a gap',
                    value: Math.max(data.compliance.headcount - data.compliance.fullyDocumented, 0),
                  },
                  { name: 'Headcount', value: data.compliance.headcount },
                ]),
              }}
            >
              <GaugeArc
                value={
                  data.compliance.headcount
                    ? (data.compliance.fullyDocumented / data.compliance.headcount) * 100
                    : null
                }
                label="Records complete"
                caption={`${num(data.compliance.fullyDocumented)} of ${num(data.compliance.headcount)}`}
                bands={{ warn: 98, bad: 90 }}
              />
            </ChartCard>

            <ChartCard
              className="lg:col-span-2"
              title="Missing statutory identifiers"
              subtitle="Each one blocks the remittance it belongs to"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Identifier' },
                  { key: 'value', label: 'People missing', align: 'right' },
                ],
                rows: rows(data.compliance.gaps),
              }}
            >
              {data.compliance.gaps.every((g) => g.value === 0) ? (
                <EmptyState icon={CheckCircle2} title="No gaps — every record is complete." />
              ) : (
                <RankedBars data={data.compliance.gaps.filter((g) => g.value > 0)} format="number" slot={4} rank />
              )}
            </ChartCard>
          </div>

          <StatGrid>
            <StatTile
              label="No reporting line"
              value={num(data.compliance.withoutReportingLine)}
              icon={Users}
              inverse
              hint="Blocks automatic reviewer assignment"
            />
            <StatTile
              label="No shift assigned"
              value={num(data.compliance.withoutShift)}
              icon={Clock}
              inverse
              hint="Attendance cannot be measured against a schedule"
            />
            <StatTile
              label="No bank account"
              value={num(data.compliance.withoutBankAccount)}
              icon={Banknote}
              inverse
              hint="Cannot be paid by transfer"
            />
            <StatTile
              label="No sign-in"
              value={num(data.compliance.withoutSignIn)}
              icon={ShieldAlert}
              inverse
              hint="Cannot clock in or file leave"
            />
          </StatGrid>

          {/* ---------------------------------------------------------- */}
          <Section title="Lifecycle" hint="Benchmarked against standard HRIS reporting — turnover, time-to-hire, offer acceptance and probation conversion" />

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Turnover" subtitle="Annualised against current headcount" height={200}>
              <div className="flex h-full flex-col justify-center gap-3 px-2">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-2">Voluntary (resigned)</span>
                  <span className="text-[15px] font-semibold text-ink">
                    {data.lifecycle.voluntaryTurnoverPct == null ? '—' : `${data.lifecycle.voluntaryTurnoverPct}%`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-2">Involuntary (terminated)</span>
                  <span className="text-[15px] font-semibold text-ink">
                    {data.lifecycle.involuntaryTurnoverPct == null ? '—' : `${data.lifecycle.involuntaryTurnoverPct}%`}
                  </span>
                </div>
                <p className="text-[11px] text-ink-3">
                  {data.lifecycle.voluntaryExitsInWindow + data.lifecycle.involuntaryExitsInWindow} exit(s) in{' '}
                  {data.window.label}
                </p>
              </div>
            </ChartCard>

            <ChartCard title="Time to hire" subtitle="Application to start date, averaged" height={200}>
              <div className="flex h-full flex-col items-center justify-center gap-1">
                {data.lifecycle.timeToHireDays == null ? (
                  <p className="text-[12px] text-ink-3">No pipeline hires in this window</p>
                ) : (
                  <>
                    <span className="text-3xl font-semibold text-ink">{data.lifecycle.timeToHireDays}</span>
                    <span className="text-[12px] text-ink-3">days, application to start date</span>
                  </>
                )}
              </div>
            </ChartCard>

            <ChartCard title="Offer acceptance" subtitle={`${num(data.lifecycle.offersAnswered)} offer(s) answered`} height={200}>
              <GaugeArc
                value={data.lifecycle.offerAcceptanceRate}
                label="Accepted"
                caption={data.lifecycle.offerAcceptanceRate == null ? 'No offers answered yet' : undefined}
                bands={{ warn: 70, bad: 50 }}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Probation conversion"
              subtitle={`${num(data.lifecycle.probationConvertedToRegular)} of ${num(data.lifecycle.probationResolved)} kept on`}
              height={200}
            >
              <GaugeArc
                value={data.lifecycle.probationConversionRate}
                label="Converted to Regular"
                caption={data.lifecycle.probationResolved === 0 ? 'Nobody has finished probation yet' : undefined}
                bands={{ warn: 70, bad: 50 }}
              />
            </ChartCard>

            <ChartCard
              title="201-file documents"
              subtitle={`${num(data.documentVault.verified)} of ${num(data.documentVault.required)} required documents verified`}
              height={200}
            >
              <GaugeArc
                value={data.documentVault.percent}
                label="Verified"
                bands={{ warn: 80, bad: 50 }}
              />
            </ChartCard>
          </div>

          <p className="pb-2 text-center text-[11px] text-ink-3">
            {data.window.label} · compared against {data.window.compare.label} · generated{' '}
            {fmtDate(data.generatedAt)}
          </p>
        </div>
      )}
    </>
  )
}
