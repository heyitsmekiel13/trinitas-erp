import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { initials } from '@/lib/format'

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'link'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // The signature gradient. Slight lift on hover, pressed state on active.
  primary:
    'grad-brand text-white shadow-[0_1px_2px_rgb(225_29_52/0.35)] hover:brightness-110 active:brightness-95 border border-brand-600/40',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2 active:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink border border-transparent',
  subtle: 'bg-surface-3 text-ink border border-transparent hover:bg-line',
  danger: 'bg-critical text-white border border-critical hover:brightness-110 active:brightness-95',
  link: 'text-brand-600 dark:text-brand-400 hover:underline underline-offset-4 border border-transparent',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-lg',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap',
        'transition-[background,color,filter,box-shadow] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  )
})

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] leading-tight font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-1 text-xs text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Badge / status                                                              */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'brand' | 'good' | 'warning' | 'serious' | 'critical' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2 ring-line-strong/60',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800',
  good: 'bg-[#0ca30c]/10 text-[#046904] ring-[#0ca30c]/30 dark:text-[#4ec44e]',
  warning: 'bg-[#fab219]/15 text-[#8a5d00] ring-[#fab219]/35 dark:text-[#f0b640]',
  serious: 'bg-[#ec835a]/15 text-[#9c4318] ring-[#ec835a]/35 dark:text-[#f0a17f]',
  critical: 'bg-[#d03b3b]/12 text-[#a11c1c] ring-[#d03b3b]/30 dark:text-[#f07575]',
  info: 'bg-[#2a78d6]/10 text-[#1a5399] ring-[#2a78d6]/30 dark:text-[#6ba7ef]',
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  brand: 'bg-brand-500',
  good: 'bg-good',
  warning: 'bg-warning',
  serious: 'bg-serious',
  critical: 'bg-critical',
  info: 'bg-series-1',
}

export function Badge({
  tone = 'neutral',
  dot,
  className,
  children,
}: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  )
}

/**
 * Document status vocabulary shared by every module, so "Approved" looks
 * identical in Procurement and in HR.
 */
export const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  pending: 'warning',
  'for approval': 'warning',
  'in review': 'warning',
  approved: 'good',
  confirmed: 'good',
  active: 'good',
  completed: 'good',
  delivered: 'good',
  paid: 'good',
  posted: 'good',
  closed: 'neutral',
  scheduled: 'info',
  'in progress': 'info',
  'in transit': 'info',
  partial: 'serious',
  'partially paid': 'serious',
  backorder: 'serious',
  'on hold': 'serious',
  overdue: 'critical',
  rejected: 'critical',
  cancelled: 'critical',
  breakdown: 'critical',
  expired: 'critical',
  inactive: 'neutral',
  won: 'good',
  lost: 'critical',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status.toLowerCase()] ?? 'neutral'
  return (
    <Badge tone={tone} dot className={className}>
      {status}
    </Badge>
  )
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */

const FIELD_BASE =
  'w-full rounded-lg border border-line-strong bg-surface text-ink placeholder:text-ink-3 ' +
  'transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(FIELD_BASE, 'h-9 px-3 text-sm', className)} {...props} />
  },
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(FIELD_BASE, 'min-h-20 px-3 py-2 text-sm', className)} {...props} />
  },
)

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          FIELD_BASE,
          'h-9 cursor-pointer appearance-none bg-no-repeat py-0 pr-8 pl-3 text-sm',
          "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2379808e' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[position:right_0.55rem_center]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  /**
   * Renders a div instead of a label. Needed when the control is itself a
   * composite of buttons and inputs — nesting those inside a label makes the
   * click target ambiguous and trips screen readers.
   */
  composite,
  ...rest
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
  composite?: boolean
} & React.HTMLAttributes<HTMLElement>) {
  const Wrapper = composite ? 'div' : 'label'

  return (
    <Wrapper className={cn('block', className)} {...rest}>
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-critical">*</span>}
      </span>
      {children}
      {/* The message is marked up as an alert and carries an icon, so an
          error is not just "the same sentence in red" — which is invisible to
          anybody who cannot see the red. */}
      {error ? (
        <span role="alert" className="mt-1 flex items-start gap-1 text-xs text-critical">
          <AlertCircle className="mt-px size-3 shrink-0" />
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-3">{hint}</span>
      ) : null}
    </Wrapper>
  )
}

