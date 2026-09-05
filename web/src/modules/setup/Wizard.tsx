import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CircleAlert,
  Database,
  KeyRound,
  Mail,
  PartyPopper,
  RefreshCw,
  Send,
  TriangleAlert,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import * as api from '@/lib/adminApi'
import { ApiError, liveApi } from '@/lib/adminApi'
import { API_BASE_URL } from '@/lib/api'
import { Badge, Button, Card, Field, Input, Select, Switch } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import { KitchenBackdrop } from '@/modules/auth/KitchenBackdrop'

/**
 * First-run setup.
 *
 * Walks a non-technical administrator from "the database exists" to "this is
 * ready for real work" in five steps. Every step is independently checkable —
 * the wizard reads actual system state rather than a "setup complete" flag,
 * so it stays honest if someone changes things afterwards.
 */

type StepId = 'database' | 'company' | 'account' | 'email' | 'done'

const STEPS: { id: StepId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'database', label: 'Database', icon: Database },
  { id: 'company', label: 'Company', icon: Building2 },
  { id: 'account', label: 'Your account', icon: KeyRound },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'done', label: 'Finish', icon: PartyPopper },
]

export function SetupWizard() {
  const navigate = useNavigate()
  const [step, setStep] = React.useState<StepId>('database')
  const [status, setStatus] = React.useState<api.SystemStatus | null>(null)
  const [checking, setChecking] = React.useState(true)

  const refreshStatus = React.useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await api.systemStatus())
    } catch {
      setStatus(null)
    } finally {
      setChecking(false)
    }
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setChecking(false)
      return
    }
    void refreshStatus()
  }, [refreshStatus])

  const index = STEPS.findIndex((s) => s.id === step)
  const go = (delta: number) => setStep(STEPS[Math.min(STEPS.length - 1, Math.max(0, index + delta))]!.id)

  return (
    <div className="grad-brand relative min-h-dvh">
      <KitchenBackdrop />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-8 sm:py-12">
        <header className="flex shrink-0 flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/15 text-lg font-bold text-white ring-1 ring-white/30 backdrop-blur-md">
            T
          </span>
          <h1 className="mt-3 text-lg font-bold tracking-tight text-white">Set up your ERP</h1>
          <p className="mt-1 text-[13px] text-white/70">Five steps. You can come back to any of them later.</p>
        </header>

        {/* Stepper */}
        <nav aria-label="Setup progress" className="mt-6 mb-4 flex shrink-0 items-center justify-center gap-1 sm:gap-2">
          {STEPS.map((s, i) => {
            const done = i < index
            const active = i === index
            return (
              <React.Fragment key={s.id}>
                <button
                  onClick={() => setStep(s.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:px-3',
                    active
                      ? 'bg-white text-brand-700'
                      : done
                        ? 'bg-white/25 text-white'
                        : 'bg-white/10 text-white/60 hover:bg-white/20',
                  )}
                >
                  {done ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <span className="h-px w-2 bg-white/25 sm:w-4" />}
              </React.Fragment>
            )
          })}
        </nav>

        <div className="flex-1">
          <Card className="p-5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.5)] sm:p-6">
            {!liveApi() ? (
              <NotConnected />
            ) : (
              <>
                {step === 'database' && <DatabaseStep status={status} checking={checking} onRefresh={refreshStatus} />}
                {step === 'company' && <CompanyStep />}
                {step === 'account' && <AccountStep />}
                {step === 'email' && <EmailStep />}
                {step === 'done' && <DoneStep status={status} onRefresh={refreshStatus} />}
              </>
            )}
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              onClick={() => go(-1)}
              disabled={index === 0}
              className="bg-white/10 text-white ring-1 ring-white/25 hover:bg-white/20"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/')}
                className="px-2 text-[13px] text-white/70 transition-colors hover:text-white"
              >
                Skip for now
              </button>
              {step === 'done' ? (
                <Button variant="secondary" onClick={() => navigate('/')} className="bg-white text-brand-700 hover:bg-white/90">
                  Go to dashboard
                  <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => go(1)} className="bg-white text-brand-700 hover:bg-white/90">
                  Next
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{description}</p>
    </div>
  )
}

