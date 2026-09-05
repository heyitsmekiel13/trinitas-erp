import * as React from 'react'
import { AlertCircle, Check, KeyRound, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/app/auth'
import { useCompany } from '@/lib/company'
import { ApiError, changeOwnPassword } from '@/lib/adminApi'
import { Button, Field, Input } from '@/components/ui/primitives'
import { KitchenBackdrop } from './KitchenBackdrop'

/**
 * Shown instead of the app while an account is still on its issued password.
 *
 * Every employee imported from the masterfile starts on the same shared
 * password, so this is the first thing they see. There is deliberately no way
 * past it other than choosing a new password or signing out — and the API
 * enforces the same rule, so skipping the screen achieves nothing.
 */

export function ForcePasswordChange() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const logout = useAuth((s) => s.logout)
  const company = useCompany()

  const rules: { label: string; test: (value: string) => boolean }[] = [
    { label: `At least ${company.minPasswordLength} characters`, test: (v) => v.length >= company.minPasswordLength },
    { label: 'A letter and a number', test: (v) => /[a-z]/i.test(v) && /\d/.test(v) },
    { label: 'Not the password you were given', test: (v) => v.toLowerCase() !== 'trinitas@2026' },
  ]

  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({})

  const passed = rules.map((rule) => rule.test(next))
  const allPassed = passed.every(Boolean)
  const matches = next.length > 0 && next === confirm

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setFieldErrors({})

    try {
      await changeOwnPassword({
        current_password: current,
        password: next,
        password_confirmation: confirm,
      })
      // Clear the flag locally so the app opens without another round trip.
      if (user) setUser({ ...user, mustChangePassword: false })
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) setFieldErrors(e.errors)
      else setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grad-brand relative min-h-dvh">
      <KitchenBackdrop />

      <div className="relative z-10 flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
        <header className="flex shrink-0 flex-col items-center text-center">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="max-h-12 w-auto max-w-[11rem] object-contain drop-shadow-lg" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold text-white ring-1 ring-white/30 backdrop-blur-md">
              {company.name.trim().charAt(0).toUpperCase() || 'T'}
            </span>
          )}
          <h1 className="mt-3 text-lg font-bold tracking-tight text-white">{company.name}</h1>
        </header>

        <div className="flex w-full flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-surface p-6 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.5)] sm:p-7">
            <span className="grad-brand-soft mb-4 flex size-11 items-center justify-center rounded-2xl">
              <KeyRound className="size-5 text-brand-500" />
            </span>

            <h2 className="text-[19px] font-semibold tracking-tight text-ink">Choose your password</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
              {user?.name?.split(' ')[0] ? `Welcome, ${user.name.split(' ')[0]}. ` : ''}
              Everyone was issued the same starting password, so please set your own before continuing.
            </p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Password you were given" required error={fieldErrors.current_password?.[0]}>
                <Input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </Field>

              <Field label="New password" required error={fieldErrors.password?.[0]}>
                <Input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>

              <ul className="space-y-1">
                {rules.map((rule, i) => (
                  <li
                    key={rule.label}
                    className={cn(
                      'flex items-center gap-1.5 text-[11px]',
                      next.length === 0 ? 'text-ink-3' : passed[i] ? 'text-[var(--delta-up)]' : 'text-ink-3',
                    )}
                  >
                    <Check className={cn('size-3', next.length > 0 && passed[i] ? 'opacity-100' : 'opacity-30')} />
                    {rule.label}
                  </li>
                ))}
              </ul>

              <Field label="Confirm new password" required>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>

              {confirm.length > 0 && !matches && (
                <p className="text-[11px] text-critical">The two passwords do not match.</p>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-critical/10 p-2.5 ring-1 ring-critical/25 ring-inset">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" />
                  <p className="text-xs text-critical">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={busy}
                disabled={!current || !allPassed || !matches}
                className="w-full"
              >
                Save and continue
              </Button>
            </form>

            <button
              type="button"
              onClick={() => logout('You signed out.')}
              className="mt-4 flex w-full items-center justify-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
            >
              <LogOut className="size-3.5" />
              Sign out instead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
