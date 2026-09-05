import * as React from 'react'
import { CircleCheck, Hammer, PackageSearch, ShieldQuestion, Wrench } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  DISPOSITIONS,
  FAULT_STAGES,
  FUNCTIONAL_STATES,
  LIABILITIES,
  PHYSICAL_STATES,
  VERDICT_TONE,
  suggestedDisposition,
  verdictFor,
  type ConditionCheck,
  type Disposition,
  type FaultStage,
  type FunctionalState,
  type Liability,
  type PhysicalState,
} from '@/data/warehouse'
import { Badge, Input, Textarea, type Tone } from '@/components/ui/primitives'

/**
 * The item check, asked the way a person on the floor actually looks at a box.
 *
 * Two questions, always in the same order:
 *
 *   1. How does it look?   — the carton, the seal, the unit itself
 *   2. Does it work?       — only meaningful for things that switch on
 *
 * They are separate because they fail separately: a crushed carton around a
 * working motor is a different problem from a pristine box with a dead one, and
 * collapsing both into "defective" throws away the difference.
 *
 * The verdict is then computed, never chosen — so two people grading the same
 * crate reach the same word for it. Only when something is actually wrong does
 * the form ask the two questions that decide who pays: where it happened, and
 * whose leg of the journey that was.
 */

function Choice({
  active,
  tone,
  label,
  hint,
  onClick,
}: {
  active: boolean
  tone: Tone
  label: string
  hint?: string
  onClick: () => void
}) {
  const activeTone: Record<string, string> = {
    good: 'border-good bg-good/10 text-[#046904] dark:text-[#4ec44e]',
    warning: 'border-warning bg-warning/15 text-[#8a5d00] dark:text-[#f0b640]',
    serious: 'border-serious bg-serious/15 text-[#9c4318] dark:text-[#f0a17f]',
    critical: 'border-critical bg-critical/12 text-[#a11c1c] dark:text-[#f07575]',
    neutral: 'border-line-strong bg-surface-3 text-ink',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={hint}
      className={cn(
        'flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-all',
        active
          ? cn('shadow-sm', activeTone[tone] ?? activeTone.neutral)
          : 'border-line-strong bg-surface text-ink-3 hover:border-brand-300 hover:text-ink',
      )}
    >
      {active && <CircleCheck className="size-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  )
}

function Group({
  icon: Icon,
  label,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
        <Icon className="size-3.5 text-ink-3" />
        {label}
        {hint && <span className="ml-1 font-normal tracking-normal text-ink-3 normal-case">{hint}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export function ConditionCheckPanel({
  value,
  onChange,
  /** Total units on the line, so the affected quantity cannot exceed it. */
  maxQty,
  /** Where in the process this check is being made. Pre-fills the fault stage. */
  atStage,
  className,
}: {
  value: ConditionCheck
  onChange: (next: ConditionCheck) => void
  maxQty?: number
  atStage?: FaultStage
  className?: string
}) {
  const verdict = verdictFor(value.physical, value.functional)
  const isClean = verdict === 'Good'

  const patch = (next: Partial<ConditionCheck>) => {
    const merged = { ...value, ...next }
    const nextVerdict = verdictFor(merged.physical, merged.functional)

    // Re-suggest the disposition whenever the grading changes, unless the user
    // has deliberately moved it somewhere the grading would not have chosen.
    const wasSuggested = value.disposition === suggestedDisposition(verdict)
    if (wasSuggested && (next.physical || next.functional)) {
      merged.disposition = suggestedDisposition(nextVerdict)
    }

    // A clean check has no affected units and no stage to blame.
    if (nextVerdict === 'Good') merged.qty = 0
    else if (merged.qty === 0) merged.qty = 1

    if ((next.physical || next.functional) && atStage && nextVerdict !== 'Good' && value.stage === atStage) {
      merged.stage = atStage
    }

    onChange(merged)
  }

  return (
    <div className={cn('space-y-3.5', className)}>
      <Group icon={PackageSearch} label="How does it look?">
        {PHYSICAL_STATES.map((state) => (
          <Choice
            key={state.id}
            active={value.physical === state.id}
            tone={state.tone as Tone}
            label={state.label}
            hint={state.hint}
            onClick={() => patch({ physical: state.id as PhysicalState })}
          />
        ))}
      </Group>

      <Group icon={Wrench} label="Does it work?" hint="— skip for non-powered items">
        {FUNCTIONAL_STATES.map((state) => (
          <Choice
            key={state.id}
            active={value.functional === state.id}
            tone={state.tone as Tone}
            label={state.label}
            hint={state.hint}
            onClick={() => patch({ functional: state.id as FunctionalState })}
          />
        ))}
      </Group>

      {/* The computed answer, stated plainly so nobody has to interpret it. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3',
          isClean ? 'border-good/30 bg-good/5' : 'border-line bg-surface-2',
        )}
      >
        <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Verdict</span>
        <Badge tone={VERDICT_TONE[verdict] as Tone} dot>
          {verdict}
        </Badge>
        <span className="text-[12px] text-ink-2">
          {isClean
            ? 'Nothing to report — this goes straight to putaway.'
            : 'Tell us where it happened so the pattern shows up next month.'}
        </span>

        {!isClean && maxQty != null && (
          <label className="ml-auto flex items-center gap-2">
            <span className="text-[11px] font-medium text-ink-2">Units affected</span>
            <Input
              type="number"
              min={1}
              max={maxQty}
              value={value.qty || 1}
              onChange={(e) => patch({ qty: Math.min(maxQty, Math.max(1, Number(e.target.value) || 1)) })}
              className="h-8 w-20 text-[13px]"
            />
            <span className="text-[11px] text-ink-3">of {maxQty}</span>
          </label>
        )}
      </div>

      {!isClean && (
        <div className="animate-in space-y-3.5 rounded-xl border border-line bg-surface p-3.5">
          <Group icon={Hammer} label="Where was it first seen?" hint="— this is what pinpoints the step">
            {FAULT_STAGES.map((stage) => (
              <Choice
                key={stage}
                active={value.stage === stage}
                tone="serious"
                label={stage}
                onClick={() => patch({ stage: stage as FaultStage })}
              />
            ))}
          </Group>

          <Group icon={ShieldQuestion} label="Whose leg of the journey?">
            {LIABILITIES.map((party) => (
              <Choice
                key={party}
                active={value.liability === party}
                tone="warning"
                label={party}
                onClick={() => patch({ liability: party as Liability })}
              />
            ))}
          </Group>

          <Group icon={CircleCheck} label="What happens to it now?">
            {DISPOSITIONS.map((disposition) => (
              <Choice
                key={disposition}
                active={value.disposition === disposition}
                tone={disposition === 'Put away' ? 'good' : disposition === 'Scrap' ? 'critical' : 'neutral'}
                label={disposition}
                onClick={() => patch({ disposition: disposition as Disposition })}
              />
            ))}
          </Group>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Anything else worth recording
            </span>
            <Textarea
              value={value.note ?? ''}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="Pallet corner crushed — bottom two cartons only, top layer fine."
              className="min-h-16 text-[13px]"
            />
          </label>
        </div>
      )}
    </div>
  )
}

/** One-line summary for lists — the same words, without the controls. */
export function VerdictBadge({ check }: { check: ConditionCheck }) {
  const verdict = verdictFor(check.physical, check.functional)
  return (
    <Badge tone={VERDICT_TONE[verdict] as Tone} dot>
      {verdict}
    </Badge>
  )
}