/* -------------------------------------------------------------------------- */
/* Combobox — a select you can type into                                       */
/* -------------------------------------------------------------------------- */

export type ComboOption = { value: string | number; label: string; sublabel?: string }

/**
 * Searchable single-select.
 *
 * A native select is fine for six payment terms and miserable for six hundred
 * customers. This filters as you type, so choosing a record is one keystroke
 * and Enter rather than a long scroll. Falls back to showing everything when
 * the query is empty, and keeps the chosen label visible when closed.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder = 'Search…',
  emptyLabel = 'No matches',
  allowClear = true,
  disabled,
  className,
}: {
  value: string | number | null | undefined
  options: ComboOption[]
  onChange: (value: string | number | null) => void
  placeholder?: string
  emptyLabel?: string
  allowClear?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const root = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const selected = options.find((o) => String(o.value) === String(value ?? ''))

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const choose = (option: ComboOption) => {
    onChange(option.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return Math.max(0, Math.min(matches.length - 1, next))
      })
    } else if (e.key === 'Enter') {
      // Never let the dropdown's Enter submit the surrounding form.
      e.preventDefault()
      const option = matches[active]
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          FIELD_BASE,
          'flex h-9 w-full cursor-pointer items-center gap-2 pr-8 pl-3 text-left text-sm',
          "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2379808e' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[position:right_0.55rem_center] bg-no-repeat",
        )}
      >
        <span className={cn('truncate', !selected && 'text-ink-3')}>{selected?.label ?? placeholder}</span>
        {selected?.sublabel && <span className="truncate text-xs text-ink-3">· {selected.sublabel}</span>}
      </button>

      {open && (
        <div className="animate-in absolute z-50 mt-1 w-full rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Type to filter…"
            className="mb-1 h-8 w-full rounded-lg bg-surface-2 px-2.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />

          <div role="listbox" className="max-h-56 overflow-y-auto">
            {allowClear && !query && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-3 hover:bg-surface-3"
              >
                None
              </button>
            )}

            {matches.length === 0 && <p className="px-2.5 py-3 text-center text-xs text-ink-3">{emptyLabel}</p>}

            {matches.map((option, i) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={String(option.value) === String(value ?? '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(option)}
                className={cn(
                  'flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]',
                  i === active ? 'bg-surface-3 text-ink' : 'text-ink-2',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.sublabel && <span className="ml-auto shrink-0 text-[11px] text-ink-3">{option.sublabel}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'grad-brand' : 'bg-line-strong',
        className,
      )}
    >
      <span
        className={cn(
          'absolute size-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/**
 * Single-choice picker that shows every option at once.
 *
 * For the handful of fields with only a few answers — a payment term, a
 * priority, a channel. A dropdown hides four options behind a click and gives
 * no sense of what the choice is between; laying them out costs one line of
 * space and answers the question before it is asked.
 *
 * Real radio inputs, not styled buttons, so arrow keys move between options
 * and a screen reader announces "2 of 4" the way it should.
 */
export function RadioGroup<T extends string | number>({
  name,
  value,
  onChange,
  options,
  className,
}: {
  name: string
  value: T | null | undefined
  onChange: (value: T) => void
  options: { value: T; label: string; sublabel?: string }[]
  className?: string
}) {
  return (
    <div role="radiogroup" className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => {
        const checked = String(option.value) === String(value ?? '')
        return (
          <label
            key={option.value}
            className={cn(
              'relative flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] transition-colors',
              // Generous enough to be a comfortable tap target on a tablet,
              // which is what the warehouse and the vans actually use.
              'min-h-9',
              checked
                ? 'border-brand-400 bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                checked ? 'border-brand-500' : 'border-line-strong',
              )}
            >
              {checked && <span className="grad-brand size-1.5 rounded-full" />}
            </span>
            <span>{option.label}</span>
            {option.sublabel && <span className="text-[11px] text-ink-3">{option.sublabel}</span>}
          </label>
        )
      })}
    </div>
  )
}

