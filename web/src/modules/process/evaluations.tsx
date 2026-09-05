import * as React from 'react'
import { ClipboardCheck, EyeOff, Gavel, Loader2, RefreshCw, Scale, Send, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Input, Segmented, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlay'
import { MiniTable } from '@/components/dashboard/MiniTable'
import { GaugeArc, RankedBars } from '@/components/charts'
import { liveApi } from '@/lib/adminApi'
import {
  discloseReview,
  escalateReview,
  getEvaluationQueue,
  getReviews,
  getScores,
  recordEvaluation,
  replyToReview,
  type EvaluationQueueRow,
  type ReviewRow,
  type ScoreRow,
} from '@/lib/workApi'
import { PersonBadge } from './shared'

/**
 * The office's judgement, and the scorecards it rolls up to.
 *
 * The register next door records what happened. This page records what the
 * office concluded about it — and the split matters, because only the second
 * one can be wrong about a person. A system that hands out verdicts
 * automatically gets ignored the first time it is unfair; a system where a
 * named reviewer signs each one does not.
 *
 * `timelinessDays` is never typed. It comes from the task, so the verdict is
 * a judgement and the number beside it stays a fact.
 */

const VERDICTS = ['Exemplary', 'Compliant', 'Minor delay', 'Non-compliant'] as const

const VERDICT_TONE: Record<string, 'good' | 'neutral' | 'warning' | 'critical'> = {
  Exemplary: 'good',
  Compliant: 'good',
  'Minor delay': 'warning',
  'Non-compliant': 'critical',
}

/** Suggests a verdict from the facts, without deciding it. */
function suggestVerdict(row: EvaluationQueueRow): (typeof VERDICTS)[number] {
  const late = row.daysLate ?? 0

  if (late <= -1 && row.deadlineMoves === 0) return 'Exemplary'
  if (late <= 0 && row.deadlineMoves <= 1) return 'Compliant'
  if (late <= 2 && row.deadlineMoves <= 2) return 'Minor delay'

  return 'Non-compliant'
}

function EvaluateDialog({
  row,
  onClose,
  onSaved,
}: {
  row: EvaluationQueueRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [verdict, setVerdict] = React.useState<(typeof VERDICTS)[number]>('Compliant')
  const [quality, setQuality] = React.useState<string>('')
  const [findings, setFindings] = React.useState('')
  const [action, setAction] = React.useState('')
  const [followUp, setFollowUp] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!row) return

    // Pre-selected from the facts so the common case is one click, but every
    // field stays editable — the suggestion is not the decision.
    setVerdict(suggestVerdict(row))
    setQuality('')
    setFindings('')
    setAction('')
    setFollowUp('')
  }, [row])

  if (!row) return null

  const submit = async () => {
    setSaving(true)
    try {
      await recordEvaluation({
        task_id: row.taskId,
        verdict,
        quality_score: quality === '' ? null : Number(quality),
        findings: findings || null,
        action_required: action || null,
        follow_up_on: followUp || null,
      })
      toast({ tone: 'success', title: 'Verdict recorded', description: `${row.reference} — ${verdict}.` })
      onSaved()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not record it', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const late = row.daysLate ?? 0

  return (
    <Modal open onClose={onClose} title="Record a verdict" description={`${row.reference} — ${row.title}`} size="lg">
      {/* The facts, stated before the judgement is asked for. */}
      <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-4">
        {[
          ['Assigned to', row.subject ?? 'Nobody'],
          ['Due', row.dueDate ? fmtDate(row.dueDate) : 'No date'],
          ['Completed', row.completedOn ? fmtDate(row.completedOn) : '—'],
          [
            'Timeliness',
            row.daysLate === null ? 'Not measurable' : late > 0 ? `${late}d late` : late === 0 ? 'On the day' : `${Math.abs(late)}d early`,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</p>
            <p
              className={cn(
                'text-[13px] font-medium text-ink',
                label === 'Timeliness' && late > 0 && 'text-critical',
                label === 'Timeliness' && late < 0 && 'text-good',
              )}
            >
              {value}
            </p>
          </div>
        ))}

        {(row.deadlineMoves > 0 || row.reassignments > 0) && (
          <div className="col-span-2 border-t border-line pt-2 sm:col-span-4">
            <p className="text-[11px] text-ink-2">
              {row.deadlineMoves > 0 && (
                <>
                  Deadline moved <span className="font-semibold text-warning">{row.deadlineMoves}×</span>
                  {row.originalDue && <> from {fmtDate(row.originalDue)}</>}.{' '}
                </>
              )}
              {row.reassignments > 0 && <>Reassigned {row.reassignments}×.</>}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <span className="mb-1.5 block text-[11px] font-medium text-ink-2">Verdict</span>
          <div className="flex flex-wrap gap-1.5">
            {VERDICTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVerdict(v)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
                  verdict === v
                    ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-line text-ink-2 hover:border-line-strong',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          {verdict === suggestVerdict(row) && (
            <p className="mt-1.5 text-[11px] text-ink-3">Suggested from the dates. Change it if the circumstances say otherwise.</p>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Findings</span>
          <Textarea
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            rows={3}
            placeholder="What actually happened, and why. This is the part that has to stand up if it is questioned."
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Quality score</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              placeholder="0–100"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Follow up on</span>
            <Input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Action required</span>
          <Textarea
            value={action}
            onChange={(e) => setAction(e.target.value)}
            rows={2}
            placeholder="What the office wants changed. Left blank when nothing needs to happen."
          />
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Record verdict
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Everything the office can do to a recorded verdict.
 *
 * Three acts, and the order between them is enforced by the API rather than
 * by this dialog: disclose, then answer whatever comes back, and only then
 * escalate. A disciplinary case raised off a finding the person has never seen
 * is precisely what the disclosure step exists to prevent, so the escalate
 * button stays disabled until it has happened.
 */
function ReviewActions({
  review,
  onClose,
  onDone,
}: {
  review: ReviewRow | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [note, setNote] = React.useState('')
  const [reply, setReply] = React.useState('')
  const [verdict, setVerdict] = React.useState<string>('')
  const [details, setDetails] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    setNote('')
    setReply('')
    setVerdict('')
    setDetails('')
  }, [review])

  if (!review) return null

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      toast({ tone: 'success', title: success })
      onDone()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not do that', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={review.title ?? 'Review'}
      description={`${review.reference ?? ''} · ${review.subject ?? 'Unknown'} · ${review.verdict}`}
      size="lg"
      headerAside={<Badge tone={STATUS_TONE[review.responseStatus] ?? 'neutral'}>{review.responseStatus}</Badge>}
    >
      <div className="space-y-4">
        {review.findings && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[10px] tracking-wide text-ink-3 uppercase">Findings</p>
            <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{review.findings}</p>
          </div>
        )}

        {/* Step one. Until this happens the subject does not know it exists. */}
        {!review.disclosed && (
          <section>
            <h3 className="text-[13px] font-semibold text-ink">Share this with {review.subject ?? 'them'}</h3>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
              They will be able to read the verdict and the findings, and answer them. Do this before the verdict is
              used in a review conversation or a decision — a finding somebody has never seen is not one they can be
              held to.
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-2"
              placeholder="Anything to say alongside it. Optional."
            />
            <Button
              className="mt-2"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => discloseReview(review.id, note || undefined), 'Shared with the subject')}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Share it
            </Button>
          </section>
        )}

        {/* Step two, once they have answered. */}
        {review.subjectResponse && (
          <section>
            <div className="rounded-xl border border-brand-400/40 bg-brand-50/40 p-3 dark:bg-brand-950/30">
              <p className="text-[10px] tracking-wide text-ink-3 uppercase">
                {review.subject} responded
                {review.responseStatus === 'Disputed' && ' — disputed'}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{review.subjectResponse}</p>
            </div>

            {['Disputed', 'Awaiting response'].includes(review.responseStatus) && (
              <div className="mt-3">
                <h3 className="text-[13px] font-semibold text-ink">Answer it</h3>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  A dispute nobody answers is process in appearance only. If they are right, correct the verdict here.
                </p>
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  className="mt-2"
                  placeholder="What the office concludes, and why."
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="h-8 w-44 text-[12px]">
                    <option value="">Leave the verdict as it is</option>
                    {VERDICTS.map((v) => (
                      <option key={v} value={v}>
                        Change to {v}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !reply.trim()}
                    onClick={() =>
                      void run(
                        () => replyToReview(review.id, { reply: reply.trim(), outcome: 'Accepted', verdict: verdict || undefined }),
                        'Answered — they were right',
                      )
                    }
                  >
                    <Scale className="size-3.5" />
                    They have a point
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || !reply.trim()}
                    onClick={() =>
                      void run(
                        () => replyToReview(review.id, { reply: reply.trim(), outcome: 'Closed', verdict: verdict || undefined }),
                        'Answered — the verdict stands',
                      )
                    }
                  >
                    The verdict stands
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Step three, and the office's limit. */}
        <section className="border-t border-line pt-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <ShieldAlert className="size-3.5 text-critical" />
            Raise a disciplinary case
          </h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
            This office establishes whether work landed on time. It does not impose penalties — that needs a notice to
            explain, a chance to answer, a hearing and a decision, which Employee Relations already carries. Raising a
            case hands it over and steps back.
          </p>

          {review.escalatedCaseNo ? (
            <p className="mt-2 text-[12px] text-ink-2">
              Already escalated as <strong>{review.escalatedCaseNo}</strong>. Follow it under HR → Employee Relations.
            </p>
          ) : (
            <>
              <Textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                className="mt-2"
                placeholder="What the case is about. This becomes the case detail HR works from."
                disabled={!review.disclosed}
              />
              <Button
                className="mt-2"
                variant="danger"
                size="sm"
                disabled={busy || !review.disclosed || !details.trim()}
                onClick={() => void run(() => escalateReview(review.id, details.trim()), 'Case raised')}
              >
                <ShieldAlert className="size-3.5" />
                Raise the case
              </Button>
              {!review.disclosed && (
                <p className="mt-1.5 text-[11px] text-warning">
                  Share the verdict with them first. A case raised off something they have never seen will not survive
                  being questioned.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}

const STATUS_TONE: Record<string, 'neutral' | 'warning' | 'good' | 'brand'> = {
  Internal: 'neutral',
  'Awaiting response': 'warning',
  Accepted: 'good',
  Disputed: 'brand',
  Closed: 'neutral',
}

type Tab = 'queue' | 'recorded' | 'scorecards'

export function Evaluations() {
  const [tab, setTab] = React.useState<Tab>('queue')
  const [queue, setQueue] = React.useState<EvaluationQueueRow[]>([])
  const [reviews, setReviews] = React.useState<ReviewRow[]>([])
  const [scores, setScores] = React.useState<{ period: string; rows: ScoreRow[] } | null>(null)
  const [evaluating, setEvaluating] = React.useState<EvaluationQueueRow | null>(null)
  const [acting, setActing] = React.useState<ReviewRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [q, r, s] = await Promise.all([getEvaluationQueue(), getReviews(), getScores()])
      setQueue(q)
      setReviews(r)
      setScores(s)
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
        <PageHeader title="Evaluations" description="Verdicts on delivered work." />
        <Card>
          <EmptyState icon={ClipboardCheck} title="Evaluations need the live API" />
        </Card>
      </>
    )
  }

  const teamRate =
    scores && scores.rows.length > 0
      ? scores.rows.reduce((sum, r) => sum + (r.onTimeRate ?? 0), 0) / scores.rows.filter((r) => r.onTimeRate !== null).length
      : null

  return (
    <>
      <PageHeader
        title="Evaluations"
        description="What the office concluded about work that has landed, and the scorecards those conclusions roll up to."
        meta={
          <Badge tone="warning">
            <EyeOff className="size-3" />
            Office only
          </Badge>
        }
        actions={
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="mb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'queue', label: `Awaiting a verdict${queue.length ? ` (${queue.length})` : ''}` },
            { value: 'recorded', label: `Recorded${reviews.length ? ` (${reviews.length})` : ''}` },
            { value: 'scorecards', label: 'Scorecards' },
          ]}
        />
      </div>

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {!loading && tab === 'queue' && (
        <Card className="overflow-hidden">
          {queue.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nothing waiting"
              description="Every task finished in the last 60 days already carries a verdict."
            />
          ) : (
            <MiniTable
              rows={queue}
              rowKey={(r) => r.taskId}
              maxHeight={900}
              columns={[
                {
                  key: 'task',
                  label: 'Task',
                  render: (r) => (
                    <div className="leading-tight">
                      <p className="font-mono text-[10px] text-ink-3">{r.reference}</p>
                      <p className="max-w-[20rem] truncate text-[12px] font-medium text-ink">{r.title}</p>
                      {r.project && <p className="text-[10px] text-ink-3">{r.project}</p>}
                    </div>
                  ),
                },
                {
                  key: 'subject',
                  label: 'Delivered by',
                  render: (r) => (
                    <span className="flex items-center gap-2">
                      <PersonBadge name={r.subject} size="xs" />
                      <span className="text-[12px] text-ink-2">{r.subject ?? '—'}</span>
                    </span>
                  ),
                },
                {
                  key: 'timeliness',
                  label: 'Timeliness',
                  render: (r) => {
                    const late = r.daysLate
                    if (late === null) return <span className="text-[12px] text-ink-3">No deadline</span>

                    return (
                      <span
                        className={cn(
                          'text-[12px] font-medium',
                          late > 0 ? 'text-critical' : late === 0 ? 'text-ink-2' : 'text-good',
                        )}
                      >
                        {late > 0 ? `${late}d late` : late === 0 ? 'On the day' : `${Math.abs(late)}d early`}
                      </span>
                    )
                  },
                },
                {
                  key: 'signals',
                  label: 'Signals',
                  render: (r) => (
                    <span className="flex flex-wrap gap-1">
                      {r.deadlineMoves > 0 && <Badge tone="warning">{r.deadlineMoves}× moved</Badge>}
                      {r.reassignments > 0 && <Badge tone="neutral">{r.reassignments}× reassigned</Badge>}
                      {r.deadlineMoves === 0 && r.reassignments === 0 && <span className="text-[11px] text-ink-3">Clean</span>}
                    </span>
                  ),
                },
                {
                  key: 'completed',
                  label: 'Completed',
                  render: (r) => <span className="text-[12px] text-ink-3">{r.completedOn ? fmtDate(r.completedOn) : '—'}</span>,
                },
                {
                  key: 'action',
                  label: '',
                  align: 'right',
                  render: (r) => (
                    <Button size="sm" variant="secondary" onClick={() => setEvaluating(r)}>
                      <Gavel className="size-3.5" />
                      Evaluate
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {!loading && tab === 'recorded' && (
        <Card className="overflow-hidden">
          {reviews.length === 0 ? (
            <EmptyState icon={Gavel} title="No verdicts recorded yet" />
          ) : (
            <MiniTable
              rows={reviews}
              rowKey={(r) => r.id}
              maxHeight={900}
              columns={[
                {
                  key: 'verdict',
                  label: 'Verdict',
                  render: (r) => <Badge tone={VERDICT_TONE[r.verdict] ?? 'neutral'}>{r.verdict}</Badge>,
                },
                {
                  key: 'task',
                  label: 'Task',
                  render: (r) => (
                    <div className="leading-tight">
                      <p className="font-mono text-[10px] text-ink-3">{r.reference ?? '—'}</p>
                      <p className="max-w-[18rem] truncate text-[12px] text-ink-2">{r.title ?? '—'}</p>
                    </div>
                  ),
                },
                { key: 'subject', label: 'Subject', render: (r) => <span className="text-[12px] text-ink-2">{r.subject ?? '—'}</span> },
                {
                  key: 'timeliness',
                  label: 'Days late',
                  align: 'right',
                  render: (r) => (
                    <span className={cn('text-[12px]', (r.timelinessDays ?? 0) > 0 && 'text-critical')}>
                      {r.timelinessDays ?? '—'}
                    </span>
                  ),
                },
                {
                  key: 'findings',
                  label: 'Findings',
                  render: (r) => <span className="line-clamp-2 max-w-[22rem] text-[12px] text-ink-3">{r.findings ?? '—'}</span>,
                },
                { key: 'reviewer', label: 'Reviewer', render: (r) => <span className="text-[12px] text-ink-3">{r.reviewer ?? '—'}</span> },
                {
                  key: 'shared',
                  label: 'Shared',
                  render: (r) => (
                    <span className="flex flex-col gap-0.5">
                      <Badge tone={STATUS_TONE[r.responseStatus] ?? 'neutral'}>{r.responseStatus}</Badge>
                      {r.escalatedCaseNo && <span className="text-[10px] text-critical">{r.escalatedCaseNo}</span>}
                    </span>
                  ),
                },
                {
                  key: 'act',
                  label: '',
                  align: 'right',
                  render: (r) => (
                    <Button size="sm" variant="ghost" onClick={() => setActing(r)}>
                      {r.disclosed ? 'Open' : 'Share…'}
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      )}

      {!loading && tab === 'scorecards' && scores && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Team on-time rate · {scores.period}
              </h3>
              <div className="h-48">
                <GaugeArc
                  value={teamRate ?? null}
                  label="On time"
                  caption={`${num(scores.rows.length)} people with work due`}
                  bands={{ warn: 85, bad: 70 }}
                />
              </div>
            </Card>

            <Card className="p-4 lg:col-span-2">
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">On-time rate by person</h3>
              <div className="h-48">
                {scores.rows.length === 0 ? (
                  <p className="flex h-full items-center justify-center text-[12px] text-ink-3">
                    Nobody had work due in this period.
                  </p>
                ) : (
                  <RankedBars
                    format={(v) => `${v.toFixed(0)}%`}
                    max={100}
                    data={scores.rows
                      .filter((r) => r.onTimeRate !== null)
                      .sort((a, b) => (a.onTimeRate ?? 0) - (b.onTimeRate ?? 0))
                      .map((r) => ({
                        name: r.name ?? '—',
                        value: r.onTimeRate ?? 0,
                        meta: `${r.onTime} on time of ${r.tasksDue} due${r.late > 0 ? ` · ${r.late} late` : ''}`,
                      }))}
                  />
                )}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <MiniTable
              rows={scores.rows}
              rowKey={(r) => r.userId}
              maxHeight={700}
              empty="No scorecards for this period."
              columns={[
                {
                  key: 'name',
                  label: 'Person',
                  render: (r) => (
                    <span className="flex items-center gap-2">
                      <PersonBadge name={r.name} size="xs" />
                      <span>
                        <span className="block text-[12px] font-medium text-ink">{r.name}</span>
                        {r.department && <span className="block text-[10px] text-ink-3">{r.department}</span>}
                      </span>
                    </span>
                  ),
                },
                { key: 'due', label: 'Due', align: 'right', render: (r) => num(r.tasksDue) },
                { key: 'onTime', label: 'On time', align: 'right', render: (r) => num(r.onTime) },
                {
                  key: 'late',
                  label: 'Late',
                  align: 'right',
                  render: (r) => <span className={cn(r.late > 0 && 'text-critical')}>{num(r.late)}</span>,
                },
                {
                  key: 'overdue',
                  label: 'Still open',
                  align: 'right',
                  render: (r) => <span className={cn(r.stillOverdue > 0 && 'text-critical')}>{num(r.stillOverdue)}</span>,
                },
                {
                  key: 'moved',
                  label: 'Deadlines moved',
                  align: 'right',
                  render: (r) => <span className={cn(r.deadlinesMoved > 2 && 'text-warning')}>{num(r.deadlinesMoved)}</span>,
                },
                {
                  key: 'rate',
                  label: 'On-time rate',
                  width: 'w-40',
                  render: (r) =>
                    r.onTimeRate === null ? (
                      <span className="text-[12px] text-ink-3">—</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${r.onTimeRate}%`,
                              background:
                                r.onTimeRate >= 85
                                  ? 'var(--color-good)'
                                  : r.onTimeRate >= 70
                                    ? 'var(--color-warning)'
                                    : 'var(--color-critical)',
                            }}
                          />
                        </span>
                        <span className="tabular w-10 text-right text-[12px] font-medium text-ink">
                          {r.onTimeRate.toFixed(0)}%
                        </span>
                      </span>
                    ),
                },
              ]}
            />
          </Card>

          <p className="text-[11px] text-ink-3">
            Measured against everything that was due in the period, not against what was finished — otherwise ignoring a
            task would improve the score. Rebuilt on every read, so a corrected deadline corrects the number.
          </p>
        </div>
      )}

      <EvaluateDialog row={evaluating} onClose={() => setEvaluating(null)} onSaved={() => void load()} />
      <ReviewActions review={acting} onClose={() => setActing(null)} onDone={() => void load()} />
    </>
  )
}
