import * as React from 'react'
import { ArrowRight, CalendarPlus, CheckCircle2, ClipboardList, Download, Star, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource, queryClient } from '@/lib/api'
import {
  downloadReviewDocument,
  getPerformanceSummary,
  getReview,
  liveApi,
  moveReview,
  openReviewCycle,
  scoreReview,
  type PerformanceSummary,
  type ReviewDetail,
} from '@/lib/adminApi'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Combobox, Field, Input, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'

/**
 * Performance reviews, as a cycle you can actually run.
 *
 * The screen was a table whose status and rating columns were both free to
 * type — so a review could be "Completed" with no score, or carry a band that
 * contradicted the score beside it. The cycle now advances one stage at a
 * time through the API, and the rating is derived from the score when the
 * review closes rather than chosen alongside it.
 *
 * It sits in Process & Performance rather than in HR because that is where the
 * rest of the judgement already lived. The Evaluations page next to it records
 * what the office concluded about delivered work; a performance review is the
 * same act over a longer period and about a person rather than a task. Having
 * them in two departments meant a manager formed an opinion on one screen and
 * wrote it down on another, and the two never referred to each other.
 */

const RATING_TONE: Record<string, 'good' | 'info' | 'neutral' | 'warning' | 'critical'> = {
  Outstanding: 'good',
  'Exceeds Expectations': 'good',
  'Meets Expectations': 'info',
  'Needs Improvement': 'warning',
  Unsatisfactory: 'critical',
}

const STATUS_TONE: Record<string, 'good' | 'info' | 'neutral' | 'warning'> = {
  'Not Started': 'neutral',
  'Self-Assessment': 'info',
  'Manager Review': 'info',
  Calibration: 'warning',
  Completed: 'good',
}

/** The five bands, so somebody scoring knows what a number will produce. */
const BANDS = [
  { from: 4.5, label: 'Outstanding' },
  { from: 3.5, label: 'Exceeds Expectations' },
  { from: 2.5, label: 'Meets Expectations' },
  { from: 1.5, label: 'Needs Improvement' },
  { from: 0, label: 'Unsatisfactory' },
]

