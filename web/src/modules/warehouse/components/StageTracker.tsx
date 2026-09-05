import { Check, ClipboardList, Hand, PackageCheck, Signature, Truck, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DISPATCH_STAGES, stageIndex, type DispatchStage } from '@/data/warehouse'

/**
 * The dispatch stepper.
 *
 * Six steps, always in the same order, always visible — including the ones
 * already behind. Someone picking up a half-finished job needs to see what has
 * been done to it as much as what is next, and a progress bar that only shows a
 * percentage does not answer that.
 */

const STAGE_ICON: Record<DispatchStage, LucideIcon> = {
  Open: ClipboardList,
  Picking: Hand,
  Packed: PackageCheck,
  'Out for Delivery': Truck,
  Delivered: Signature,
  Completed: Check,
}

export function StageTracker({
  stage,
  size = 'md',
  className,
}: {
  stage: DispatchStage
  size?: 'sm' | 'md'
  className?: string
}) {
  const current = stageIndex(stage)
  const dot = size === 'sm' ? 'size-6' : 'size-8'
  const icon = size === 'sm' ? 'size-3' : 'size-3.5'

  return (
    <ol className={cn('flex items-start', className)} aria-label="Dispatch progress">
      {DISPATCH_STAGES.map((step, i) => {
        const done = i < current
        const active = i === current
        const Icon = STAGE_ICON[step]

        return (
          <li key={step} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {/* Connector to the left, so the rail runs edge to edge. */}
              <span
                className={cn('h-0.5 flex-1 rounded-full', i === 0 && 'invisible', done || active ? 'bg-good' : 'bg-line')}
              />
              <span
                className={cn(
                  'flex shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  dot,
                  done
                    ? 'border-good bg-good text-white'
                    : active
                      ? 'grad-brand border-brand-600/40 text-white shadow-[0_1px_3px_rgb(225_29_52/0.35)]'
                      : 'border-line bg-surface text-ink-3',
                )}
              >
                {done ? <Check className={icon} /> : <Icon className={icon} />}
              </span>
              <span
                className={cn('h-0.5 flex-1 rounded-full', i === DISPATCH_STAGES.length - 1 && 'invisible', done ? 'bg-good' : 'bg-line')}
              />
            </div>

            <span
              className={cn(
                'mt-1.5 max-w-full truncate text-center text-[10px] leading-tight',
                active ? 'font-semibold text-ink' : done ? 'text-ink-2' : 'text-ink-3',
              )}
            >
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
