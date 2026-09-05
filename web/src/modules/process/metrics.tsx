import * as React from 'react'
import { Activity, EyeOff, Gauge, Loader2, RefreshCw, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Segmented } from '@/components/ui/primitives'
import { EmptyState, ErrorState } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { BarSeriesChart, ChartCard, Histogram, RankedBars, TrendChart } from '@/components/charts'
import { liveApi } from '@/lib/adminApi'
import { getProcessMetrics, type ProcessMetrics as Metrics } from '@/lib/workApi'

/**
 * Whether the process is improving.
 *
 * The register next door answers "what is wrong today". This page answers the
 * question a process office actually exists for, and could not previously ask:
 * are we getting faster, are we getting more done, and where does work pile up.
 *
 * Percentiles rather than averages throughout. One task that took ninety days
 * drags a mean far enough to make it meaningless, and the promise a team can
 * honestly make is not "about six days" but "eight days, five times out of
 * six" — which is what the 85th percentile says.
 */

const WINDOWS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: 'A year' },
]

/** A duration summary, with the percentile spread it was drawn from. */
function Durations({
  title,
  subtitle,
  data,
  empty,
}: {
  title: string
  subtitle: string
  data: Metrics['cycleTime']
  empty: string
}) {
  if (data.count === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
        <p className="mt-4 text-center text-[12px] text-ink-3">{empty}</p>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <h3 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{title}</h3>
      <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p>

      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="tabular text-[28px] leading-none font-semibold text-ink">{data.median}</span>
        <span className="text-[12px] text-ink-3">working days, typically</span>
      </p>

      <div className="mt-3 space-y-1.5 border-t border-line pt-3">
        {[
          ['85% finish within', data.p85],
          ['95% finish within', data.p95],
          ['Fastest', data.fastest],
          ['Slowest', data.slowest],
        ].map(([label, value]) => (
          <p key={label as string} className="flex items-baseline justify-between text-[12px]">
            <span className="text-ink-3">{label}</span>
            <span className="tabular font-medium text-ink">{value ?? '—'}d</span>
          </p>
        ))}
      </div>

      <p className="mt-2.5 border-t border-line pt-2 text-[11px] text-ink-3">
        From {num(data.count)} finished task{data.count === 1 ? '' : 's'}
      </p>
    </Card>
  )
}

