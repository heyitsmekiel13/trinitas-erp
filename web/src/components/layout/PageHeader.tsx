import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Every page opens the same way: title, one line of context, actions on the
 * right. Consistency here is what makes an ERP feel like one product.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Buttons — hidden from printed output. */
  actions?: React.ReactNode
  /** Small pills or counts shown under the title. */
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-start sm:justify-between', className)}>
      {/* The printed letterhead already carries the title and description, so
          the on-screen heading would only repeat itself on paper. */}
      <div data-print="hide" className="min-w-0">
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-ink sm:text-[22px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-3">{description}</p>}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && (
        <div data-print="hide" className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}

/** Section divider inside long pages. */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  )
}
