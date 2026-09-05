import * as React from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ShieldAlert, UserRound, XCircle } from 'lucide-react'
import { useCompany } from '@/lib/company'
import { checkEmployeeBadge, type PublicEmployee } from '@/lib/publicEmployeeApi'

/**
 * What a scanned badge shows a stranger — the destination of the QR code
 * printed on an employee ID card (see `hr/idCards.tsx`).
 *
 * No sign-in, deliberately: the whole point is that a security guard, a
 * client, or a supplier can confirm "does this person really work here"
 * without an account or a call to HR. Outside the app shell, like the
 * careers site, for the same reason — this page owes nobody who looks at it
 * a view of the internal ERP.
 */
export function IdCheck() {
  const { token } = useParams<{ token: string }>()
  const company = useCompany()
  const [employee, setEmployee] = React.useState<PublicEmployee | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!token) return
    setLoading(true)
    checkEmployeeBadge(token)
      .then((e) => {
        setEmployee(e)
        setError(null)
      })
      .catch((e: Error) => {
        setEmployee(null)
        setError(e.message)
      })
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-page px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        {company.logoUrl ? (
          <img src={company.logoUrl} alt="" className="size-9 rounded-lg object-contain" />
        ) : (
          <span className="grad-brand flex size-9 items-center justify-center rounded-lg text-sm font-bold text-white">
            {company.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="text-[15px] font-bold tracking-tight text-ink uppercase">{company.name}</span>
      </div>

      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)]">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-ink-3">Checking badge…</div>
        ) : error || !employee ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <XCircle className="size-10 text-critical" />
            <p className="text-[14px] font-semibold text-ink">Not a valid badge</p>
            <p className="text-[12px] text-ink-3">{error ?? 'This QR code does not match any employee on file.'}</p>
          </div>
        ) : (
          <>
            <div className={employee.status === 'Active' ? 'grad-brand p-5' : 'bg-ink-3 p-5'}>
              <div className="flex items-center gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/15 ring-2 ring-white/40">
                  {employee.photoUrl ? (
                    <img src={employee.photoUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <UserRound className="size-8 text-white/80" />
                  )}
                </div>
                <div className="min-w-0 text-white">
                  <p className="truncate text-[16px] font-bold">{employee.name}</p>
                  <p className="truncate text-[12px] text-white/85">{employee.position ?? '—'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-5">
              <div
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold ${
                  employee.status === 'Active'
                    ? 'bg-good/10 text-good'
                    : 'bg-critical/10 text-critical'
                }`}
              >
                {employee.status === 'Active' ? <CheckCircle2 className="size-4.5 shrink-0" /> : <ShieldAlert className="size-4.5 shrink-0" />}
                {employee.status === 'Active'
                  ? 'Currently employed here'
                  : 'No longer employed here'}
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
                <div>
                  <dt className="text-ink-3">Department</dt>
                  <dd className="font-medium text-ink">{employee.department ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Employee no.</dt>
                  <dd className="font-mono font-medium text-ink">{employee.employeeNo}</dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </div>

      <p className="mt-6 max-w-sm text-center text-[11px] leading-relaxed text-ink-3">
        This page confirms an employment badge issued by {company.name}. It shows nothing beyond what appears here —
        no contact details, schedule or personal information.
      </p>
    </div>
  )
}