export function ProcessMetricsPage() {
  const [window, setWindow] = React.useState('90')
  const [data, setData] = React.useState<Metrics | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await getProcessMetrics(Number(window)))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [window])

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
        <PageHeader title="Flow & Throughput" description="Whether the process is getting faster." />
        <Card>
          <EmptyState icon={Activity} title="These figures need the live API" />
        </Card>
      </>
    )
  }

  const coverage = data?.coverage

  return (
    <>
      <PageHeader
        title="Flow & Throughput"
        description="Cycle time, capacity and where work piles up — the measures that say whether the process is improving rather than how bad today is."
        meta={
          <Badge tone="warning">
            <EyeOff className="size-3" />
            Office only
          </Badge>
        }
        actions={
          <>
            <Segmented size="sm" value={window} onChange={setWindow} options={WINDOWS} />
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </>
        }
      />

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && !data && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {data && coverage && (
        <div className="space-y-4">
          {/* Coverage first, and deliberately so. Every other number on this
              page is computed over work that is in the system; if that is a
              tenth of what the company does, the rest is a sample, not a
              measurement, and the reader needs to know that before they read
              anything else. */}
          {(coverage.overall ?? 0) < 80 && (
            <Card className="flex items-start gap-3 border-warning/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3">
              <Gauge className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="text-[12px] leading-relaxed text-ink-2">
                <strong>Only {coverage.overall ?? 0}% of active staff have any tracked work.</strong> Every figure below
                is drawn from {num(coverage.covered)} of {num(coverage.headcount)} people, so treat it as a sample of
                the company rather than a measure of it. A department with nothing here is not necessarily performing
                well — it is not being measured.
              </p>
            </Card>
          )}

          <StatGrid>
            <StatTile
              label="Typical cycle time"
              value={data.cycleTime.median !== null ? `${data.cycleTime.median}d` : '—'}
              icon={Activity}
              hint={data.cycleTime.count > 0 ? `85% within ${data.cycleTime.p85}d` : 'Nothing finished yet'}
            />
            <StatTile
              label="Typical lead time"
              value={data.leadTime.median !== null ? `${data.leadTime.median}d` : '—'}
              icon={Activity}
              hint="From first movement, not from raising"
            />
            <StatTile
              label="Finished per week"
              value={num(
                Math.round(
                  data.throughput.reduce((sum, w) => sum + w.value, 0) / Math.max(data.throughput.length, 1),
                ),
              )}
              icon={TrendingUp}
              hint={`Averaged over ${data.throughput.length} weeks`}
            />
            <StatTile
              label="Workforce covered"
              value={coverage.overall !== null ? `${coverage.overall}%` : '—'}
              icon={Gauge}
              hint={`${num(coverage.covered)} of ${num(coverage.headcount)} people`}
              progress={{
                value: coverage.overall ?? 0,
                tone: (coverage.overall ?? 0) >= 80 ? 'good' : (coverage.overall ?? 0) >= 40 ? 'warning' : 'critical',
              }}
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <Durations
              title="Cycle time"
              subtitle="Raised to finished"
              data={data.cycleTime}
              empty="Nothing has finished in this window."
            />
            <Durations
              title="Lead time"
              subtitle="First movement to finished"
              data={data.leadTime}
              empty="No task has been moved and finished yet."
            />

            <ChartCard
              title="Coverage by department"
              subtitle="Staff with any tracked work"
              height={280}
              table={{
                columns: [
                  { key: 'name', label: 'Department' },
                  { key: 'covered', label: 'Covered', align: 'right' },
                  { key: 'headcount', label: 'Headcount', align: 'right' },
                ],
                rows: coverage.byDepartment as unknown as Record<string, unknown>[],
              }}
            >
              {/* Worst first — the useful end of this list is the bottom. */}
              <RankedBars
                data={coverage.byDepartment}
                format={(v) => `${v.toFixed(0)}%`}
                max={100}
                slot={4}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="On-time delivery over time"
              subtitle="The figure the dashboard shows for this month, given a history"
              table={{
                columns: [
                  { key: 'name', label: 'Month' },
                  { key: 'onTime', label: 'On time', align: 'right' },
                  { key: 'late', label: 'Late', align: 'right' },
                ],
                rows: data.onTimeTrend as unknown as Record<string, unknown>[],
              }}
            >
              {data.onTimeTrend.every((m) => m.value === null) ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  Nothing dated has been completed yet.
                </p>
              ) : (
                <TrendChart
                  data={data.onTimeTrend as unknown as Record<string, unknown>[]}
                  xKey="name"
                  format={(v) => `${v}%`}
                  series={[{ key: 'value', label: 'On-time %', kind: 'area', slot: 3 }]}
                />
              )}
            </ChartCard>

            <ChartCard
              title="Throughput"
              subtitle="Tasks finished each week — capacity, in plain terms"
              table={{
                columns: [
                  { key: 'name', label: 'Week of' },
                  { key: 'value', label: 'Finished', align: 'right' },
                ],
                rows: data.throughput as unknown as Record<string, unknown>[],
              }}
            >
              <BarSeriesChart
                data={data.throughput as unknown as Record<string, unknown>[]}
                xKey="name"
                format="number"
                series={[{ key: 'value', label: 'Finished', slot: 1 }]}
              />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="How long things take"
              subtitle="Finished work, banded by cycle time"
              table={{
                columns: [
                  { key: 'name', label: 'Band' },
                  { key: 'value', label: 'Tasks', align: 'right' },
                ],
                rows: (data.cycleTime.distribution ?? []) as unknown as Record<string, unknown>[],
              }}
            >
              <Histogram data={data.cycleTime.distribution ?? []} slot={1} />
            </ChartCard>

            <ChartCard
              title="Where work sits"
              subtitle="Stacked by column, day by day — a widening band is a queue forming"
              table={{
                columns: [
                  { key: 'label', label: 'Day' },
                  ...data.flow.sections.map((s) => ({ key: s, label: s, align: 'right' as const })),
                ],
                rows: data.flow.series,
              }}
            >
              {data.flow.sections.length === 0 ? (
                <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                  Not enough history to draw the flow yet.
                </p>
              ) : (
                <TrendChart
                  data={data.flow.series}
                  xKey="label"
                  format="number"
                  stacked
                  series={data.flow.sections.map((name, i) => ({
                    key: name,
                    label: name,
                    kind: 'area' as const,
                    slot: (i % 8) + 1,
                  }))}
                />
              )}
            </ChartCard>
          </div>

          <p className="pb-2 text-center text-[11px] text-ink-3">
            Working days throughout — weekends, public holidays, approved leave and time spent blocked are all excluded.
          </p>
        </div>
      )}
    </>
  )
}
