import * as React from 'react'
import {
  ArrowLeft, ArrowRight, Ban, CheckCircle2, ClipboardList, FileSearch, Handshake,
  MessageSquare, Send, Sparkles, UserPlus, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Tone } from '@/components/ui/primitives'
import { Badge, Button } from '@/components/ui/primitives'
import type { Assessment, ApplicantDetail } from '@/lib/adminApi'

/**
 * The pipeline as a guided sequence rather than a row of buttons.
 *
 * The board already refused illegal moves — the server has always decided what
 * may follow what — but the screen showed the result as a handful of
 * same-looking buttons labelled with stage names. So a recruiter looking at
 * "Assessment · Interview · Rejected" had to already know which of those was
 * forward, which was back, and what the stage they were in even meant. People
 * pressed one and hoped.
 *
 * What changed is not the rules. It is that the screen now says, in order:
 *
 *   where they are          a rail of every stage, with the ones behind them
 *                           filled in and the ones ahead greyed
 *   what this step is for   a sentence about what happens at this stage
 *   what to do now          one primary button, worded as the thing you are
 *                           actually doing — "Invite to interview", not
 *                           "Interview"
 *   everything else         back a step, or reject, kept deliberately quieter
 *
 * Each stage owns a colour, and the same colour is used for the rail, the
 * badge on the row and the tile on the board, so a stage is recognisable
 * before it is read.
 */

export type StageId =
  | 'Applied' | 'Screening' | 'Interview' | 'Assessment'
  | 'Final Interview' | 'Offer' | 'Hired' | 'Rejected'

export type StageDef = {
  id: StageId
  /** Short name for the rail and the badge. */
  label: string
  tone: Tone
  icon: React.ComponentType<{ className?: string }>
  /** What happens at this stage, in one line. */
  meaning: string
  /** The primary action out of it, worded as the act rather than the destination. */
  advance: string
  /** The bar and dot colour on the rail. Tailwind classes, not tokens, so the
   *  eight stages stay visually distinct rather than reusing four tones. */
  bar: string
  ring: string
}

/**
 * The seven stages in order, plus the one that sits outside them.
 *
 * The colours run cool to warm to green deliberately: it reads as progress
 * even to somebody who has never been told what the stages are.
 */
export const STAGES: StageDef[] = [
  {
    id: 'Applied',
    label: 'Applied',
    tone: 'neutral',
    icon: Users,
    meaning: 'They have applied and nobody has looked yet.',
    advance: 'Start screening',
    bar: 'bg-slate-400 dark:bg-slate-500',
    ring: 'ring-slate-400/40',
  },
  {
    id: 'Screening',
    label: 'Screening',
    tone: 'info',
    icon: FileSearch,
    meaning: 'Reading the CV against the advert — does this person meet the requirements on paper?',
    advance: 'Invite to interview',
    bar: 'bg-sky-500',
    ring: 'ring-sky-500/40',
  },
  {
    id: 'Interview',
    label: 'Interview',
    tone: 'brand',
    icon: MessageSquare,
    meaning: 'The first conversation. Can they do the job, and do they want it?',
    advance: 'Send for assessment',
    bar: 'bg-indigo-500',
    ring: 'ring-indigo-500/40',
  },
  {
    id: 'Assessment',
    label: 'Assessment',
    tone: 'warning',
    icon: ClipboardList,
    meaning: 'A test, a practical or a work sample — evidence rather than an impression.',
    advance: 'Move to final interview',
    bar: 'bg-amber-500',
    ring: 'ring-amber-500/40',
  },
  {
    id: 'Final Interview',
    label: 'Final',
    tone: 'serious',
    icon: Handshake,
    meaning: 'The decision-maker meets them. After this you either offer or you do not.',
    advance: 'Prepare an offer',
    bar: 'bg-orange-500',
    ring: 'ring-orange-500/40',
  },
  {
    id: 'Offer',
    label: 'Offer',
    tone: 'good',
    icon: Send,
    meaning: 'Terms in writing, waiting on their answer.',
    advance: 'Hire them',
    bar: 'bg-emerald-500',
    ring: 'ring-emerald-500/40',
  },
  {
    id: 'Hired',
    label: 'Hired',
    tone: 'good',
    icon: UserPlus,
    meaning: 'They work here. Their 201 file is in the masterfile.',
    advance: '',
    bar: 'bg-green-600',
    ring: 'ring-green-600/40',
  },
]