/** Segmented control — the ERP's tab/toggle workhorse. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn('inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[6px] font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
              active ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                      */
/* -------------------------------------------------------------------------- */

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  /** Null when the record has nobody assigned — renders a neutral placeholder. */
  name: string | null | undefined
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    xs: 'size-6 text-[10px]',
    sm: 'size-7 text-[11px]',
    md: 'size-9 text-xs',
    lg: 'size-12 text-sm',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        'grad-brand ring-1 ring-black/5',
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

export function ProgressBar({
  value,
  tone = 'brand',
  className,
  label,
}: {
  /** 0-100 */
  value: number
  tone?: 'brand' | 'good' | 'warning' | 'critical' | 'neutral'
  className?: string
  label?: string
}) {
  const fills: Record<string, string> = {
    brand: 'grad-brand',
    good: 'bg-good',
    warning: 'bg-warning',
    critical: 'bg-critical',
    neutral: 'bg-ink-3',
  }
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', fills[tone])} style={{ width: `${clamped}%` }} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Tooltip (CSS-only, zero runtime cost)                                       */
/* -------------------------------------------------------------------------- */

/**
 * A tooltip that cannot be clipped by whatever it happens to sit inside.
 *
 * The first version positioned itself absolutely within the trigger, which
 * works everywhere except the places it was most needed. An absolutely
 * positioned child is clipped by any ancestor that scrolls or hides its
 * overflow — and the message thread, the conversation list, the register
 * tables and every modal body are exactly that. So the hover text on the chat
 * toolbar rendered correctly and was invisible: cut off by the scroller it was
 * drawn inside, or hidden behind the card's `overflow-hidden`.
 *
 * It is therefore rendered into `document.body` and positioned in viewport
 * coordinates. Nothing can clip it, and it flips to the other side of the
 * trigger rather than disappearing off the top of the window.
 *
 * Kept as a hover/focus affordance only: it is never the sole carrier of
 * meaning, because it cannot be reached at all on a touch screen.
 */
export function Tooltip({
  content,
  side = 'top',
  className,
  children,
}: {
  content: React.ReactNode
  side?: 'top' | 'bottom'
  className?: string
  children: React.ReactNode
}) {
  const anchor = React.useRef<HTMLSpanElement>(null)
  const [at, setAt] = React.useState<{ top: number; left: number; side: 'top' | 'bottom' } | null>(null)

  const show = React.useCallback(() => {
    const box = anchor.current?.getBoundingClientRect()

    if (!box) return

    // Flip when there is not enough room above, so a tooltip on the first row
    // of a list is readable rather than half off the window.
    const flipped = side === 'top' && box.top < 44 ? 'bottom' : side

    setAt({
      top: flipped === 'top' ? box.top - 6 : box.bottom + 6,
      left: box.left + box.width / 2,
      side: flipped,
    })
  }, [side])

  const hide = React.useCallback(() => setAt(null), [])

  /* Anything that moves the page moves the trigger, and a tooltip left behind
     at stale coordinates is worse than none. Scroll is captured so an ancestor
     scroller counts, not just the window. */
  React.useEffect(() => {
    if (!at) return

    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)

    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [at, hide])

  return (
    <>
      <span
        ref={anchor}
        className={cn('inline-flex', className)}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </span>

      {at &&
        content &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              top: at.top,
              left: at.left,
              transform: `translate(-50%, ${at.side === 'top' ? '-100%' : '0'})`,
            }}
            className={cn(
              'pointer-events-none z-[100] max-w-[min(20rem,90vw)] rounded-md px-2 py-1',
              'bg-ink text-[11px] leading-snug font-medium text-page shadow-lg',
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </>
  )
}
