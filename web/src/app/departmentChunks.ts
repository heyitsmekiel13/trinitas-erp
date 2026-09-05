import type { ComponentType } from 'react'

/**
 * Each department is one lazily-loaded chunk holding all of its pages.
 *
 * Pulled out of `routes.tsx` into its own module so the sidebar can warm a
 * chunk on hover without importing the router — importing `routes.tsx` from
 * `Sidebar.tsx` would be circular, since the router's shell renders the
 * sidebar in the first place.
 */
export type PageModule = { PAGES: Record<string, ComponentType> }

export const DEPARTMENT_CHUNKS: Record<string, () => Promise<PageModule>> = {
  sales: () => import('@/modules/sales'),
  procurement: () => import('@/modules/procurement'),
  warehouse: () => import('@/modules/warehouse'),
  'after-sales': () => import('@/modules/afterSales'),
  maintenance: () => import('@/modules/maintenance'),
  finance: () => import('@/modules/finance'),
  hr: () => import('@/modules/hr'),
  process: () => import('@/modules/process'),
}

const warmed = new Set<string>()

/**
 * Starts loading a department's chunk before its route is actually visited.
 *
 * Fired on sidebar hover — by the time a pointer travels from the nav item
 * to registering a click, the chunk request is usually already on the wire,
 * so the department that opens on click has a head start instead of starting
 * cold. Idempotent and fire-and-forget: a failed prefetch (offline, a flaky
 * connection) is not reported anywhere, because the route's own lazy loader
 * will try again — and surface the failure properly — the moment it is
 * actually navigated to.
 */
export function prefetchDepartment(id: string): void {
  if (warmed.has(id) || !DEPARTMENT_CHUNKS[id]) return
  warmed.add(id)
  void DEPARTMENT_CHUNKS[id]!().catch(() => {
    // Left for the real navigation to retry and report.
    warmed.delete(id)
  })
}

/**
 * Warms every department chunk once the browser is genuinely idle.
 *
 * Not on mount — competing with the current page's own data fetches for
 * bandwidth and the main thread is exactly the wrong moment. `requestIdleCallback`
 * (falling back to a delayed timeout on Safari, which has never implemented
 * it) only runs this once the browser has nothing more pressing to do, so a
 * department that was never hovered is still often warm by the time it is
 * clicked.
 */
export function prefetchAllDepartmentsWhenIdle(): void {
  const run = () => {
    for (const id of Object.keys(DEPARTMENT_CHUNKS)) {
      prefetchDepartment(id)
    }
  }

  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }

  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(run)
  } else {
    setTimeout(run, 2000)
  }
}
