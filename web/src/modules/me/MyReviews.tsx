import * as React from 'react'
import { CheckCircle2, Loader2, MessageSquareWarning, Scale, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { Badge, Button, Card, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import { liveApi } from '@/lib/adminApi'
import { getMyReviews, respondToReview, type MyReview } from '@/lib/supportApi'

/**
 * Delivery reviews the Process & Performance office has shared with me.
 *
 * This exists because the compliance layer was, correctly, invisible — and
 * that is only defensible while a finding stays inside the office. The moment
 * a verdict is going to be used in a rating or a conversation, a person has to
 * be able to read it and answer it, and there was previously no path for
 * either.
 *
 * What is deliberately *not* here: the observation register. Those are what
 * the data shows, they are recorded automatically, and exposing them would
 * mean nothing ever got recorded honestly. Only a verdict — a judgement a
 * named person signed — is ever disclosed, and only when the office chooses to.
 *
 * Most people will see an empty state here for ever. That is the intended
 * outcome, not a gap.
 */

const VERDICT_TONE: Record<string, 'good' | 'neutral' | 'warning' | 'critical'> = {
  Exemplary: 'good',
  Compliant: 'good',
  'Minor delay': 'warning',
  'Non-compliant': 'critical',
}

const STATUS_TONE: Record<string, 'neutral' | 'warning' | 'good' | 'brand'> = {
  'Awaiting response': 'warning',
  Accepted: 'good',
  Disputed: 'brand',
  Closed: 'neutral',
}

function Respond({ review, onDone }: { review: MyReview; onDone: () => void }) {
  const toast = useToast()
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const send = async (accept: boolean) => {
    if (!text.trim()) return

    setBusy(true)
    try {
      await respondToReview(review.id, text.trim(), accept)
      toast({
        tone: 'success',
        title: accept ? 'Response recorded' : 'Dispute recorded',
        description: accept
          ? 'Noted against the review.'
          : 'The office will answer it, and can change the verdict if you are right.',
      })
      onDone()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send that', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
      <p className="mb-2 text-[12px] font-medium text-ink">Your response</p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="If something here is wrong or there is context the office does not have, say so. This is recorded alongside the review."
        className="text-[13px]"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Two buttons rather than a dropdown: accepting and disputing are
            different acts with different consequences, and burying that
            distinction in a select makes it easy to pick the wrong one. */}
        <Button size="sm" variant="secondary" onClick={() => void send(true)} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />}
          This is fair
        </Button>
        <Button size="sm" variant="primary" onClick={() => void send(false)} disabled={busy || !text.trim()}>
          <Scale className="size-3.5" />
          I disagree with this
        </Button>
        <span className="text-[11px] text-ink-3">Either way it is recorded. Disputing asks the office to answer.</span>
      </div>
    </div>
  )
}

export function MyReviews() {
  const [reviews, setReviews] = React.useState<MyReview[]>([])
  const [awaiting, setAwaiting] = React.useState(0)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getMyReviews()
      setReviews(data.reviews)
      setAwaiting(data.awaitingResponse)
    } catch {
      // A person with nothing shared with them is the ordinary case, and a
      // failure here must never take the rest of My Workspace down with it.
      setReviews([])
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

  // Nothing shared, nothing to say. Deliberately renders no empty state at
  // all — a permanent "no reviews" card would imply somebody is looking.
  if (loading || reviews.length === 0) return null

  return (
    <section>
      <header className="mb-2 flex items-center gap-2.5">
        <span className={cn('h-4 w-1 rounded-full', awaiting > 0 ? 'bg-warning' : 'bg-line-strong')} aria-hidden />
        <h2 className="text-[13px] font-semibold text-ink">Delivery reviews shared with you</h2>
        {awaiting > 0 && <Badge tone="warning">{awaiting} awaiting your response</Badge>}
      </header>

      <div className="space-y-3">
        {reviews.map((review) => (
          <Card key={review.id} className="p-4">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  {review.reference && <span className="font-mono text-[10px] text-ink-3">{review.reference}</span>}
                  <span className="text-[14px] font-semibold text-ink">{review.title ?? 'A piece of work'}</span>
                </p>
                {review.project && <p className="text-[11px] text-ink-3">{review.project}</p>}
              </div>
              <Badge tone={VERDICT_TONE[review.verdict] ?? 'neutral'}>{review.verdict}</Badge>
              <Badge tone={STATUS_TONE[review.status] ?? 'neutral'}>{review.status}</Badge>
            </div>

            {/* The facts, before the judgement — the same order the office
                sees them in, so the two sides are reading the same thing. */}
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-4">
              {[
                ['Due', review.dueDate ? fmtDate(review.dueDate) : 'No date'],
                ['Completed', review.completedOn ? fmtDate(review.completedOn) : '—'],
                [
                  'Timeliness',
                  review.timelinessDays === null
                    ? 'Not measurable'
                    : review.timelinessDays > 0
                      ? `${review.timelinessDays} working days late`
                      : review.timelinessDays === 0
                        ? 'On the day'
                        : `${Math.abs(review.timelinessDays)} days early`,
                ],
                ['Reviewed by', review.reviewer ?? '—'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</p>
                  <p
                    className={cn(
                      'text-[12px] font-medium text-ink',
                      label === 'Timeliness' && (review.timelinessDays ?? 0) > 0 && 'text-critical',
                    )}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {review.findings && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Findings</p>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{review.findings}</p>
              </div>
            )}

            {review.actionRequired && (
              <div className="mt-3 rounded-lg border border-warning/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-2.5">
                <p className="text-[11px] font-semibold tracking-wide text-warning uppercase">What is being asked</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{review.actionRequired}</p>
                {review.followUpOn && (
                  <p className="mt-1 text-[11px] text-ink-3">Follow-up on {fmtDate(review.followUpOn)}</p>
                )}
              </div>
            )}

            {review.myResponse && (
              <div className="mt-3 rounded-lg border border-line p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                  <MessageSquareWarning className="size-3" />
                  You said
                  {review.myRespondedAt && (
                    <span className="font-normal normal-case">· {fmtDateTime(review.myRespondedAt)}</span>
                  )}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{review.myResponse}</p>
              </div>
            )}

            {review.officeReply && (
              <div className="mt-2 rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                  <CheckCircle2 className="size-3" />
                  The office replied
                  {review.officeRepliedAt && (
                    <span className="font-normal normal-case">· {fmtDateTime(review.officeRepliedAt)}</span>
                  )}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{review.officeReply}</p>
              </div>
            )}

            {review.canRespond && <Respond review={review} onDone={() => void load()} />}
          </Card>
        ))}
      </div>
    </section>
  )
}