function ReviewPanel({ id, onChanged }: { id: number; onChanged: () => void }) {
  const toast = useToast()
  const [review, setReview] = React.useState<ReviewDetail | null>(null)
  const [busy, setBusy] = React.useState(false)

  const [score, setScore] = React.useState<number | null>(null)
  const [strengths, setStrengths] = React.useState('')
  const [development, setDevelopment] = React.useState('')
  const [downloading, setDownloading] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      const r = await getReview(id)
      setReview(r)
      setScore(r.score)
      setStrengths(r.strengths ?? '')
      setDevelopment(r.developmentAreas ?? '')
    } catch {
      setReview(null)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (score == null) return
    setBusy(true)
    try {
      setReview(await scoreReview(id, { score, strengths, developmentAreas: development }))
      onChanged()
      toast({ tone: 'success', title: 'Score saved' })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const downloadDocument = async () => {
    setDownloading(true)
    try {
      await downloadReviewDocument(id)
    } catch (err) {
      toast({ tone: 'error', title: 'Could not download that.', description: (err as Error).message })
    } finally {
      setDownloading(false)
    }
  }

  const advance = async (status: string) => {
    setBusy(true)
    try {
      setReview(await moveReview(id, status))
      onChanged()
      toast({ tone: 'success', title: `Moved to ${status}` })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not move it.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!review) return <p className="p-4 text-xs text-ink-3">Loading…</p>

  const done = review.status === 'Completed'
  // What this score would produce if the cycle closed now.
  const projected = score == null ? null : BANDS.find((b) => score >= b.from)?.label ?? 'Unsatisfactory'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink">{review.employee ?? 'Unknown'}</p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {review.period}
            {review.position && ` · ${review.position}`}
            {review.department && ` · ${review.department}`}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {review.reviewer ? `Reviewer: ${review.reviewer}` : 'No reviewer assigned'}
            {review.dueDate && ` · due ${fmtDate(review.dueDate)}`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[review.status] ?? 'neutral'}>{review.status}</Badge>
      </div>

      <div className="border-t border-line pt-3">
        <Field
          label="Score"
          hint={
            done
              ? 'The cycle is closed. Editing the score re-derives the rating.'
              : 'Out of 5. The rating band is settled from this when the review closes.'
          }
          composite
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={5}
              step={0.1}
              className="tabular w-24 text-right"
              value={score ?? ''}
              onChange={(e) => setScore(e.target.value === '' ? null : Number(e.target.value))}
            />
            {projected && (
              <Badge tone={RATING_TONE[projected] ?? 'neutral'}>
                {done ? projected : `would be ${projected}`}
              </Badge>
            )}
          </div>
        </Field>

        <Field label="Strengths" className="mt-3">
          <Textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            placeholder="What they do well, with an example."
          />
        </Field>

        <Field label="Development areas" className="mt-3">
          <Textarea
            value={development}
            onChange={(e) => setDevelopment(e.target.value)}
            placeholder="What to work on, and what support it needs."
          />
        </Field>

        <Button className="mt-3" size="sm" onClick={() => void save()} disabled={score == null || busy}>
          Save assessment
        </Button>
      </div>

      <div className="border-t border-line pt-3">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Cycle</p>
        {review.allowedMoves.length === 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[12px] text-good">
              <CheckCircle2 className="size-3.5" />
              Complete — rated {review.rating}. The employee can see this on their own page.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void downloadDocument()} loading={downloading}>
              <Download className="size-3.5" />
              Download signed record (PDF)
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {review.allowedMoves.map((status) => (
                <Button key={status} variant="secondary" size="sm" disabled={busy} onClick={() => void advance(status)}>
                  <ArrowRight className="size-3.5" />
                  {status}
                </Button>
              ))}
            </div>
            {review.allowedMoves.includes('Completed') && review.score == null && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
                <TriangleAlert className="mt-px size-3 shrink-0" />
                Save a score first — a completed review with no score has no rating to report.
              </p>
            )}
          </>
        )}
        <p className="mt-2 text-[11px] text-ink-3">
          The score and rating stay hidden from the employee until the cycle closes.
        </p>
      </div>
    </div>
  )
}

/**
 * Opening a cycle for a whole population at once.
 *
 * Reviews could only be created one employee at a time, with the reviewer
 * looked up and keyed by hand — several hours of transcription for a company
 * this size, and a fresh chance to point each review at the wrong manager.
 * The reporting line is already on the 201 file, so the cycle reads it.
 *
 * Re-running the same period is deliberately harmless: anybody who already
 * has a review keeps it, and only the gaps are filled. That is what makes it
 * usable for somebody who joined halfway through the cycle.
 */