function NotConnected() {
  return (
    <>
      <StepHeading
        title="The app is not talking to the database yet"
        description="Right now you are looking at preview data. Two things connect it for real."
      />
      <ol className="space-y-3 text-[13px] text-ink-2">
        <li className="rounded-xl border border-line bg-surface-2 p-3.5">
          <p className="font-medium text-ink">1. Create the database</p>
          <p className="mt-1 text-ink-3">
            Double-click <code className="rounded bg-surface px-1 py-0.5 font-mono text-ink">SETUP DATABASE.bat</code> in
            the TRINITAS ERP folder and enter your MySQL password when it asks.
          </p>
        </li>
        <li className="rounded-xl border border-line bg-surface-2 p-3.5">
          <p className="font-medium text-ink">2. Point the app at the API</p>
          <p className="mt-1 text-ink-3">
            Create a file called <code className="rounded bg-surface px-1 py-0.5 font-mono text-ink">web/.env</code> containing:
          </p>
          <code className="mt-2 block rounded-lg bg-surface px-2.5 py-2 font-mono text-xs text-ink">
            VITE_API_URL={API_BASE_URL}
          </code>
          <p className="mt-2 text-ink-3">Then stop and restart the app.</p>
        </li>
      </ol>
    </>
  )
}

/* ------------------------------- Database --------------------------------- */

