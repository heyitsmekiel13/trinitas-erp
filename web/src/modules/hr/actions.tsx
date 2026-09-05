import * as React from 'react'
import { Check, KeyRound, RadarIcon, X } from 'lucide-react'
import { invalidateResource } from '@/lib/api'
import { decideLeave, liveApi, resetEmployeePassword, scanInfractions } from '@/lib/adminApi'
import { num } from '@/lib/format'
import { useToast } from '@/components/ui/feedback'
import { Button, Field, Switch } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'

/**
 * HR actions that change something.
 *
 * Approving leave moves a balance, scanning attendance raises real notices, and
 * resetting a sign-in changes what somebody types tomorrow morning — so each
 * one reports exactly what it did rather than a bare "saved".
 */

const refresh = (...endpoints: string[]) => endpoints.forEach((endpoint) => void invalidateResource(endpoint))

const HR_KEYS = ['hr/dashboard', 'hr/leaves', 'hr/cases', 'hr/attendance', 'hr/watchlist', 'me/hr']

type Row = Record<string, unknown>

const idOf = (row: Row) => Number(row.id ?? 0)

/* -------------------------------------------------------------------------- */

/** Approves or refuses leave. Approval is what takes the days off. */
export function DecideLeave({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState<'Approved' | 'Rejected' | null>(null)

  if (!liveApi() || !['For Approval', 'Draft'].includes(String(row.status))) return null

  const decide = async (decision: 'Approved' | 'Rejected') => {
    setBusy(decision)
    try {
      const result = await decideLeave(idOf(row), decision)
      toast({
        tone: decision === 'Approved' ? 'success' : 'info',
        title: `${result.no} ${decision.toLowerCase()}`,
        description:
          decision === 'Approved'
            ? `${num(result.days, 1)} day(s) deducted — ${num(result.balanceAfter, 1)} left.`
            : 'The balance is untouched.',
      })
      refresh(...HR_KEYS)
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not decide', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" loading={busy === 'Rejected'} onClick={() => decide('Rejected')}>
        <X className="size-3.5" />
        Reject
      </Button>
      <Button variant="secondary" size="sm" loading={busy === 'Approved'} onClick={() => decide('Approved')}>
        <Check className="size-3.5" />
        Approve
      </Button>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Raises infraction cases from what the attendance log already shows.
 *
 * The alternative is somebody noticing that a person "is always late" — an
 * impression nobody can check, and a notice nobody can defend.
 */
export function ScanInfractions() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  if (!liveApi()) return null

  const run = async () => {
    setBusy(true)
    try {
      const result = await scanInfractions()
      toast({
        tone: result.raised > 0 ? 'success' : 'info',
        title: result.raised > 0 ? `${result.raised} case${result.raised === 1 ? '' : 's'} raised` : 'Nothing to raise',
        description:
          result.raised > 0
            ? result.cases
                .slice(0, 5)
                .map((c) => `${c.no} · ${c.employeeNo} — ${c.type} (${c.action})`)
                .join('\n')
            : `${num(result.scanned)} day(s) checked since ${result.since}. Anything found already has a case.`,
      })
      refresh(...HR_KEYS)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not scan', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="primary" size="sm" loading={busy} onClick={run}>
      <RadarIcon className="size-3.5" />
      Scan attendance
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Puts an employee's sign-in back to the shared default.
 *
 * Shows the username afterwards because that is the part people forget — it is
 * their employee number without the branch prefix.
 */
export function ResetSignIn({ row, done }: { row: Row; done: () => void }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [mustChange, setMustChange] = React.useState(false)
  const [result, setResult] = React.useState<{ username: string; password: string } | null>(null)

  if (!liveApi()) return null

  const submit = async () => {
    setBusy(true)
    try {
      const reset = await resetEmployeePassword(idOf(row), mustChange)
      setResult({ username: reset.username, password: reset.password })
      toast({
        tone: 'success',
        title: 'Sign-in reset',
        description: `${reset.employee} signs in as ${reset.username}.`,
      })
      refresh(...HR_KEYS, 'admin/users')
      done()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not reset', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setOpen(false)
    setResult(null)
    setMustChange(false)
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="size-3.5" />
        Reset sign-in
      </Button>

      <Modal
        open={open}
        onClose={close}
        size="sm"
        title="Reset this employee's sign-in"
        description={`${String(row.fullName ?? row.employeeNo ?? '')} will be able to sign in with the shared default password.`}
        footer={
          result ? (
            <Button variant="primary" size="sm" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={busy} onClick={submit}>
                Reset password
              </Button>
            </>
          )
        }
      >
        {result ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-2">Give the employee these details:</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-[10px] tracking-wide text-ink-3 uppercase">Username</p>
                <p className="mt-1 font-mono text-[15px] font-semibold text-ink">{result.username}</p>
              </div>
              <div className="rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-[10px] tracking-wide text-ink-3 uppercase">Password</p>
                <p className="mt-1 font-mono text-[15px] font-semibold text-ink">{result.password}</p>
              </div>
            </div>
            <p className="text-[11px] text-ink-3">
              The username is their employee number without the branch prefix — the number they already quote.
            </p>
          </div>
        ) : (
          <Field
            label="Require a change on first sign-in"
            hint="Leave off so the employee can clock in straight away. Turn on if this account needs its own password."
          >
            <Switch checked={mustChange} onChange={setMustChange} label="Force a password change" />
          </Field>
        )}
      </Modal>
    </>
  )
}
