import * as React from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Eye, Layers, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateTime, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { MiniTable } from '@/components/dashboard/MiniTable'
import { ChartCard, DonutChart, GaugeArc, Histogram, RankedBars, TrendChart } from '@/components/charts'
import { liveApi } from '@/lib/adminApi'
import { getComplianceDashboard, type ComplianceDashboard } from '@/lib/workApi'
import { PersonBadge } from './shared'

/**
 * Delivery, seen from the office.
 *
 * One question runs down the page: is work landing when it was promised, and
 * if not, where. Every tile and chart is a different cut of that — nothing
 * here counts activity for its own sake, because "tasks created this week" is
 * the number project dashboards reach for when they have nothing to say.
 */
export function DeliveryDashboard() {
  const [data, setData] = React.useState<ComplianceDashboard | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await getComplianceDashboard())
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    void load()
  }, [load])

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Delivery Dashboard" description="On-time rate, overdue ageing and the projects carrying risk." />
        <Card>
          <EmptyState icon={ShieldCheck} title="This dashboard needs the live API" />
        </Card>
      </>
    )
  }

  const k = data?.kpis

  return (
    <>
      <PageHeader
        title="Delivery Dashboard"
        description="Whether work is landing when it was promised — and where it is not."
        meta={data && <span className="text-[11px] text-ink-3">Updated {fmtDateTime(data.generatedAt)}</span>}
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error && !data && <ErrorState error={error} onRetry={() => void load()} />}
      {loading && !data && <SkeletonDashboard />}

      {data && k && (
        <div className="space-y-4">
          <StatGrid>
            <StatTile
              label="Open tasks"
              value={num(k.openTasks)}
              icon={ListChecks}
              hint={`${num(k.undated)} with no deadline`}
            />
            <StatTile
              label="Overdue"
              value={num(k.overdue)}
              icon={AlertTriangle}
              inverse
              hint={k.overdue === 0 ? 'Everything is inside its date' : 'Past the date they were promised for'}
            />
            <StatTile label="Due today" value={num(k.dueToday)} icon={CalendarClock} hint={`${num(k.dueThisWeek)} this week`} />
            <StatTile
              label="Open observations"
              value={num(k.openFlags)}
              icon={ShieldCheck}
              inverse
              hint={`${num(k.criticalFlags)} critical`}
            />
          </StatGrid>

          {/* Coverage, stated before anything else is read.

              Every figure on this page is computed over work that is in the
              system. Without this line beside them, a department that never
              adopted the board shows no findings and reads as flawless — the
              page would be quietly rewarding non-participation. */}
          {data.coverage && (data.coverage.overall ?? 0) < 80 && (
            <Card className="flex items-start gap-3 border-warning/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3">
              <Eye className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-[12px] leading-relaxed text-ink-2">
                <strong>
                  {data.coverage.overall ?? 0}% of active staff have any tracked work — {num(data.coverage.covered)} of{' '}
                  {num(data.coverage.headcount)}.
                </strong>{' '}
                Everything below is measured over those people only. A department with no findings here may simply have
                nothing in the system; that is not the same as being on time.
              </p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="On-time rate"
              subtitle="Work completed this month, against its deadline"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Measure' },
                  { key: 'value', label: 'Tasks', align: 'right' },
                ],
                rows: [
                  { name: 'Completed this month', value: k.completedThisMonth },
                  { name: 'Of those, on time', value: k.onTimeThisMonth },
                  { name: 'Of those, late', value: k.completedThisMonth - k.onTimeThisMonth },
                ] as unknown as Record<string, unknown>[],
              }}
            >
              <GaugeArc
                value={k.onTimeRate}
                label="Delivered on time"
                caption={
                  k.completedThisMonth === 0
                    ? 'Nothing dated has finished this month'
                    : `${num(k.onTimeThisMonth)} of ${num(k.completedThisMonth)}`
                }
                bands={{ warn: 85, bad: 70 }}
              />
            </ChartCard>

            <ChartCard
              title="On-time delivery, by month"
              subtitle="The gauge on the left, given a history"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Month' },
                  { key: 'onTime', label: 'On time', align: 'right' },
                  { key: 'late', label: 'Late', align: 'right' },
                ],
                rows: (data.onTimeTrend ?? []) as unknown as Record<string, unknown>[],
              }}
            >
              {(data.onTimeTrend ?? []).every((m) => m.value === null) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  Nothing dated has been completed yet.
                </p>
              ) : (
                <TrendChart
                  data={(data.onTimeTrend ?? []) as unknown as Record<string, unknown>[]}
                  xKey="name"
                  format={(v) => `${v}%`}
                  series={[{ key: 'value', label: 'On-time %', kind: 'area', slot: 3 }]}
                />
              )}
            </ChartCard>

            <ChartCard
              title="How late is late"
              subtitle="Open work, banded by how far past its date it is"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Band' },
                  { key: 'value', label: 'Tasks', align: 'right' },
                ],
                rows: data.ageing as unknown as Record<string, unknown>[],
              }}
            >
              {/* Bands in order, never re-sorted by size — the shape is the
                  finding, and a ranking would hide whether this is one bad
                  week or a year of accumulated debt. */}
              <Histogram data={data.ageing} slot={2} />
            </ChartCard>

            <ChartCard
              title="Observations by severity"
              subtitle="Everything open in the register"
              height={240}
              table={{
                columns: [
                  { key: 'name', label: 'Severity' },
                  { key: 'value', label: 'Open', align: 'right' },
                ],
                rows: data.flagsBySeverity as unknown as Record<string, unknown>[],
              }}
            >
              {k.openFlags === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing outstanding.</p>
              ) : (
                <DonutChart
                  data={data.flagsBySeverity.filter((s) => s.value > 0)}
                  format="number"
                  centerLabel="Open"
                  centerValue={num(k.openFlags)}
                />
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="What is going wrong"
              subtitle="Open observations, by kind"
              table={{
                columns: [
                  { key: 'name', label: 'Kind' },
                  { key: 'value', label: 'Open', align: 'right' },
                ],
                rows: data.flagsByKind as unknown as Record<string, unknown>[],
              }}
            >
              {data.flagsByKind.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nothing recorded.</p>
              ) : (
                <RankedBars data={data.flagsByKind} format="number" slot={4} rank showShare />
              )}
            </ChartCard>

            <ChartCard
              title="Where the observations sit"
              subtitle="People carrying the most unresolved items"
              table={{
                columns: [
                  { key: 'name', label: 'Person' },
                  { key: 'value', label: 'Open', align: 'right' },
                ],
                rows: data.worstOffenders as unknown as Record<string, unknown>[],
              }}
            >
              {data.worstOffenders.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">Nobody has open items.</p>
              ) : (
                <RankedBars data={data.worstOffenders} format="number" slot={2} rank />
              )}
            </ChartCard>
          </div>

          <Card className="overflow-hidden">
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <Layers className="size-4 text-ink-3" />
              <h2 className="text-[13px] font-semibold text-ink">Projects</h2>
              <span className="text-[11px] text-ink-3">Worst first, by what is overdue inside them</span>
            </header>

            <MiniTable
              rows={data.projects}
              rowKey={(p) => p.id}
              maxHeight={520}
              empty="No active projects."
              emptyIcon={CheckCircle2}
              columns={[
                {
                  key: 'name',
                  label: 'Project',
                  render: (p) => (
                    <div className="leading-tight">
                      <p className="font-mono text-[10px] text-ink-3">{p.code}</p>
                      <p className="text-[12px] font-medium text-ink">{p.name}</p>
                    </div>
                  ),
                },
                {
                  key: 'owner',
                  label: 'Owner',
                  render: (p) => (
                    <span className="flex items-center gap-2">
                      <PersonBadge name={p.owner} size="xs" />
                      <span className="text-[12px] text-ink-2">{p.owner ?? '—'}</span>
                    </span>
                  ),
                },
                { key: 'status', label: 'Status', render: (p) => <Badge tone="neutral">{p.status}</Badge> },
                { key: 'open', label: 'Open', align: 'right', render: (p) => num(p.openTasks) },
                {
                  key: 'overdue',
                  label: 'Overdue',
                  align: 'right',
                  render: (p) => (
                    <span className={cn('font-medium', p.overdueTasks > 0 ? 'text-critical' : 'text-ink-3')}>
                      {num(p.overdueTasks)}
                    </span>
                  ),
                },
                {
                  key: 'progress',
                  label: 'Progress',
                  width: 'w-40',
                  render: (p) => (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="block h-full rounded-full bg-brand-500"
                          style={{ width: `${p.progress}%` }}
                        />
                      </span>
                      <span className="tabular w-9 text-right text-[12px] text-ink">{p.progress}%</span>
                    </span>
                  ),
                },
              ]}
            />
          </Card>

          <p className="flex items-center justify-center gap-1.5 pb-2 text-[11px] text-ink-3">
            <Clock className="size-3" />
            The scan behind these figures runs every morning at 06:30, and reminders go out at 07:00.
          </p>
        </div>
      )}
    </>
  )
}