function CycleDialog({
  open,
  onClose,
  onOpened,
}: {
  open: boolean
  onClose: () => void
  onOpened: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')

  const thisYear = new Date().getFullYear()
  const [period, setPeriod] = React.useState(`${thisYear} Annual`)
  const [dueDate, setDueDate] = React.useState('')
  const [departmentId, setDepartmentId] = React.useState<number | null>(null)

  const { data: departments = [] } = useResource<Record<string, unknown>[]>('hr/departments', () => [])

  const submit = async () => {
    setBusy(true)
    setProblem('')
    try {
      const r = await openReviewCycle({
        period: period.trim(),
        ...(dueDate ? { dueDate } : {}),
        ...(departmentId ? { departmentId } : {}),
      })
      toast({
        tone: 'success',
        title: r.created ? `${r.created} reviews opened for ${r.period}` : `Everyone already has a ${r.period} review`,
        description: [
          r.skipped ? `${r.skipped} already existed` : '',
          r.noReviewer ? `${r.noReviewer} have no reviewer in the reporting line` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })
      onOpened()
      onClose()
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a review cycle"
      description="Opens a review for every active employee in scope, with their manager as reviewer."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!period.trim() || busy} loading={busy}>
            Open cycle
          </Button>
        </>
      }
    >
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="Period" required hint="What this cycle is called on every review it opens.">
          <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder={`${thisYear} Annual`} />
        </Field>
        <Field label="Due date" hint="When the cycle should be closed. Drives the overdue count.">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field
          label="Scope"
          hint="Leave empty to open the cycle for every active employee."
          composite
          className="sm:col-span-2"
        >
          <Combobox
            value={departmentId}
            options={departments.map((d) => ({
              value: Number(d.id),
              label: String(d.name ?? ''),
              sublabel: String(d.code ?? ''),
            }))}
            onChange={(v) => setDepartmentId(v === null ? null : Number(v))}
            placeholder="Whole company"
          />
        </Field>
      </div>

      <p className="mt-3 text-[11px] text-ink-3">
        Anybody who already has a review for this period keeps it — running the same cycle again only fills the
        gaps, which is what you want for a mid-cycle joiner.
      </p>

      {problem && <p className="mt-3 text-[12px] text-critical">{problem}</p>}
    </Modal>
  )
}

export function PerformanceReviews() {
  const [summary, setSummary] = React.useState<PerformanceSummary | null>(null)
  const [selected, setSelected] = React.useState<number | null>(null)
  const [opening, setOpening] = React.useState(false)

  const { data: reviews = [], refetch } = useResource<Record<string, unknown>[]>('hr/reviews', () => [])

  const loadSummary = React.useCallback(async () => {
    if (!liveApi()) return
    try {
      setSummary(await getPerformanceSummary())
    } catch {
      setSummary(null)
    }
  }, [])

  React.useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const refresh = () => {
    void refetch()
    void loadSummary()
    void queryClient.invalidateQueries({ queryKey: ['resource'] })
  }

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Performance" description="Review cycles, scoring and calibration." />
        <div className="card">
          <EmptyState icon={Star} title="Performance needs the live API" description="Reviews are read and written straight to the database." />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Performance"
        description="Review cycles moved one stage at a time, with the rating derived from the score when each closes."
        actions={
          <Button onClick={() => setOpening(true)}>
            <CalendarPlus className="size-4" />
            Start review cycle
          </Button>
        }
      />

      <CycleDialog open={opening} onClose={() => setOpening(false)} onOpened={refresh} />

      {summary && (
        <StatGrid className="mb-4">
          <StatTile label="Reviews" value={num(summary.total)} icon={ClipboardList} hint={`${num(summary.completed)} complete`} />
          <StatTile label="In progress" value={num(summary.inProgress)} icon={ClipboardList} hint={`${num(summary.notStarted)} not started`} />
          <StatTile label="Overdue" value={num(summary.overdue)} icon={TriangleAlert} hint="Past due date, not yet complete" />
          <StatTile
            label="Average score"
            value={summary.averageScore === null ? '—' : summary.averageScore.toFixed(2)}
            icon={Star}
            hint="Completed reviews only"
          />
        </StatGrid>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[32rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2 text-left">Rating</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Star}
                      title="No review cycles yet"
                      description="Use Start review cycle above — it opens one for every active employee in scope, with their manager as reviewer."
                    />
                  </td>
                </tr>
              ) : (
                reviews.map((r) => (
                  <tr
                    key={Number(r.id)}
                    onClick={() => setSelected(Number(r.id))}
                    className={cn(
                      'cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-surface-2',
                      selected === Number(r.id) && 'bg-brand-50 dark:bg-brand-950',
                    )}
                  >
                    <td className="px-3 py-2 text-[13px] font-medium text-ink">{String(r.employee ?? '—')}</td>
                    <td className="px-3 py-2 text-[13px] text-ink-2">{String(r.period ?? '—')}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[String(r.status)] ?? 'neutral'}>{String(r.status)}</Badge>
                    </td>
                    <td className="tabular px-3 py-2 text-right text-[13px]">
                      {r.score == null ? '—' : Number(r.score).toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      {r.rating ? (
                        <Badge tone={RATING_TONE[String(r.rating)] ?? 'neutral'}>{String(r.rating)}</Badge>
                      ) : (
                        <span className="text-[12px] text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          {selected ? (
            <ReviewPanel id={selected} onChanged={refresh} />
          ) : (
            <EmptyState
              icon={Star}
              title="Pick a review"
              description="Score it, record strengths and development areas, and move it through the cycle."
            />
          )}
        </div>
      </div>
    </>
  )
}
