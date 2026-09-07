import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './primitives'

/** Closes on Escape and locks body scroll while any overlay is open. */
function useDismissable(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A combobox or menu inside the dialog handles its own Escape first
        // and marks the event, so the first press closes the dropdown rather
        // than throwing away the whole form.
        if (e.defaultPrevented) return
        e.stopPropagation()
        onClose()
      }
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}

/** Moves focus into the panel on open and restores it on close. */
function useFocusTrap(open: boolean) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = ref.current
    const focusable = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    )
    ;(focusable ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open])

  return ref
}

function Scrim({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] motion-safe:animate-[fade-in-up_.15s_ease-out]"
      onClick={onClose}
      aria-hidden
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                       */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  headerAside,
  bodyClassName,
  dirty = false,
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  footer?: React.ReactNode
  /** Rendered to the left of the close button — tabs, a status badge, an action. */
  headerAside?: React.ReactNode
  bodyClassName?: string
  /**
   * Set once the dialog holds unsaved edits. A backdrop click or Escape then
   * asks before discarding, so a stray click on a half-filled order does not
   * quietly throw the work away. Untouched dialogs still close instantly.
   */
  dirty?: boolean
  children: React.ReactNode
}) {
  const [confirming, setConfirming] = React.useState(false)

  // A close request that respects unsaved work.
  const requestClose = React.useCallback(() => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])

  React.useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  useDismissable(open, requestClose)
  const panelRef = useFocusTrap(open)
  if (!open) return null

  const discard = () => {
    setConfirming(false)
    onClose()
  }

  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-5xl', '2xl': 'max-w-6xl' }

  return createPortal(
    <>
      <Scrim onClose={requestClose} />
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : undefined}
          tabIndex={-1}
          className={cn(
            // A flex column so the body is the only part that scrolls — the
            // header and the save button stay put however tall the form gets.
            'card animate-in relative flex w-full flex-col overflow-hidden shadow-[var(--shadow-pop)]',
            'max-h-[94dvh] rounded-b-none sm:max-h-[88dvh] sm:rounded-[var(--radius-card)]',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
              {description && <p className="mt-1 text-xs text-ink-3">{description}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAside}
              <Button variant="ghost" size="icon-sm" onClick={requestClose} aria-label="Close dialog">
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>{children}</div>

          {footer && (
            <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
              {footer}
            </div>
          )}

          {confirming && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-6 backdrop-blur-[1px]">
              <div className="card animate-in w-full max-w-sm p-5 text-center shadow-[var(--shadow-pop)]">
                <p className="text-sm font-semibold text-ink">Discard your changes?</p>
                <p className="mt-1.5 text-[13px] text-ink-2">
                  This form has edits that have not been saved. Closing it now loses them.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                    Keep editing
                  </Button>
                  <Button variant="danger" size="sm" onClick={discard}>
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Drawer — the record detail surface used across every module                 */
/* -------------------------------------------------------------------------- */

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'md',
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  width?: 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  useDismissable(open, onClose)
  const panelRef = useFocusTrap(open)
  if (!open) return null

  const widths = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }

  return createPortal(
    <>
      <Scrim onClose={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cn(
          'fixed z-50 flex flex-col bg-surface shadow-[var(--shadow-pop)]',
          // Full-height sheet on desktop, bottom sheet on phones.
          'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl',
          'sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:rounded-none sm:border-l sm:border-line',
          'motion-safe:animate-[fade-in-up_.2s_var(--ease-out-soft)]',
          widths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>
        )}
      </div>
    </>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Dropdown menu                                                               */
/* -------------------------------------------------------------------------- */

export function Menu({
  trigger,
  children,
  align = 'end',
  placement = 'bottom',
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
  align?: 'start' | 'end'
  /** 'top' opens upward from the trigger — for a menu docked in a bottom footer, where
   *  opening downward would render past the dialog's own edge and get clipped invisible. */
  placement?: 'bottom' | 'top'
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={root} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          role="menu"
          className={cn(
            'animate-in absolute z-50 min-w-52 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]',
            placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
  shortcut,
  disabled,
}: {
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  onClick?: () => void
  danger?: boolean
  shortcut?: string
  disabled?: boolean
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-critical hover:bg-critical/10' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 opacity-70" />}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <kbd className="text-[10px] text-ink-3">{shortcut}</kbd>}
    </button>
  )
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-3 uppercase">{children}</div>
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}
