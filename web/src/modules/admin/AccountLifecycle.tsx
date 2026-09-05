import * as React from 'react'
import { CalendarClock, PowerOff, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { updateRecord, liveApi } from '@/lib/adminApi'
import { Badge, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Setting an account's status, and — the part that did not exist before —
 * scheduling a deactivation ahead of time rather than having to remember to
 * come back and do it by hand.
 *
 * `Inactive` is deliberately distinct from `Suspended`: suspension is what
 * the system does on its own the moment somebody is RESIGNED or TERMINATED
 * (see `EmployeeObserver`), for cause. Inactive is a choice an administrator
 * makes ahead of a known date — a contract ending, a leave of absence — and
 * it is reversible in the same dialog: setting the account back to Active
 * clears the schedule server-side, so reactivating never leaves a stale
 * deactivation date waiting to fire again.
 */

type Status = 'Active' | 'Suspended' | 'Locked' | 'Invited' | 'Inactive'

const STATUSES: { value: Status; label: string; tone: 'good' | 'warning' | 'critical' | 'neutral' }[] = [
  { value: 'Active', label: 'Active', tone: 'good' },
  { value: 'Inactive', label: 'Inactive', tone: 'neutral' },
  { value: 'Suspended', label: 'Suspended', tone: 'critical' },
  { value: 'Locked', label: 'Locked', tone: 'critical' },
  { value: 'Invited', label: 'Invited', tone: 'warning' },
]

const QUICK_PICKS = [
  { label: '30 days', days: 30 },
  { label: '60 days', days: 60 },
  { label: '90 days', days: 90 },
]

export function AccountLifecycleAction({
  user,
  done,
}: {
  user: { id?: number; name?: string; status?: string; deactivateAt?: string | null }
  done?: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [status, setStatus] = React.useState<Status>((user.status as Status) ?? 'Active')
  const [deactivateAt, setDeactivateAt] = React.useState(user.deactivateAt ? user.deactivateAt.slice(0, 10) : '')
  const [busy, setBusy] = React.useState(false)

  const id = Number(user.id ?? 0)
  if (!liveApi() || !id) return null

  const openDialog = () => {
    setStatus((user.status as Status) ?? 'Active')
    setDeactivateAt(user.deactivateAt ? user.deactivateAt.slice(0, 10) : '')
    setOpen(true)
  }

  const quickPick = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    setDeactivateAt(d.toISOString().slice(0, 10))
  }

  const submit = async () => {
    setBusy(true)
    try {
      await updateRecord('admin/users', id, {
        status,
        // A schedule only makes sense while the account is still Active —
        // setting anything else directly is an immediate change, so any
        // stale schedule is cleared rather than left to fire later.
        deactivateAt: status === 'Active' ? deactivateAt || null : null,
      })
      toast({ tone: 'success', title: 'Account updated' })
      setOpen(false)
      done?.()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update the account.', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openDialog}>
        <PowerOff className="size-3.5" />
        Manage status
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Account status"
        description={user.name}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4 p-4">
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatus(s.value)}
                  className={cn('rounded-full transition-opacity', status === s.value ? '' : 'opacity-50 hover:opacity-100')}
                >
                  <Badge tone={s.tone}>{s.label}</Badge>
                </button>
              ))}
            </div>
          </div>

          {status === 'Active' ? (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                <CalendarClock className="size-3.5" />
                Schedule automatic deactivation
              </p>
              <input
                type="date"
                value={deactivateAt}
                onChange={(e) => setDeactivateAt(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {QUICK_PICKS.map((q) => (
                  <Button key={q.days} size="xs" variant="ghost" onClick={() => quickPick(q.days)}>
                    In {q.label}
                  </Button>
                ))}
                {deactivateAt && (
                  <Button size="xs" variant="ghost" onClick={() => setDeactivateAt('')}>
                    Clear
                  </Button>
                )}
              </div>
              <p className="mt-1.5 flex items-start gap-1 text-[11px] text-ink-3">
                <ShieldCheck className="mt-px size-3 shrink-0" />
                {deactivateAt
                  ? `The account stays Active and working normally, then becomes Inactive automatically on ${deactivateAt} — a contract end date, a leave of absence, anything known ahead of time.`
                  : 'Optional — leave empty for an ordinary Active account with no scheduled change.'}
              </p>
            </div>
          ) : (
            <p className="flex items-start gap-1.5 rounded-lg bg-surface-2 p-2.5 text-[11px] leading-relaxed text-ink-3">
              <ShieldCheck className="mt-px size-3.5 shrink-0" />
              Setting the account back to Active also clears any scheduled deactivation date on it.
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