export const REJECTED: StageDef = {
  id: 'Rejected',
  label: 'Rejected',
  tone: 'critical',
  icon: Ban,
  meaning: 'Not going further. They can be put back into the pipeline if that was wrong.',
  advance: 'Put back into the pipeline',
  bar: 'bg-red-500',
  ring: 'ring-red-500/40',
}

export const stageOf = (id: string): StageDef =>
  id === 'Rejected' ? REJECTED : (STAGES.find((s) => s.id === id) ?? STAGES[0])

/** The tone map the table badges and board tiles read. */
export const STAGE_TONE: Record<string, Tone> = Object.fromEntries(
  [...STAGES, REJECTED].map((s) => [s.id, s.tone]),
)

export const stageBar = (id: string): string => stageOf(id).bar

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where they are, at a glance.
 *
 * Stages behind them are filled in their own colour, the current one is filled
 * and ringed, and the ones ahead are hollow. A rejected applicant shows the
 * rail they left, greyed, with the rejection sitting at the end — because
 * "rejected from Assessment" and "rejected on day one" are different facts and
 * a single red pill says neither.
 */
export function StageRail({ stage, compact }: { stage: string; compact?: boolean }) {
  const rejected = stage === 'Rejected'
  const index = STAGES.findIndex((s) => s.id === stage)

  return (
    <div className="flex items-center gap-1" aria-label={`Stage: ${stage}`}>
      {STAGES.map((s, i) => {
        const done = !rejected && index > i
        const current = !rejected && index === i

        return (
          <React.Fragment key={s.id}>
            {i > 0 && (
              <span
                className={cn(
                  'h-0.5 flex-1 rounded-full',
                  done || current ? STAGES[i - 1].bar : 'bg-line',
                  rejected && 'opacity-30',
                )}
              />
            )}
            <span
              title={`${s.id} — ${s.meaning}`}
              className={cn(
                'shrink-0 rounded-full transition-all',
                compact ? 'size-2' : 'size-2.5',
                done || current ? s.bar : 'bg-line',
                current && !compact && `ring-4 ${s.ring}`,
                rejected && 'opacity-30',
              )}
            />
          </React.Fragment>
        )
      })}

      {rejected && (
        <>
          <span className="h-0.5 w-4 rounded-full bg-red-500/40" />
          <span className={cn('shrink-0 rounded-full bg-red-500', compact ? 'size-2' : 'size-2.5 ring-4 ring-red-500/40')} />
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The recommendation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * What the assessment engine already computed, said as advice rather than
 * a decision made for you.
 *
 * `CandidateAssessment` on the server scores every application against the
 * advert it was made for, but nothing acted on that score — a recruiter had
 * to open the assessment tab and read it themselves. This puts the same
 * verdict where the decision is actually made, worded as a recommendation a
 * person can take or ignore. It never moves a stage on its own: the button
 * beside it is still the recruiter's own click.
 */
const RECOMMENDATION: Record<Assessment['band'], { label: string; tone: Tone; lean: 'shortlist' | 'review' | 'caution' | null }> = {
  'Strong match': { label: 'Recommended: shortlist', tone: 'good', lean: 'shortlist' },
  Possible: { label: 'Recommended: review closely', tone: 'warning', lean: 'review' },
  'Weak match': { label: 'Recommended: likely not a fit', tone: 'critical', lean: 'caution' },
  'Not enough to say': { label: 'Not enough to score', tone: 'neutral', lean: null },
}

export function RecommendationBanner({ assessment, matchScore }: { assessment: Assessment | null; matchScore: number | null }) {
  if (!assessment) return null

  const rec = RECOMMENDATION[assessment.band]

  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-2.5">
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={rec.tone}>{rec.label}</Badge>
          {matchScore !== null && <span className="text-[11px] text-ink-3">{matchScore}% match</span>}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{assessment.summary}</p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The guided step                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One step of the cycle, with one obvious thing to do next.
 *
 * The primary button is whatever moves them forward, worded as the act. The
 * quieter controls are the ones you rarely want: stepping back to correct a
 * mis-click, and rejecting. Rejection is deliberately not styled as a
 * destructive twin of the primary action — it is a real outcome, not a
 * mistake, but it should never be the button somebody hits by muscle memory.
 */
export function GuidedStep({
  applicant,
  busy,
  onMove,
  onHire,
  onOffer,
}: {
  applicant: ApplicantDetail
  busy: boolean
  onMove: (stage: string) => void
  onHire: () => void
  onOffer: () => void
}) {
  const current = stageOf(applicant.stage)
  const index = STAGES.findIndex((s) => s.id === applicant.stage)

  const forward = applicant.allowedMoves.find(
    (m) => m !== 'Rejected' && STAGES.findIndex((s) => s.id === m) > index,
  )
  const back = applicant.allowedMoves.find(
    (m) => m !== 'Rejected' && STAGES.findIndex((s) => s.id === m) < index,
  )
  const canReject = applicant.allowedMoves.includes('Rejected')

  const Icon = current.icon

  /*
   * At Offer the forward move is not a stage change at all — it is hiring,
   * which creates a person. And before an offer has gone out, the thing to do
   * is send one. So the primary action here is chosen from what the applicant
   * actually needs next rather than from the stage order.
   */
  const offerSent = applicant.offer?.sentAt != null
  const offerAccepted = applicant.offer?.response === 'Accepted'

  const primary: { label: string; icon: React.ComponentType<{ className?: string }>; run: () => void } | null =
    applicant.stage === 'Hired'
      ? null
      : applicant.stage === 'Offer' && !offerSent
        ? { label: 'Send the job offer', icon: Send, run: onOffer }
        : applicant.canHire && (offerAccepted || applicant.stage === 'Offer')
          ? { label: 'Hire them', icon: UserPlus, run: onHire }
          : forward
            ? { label: stageOf(applicant.stage).advance, icon: ArrowRight, run: () => onMove(forward) }
            : applicant.canHire
              ? { label: 'Hire them', icon: UserPlus, run: onHire }
              : null

  return (
    <div className="space-y-3">
      {/* Where they are. */}
      <div className="space-y-2">
        <StageRail stage={applicant.stage} />
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <span className={cn('inline-block size-2 rounded-full', current.bar)} />
            Step {applicant.stage === 'Rejected' ? '—' : index + 1} of {STAGES.length}
          </p>
          <Badge tone={current.tone}>{applicant.stage}</Badge>
        </div>
      </div>

      {/* The AI-assessed fit, as a recommendation — never an automatic move. */}
      {applicant.stage !== 'Hired' && applicant.stage !== 'Rejected' && (
        <RecommendationBanner assessment={applicant.assessment} matchScore={applicant.matchScore} />
      )}

      {/* What this step is for. */}
      <div className={cn('rounded-xl border border-line p-3', 'bg-surface-2')}>
        <p className="flex items-start gap-2 text-[13px] font-semibold text-ink">
          <Icon className="mt-px size-4 shrink-0" />
          {current.id === 'Rejected' ? 'Not going further' : current.id}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{current.meaning}</p>

        {/* The offer's own state, when it is the thing holding this up. */}
        {applicant.stage === 'Offer' && offerSent && !applicant.offer?.response && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-warning">
            The offer has gone out and they have not answered yet. You can hire them once they accept, or
            record their answer below.
          </p>
        )}
        {offerAccepted && applicant.stage !== 'Hired' && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-good">
            <CheckCircle2 className="size-3.5" />
            They accepted. Hiring them creates the 201 file and their sign-in.
          </p>
        )}

        {/* One obvious thing to do. */}
        {primary && (
          <Button className="mt-2.5 w-full" onClick={primary.run} disabled={busy}>
            <primary.icon className="size-4" />
            {primary.label}
          </Button>
        )}

        {/* And the quieter ones. */}
        {(back || canReject) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {back && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMove(back)}>
                <ArrowLeft className="size-3.5" />
                Back to {back}
              </Button>
            )}
            {canReject && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-critical"
                disabled={busy}
                onClick={() => onMove('Rejected')}
              >
                <Ban className="size-3.5" />
                {applicant.stage === 'Rejected' ? 'Reject' : 'Not for us'}
              </Button>
            )}
          </div>
        )}

        {applicant.stage === 'Hired' && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-good">
            <CheckCircle2 className="size-3.5" />
            Hired — their 201 file is in the masterfile.
          </p>
        )}
      </div>

      {/* What comes after, so the sequence is never a surprise. */}
      {applicant.stage !== 'Hired' && applicant.stage !== 'Rejected' && index < STAGES.length - 2 && (
        <p className="text-[11px] leading-relaxed text-ink-3">
          Next after this: {STAGES.slice(index + 1, index + 3).map((s) => s.id).join(', then ')}.
        </p>
      )}
    </div>
  )
}
