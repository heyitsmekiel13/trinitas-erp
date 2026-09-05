import { Navigate, useLocation } from 'react-router-dom'
import { useIsSuperAdmin } from '@/app/auth'

/**
 * Keeps Administration to super administrators.
 *
 * The sidebar already hides these pages, but a hidden link is not a control —
 * somebody can type the address, or land on a bookmark from a previous role.
 * The redirect is the courtesy; the API refusing the same routes with a 403 is
 * the actual protection.
 */
export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const superAdmin = useIsSuperAdmin()
  const location = useLocation()

  if (!superAdmin) {
    // Replace rather than push, so Back does not bounce them straight into
    // the same redirect again.
    return <Navigate to="/" replace state={{ deniedFrom: location.pathname }} />
  }

  return <>{children}</>
}

/**
 * Keeps self service to accounts that belong to a person.
 *
 * The super administrator is a system login with no 201 file, no shift and no
 * payslips, so `/me` can only render empty for it — and the HR endpoints it
 * calls resolve an employee from the account, which that account does not
 * have.
 */
export function RequireEmployee({ children }: { children: React.ReactNode }) {
  const superAdmin = useIsSuperAdmin()

  if (superAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