function DatabaseStep({
  status,
  checking,
  onRefresh,
}: {
  status: api.SystemStatus | null
  checking: boolean
  onRefresh: () => Promise<void>
}) {
  const db = status?.database

  return (
    <>
      <StepHeading
        title="Database connection"
        description="Everything the ERP records lives here. This must be green before anything else matters."
      />

      {checking ? (
        <div className="shimmer h-28 rounded-xl" />
      ) : db?.connected ? (
        <div className="rounded-xl border border-good/30 bg-good/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Check className="size-4 text-good" />
            Connected
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-[13px] sm:grid-cols-3">
            {[
              ['Driver', db.driver],
              ['Database', db.name?.split(/[\\/]/).pop() ?? '—'],
              ['Server', db.host ? `${db.host}:${db.port}` : 'local file'],
              ['Version', db.version ?? '—'],
              ['Tables', String(db.tables ?? 0)],
              ['Migrated', db.migrated ? 'Yes' : 'No'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</dt>
                <dd className="mt-0.5 truncate text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {db.driver === 'sqlite' && (
            <p className="mt-3 flex items-start gap-2 border-t border-good/25 pt-3 text-xs text-ink-2">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
              This is the development SQLite file, not MySQL. Run{' '}
              <code className="rounded bg-surface px-1 font-mono">SETUP DATABASE.bat</code> to switch to MySQL before
              going live.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-critical/30 bg-critical/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-critical">
            <CircleAlert className="size-4" />
            Not connected
          </p>
          <p className="mt-2 text-[13px] text-ink-2">
            Run <code className="rounded bg-surface px-1 py-0.5 font-mono text-ink">SETUP DATABASE.bat</code> in the
            TRINITAS ERP folder, then press Check again.
          </p>
          {db?.error && (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-surface p-2.5 font-mono text-[11px] text-ink-3">
              {db.error}
            </pre>
          )}
        </div>
      )}

      <Button variant="secondary" size="sm" className="mt-4" onClick={() => void onRefresh()} loading={checking}>
        <RefreshCw className="size-3.5" />
        Check again
      </Button>
    </>
  )
}

/* -------------------------------- Company --------------------------------- */

function CompanyStep() {
  const toast = useToast()
  const [values, setValues] = React.useState<api.CompanySettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  React.useEffect(() => {
    api.getCompanySettings().then(setValues).catch(() => setValues(null))
  }, [])

  if (!values) return <div className="shimmer h-56 rounded-xl" />

  const set = <K extends keyof api.CompanySettings>(key: K, value: api.CompanySettings[K]) =>
    setValues({ ...values, [key]: value })

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      setValues(await api.saveCompanySettings(values))
      toast({ tone: 'success', title: 'Company details saved' })
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.errors)
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <StepHeading
        title="Company details"
        description="These appear on every printed report, exported file and outgoing email."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Registered name" required error={errors.legal_name?.[0]} className="sm:col-span-2">
          <Input value={values.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
        </Field>
        <Field label="Registered address" className="sm:col-span-2" error={errors.address?.[0]}>
          <Input value={values.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="TIN" error={errors.tin?.[0]}>
          <Input value={values.tin ?? ''} onChange={(e) => set('tin', e.target.value)} placeholder="000-000-000-000" />
        </Field>
        <Field label="Contact number" error={errors.phone?.[0]}>
          <Input value={values.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Currency" required error={errors.currency?.[0]}>
          <Input value={values.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Fiscal year starts" required>
          <Select value={String(values.fiscal_year_start)} onChange={(e) => set('fiscal_year_start', Number(e.target.value))}>
            {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(
              (m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ),
            )}
          </Select>
        </Field>
      </div>

      <Button variant="primary" size="sm" className="mt-5" onClick={save} loading={saving}>
        Save company details
      </Button>
      <p className="mt-2 text-xs text-ink-3">You can add a logo later in Admin → System Settings → Company.</p>
    </>
  )
}

/* -------------------------------- Account --------------------------------- */

function AccountStep() {
  const toast = useToast()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [changed, setChanged] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await api.changeOwnPassword({ current_password: current, password: next, password_confirmation: confirm })
      setChanged(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      toast({ tone: 'success', title: 'Password changed', description: 'Other sessions have been signed out.' })
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.errors)
      toast({ tone: 'error', title: 'Could not change password', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <StepHeading
        title="Secure your account"
        description="The install password is published in the documentation. Replace it before anyone else can reach this system."
      />

      {changed ? (
        <div className="rounded-xl border border-good/30 bg-good/10 p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Check className="size-4 text-good" />
            Password updated
          </p>
          <p className="mt-1.5 text-[13px] text-ink-2">Every other signed-in session was ended.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password" required error={errors.current_password?.[0]}>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" required hint="At least 10 characters." error={errors.password?.[0]}>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password" required>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!current || next.length < 10 || next !== confirm}>
            Change password
          </Button>
        </form>
      )}
    </>
  )
}

/* --------------------------------- Email ---------------------------------- */

function EmailStep() {
  const toast = useToast()
  const [values, setValues] = React.useState<api.SmtpSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testTo, setTestTo] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string[]>>({})

  React.useEffect(() => {
    api.getSmtpSettings().then(setValues).catch(() => setValues(null))
  }, [])

  if (!values) return <div className="shimmer h-56 rounded-xl" />

  const set = <K extends keyof api.SmtpSettings>(key: K, value: api.SmtpSettings[K]) =>
    setValues({ ...values, [key]: value })

  const save = async () => {
    setSaving(true)
    setErrors({})
    try {
      setValues(await api.saveSmtpSettings(values))
      toast({ tone: 'success', title: 'Email settings saved' })
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.errors)
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const result = await api.sendTestEmail(testTo)
      toast(
        result.sent
          ? { tone: 'success', title: 'Test email sent' }
          : { tone: 'error', title: 'Could not send', description: result.error ?? '' },
      )
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send', description: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <StepHeading
        title="Email delivery"
        description="Needed for sign-in codes, approval requests and payroll notices. You can skip this and set it up later."
      />

      <label className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
        <span className="text-[13px] font-medium text-ink">Send transactional email</span>
        <Switch checked={values.enabled} onChange={(on) => set('enabled', on)} label="Enable email" />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SMTP host" required={values.enabled} error={errors.host?.[0]}>
          <Input value={values.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="smtp.gmail.com" />
        </Field>
        <Field label="Port" required={values.enabled} error={errors.port?.[0]}>
          <Input type="number" value={values.port ?? 587} onChange={(e) => set('port', Number(e.target.value))} />
        </Field>
        <Field label="Username" error={errors.username?.[0]}>
          <Input value={values.username ?? ''} onChange={(e) => set('username', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password" hint="Stored encrypted." error={errors.password?.[0]}>
          <Input
            type="password"
            value={values.password ?? ''}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="From address" required={values.enabled} error={errors.from_address?.[0]} className="sm:col-span-2">
          <Input
            type="email"
            value={values.from_address ?? ''}
            onChange={(e) => set('from_address', e.target.value)}
            placeholder="noreply@yourcompany.com"
          />
        </Field>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <Button variant="primary" size="sm" onClick={save} loading={saving}>
          Save email settings
        </Button>
        <Field label="Test send to" className="min-w-48 flex-1">
          <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Button variant="secondary" size="sm" onClick={test} loading={testing} disabled={!testTo || !values.enabled}>
          <Send className="size-3.5" />
          Test
        </Button>
      </div>
    </>
  )
}

/* --------------------------------- Done ----------------------------------- */

function DoneStep({ status, onRefresh }: { status: api.SystemStatus | null; onRefresh: () => Promise<void> }) {
  React.useEffect(() => {
    void onRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checklist = status?.checklist ?? []
  const remaining = checklist.filter((c) => !c.done)

  return (
    <>
      <StepHeading
        title={remaining.length === 0 ? 'You are ready to go' : 'Almost there'}
        description={
          remaining.length === 0
            ? 'Every setup item is complete. The ERP is ready for real work.'
            : 'These items are still outstanding. None of them block you from using the system.'
        }
      />

      <ul className="space-y-2">
        {checklist.map((item) => (
          <li
            key={item.key}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3.5',
              item.done ? 'border-good/25 bg-good/5' : 'border-line bg-surface-2',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
                item.done ? 'bg-good text-white' : 'border border-line-strong text-ink-3',
              )}
            >
              {item.done ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">{item.label}</span>
              {!item.done && <span className="mt-0.5 block text-xs text-ink-3">{item.hint}</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-2">
        <Badge tone={remaining.length === 0 ? 'good' : 'warning'} dot>
          {checklist.length - remaining.length} of {checklist.length} complete
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => void onRefresh()}>
          <RefreshCw className="size-3.5" />
          Re-check
        </Button>
      </div>
    </>
  )
}
