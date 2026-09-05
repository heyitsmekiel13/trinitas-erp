import { AlertTriangle, Gavel, ShieldCheck, TrendingUp } from 'lucide-react'
import { useResource } from '@/lib/api'
import { type WatchlistRow } from '@/lib/adminApi'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Card, CardHeader, ProgressBar } from '@/components/ui/primitives'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { ScanInfractions } from './actions'

/**
 * Infraction monitoring.
 *
 * The point of this screen is that discipline stops being run on memory.
 * Every row is a running total of points from cases that each cite the
 * attendance record behind them, and the standing is what those points warrant
 * under one stated rule — so two people with the same history get the same
 * answer regardless of who is handling the file.
 */

const STANDING_TONE: Record<string, 'good' | 'neutral' | 'warning' | 'serious' | 'critical'> = {
  Clear: 'good',
  'Under Review': 'neutral',
  'Verbal Warning': 'neutral',
  'Written Warning': 'warning',
  'Final Warning': 'serious',
  Suspension: 'critical',
}

/** The thresholds, stated on screen so the rule can be argued with. */
const LADDER = [
  { points: 1, action: 'Verbal Warning' },
  { points: 4, action: 'Written Warning' },
  { points: 8, action: 'Final Warning' },
  { points: 12, action: 'Suspension' },
]

export function Infractions() {
  const { data, isLoading, error, refetch } = useResource<WatchlistRow[]>('hr/watchlist', () => [])

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const totalPoints = data.reduce((s, r) => s + r.points, 0)
  const totalCases = data.reduce((s, r) => s + r.cases, 0)
  const atRisk = data.filter((r) => r.points >= 8).length

  return (
    <div>
      <PageHeader
        title="Infraction Monitoring"
        description="Who is accumulating infractions, and what their record warrants. Points expire after 90 days, so an old warning does not decide today's action."
        actions={<ScanInfractions />}
      />

      <StatGrid>
        <StatTile
          label="Employees with a record"
          value={num(data.length)}
          icon={Gavel}
          hint="Open cases in the last 90 days"
        />
        <StatTile label="Cases" value={num(totalCases)} icon={AlertTriangle} />
        <StatTile label="Points outstanding" value={num(totalPoints)} icon={TrendingUp} />
        <StatTile
          label="At final warning or beyond"
          value={num(atRisk)}
          icon={ShieldCheck}
          hint={atRisk > 0 ? 'Needs a decision, not another notice' : 'Nobody near the threshold'}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader
            title="Watchlist"
            subtitle="Ranked by points accumulated, worst first"
            action={<Badge tone="neutral">{num(data.length)}</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {data.length === 0 && (
              <EmptyState
                icon={ShieldCheck}
                title="Nobody on the watchlist"
                description="No open infractions in the last 90 days. Run a scan to check the attendance log."
              />
            )}
            {data.map((row) => (
              <div key={row.employeeId} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{row.name}</p>
                    <p className="text-[11px] text-ink-3">
                      {row.employeeNo}
                      {row.department ? ` · ${row.department}` : ''} · {num(row.cases)} case
                      {row.cases === 1 ? '' : 's'}
                      {row.openCases > 0 ? ` · ${num(row.openCases)} open` : ''}
                      {row.lastIncident ? ` · last ${fmtDate(row.lastIncident)}` : ''}
                    </p>
                  </div>
                  <Badge tone={STANDING_TONE[row.standing] ?? 'neutral'}>{row.standing}</Badge>
                  <span className="tabular shrink-0 text-[15px] font-semibold text-ink">{num(row.points)}</span>
                </div>

                {/* Progress toward suspension, which is the threshold that
                    actually matters to a manager reading this. */}
                <ProgressBar
                  className="mt-2"
                  value={Math.min(100, (row.points / 12) * 100)}
                  tone={row.points >= 12 ? 'critical' : row.points >= 8 ? 'warning' : 'good'}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card data-print="keep">
          <CardHeader title="How escalation works" subtitle="One rule, applied the same way to everybody" />
          <div className="divide-y divide-line border-t border-line">
            {LADDER.map((step) => (
              <div key={step.points} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="text-[13px] text-ink-2">{step.action}</span>
                <span className="tabular shrink-0 text-[13px] font-medium text-ink">{step.points}+ pts</span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-4 py-3">
            <p className="text-[11px] leading-relaxed text-ink-3">
              Tardiness carries 1 point, absence without leave 3, a policy violation 2 and a safety incident 4. Points
              from cases older than 90 days, and from closed cases, stop counting.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
