import { QueryClient, useQuery } from '@tanstack/react-query'

/**
 * The data access seam.
 *
 * Today every hook resolves from the in-memory preview dataset. When the
 * Laravel API is built, only `fetchResource` below changes — swap the mock
 * branch for a real `fetch` and every page keeps working untouched, because
 * pages never import the dataset directly.
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ERP records change on human timescales, not by the second.
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      // Keeps the previous render visible during a refetch instead of
      // flashing a skeleton and jumping the layout.
      placeholderData: (previous: unknown) => previous,
    },
  },
})

/**
 * Pulls the bearer token out of the persisted auth store.
 *
 * Deliberately reads storage rather than importing the store: `app/auth.ts`
 * imports `API_BASE_URL` from here, and importing it back would be circular.
 */
function readToken(): string | null {
  try {
    const raw = localStorage.getItem('trinitas.auth')
    if (!raw) return null
    const token = JSON.parse(raw)?.state?.token
    return token && token !== 'bootstrap-session' ? token : null
  } catch {
    return null
  }
}

/** Simulated network latency — makes loading states real during design review. */
const MOCK_LATENCY_MS = 180

function delay<T>(value: T, ms = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/**
 * Reads one resource.
 *
 * @param endpoint Laravel route this will call later, e.g. `sales/orders`.
 * @param loader   Preview data source. Deleted once the endpoint is live.
 */
async function fetchResourceOrMock<T>(endpoint: string, loader: () => T): Promise<T> {
  if (import.meta.env.VITE_API_URL) {
    // Read the token lazily rather than importing the auth store, which would
    // create a cycle: auth imports API_BASE_URL from this module.
    const token = readToken()

    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    })

    if (response.status === 401) {
      throw new Error('Your session has expired. Sign in again.')
    }
    if (response.status === 423) {
      throw new Error('Choose a new password before using the system.')
    }
    if (!response.ok) throw new Error(`Request failed (${response.status}) for ${endpoint}`)
    const body = await response.json()
    // Laravel resource collections wrap payloads in `data`.
    return (body?.data ?? body) as T
  }
  return delay(loader())
}

/**
 * Endpoints that a write to one list also changes.
 *
 * Saving a record invalidated the list it was saved from and nothing else,
 * which is right whenever a row belongs to exactly one endpoint. It is wrong
 * when the server writes further rows of its own: editing an employee's email
 * also rewrites the sign-in account behind them, so Users & Roles was holding
 * a row the database had already replaced. With a five minute stale time and a
 * thirty minute cache, the screen could disagree with the record for half an
 * hour — long enough to read as "the change did not save".
 *
 * Listed here rather than at each call site so the cascade is declared once,
 * beside the cache it is compensating for, and so a page that does not know
 * the employee/user relationship exists still refreshes correctly.
 */
const CASCADES: Record<string, string[]> = {
  // EmployeeObserver carries name, email and employment status across.
  'hr/employees': ['admin/users'],
}

/** Marks a list stale, along with any list the same write also changed. */
export function invalidateResource(endpoint: string): Promise<unknown> {
  return Promise.all(
    [endpoint, ...(CASCADES[endpoint] ?? [])].map((key) =>
      queryClient.invalidateQueries({ queryKey: ['resource', key] }),
    ),
  )
}

/** The single hook every module page uses to read data. */
export function useResource<T>(endpoint: string, loader: () => T, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['resource', endpoint],
    queryFn: () => fetchResourceOrMock(endpoint, loader),
    enabled: options?.enabled ?? true,
  })
}

/**
 * A one-off read of a live endpoint, outside the shared list cache.
 *
 * For the cases where a stale answer is worse than a slow one — a dialog that
 * has to reflect what is in the database right now, not what the list page
 * happened to fetch earlier. Returns an empty list on preview data, since
 * there is no API to ask.
 */
export function fetchResource<T>(endpoint: string): Promise<T> {
  return fetchResourceOrMock<T>(endpoint, () => [] as unknown as T)
}
