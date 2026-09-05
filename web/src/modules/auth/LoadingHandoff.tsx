import { useCompany } from '@/lib/company'

/**
 * The screen between "credentials accepted" and "the app is open."
 *
 * Covers the moment `Login.tsx` spends warming the cache (see `app/warmup.ts`)
 * so that moment reads as the system loading rather than as a stall — the
 * same reasoning a real loading screen always has: an unexplained pause reads
 * as broken, a labelled one reads as working.
 */
export function LoadingHandoff() {
  const company = useCompany()

  return (
    <div className="animate-in fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-surface">
      <div className="relative flex size-16 items-center justify-center">
        <span className="grad-brand absolute inset-0 animate-ping rounded-2xl opacity-25" />
        {company.logoUrl ? (
          <img src={company.logoUrl} alt="" className="relative size-12 object-contain" />
        ) : (
          <span className="grad-brand relative flex size-14 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-[0_10px_30px_-8px_rgb(225_29_52/0.5)]">
            {company.name.trim().charAt(0).toUpperCase() || 'T'}
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <p className="text-[13px] font-medium text-ink-2">Loading your workspace…</p>
        <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-3">
          <div className="shimmer h-full w-full rounded-full" />
        </div>
      </div>
    </div>
  )
}
