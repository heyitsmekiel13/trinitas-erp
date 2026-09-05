import { fetchResource, queryClient } from '@/lib/api'

/**
 * What "the system is loaded" actually means.
 *
 * `prefetchAllDepartmentsWhenIdle` (departmentChunks.ts) warms the *code* —
 * the JS a department needs is already downloaded by the time it is clicked.
 * That was never the part that showed a spinner. Every department's landing
 * page still ran its own `useResource` fetch on mount, so the click felt
 * instant and the page it opened onto did not.
 *
 * This warms the *data* for that landing page too, into the exact React
 * Query cache key `useResource` itself reads (`['resource', endpoint]`,
 * `lib/api.ts`) — so the first paint of a department's dashboard finds
 * already-fresh data sitting there and skips the loading state entirely,
 * the same way a second visit to a page you have already opened does.
 *
 * Deliberately just the six dashboards, not every list in the ERP. Item
 * Master alone is over two thousand rows — prefetching everything behind
 * every nav item would make sign-in itself slow to buy back a saving on
 * pages nobody has clicked into yet. After-Sales and Process are not listed:
 * neither reads through `useResource` (one computes from a bundled dataset,
 * the other fetches with plain `useState`), so there is no shared cache
 * entry here for either to warm.
 */
const DASHBOARD_ENDPOINTS = [
  'sales/dashboard',
  'procurement/dashboard',
  'warehouse/dashboard',
  'maintenance/dashboard',
  'finance/dashboard',
  'hr/dashboard',
]

export function prefetchDashboards(): Promise<unknown> {
  return Promise.allSettled(
    DASHBOARD_ENDPOINTS.map((endpoint) =>
      queryClient.prefetchQuery({
        queryKey: ['resource', endpoint],
        queryFn: () => fetchResource(endpoint),
      }),
    ),
  )
}
