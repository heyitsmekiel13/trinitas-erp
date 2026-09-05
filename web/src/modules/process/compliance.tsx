import * as React from 'react'
import { AlertTriangle, CheckCircle2, EyeOff, Loader2, RefreshCw, ScanLine, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Select } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { MiniTable } from '@/components/dashboard/MiniTable'
import { liveApi } from '@/lib/adminApi'
import {
  acknowledgeFlag,
  getComplianceFlags,
  resolveFlag,
  runComplianceScan,
  type ComplianceFlagRow,
} from '@/lib/workApi'
import { PersonBadge } from './shared'

/**
 * The compliance register.
 *
 * The office's own screen, and the reason the department exists. Nobody
 * outside it can reach the endpoint behind this page — the API answers 404,
 * not 403, so a person cannot even learn that an assessment of them is being
 * kept.
 *
 * The register is observations, not verdicts. Every row here is something the
 * data says: this was late, this deadline moved four times, this has not been
 * touched in three weeks. What it means is a person's call, recorded on the
 * Evaluations page. Keeping the two apart is what stops the register being
 * argued with — you cannot dispute that a date moved.
 */

const SEVERITY_TONE: Record<string, 'critical' | 'warning' | 'neutral'> = {
  Critical: 'critical',
  High: 'critical',
  Medium: 'warning',
  Low: 'neutral',
}

const SEVERITY_BAR: Record<string, string> = {
  Critical: 'bg-critical',
  High: 'bg-critical/70',
  Medium: 'bg-warning',
  Low: 'bg-line-strong',
}

const KINDS = [
  ['', 'Every kind'],
  ['overdue', 'Past its deadline'],
  ['late_completion', 'Delivered late'],
  ['due_date_moved', 'Deadline moved repeatedly'],
  ['stalled', 'No movement'],
  ['no_due_date', 'No deadline set'],
  ['unassigned', 'Nobody assigned'],
  ['wip_exceeded', 'Column over its limit'],
] as const

/** Renders whatever the scanner recorded alongside an observation. */
function Detail({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail || Object.keys(detail).length === 0) return null

  const labels: Record<string, string> = {
    daysLate: 'days late',
    dueDate: 'due',
    moves: 'moves',
    originalDue: 'first agreed',
    currentDue: 'now',
    driftDays: 'drift',
    idleDays: 'idle days',
    ageDays: 'age',
    openedOn: 'opened',
    completedOn: 'completed',
    deadlineMoves: 'deadline moves',
    lastTouched: 'last touched',
    section: 'column',
    open: 'open',
    limit: 'limit',
  }

  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
      {Object.entries(detail)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => (
          <span key={key} className="text-[10px] text-ink-3">
            {labels[key] ?? key}: <span className="text-ink-2">{String(value)}</span>
          </span>
        ))}
    </div>
  )
}

