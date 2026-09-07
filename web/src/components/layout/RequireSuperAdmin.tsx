import { Navigate, useLocation } from 'react-router-dom'
import { hasCommandCenterAccess, hasDepartmentDashboardAccess, useAuth, useIsSuperAdmin } from '@/app/auth'

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

/**
 * Keeps Command Center to Top Management.
 *
 * A rank-and-file or supervisory employee's own view is Self Service or
 * their department's own dashboard — Command Center aggregates figures
 * across the whole company, which only Top Management's job actually asks.
 * System/IT accounts with no employee record are unaffected either way —
 * see {@link hasCommandCenterAccess}.
 */
export function RequireCommandCenterAccess({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user)

  if (!hasCommandCenterAccess(user)) {
    return <Navigate to="/me" replace />
  }

  return <>{children}</>
}

/**
 * Keeps a department's own dashboard (Sales Dashboard, Warehouse Dashboard,
 * ...) to Supervisory and Top Management.
 *
 * Rank-and-file keeps every other page in the department — their own
 * orders, requests, records — so the redirect lands on a sibling page
 * inside the same department instead of pushing them out of it entirely.
 * See {@link hasDepartmentDashboardAccess}.
 */
export function RequireDepartmentDashboardAccess({
  fallback,
  children,
}: {
  /** Where to send a rank-and-file employee instead — a sibling page in the same department. */
  fallback: string
  children: React.ReactNode
}) {
  const user = useAuth((s) => s.user)

  if (!hasDepartmentDashboardAccess(user)) {
    return <Navigate to={fallback} replace />
  }

  return <>{children}</>
}
