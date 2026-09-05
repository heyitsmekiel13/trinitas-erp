import { API_BASE_URL } from './api'
import { ApiError } from './adminApi'

/**
 * The scanned-badge lookup's client.
 *
 * Separate from `adminApi` for the same reason `careersApi` is: nobody
 * calling this has an account, so no bearer token should ever travel with
 * the request — see careersApi.ts for the fuller version of this reasoning.
 */

export type PublicEmployee = {
  name: string
  employeeNo: string
  position: string | null
  department: string | null
  status: 'Active' | 'Inactive'
  photoUrl: string | null
}

export async function checkEmployeeBadge(token: string): Promise<PublicEmployee> {
  const response = await fetch(`${API_BASE_URL}/public/employees/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      payload.message ?? (response.status === 404 ? 'No badge matches this code.' : `Something went wrong (${response.status}).`),
      response.status,
    )
  }

  return payload.data as PublicEmployee
}
