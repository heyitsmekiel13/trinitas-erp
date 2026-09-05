import * as React from 'react'
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { ApiError, changeOwnPassword } from '@/lib/adminApi'
import { useCompany } from '@/lib/company'

/**
 * Changing your own password, voluntarily.
 *
 * Accounts are issued the last four digits of the person's mobile number and
 * are no longer forced to change it, which is a deliberate trade for how
 * quickly a crew can be onboarded. The cost of that trade is that an account
 * can stay on a four-digit credential for ever unless somebody chooses
 * otherwise — so this screen has to be easy to find and worth using, rather
 * than a setting buried three levels down.
 *
 * Reachable from the account menu on every page. The forced-change screen at
 * sign-in still exists for the accounts that are flagged for it; this is the
 * same operation without the wall.
 */
export function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const minLength = useCompany().minPasswordLength
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [show, setShow] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  React.useEffect(() => {
    if (!open) return

    setCurrent('')
    setNext('')
    setConfirm('')
    setErrors({})
    setShow(false)
  }, [open])

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < minLength
  const canSubmit = current.length > 0 && next.length >= minLength && next === confirm && !saving

  const submit = async () => {
    setSaving(true)
    setErrors({})

    try {
      await changeOwnPassword({ current_password: current, password: next, password_confirmation: confirm })

      toast({
        tone: 'success',
        title: 'Password changed',
        description: 'Use the new one next time you sign in.',
      })
      onClose()
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) {
        setErrors(e.errors)
      } else {
        toast({ tone: 'error', title: 'Could not change it', description: (e as Error).message })
      }
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => errors[field]?.[0]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change your password"
      description="Pick something only you know. You will not be asked to do this again."
      size="sm"
    >
      <div className="space-y-4">
        {/* Says plainly what the issued password is, because somebody who has
            never changed it will not otherwise know what to type here. */}
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-ink-3" />
          <p className="text-[12px] leading-relaxed text-ink-3">
            If you have never changed it, your current password is the{' '}
            <strong className="text-ink-2">last four digits of your mobile number</strong> as recorded by HR.
          </p>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Current password</span>
          <Input
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            data-invalid={fieldError('current_password') ? 'true' : undefined}
          />
          {fieldError('current_password') && (
            <span className="mt-1 block text-[11px] text-critical">{fieldError('current_password')}</span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-ink-2">
            New password
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-normal text-ink-3 hover:text-ink-2"
            >
              {show ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
          <Input
            type={show ? 'text' : 'password'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            data-invalid={tooShort || fieldError('password') ? 'true' : undefined}
          />
          <span className={cn('mt-1 block text-[11px]', tooShort ? 'text-critical' : 'text-ink-3')}>
            {fieldError('password') ?? `At least ${minLength} characters.`}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">Confirm new password</span>
          <Input
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && void submit()}
            data-invalid={mismatch ? 'true' : undefined}
          />
          {mismatch && <span className="mt-1 block text-[11px] text-critical">The two do not match.</span>}
        </label>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
          <ShieldCheck className="size-3.5" />
          Signing in elsewhere is unaffected.
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Change password
          </Button>
        </div>
      </div>
    </Modal>
  )
}
