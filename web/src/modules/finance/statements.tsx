import * as React from 'react'
import { Printer, Scale } from 'lucide-react'
import { financialStatements, type FinancialStatements, type StatementLine } from '@/data/analytics'
import { useResource } from '@/lib/api'
import { fmtDate, money, percent } from '@/lib/format'
import { printRegion } from '@/lib/export'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Segmented } from '@/components/ui/primitives'
import { ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { currentUser } from '@/app/auth'

/**
 * The three statements, as the ledger reports them.
 *
 * This screen used to claim it was "assembled from the general ledger" while
 * splitting operating expenses by hardcoded percentages and deriving investing
 * activities from a balance times 0.08. Every line now comes from posted
 * journal lines, which is why the expense breakdown is a list of real accounts
 * rather than a fixed set of labels.
 */

function StatementTable({ lines }: { lines: StatementLine[] }) {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {lines.map((line, i) => (
          <tr
            key={i}
            className={
              line.level === 0
                ? 'border-b border-line-strong'
                : line.emphasis
                  ? 'border-t border-line'
                  : 'border-b border-line/50'
            }
          >
            <td
              className={
                line.level === 0
                  ? 'px-4 py-2.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase'
                  : line.emphasis
                    ? 'px-4 py-2.5 font-semibold text-ink'
                    : `px-4 py-2 text-ink-2 ${line.level === 2 ? 'pl-8' : 'pl-6'}`
              }
            >
              {line.label}
            </td>
            <td
              className={`tabular px-4 py-2 text-right ${
                line.emphasis ? 'font-semibold text-ink' : line.level === 0 ? '' : 'text-ink-2'
              }`}
            >
              {line.level === 0 ? '' : money(line.amount, { decimals: false })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Statements() {
  const [view, setView] = React.useState<'pl' | 'bs' | 'cf'>('pl')
  const regionRef = React.useRef<HTMLDivElement>(null)

  const { data, isLoading, error, refetch } = useResource<FinancialStatements>(
    'finance/statements',
    financialStatements,
  )

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { profitAndLoss, balanceSheet, cashFlow } = data

  const current = { pl: profitAndLoss, bs: balanceSheet, cf: cashFlow }[view]

  const periodLabel =
    view === 'bs'
      ? `As at ${fmtDate(balanceSheet.asAt)}`
      : `${fmtDate(profitAndLoss.from)} — ${fmtDate(profitAndLoss.to)}`

  return (
    <div ref={regionRef}>
      <PageHeader
        title="Financial Statements"
        description="Assembled from posted journal lines. Print any statement onto company letterhead."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              size="sm"
              options={[
                { value: 'pl', label: 'P&L' },
                { value: 'bs', label: 'Balance Sheet' },
                { value: 'cf', label: 'Cash Flow' },
              ]}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                printRegion(regionRef.current, {
                  title: current.title,
                  subtitle: periodLabel,
                  preparedBy: currentUser().name,
                })
              }
            >
              <Printer className="size-3.5" />
              Print
            </Button>
          </>
        }
      />

      {/* A balance sheet that does not balance is the one thing this screen
          must never present quietly. */}
      {view === 'bs' && !balanceSheet.totals.balanced && (
        <Card className="mb-4 border-critical/40" data-print="keep">
          <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <Scale className="mt-0.5 size-4 shrink-0 text-critical" />
            <p className="text-[13px] text-ink-2">
              Assets do not equal liabilities plus equity — a difference of{' '}
              <strong className="text-critical">{money(balanceSheet.totals.difference)}</strong>. Something has reached
              the ledger without balancing. Check the trial balance before relying on this statement.
            </p>
          </div>
        </Card>
      )}

      <Card data-print="keep">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{current.title}</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">{periodLabel}</p>
          </div>

          {view === 'pl' && profitAndLoss.totals.netMarginPct !== null && (
            <Badge tone={profitAndLoss.totals.netProfit >= 0 ? 'good' : 'critical'}>
              {percent(profitAndLoss.totals.netMarginPct)} net margin
            </Badge>
          )}
          {view === 'bs' && (
            <Badge tone={balanceSheet.totals.balanced ? 'good' : 'critical'}>
              {balanceSheet.totals.balanced ? 'Balanced' : 'Out of balance'}
            </Badge>
          )}
          {view === 'cf' && (
            <Badge tone={cashFlow.totals.netMovement >= 0 ? 'good' : 'warning'}>
              {money(cashFlow.totals.netMovement, { decimals: false })} net movement
            </Badge>
          )}
        </header>

        <StatementTable lines={current.lines} />
      </Card>

      <p className="mt-3 text-[11px] text-ink-3">
        Every line is the sum of posted journal entries for the period. Nothing on this page is estimated or
        apportioned.
      </p>
    </div>
  )
}