export function ComplianceRegister() {
  const toast = useToast()
  const [flags, setFlags] = React.useState<ComplianceFlagRow[]>([])
  const [kind, setKind] = React.useState('')
  const [severity, setSeverity] = React.useState('')
  const [includeResolved, setIncludeResolved] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [scanning, setScanning] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setFlags(await getComplianceFlags({ kind: kind || undefined, severity: severity || undefined, includeResolved }))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [kind, severity, includeResolved])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    void load()
  }, [load])

  const scan = async () => {
    setScanning(true)
    try {
      const counts = await runComplianceScan()
      const raised = Object.entries(counts)
        .filter(([key]) => key !== 'scores' && key !== 'resolved')
        .reduce((sum, [, value]) => sum + value, 0)

      toast({
        tone: 'success',
        title: raised > 0 ? `${raised} new observation(s)` : 'Nothing new to record',
        description: `${counts.resolved ?? 0} closed automatically · ${counts.scores ?? 0} scorecard(s) rebuilt.`,
      })
      await load()
    } catch (e) {
      toast({ tone: 'error', title: 'The scan failed', description: (e as Error).message })
    } finally {
      setScanning(false)
    }
  }

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Compliance Register" description="Observations on late, stalled and undated work." />
        <Card>
          <EmptyState icon={ShieldCheck} title="The register needs the live API" />
        </Card>
      </>
    )
  }

  const bySeverity = (level: string) => flags.filter((f) => f.severity === level && !f.resolved).length

  return (
    <>
      <PageHeader
        title="Compliance Register"
        description="What the data shows about how work is landing. Observations only — the verdict on each one is recorded under Evaluations."
        meta={
          <Badge tone="warning">
            <EyeOff className="size-3" />
            Office only
          </Badge>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => void scan()} disabled={scanning}>
              {scanning ? <Loader2 className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />}
              Run the scan
            </Button>
          </>
        }
      />

      {/* A one-line explanation of who can see this. It is the least obvious
          thing about the page and the most important. */}
      <div className="card mb-4 flex items-start gap-2.5 p-3 text-[12px] text-ink-2" data-print="hide">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="leading-relaxed">
          Visible to the Process &amp; Performance office only. The people named below use the same board and cannot
          reach this page — the API refuses it for every other account, so nobody learns that a record of their delivery
          is kept. The scan runs itself every morning at 06:30; the button above only brings it forward.
        </p>
      </div>

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3" data-print="hide">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-56 text-[13px]" aria-label="Kind">
          {KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="h-8 w-40 text-[13px]"
          aria-label="Severity"
        >
          <option value="">Any severity</option>
          {['Critical', 'High', 'Medium', 'Low'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
            className="accent-[var(--color-brand-500)]"
          />
          Include closed
        </label>

        <div className="ml-auto flex items-center gap-2">
          {['Critical', 'High', 'Medium', 'Low'].map((level) => (
            <span key={level} className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className={cn('size-2 rounded-full', SEVERITY_BAR[level])} />
              {level} {bySeverity(level)}
            </span>
          ))}
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && flags.length === 0 && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && flags.length === 0 && !error && (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Nothing to report"
            description="No open observations match this filter. Either the work is landing, or the scan has not run since the last change."
          />
        </Card>
      )}

      {flags.length > 0 && (
        <Card className="overflow-hidden">
          <MiniTable
            rows={flags}
            rowKey={(f) => f.id}
            maxHeight={900}
            columns={[
              {
                key: 'severity',
                label: '',
                width: 'w-1',
                // A bar rather than a badge: the register is read by scanning
                // down the left edge for the red ones.
                render: (f) => (
                  <span
                    className={cn('block h-8 w-1 rounded-full', SEVERITY_BAR[f.severity], f.resolved && 'opacity-30')}
                    title={f.severity}
                  />
                ),
              },
              {
                key: 'summary',
                label: 'Observation',
                render: (f) => (
                  <div className={cn(f.resolved && 'opacity-55')}>
                    <p className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-ink">{f.summary}</span>
                      <Badge tone={SEVERITY_TONE[f.severity] ?? 'neutral'}>{f.kindLabel}</Badge>
                      {f.resolved && <Badge tone="good">closed</Badge>}
                    </p>
                    <Detail detail={f.detail} />
                  </div>
                ),
              },
              {
                key: 'task',
                label: 'Task',
                render: (f) => (
                  <div className="leading-tight">
                    <p className="font-mono text-[10px] text-ink-3">{f.taskRef ?? '—'}</p>
                    <p className="max-w-[16rem] truncate text-[12px] text-ink-2">{f.taskTitle ?? '—'}</p>
                    {f.project && <p className="text-[10px] text-ink-3">{f.project}</p>}
                  </div>
                ),
              },
              {
                key: 'subject',
                label: 'Assigned to',
                render: (f) => (
                  <span className="flex items-center gap-2">
                    <PersonBadge name={f.subject} size="xs" />
                    <span className="text-[12px] text-ink-2">{f.subject ?? 'Nobody'}</span>
                  </span>
                ),
              },
              {
                key: 'observed',
                label: 'Observed',
                render: (f) => <span className="text-[12px] text-ink-3">{f.observedOn ? fmtDate(f.observedOn) : '—'}</span>,
              },
              {
                key: 'actions',
                label: '',
                align: 'right',
                render: (f) =>
                  f.resolved ? (
                    <span className="text-[11px] text-ink-3">closed</span>
                  ) : (
                    <span className="flex justify-end gap-1">
                      {!f.acknowledged && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await acknowledgeFlag(f.id)
                            await load()
                          }}
                          title="Mark as seen by the office"
                        >
                          Seen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await resolveFlag(f.id)
                          await load()
                        }}
                        title="Close this observation"
                      >
                        Close
                      </Button>
                    </span>
                  ),
              },
            ]}
          />
        </Card>
      )}

      {flags.length > 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-3">
          <AlertTriangle className="size-3" />
          {num(flags.filter((f) => !f.resolved).length)} open observation(s). Closing one keeps it in the history — it
          only stops it competing for attention.
        </p>
      )}
    </>
  )
}
