import * as React from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './primitives'

/* -------------------------------------------------------------------------- */
/* Skeleton                                                                    */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} aria-hidden />
}

export function SkeletonTable({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading records">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-8', c === 0 ? 'w-[22%]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-[var(--radius-card)] lg:col-span-2" />
        <Skeleton className="h-80 rounded-[var(--radius-card)]" />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty & error states                                                        */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {Icon && (
        <div className="grad-brand-soft mb-4 flex size-12 items-center justify-center rounded-2xl ring-1 ring-brand-200 dark:ring-brand-900">
          <Icon className="size-5 text-brand-500" />
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
  return (
    <EmptyState
      icon={AlertCircle}
      title="Something went wrong"
      description={message}
      action={onRetry && <Button onClick={onRetry}>Try again</Button>}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

type ToastTone = 'success' | 'error' | 'warning' | 'info'
type Toast = { id: number; tone: ToastTone; title: string; description?: string }

const ToastCtx = React.createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

/** `const toast = useToast(); toast({ tone: 'success', title: 'Saved' })` */
export function useToast() {
  return React.useContext(ToastCtx)
}

const TOAST_ICON: Record<ToastTone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info,
}

const TOAST_COLOR: Record<ToastTone, string> = {
  success: 'text-good',
  error: 'text-critical',
  warning: 'text-warning',
  info: 'text-series-1',
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const push = React.useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { ...t, id }])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500)
  }, [])

  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id))

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
          role="region"
          aria-live="polite"
          aria-label="Notifications"
          data-print="hide"
        >
          {toasts.map((t) => {
            const Icon = TOAST_ICON[t.tone]
            return (
              <div
                key={t.id}
                className="card animate-in pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3.5 shadow-[var(--shadow-pop)]"
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', TOAST_COLOR[t.tone])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-ink-3">{t.description}</p>}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="text-ink-3 transition-colors hover:text-ink"
                  aria-label="Dismiss notification"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

/* -------------------------------------------------------------------------- */
/* Error boundary — one bad page must never blank the whole ERP                */
/* -------------------------------------------------------------------------- */

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card m-4">
          <ErrorState error={this.state.error} onRetry={() => this.setState({ error: null })} />
        </div>
      )
    }
    return this.props.children
  }
}
