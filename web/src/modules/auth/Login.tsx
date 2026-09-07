import * as React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock, MailCheck, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BOOTSTRAP_CREDENTIAL, useAuth } from '@/app/auth'
import { forgotPassword, liveApi, resetPassword, verifyResetCode } from '@/lib/adminApi'
import { useCompany } from '@/lib/company'
import { prefetchAllDepartmentsWhenIdle } from '@/app/departmentChunks'
import { prefetchDashboards } from '@/app/warmup'
import { Button, Field, Input } from '@/components/ui/primitives'
import { KitchenBackdrop } from './KitchenBackdrop'
import { LoadingHandoff } from './LoadingHandoff'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const company = useCompany()
  const login = useAuth((s) => s.login)
  const verifyCode = useAuth((s) => s.verifyCode)
  const logoutReason = useAuth((s) => s.logoutReason)
  const clearLogoutReason = useAuth((s) => s.clearLogoutReason)

  const [step, setStep] = React.useState<'credentials' | 'code' | 'forgot' | 'reset' | 'reset-done'>('credentials')
  const [challengeId, setChallengeId] = React.useState('')
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [code, setCode] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // Set the instant credentials are accepted, kept true through the redirect
  // itself. No overlay of its own — the button's existing spinner already
  // reads as "signing in" without a second, bigger one on top of it; this
  // just holds that state a beat longer than the network call needed, so
  // the handoff to the app shell (which fades in on its own) never reads as
  // an instant cut.
  const [transitioning, setTransitioning] = React.useState(false)

  /* Forgotten-password flow. Kept in this component because it is three short
     steps on one card, not a route of its own. */
  const [notice, setNotice] = React.useState('')
  const [resetCode, setResetCode] = React.useState('')
  // The code is checked before the password fields ever appear — asking for
  // a new password up front and only then saying the code was wrong meant
  // retyping a password for a mistake that had nothing to do with it.
  const [resetCodeVerified, setResetCodeVerified] = React.useState(false)
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')

  const goTo = (next: typeof step) => {
    setStep(next)
    setError('')
  }

  /**
   * Asks for a reset code.
   *
   * The reply is identical whether or not the account exists, so this never
   * says "no such user" — that would turn the form into a way of discovering
   * who works here.
   */
  const submitForgot = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const result = await forgotPassword(username.trim())
      setNotice(result.message)
      setResetCode('')
      setResetCodeVerified(false)
      goTo('reset')
    } catch (e) {
      setError((e as Error).message || 'Could not start a reset. Try again.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Lets somebody get a fresh code without leaving the reset screen —
   * without this the only way to resend was Back → re-type the username →
   * Send, three steps to redo one thing already on record.
   *
   * A resend invalidates whatever code was live before it, so any code
   * already verified on screen stops being valid too — back to the code
   * field, not the password fields.
   */
  const resendCode = async () => {
    setError('')
    setBusy(true)

    try {
      const result = await forgotPassword(username.trim())
      setNotice(result.message)
      setResetCode('')
      setResetCodeVerified(false)
    } catch (e) {
      setError((e as Error).message || 'Could not resend the code. Try again.')
    } finally {
      setBusy(false)
    }
  }

  /** Stage one of the reset: confirm the code before asking for a password at all. */
  const submitVerifyResetCode = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      await verifyResetCode(username.trim(), resetCode)
      setResetCodeVerified(true)
    } catch (e) {
      setError((e as Error).message || 'That code is not valid or has expired.')
    } finally {
      setBusy(false)
    }
  }

  /** Stage two: the code is already confirmed, so this only ever fails on the password itself. */
  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.')
      return
    }
    if (newPassword.length < company.minPasswordLength) {
      setError(`Use at least ${company.minPasswordLength} characters.`)
      return
    }

    setBusy(true)
    try {
      await resetPassword({
        username: username.trim(),
        code: resetCode,
        password: newPassword,
        password_confirmation: confirmPassword,
      })
      setPassword('')
      setResetCode('')
      setNewPassword('')
      setConfirmPassword('')
      goTo('reset-done')
    } catch (e) {
      setError((e as Error).message || 'That code is not valid or has expired.')
    } finally {
      setBusy(false)
    }
  }

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/'

  /**
   * The moment credentials are accepted, to the moment the app shell is on
   * screen.
   *
   * Navigation happens immediately — the credential check itself is the only
   * network round trip worth waiting for. Every department's code starts
   * warming (`departmentChunks.ts`) and each department's landing-page data
   * is prefetched into the same React Query cache `useResource` reads from
   * (`app/warmup.ts`), but neither blocks the handoff: they run in the
   * background, and whatever a click into Sales or Warehouse finds already
   * warm is a bonus, not something worth making every sign-in wait on. The
   * destination route's own skeleton covers whatever is still loading.
   */
  const handOff = () => {
    setTransitioning(true)
    prefetchAllDepartmentsWhenIdle()
    void prefetchDashboards()
    navigate(redirectTo, { replace: true })
  }

  // Both handlers clear `busy` in a finally block. Anything that throws on the
  // way to the server would otherwise leave the button reading "Signing in…"
  // with no error beside it, and no way back except a page reload.
  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    clearLogoutReason()
    setBusy(true)

    try {
      const result = await login(username, password)
      if (result.status === 'ok') {
        handOff()
        return
      } else if (result.status === 'code-required') {
        setChallengeId(result.challengeId)
        setStep('code')
      } else setError(result.message)
    } catch (e) {
      setError((e as Error).message || 'Something went wrong signing in. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const result = await verifyCode(challengeId, code)
      if (result.status === 'ok') {
        handOff()
        return
      } else if (result.status === 'error') setError(result.message)
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-dvh bg-surface">
      {transitioning && <LoadingHandoff />}
      <KitchenBackdrop />
      <div className="relative z-10 flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
        {/* ------------------------------- Logo -------------------------------- */}
        <header className="flex shrink-0 flex-col items-center text-center">
          {company.logoUrl ? (
            <img
              src={company.logoUrl}
              alt={company.name}
              // Most uploaded logos carry a white plate. Multiplying drops it
              // into the page instead of leaving a bright rectangle floating on
              // the tint — but only in light mode, where the page is light
              // enough for the blend to be a no-op on the artwork itself.
              className="max-h-28 w-auto max-w-[22rem] object-contain mix-blend-multiply sm:max-h-32 dark:mix-blend-normal"
            />
          ) : (
            <span className="grad-brand flex size-24 items-center justify-center rounded-3xl text-4xl font-bold text-white shadow-[0_10px_30px_-8px_rgb(225_29_52/0.5)] sm:size-28 sm:text-5xl">
              {company.name.trim().charAt(0).toUpperCase() || 'T'}
            </span>
          )}
          <h1 className="mt-4 text-xl font-bold tracking-tight text-ink sm:text-2xl">{company.name}</h1>
          <p className="mt-1 text-[10px] font-medium tracking-[0.28em] text-ink-3">ERP SUITE</p>
        </header>

        {/* ------------------------------- Card -------------------------------- */}
        <div className="flex w-full flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-[0_16px_48px_-20px_rgb(13_15_20/0.28)] sm:p-7">
            {/* Each step below guards its own render — this one used to be
                "credentials, else the auth-code form", which meant the
                auth-code form kept rendering underneath the forgot-password
                steps too (anything that isn't 'credentials' matched the
                else). That's the real redundancy: two forms stacked on one
                screen. */}
            {step === 'credentials' ? (
              <>
                <h2 className="text-[19px] font-semibold tracking-tight text-ink">Sign in</h2>
                <p className="mt-1 text-[13px] text-ink-3">Enter your account details to continue.</p>

                {logoutReason && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
                    <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <p className="text-xs text-ink-2">{logoutReason}</p>
                  </div>
                )}

                <form onSubmit={submitCredentials} className="mt-5 space-y-4">
                  <Field label="Username" required>
                    <div className="relative">
                      <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="superadmin"
                        autoComplete="username"
                        autoFocus
                        required
                        className="h-11 pl-9"
                      />
                    </div>
                  </Field>

                  <Field label="Password" required>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                        className="h-11 pr-10 pl-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </Field>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-critical/10 p-2.5 ring-1 ring-critical/25 ring-inset">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" />
                      <p className="text-xs text-critical">{error}</p>
                    </div>
                  )}

                  <Button type="submit" variant="primary" size="lg" loading={busy || transitioning} className="w-full">
                    {busy || transitioning ? 'Signing in…' : 'Sign in'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setNotice('')
                      goTo('forgot')
                    }}
                    className="block w-full text-center text-[13px] text-ink-3 transition-colors hover:text-brand-600 dark:hover:text-brand-400"
                  >
                    Forgot password?
                  </button>
                </form>

                {/* Bootstrap account — removed once real users exist in the database. */}
                <button
                  type="button"
                  onClick={() => {
                    setUsername(BOOTSTRAP_CREDENTIAL.username)
                    setPassword(BOOTSTRAP_CREDENTIAL.password)
                  }}
                  className="mt-5 block w-full rounded-lg border border-dashed border-line-strong px-3 py-2 text-[11px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
                >
                  First time here? Use the temporary{' '}
                  <span className="font-mono text-ink-2">{BOOTSTRAP_CREDENTIAL.username}</span> account
                </button>
              </>
            ) : step === 'code' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setStep('credentials')
                    setError('')
                    setCode('')
                  }}
                  className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" />
                  Back
                </button>

                <span className="grad-brand-soft mb-4 flex size-12 items-center justify-center rounded-2xl">
                  <MailCheck className="size-5 text-brand-500" />
                </span>

                <h2 className="text-[19px] font-semibold tracking-tight text-ink">Enter your auth code</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                  We emailed a six-digit code to the address on your account. It expires in 10 minutes.
                </p>

                <form onSubmit={submitCode} className="mt-5 space-y-4">
                  <Field label="Authentication code" required>
                    <Input
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      autoFocus
                      required
                      className={cn('h-12 text-center font-mono text-lg tracking-[0.5em]')}
                    />
                  </Field>

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
                    loading={busy || transitioning}
                    disabled={code.length !== 6}
                    className="w-full"
                  >
                    {transitioning ? 'Signing in…' : 'Verify and sign in'}
                  </Button>
                </form>
              </>
            ) : null}

            {/* ---------------------- Forgotten password ---------------------- */}
            {step === 'forgot' && (
              <>
                <button
                  type="button"
                  onClick={() => goTo('credentials')}
                  className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" />
                  Back to sign in
                </button>

                <span className="grad-brand-soft mb-4 flex size-12 items-center justify-center rounded-2xl">
                  <KeyRound className="size-5 text-brand-500" />
                </span>

                <h2 className="text-[19px] font-semibold tracking-tight text-ink">Reset your password</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                  Give us your username or email address and we will send a six-digit code to the address on the
                  account.
                </p>

                <form onSubmit={submitForgot} className="mt-5 space-y-4">
                  <Field label="Username or email" required>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="superadmin"
                      autoComplete="username"
                      autoFocus
                      required
                    />
                  </Field>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-critical/10 p-2.5 ring-1 ring-critical/25 ring-inset">
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" />
                      <p className="text-xs text-critical">{error}</p>
                    </div>
                  )}

                  {!liveApi() && (
                    <p className="rounded-lg bg-warning/10 p-2.5 text-xs text-ink-2 ring-1 ring-warning/25 ring-inset">
                      Password reset needs the server. This preview has no mail to send with.
                    </p>
                  )}

                  <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
                    Send me a code
                  </Button>
                </form>
              </>
            )}

            {step === 'reset' && (
              <>
                {/* Straight back to sign-in, not to the "send a code" step —
                    that step has nothing left to do once a code is on its
                    way, so routing through it first was a detour, not an
                    undo. */}
                <button
                  type="button"
                  onClick={() => goTo('credentials')}
                  className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
                >
                  <ArrowLeft className="size-3.5" />
                  Back to sign in
                </button>

                <span className="grad-brand-soft mb-4 flex size-12 items-center justify-center rounded-2xl">
                  <MailCheck className="size-5 text-brand-500" />
                </span>

                {resetCodeVerified ? (
                  <>
                    <h2 className="text-[19px] font-semibold tracking-tight text-ink">Choose a new password</h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                      Code verified. Pick a new password for the account.
                    </p>

                    <form onSubmit={submitReset} className="mt-5 space-y-4">
                      <Field label="New password" required hint={`At least ${company.minPasswordLength} characters.`}>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                          autoFocus
                          required
                        />
                      </Field>

                      <Field label="Confirm new password" required>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          autoComplete="new-password"
                          required
                        />
                      </Field>

                      {error && (
                        <div className="flex items-start gap-2 rounded-lg bg-critical/10 p-2.5 ring-1 ring-critical/25 ring-inset">
                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" />
                          <p className="text-xs text-critical">{error}</p>
                        </div>
                      )}

                      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
                        Change my password
                      </Button>

                      <button
                        type="button"
                        onClick={() => setResetCodeVerified(false)}
                        disabled={busy}
                        className="block w-full text-center text-[13px] text-ink-3 transition-colors hover:text-brand-600 disabled:opacity-50 dark:hover:text-brand-400"
                      >
                        Wrong code? Go back
                      </button>
                    </form>
                  </>
                ) : (
                  <>
                    <h2 className="text-[19px] font-semibold tracking-tight text-ink">Enter your reset code</h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                      {notice || 'Enter the six-digit code we emailed you.'}
                    </p>

                    <form onSubmit={submitVerifyResetCode} className="mt-5 space-y-4">
                      <Field label="Six-digit code" required>
                        <Input
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="000000"
                          autoFocus
                          required
                          className="h-12 text-center font-mono text-lg tracking-[0.5em]"
                        />
                      </Field>

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
                        disabled={resetCode.length !== 6}
                        className="w-full"
                      >
                        Verify code
                      </Button>

                      <button
                        type="button"
                        onClick={() => void resendCode()}
                        disabled={busy}
                        className="block w-full text-center text-[13px] text-ink-3 transition-colors hover:text-brand-600 disabled:opacity-50 dark:hover:text-brand-400"
                      >
                        Didn't get it? Resend the code
                      </button>
                    </form>
                  </>
                )}
              </>
            )}

            {step === 'reset-done' && (
              <div className="py-2 text-center">
                <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-good/15">
                  <CheckCircle2 className="size-6 text-good" />
                </span>
                <h2 className="text-[19px] font-semibold tracking-tight text-ink">Password changed</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                  Every other session on this account has been signed out. Sign in with the new password.
                </p>
                <Button variant="primary" size="lg" className="mt-5 w-full" onClick={() => goTo('credentials')}>
                  Back to sign in
                </Button>
              </div>
            )}
          </div>
        </div>

        <footer className="shrink-0 text-center text-[11px] text-ink-3">
          © {new Date().getFullYear()} {company.name} · Access is monitored and recorded in the audit trail.
        </footer>
      </div>
    </div>
  )
}
