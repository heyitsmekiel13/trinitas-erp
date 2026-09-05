import * as React from 'react'
import {
  AlertTriangle,
  Banknote,
  BookCheck,
  Building2,
  Coins,
  CreditCard,
  Percent,
  Scale,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { financeDashboard, type FinanceDashboard } from '@/data/analytics'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart, ChartCard, DonutChart, RankedBars, TrendChart } from '@/components/charts'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { DashboardShell, type Period, type ReportOption } from '@/components/dashboard/DashboardShell'
import { useResource } from '@/lib/api'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'

/**
 * The Finance dashboard.
 *
 * Cash is what the cash accounts hold, profit is what the profit and loss says,
 * and the ageing buckets are the ones the AR and AP screens show — so a figure
 * here and the list behind it cannot disagree.
 */

const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

export function Dashboard() {
  const [period, setPeriod] = React.useState<Period>('ytd')

  const { data, isLoading, error, refetch } = useResource<FinanceDashboard>('finance/dashboard', financeDashboard)

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const {
    kpis,
    trend,
    cashByAccount,
    receivableAgeing,
    payableAgeing,
    expenseByCategory,
    topDebtors,
    upcomingObligations,
  } = data

  const reportOptions: ReportOption[] = [
    {
      id: 'summary',
      label: 'Financial summary',
      description: 'Cash, profit, receivables and payables.',
      build: () => [
        {
          kind: 'summary',
          title: 'Financial Summary',
          items: [
            { label: 'Cash position', value: money(kpis.cashPosition, { decimals: false }), note: `${num(kpis.bankAccounts)} active accounts` },
            { label: 'Revenue (year to date)', value: money(kpis.revenue, { decimals: false }) },
            { label: 'Gross profit', value: money(kpis.grossProfit, { decimals: false }), note: orDash(kpis.grossMarginPct, percent) },
            { label: 'Net profit', value: money(kpis.netProfit, { decimals: false }), note: orDash(kpis.netMarginPct, percent) },
            { label: 'Receivables', value: money(kpis.receivables, { decimals: false }), note: `${money(kpis.receivablesOverdue, { decimals: false })} overdue` },
            { label: 'Payables', value: money(kpis.payables, { decimals: false }), note: `${money(kpis.dueThisWeek, { decimals: false })} due this week` },
            { label: 'Working capital', value: money(kpis.workingCapital, { decimals: false }) },
            { label: 'Days sales outstanding', value: orDash(kpis.daysSalesOutstanding, (v) => `${v} days`) },
          ],
        },
      ],
    },
    {
      id: 'trend',
      label: 'Revenue and profit by month',
      description: 'Twelve months from the ledger.',
      build: () => [
        {
          kind: 'table',
          title: 'Revenue and Profit by Month',
          columns: ['Month', 'Revenue', 'Cost of sales', 'Expenses', 'Gross profit', 'Net profit'],
          rows: trend.map((t) => [
            t.month,
            money(t.revenue, { decimals: false }),
            money(t.cogs, { decimals: false }),
            money(t.expenses, { decimals: false }),
            money(t.grossProfit, { decimals: false }),
            money(t.netProfit, { decimals: false }),
          ]),
          total: [
            'TOTAL',
            money(trend.reduce((s, t) => s + t.revenue, 0), { decimals: false }),
            money(trend.reduce((s, t) => s + t.cogs, 0), { decimals: false }),
            money(trend.reduce((s, t) => s + t.expenses, 0), { decimals: false }),
            money(trend.reduce((s, t) => s + t.grossProfit, 0), { decimals: false }),
            money(trend.reduce((s, t) => s + t.netProfit, 0), { decimals: false }),
          ],
        },
      ],
    },
    {
      id: 'ageing',
      label: 'Receivables and payables ageing',
      description: 'What is owed to and by the business, by bucket.',
      build: () => [
        {
          kind: 'table',
          title: 'Receivables Ageing',
          columns: ['Bucket', 'Invoices', 'Balance'],
          rows: receivableAgeing.map((b) => [b.name, b.documents, money(b.value, { decimals: false })]),
          total: ['TOTAL', receivableAgeing.reduce((s, b) => s + b.documents, 0), money(kpis.receivables, { decimals: false })],
        },
        {
          kind: 'table',
          title: 'Payables Ageing',
          columns: ['Bucket', 'Bills', 'Balance'],
          rows: payableAgeing.map((b) => [b.name, b.documents, money(b.value, { decimals: false })]),
          total: ['TOTAL', payableAgeing.reduce((s, b) => s + b.documents, 0), money(kpis.payables, { decimals: false })],
        },
      ],
    },
    {
      id: 'debtors',
      label: 'Who owes the most',
      description: 'The collections call list, worst first.',
      defaultOn: false,
      build: () => [
        {
          kind: 'table',
          title: 'Top Debtors',
          columns: ['Customer', 'Invoices', 'Oldest (days)', 'Balance'],
          rows: topDebtors.map((d) => [d.name, d.invoices, d.oldestDays, money(d.value, { decimals: false })]),
        },
      ],
    },
  ]

  return (
    <DashboardShell
      title="Finance & Accounting"
      description="Cash, profit and what is owed — every figure derived from what has been posted to the general ledger."
      period={period}
      onPeriodChange={setPeriod}
      reportTitle="Financial Position Report"
      reportOptions={reportOptions}
      excelExport={{
        name: 'finance-trend',
        rows: trend,
        columns: [
          { header: 'Month', value: (r) => r.month },
          { header: 'Revenue', value: (r) => r.revenue },
          { header: 'Cost of sales', value: (r) => r.cogs },
          { header: 'Expenses', value: (r) => r.expenses },
          { header: 'Net profit', value: (r) => r.netProfit },
        ],
      }}
    >
      {/* The ledger has to be sound before anything above it means much, so a
          problem with it is stated at the top rather than buried. */}
      {(!kpis.trialBalanced || !kpis.balanceSheetBalanced) && (
        <Card data-print="keep" className="border-critical/40">
          <CardHeader
            title="The ledger does not balance"
            subtitle="Every figure on this page is derived from it, so this needs looking at before anything else."
            action={<Badge tone="critical">Check</Badge>}
          />
          <p className="px-4 py-3 text-[13px] text-ink-2 sm:px-5">
            {!kpis.trialBalanced && (
              <>
                The trial balance is out by <strong className="text-critical">{money(kpis.trialDifference)}</strong>.{' '}
              </>
            )}
            {!kpis.balanceSheetBalanced && <>Assets do not equal liabilities plus equity. </>}
            Rebuild the account balances from Chart of Accounts, and check for a journal posted outside the system.
          </p>
        </Card>
      )}

      <StatGrid>
        <StatTile
          label="Cash position"
          value={moneyCompact(kpis.cashPosition)}
          icon={Wallet}
          hint={`${num(kpis.bankAccounts)} account${kpis.bankAccounts === 1 ? '' : 's'}${kpis.unreconciled > 0 ? ` · ${num(kpis.unreconciled)} unreconciled` : ' · all reconciled'}`}
        />
        <StatTile
          label="Revenue"
          value={moneyCompact(kpis.revenue)}
          icon={TrendingUp}
          hint={`Year to date · ${orDash(kpis.grossMarginPct, percent)} gross margin`}
        />
        <StatTile
          label="Net profit"
          value={moneyCompact(kpis.netProfit)}
          icon={Percent}
          hint={kpis.netMarginPct === null ? 'No revenue posted yet' : `${percent(kpis.netMarginPct)} net margin`}
        />
        <StatTile
          label="Working capital"
          value={moneyCompact(kpis.workingCapital)}
          icon={Scale}
          hint="Cash and receivables, less what is owed"
        />
      </StatGrid>

      <StatGrid>
        <StatTile
          label="Receivables"
          value={moneyCompact(kpis.receivables)}
          icon={Banknote}
          hint={
            kpis.receivablesOverdue > 0
              ? `${moneyCompact(kpis.receivablesOverdue)} overdue across ${num(kpis.overdueInvoices)} invoice${kpis.overdueInvoices === 1 ? '' : 's'}`
              : `${num(kpis.receivablesCount)} open · none overdue`
          }
        />
        <StatTile
          label="Payables"
          value={moneyCompact(kpis.payables)}
          icon={CreditCard}
          hint={
            kpis.payablesOverdue > 0
              ? `${moneyCompact(kpis.payablesOverdue)} already late`
              : `${moneyCompact(kpis.dueThisWeek)} due this week`
          }
        />
        <StatTile
          label="Days sales outstanding"
          value={orDash(kpis.daysSalesOutstanding, (v) => `${v} d`)}
          icon={Coins}
          hint={kpis.daysSalesOutstanding === null ? 'No revenue to measure against' : 'How long the average peso takes to arrive'}
        />
        <StatTile
          label="Fixed assets"
          value={moneyCompact(kpis.fixedAssetsNbv)}
          icon={Building2}
          hint={
            kpis.depreciationDue > 0
              ? `${num(kpis.depreciationDue)} awaiting this month's depreciation`
              : 'Depreciation up to date'
          }
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Revenue and profit"
          subtitle="Twelve months, from posted journal lines"
          height={300}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'revenue', label: 'Revenue', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'grossProfit', label: 'Gross profit', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'netProfit', label: 'Net profit', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: trend,
          }}
        >
          <BarSeriesChart
            data={trend}
            xKey="month"
            series={[
              { key: 'revenue', label: 'Revenue', slot: 1 },
              { key: 'netProfit', label: 'Net profit', slot: 3 },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Cash by account"
          subtitle="What each bank actually holds"
          height={300}
          table={{
            columns: [
              { key: 'name', label: 'Account' },
              { key: 'value', label: 'Balance', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: cashByAccount,
          }}
        >
          {cashByAccount.length === 0 ? (
            <EmptyState icon={Wallet} title="No bank accounts" description="Add one under Banking & Cash." />
          ) : (
            <DonutChart
              data={cashByAccount}
              centerValue={moneyCompact(kpis.cashPosition)}
              centerLabel="Total cash"
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Receivables ageing"
          subtitle="How long the money has been owed"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Bucket' },
              { key: 'documents', label: 'Invoices', align: 'right' },
              { key: 'value', label: 'Balance', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: receivableAgeing,
          }}
        >
          {receivableAgeing.length === 0 ? (
            <EmptyState icon={Banknote} title="Nothing outstanding" description="Every invoice has been settled." />
          ) : (
            <RankedBars data={receivableAgeing} slot={2} emphasise={receivableAgeing.length - 1} />
          )}
        </ChartCard>

        <ChartCard
          title="Payables ageing"
          subtitle="How long suppliers have been waiting"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Bucket' },
              { key: 'documents', label: 'Bills', align: 'right' },
              { key: 'value', label: 'Balance', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: payableAgeing,
          }}
        >
          {payableAgeing.length === 0 ? (
            <EmptyState icon={CreditCard} title="Nothing owed" description="Every bill has been paid." />
          ) : (
            <RankedBars data={payableAgeing} slot={4} emphasise={payableAgeing.length - 1} />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Profit trend"
          subtitle="Gross and net profit, month by month"
          height={280}
          table={{
            columns: [
              { key: 'month', label: 'Month' },
              { key: 'grossProfit', label: 'Gross', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
              { key: 'netProfit', label: 'Net', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: trend,
          }}
        >
          <TrendChart
            data={trend}
            xKey="month"
            series={[
              { key: 'grossProfit', label: 'Gross profit', slot: 1, kind: 'area' },
              { key: 'netProfit', label: 'Net profit', slot: 3 },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Expenses by category"
          subtitle="Approved claims, year to date"
          height={280}
          table={{
            columns: [
              { key: 'name', label: 'Category' },
              { key: 'value', label: 'Amount', align: 'right', format: (v) => money(Number(v), { decimals: false }) },
            ],
            rows: expenseByCategory,
          }}
        >
          {expenseByCategory.length === 0 ? (
            <EmptyState icon={Coins} title="No claims approved" description="Approved expenses appear here." />
          ) : (
            <RankedBars data={expenseByCategory} slot={5} />
          )}
        </ChartCard>
      </div>

      {(topDebtors.length > 0 || upcomingObligations.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {topDebtors.length > 0 && (
            <Card data-print="keep">
              <CardHeader title="Who owes the most" subtitle="The collections call list, worst first" />
              <div className="divide-y divide-line border-t border-line">
                {topDebtors.map((debtor) => (
                  <div key={debtor.name} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{debtor.name}</p>
                      <p className="text-[11px] text-ink-3">
                        {num(debtor.invoices)} invoice{debtor.invoices === 1 ? '' : 's'}
                        {debtor.oldestDays > 0 ? ` · oldest ${num(debtor.oldestDays)} days late` : ' · none overdue'}
                      </p>
                    </div>
                    {debtor.oldestDays > 0 && (
                      <Badge tone={debtor.oldestDays > 60 ? 'critical' : 'warning'}>{debtor.oldestDays}d</Badge>
                    )}
                    <span className="tabular shrink-0 text-[13px] font-medium text-ink">
                      {money(debtor.value, { decimals: false })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {upcomingObligations.length > 0 && (
            <Card data-print="keep">
              <CardHeader
                title="Falling due"
                subtitle="Bills and returns in the next thirty days"
                action={<Badge tone="warning">{num(upcomingObligations.length)}</Badge>}
              />
              <div className="divide-y divide-line border-t border-line">
                {upcomingObligations.map((item, i) => (
                  <div key={`${item.kind}-${item.label}-${i}`} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">
                        {item.label}
                        {item.party ? <span className="text-ink-3"> · {item.party}</span> : null}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {item.kind} · {item.due ? fmtDate(item.due) : 'no date'}
                      </p>
                    </div>
                    <Badge tone={item.daysToDue < 0 ? 'critical' : item.daysToDue <= 7 ? 'warning' : 'neutral'}>
                      {item.daysToDue < 0 ? `${Math.abs(item.daysToDue)}d late` : `${item.daysToDue}d`}
                    </Badge>
                    <span className="tabular shrink-0 text-[13px] font-medium text-ink">
                      {money(item.amount, { decimals: false })}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {(kpis.draftJournals > 0 || kpis.expenseClaims > 0) && (
        <Card data-print="keep">
          <CardHeader title="Waiting on someone" subtitle="Nothing here has reached the ledger yet" />
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 sm:px-5">
            {kpis.draftJournals > 0 && (
              <p className="text-[13px] text-ink-2">
                <BookCheck className="mr-1.5 inline size-3.5 text-ink-3" />
                <strong className="text-ink">{num(kpis.draftJournals)}</strong> draft journal
                {kpis.draftJournals === 1 ? '' : 's'} not yet posted.
              </p>
            )}
            {kpis.expenseClaims > 0 && (
              <p className="text-[13px] text-ink-2">
                <AlertTriangle className="mr-1.5 inline size-3.5 text-ink-3" />
                <strong className="text-ink">{num(kpis.expenseClaims)}</strong> expense claim
                {kpis.expenseClaims === 1 ? '' : 's'} awaiting approval, worth{' '}
                {money(kpis.expenseClaimsValue, { decimals: false })}.
              </p>
            )}
          </div>
        </Card>
      )}
    </DashboardShell>
  )
}
