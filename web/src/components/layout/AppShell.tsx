import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { UserCog } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUnreadPoll } from '@/lib/unread'
import { useUi } from '@/app/store'
import { useImpersonation } from '@/app/auth'
import { prefetchAllDepartmentsWhenIdle } from '@/app/departmentChunks'
import { stopImpersonation } from '@/lib/adminApi'
import { useToast } from '@/components/ui/feedback'
import { Sidebar, MobileSidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { ErrorBoundary, SkeletonDashboard } from '@/components/ui/feedback'

/**
 * Unmissable, on purpose — see ImpersonationController's docblock. An admin
 * who forgets they are looking through somebody else's account is the one
 * failure mode this whole feature exists to prevent, so the banner is not
 * dismissible and sits above everything else, on every screen, the entire
 * time a "log in as" session is open.
 */
function ImpersonationBanner() {
  const toast = useToast()
  const { active, adminName, viewingAs, end } = useImpersonation()

  if (!active) return null

  const returnToAdmin = async () => {
    try {
      await stopImpersonation()
    } catch {
      // The token may already be gone (expired, or ended from another tab) —
      // either way the point is to get the admin back to their own session,
      // which the local swap below does regardless of whether the server
      // call succeeded.
    }
    end()
    toast({ tone: 'success', title: `Back to ${adminName ?? 'your account'}` })
  }

  return (
    <div
      data-print="hide"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 bg-ink px-4 py-2 text-[13px] font-medium text-white"
    >
      <UserCog className="size-4 shrink-0" />
      <span>
        Viewing as <strong>{viewingAs}</strong> — this is what they see, not you.
      </span>
      <button
        type="button"
        onClick={() => void returnToAdmin()}
        className="rounded-md bg-white/15 px-2.5 py-1 text-[12px] font-semibold transition-colors hover:bg-white/25"
      >
        Return to admin
      </button>
    </div>
  )
}

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const { pathname } = useLocation()

  // One poll for the whole shell — the sidebar and top bar both read the
  // store it fills, so the badge cannot disagree with itself.
  useUnreadPoll()

  // Warms every department's chunk once the browser is idle, so switching
  // departments feels instant even for one that was never hovered first —
  // see departmentChunks.ts for why this waits for idle rather than firing
  // on mount.
  useEffect(() => {
    prefetchAllDepartmentsWhenIdle()
  }, [])

  return (
    <div className="animate-in min-h-dvh bg-page">
      <Sidebar />
      <MobileSidebar />
      <CommandPalette />

      <div
        className={cn(
          'flex min-h-dvh flex-col transition-[padding] duration-200 ease-[var(--ease-out-soft)]',
          collapsed ? 'lg:pl-[68px]' : 'lg:pl-[264px]',
        )}
      >
        <ImpersonationBanner />
        <Topbar />

        <main id="main" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<SkeletonDashboard />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        <footer
          data-print="hide"
          className="border-t border-line px-5 py-3 text-[11px] text-ink-3"
        >
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>Trinitas ERP Suite · v0.1.0 — frontend preview with representative data</span>
            <span>© {new Date().getFullYear()} Trinitas Distribution Inc.</span>
          </div>
        </footer>
      </div>
    </div>
  )
}
