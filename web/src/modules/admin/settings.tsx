import * as React from 'react'
import {
  Building2,
  Check,
  Clock,
  Globe,
  MapPinned,
  Image as ImageIcon,
  Mail,
  Plug,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Truck,
  Upload,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { API_BASE_URL } from '@/lib/api'
import * as api from '@/lib/adminApi'
import { ApiError, liveApi } from '@/lib/adminApi'
import { loadCompany } from '@/lib/company'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, CardHeader, Field, Input, Segmented, Select, Switch } from '@/components/ui/primitives'
import { AccessLocations } from './AccessLocations'
import { EmptyState, useToast } from '@/components/ui/feedback'

/* -------------------------------------------------------------------------- */
/* Shared form plumbing                                                        */
/* -------------------------------------------------------------------------- */

type FormState<T> = {
  values: T | null
  loading: boolean
  saving: boolean
  error: string | null
  fieldErrors: Record<string, string[]>
}

/**
 * Loads one settings group, tracks edits, and saves it back.
 *
 * Field-level validation errors from Laravel are surfaced next to the input
 * that caused them rather than as one opaque "save failed".
 */
function useSettingsForm<T extends object>(
  load: () => Promise<T>,
  save: (values: Partial<T>) => Promise<T>,
  label: string,
) {
  const toast = useToast()
  const [state, setState] = React.useState<FormState<T>>({
    values: null,
    loading: true,
    saving: false,
    error: null,
    fieldErrors: {},
  })

  React.useEffect(() => {
    let cancelled = false
    if (!liveApi()) {
      setState((s) => ({ ...s, loading: false }))
      return
    }
    load()
      .then((values) => !cancelled && setState((s) => ({ ...s, values, loading: false })))
      .catch((e: Error) => !cancelled && setState((s) => ({ ...s, loading: false, error: e.message })))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setState((s) => (s.values ? { ...s, values: { ...s.values, [key]: value } } : s))

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (!state.values) return

    setState((s) => ({ ...s, saving: true, error: null, fieldErrors: {} }))
    try {
      const values = await save(state.values)
      setState((s) => ({ ...s, values, saving: false }))
      // Refresh the cached branding so headers and letterheads update at once.
      void loadCompany()
      toast({ tone: 'success', title: `${label} saved` })
    } catch (e) {
      const apiError = e instanceof ApiError ? e : null
      setState((s) => ({
        ...s,
        saving: false,
        error: apiError?.errors && Object.keys(apiError.errors).length ? null : (e as Error).message,
        fieldErrors: apiError?.errors ?? {},
      }))
      if (!apiError || !Object.keys(apiError.errors).length) {
        toast({ tone: 'error', title: `Could not save ${label.toLowerCase()}`, description: (e as Error).message })
      }
    }
  }

  const fieldError = (key: keyof T & string) => state.fieldErrors[key]?.[0]

  return { ...state, set, submit, fieldError }
}

/** Shown on every settings panel when the app is still on preview data. */
function OfflineNotice() {
  return (
    <Card className="p-5">
      <EmptyState
        icon={Plug}
        title="Not connected to the database yet"
        description="These settings are stored in MySQL. Run SETUP DATABASE.bat, start the API, then set VITE_API_URL in web/.env so the app reads and writes live data."
      />
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface-2 p-3">
        <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">web/.env</p>
        <code className="mt-1.5 block font-mono text-xs text-ink">VITE_API_URL={API_BASE_URL}</code>
      </div>
    </Card>
  )
}

function SaveBar({ saving, error, dirtyLabel = 'Save changes' }: { saving: boolean; error: string | null; dirtyLabel?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-critical">
          <TriangleAlert className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : (
        <span />
      )}
      <Button type="submit" variant="primary" size="sm" loading={saving}>
        {dirtyLabel}
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Company & branding                                                          */
/* -------------------------------------------------------------------------- */

function CompanyPanel() {
  const toast = useToast()
  const form = useSettingsForm(api.getCompanySettings, api.saveCompanySettings, 'Company details')
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)

  React.useEffect(() => {
    const path = form.values?.logo_path
    if (path) setLogoUrl(`${API_BASE_URL}/public-files/${path}`)
  }, [form.values?.logo_path])

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  const onLogo = async (file: File) => {
    setUploading(true)
    try {
      const result = await api.uploadLogo(file)
      setLogoUrl(result.url)
      void loadCompany()
      toast({ tone: 'success', title: 'Logo updated', description: 'It now appears on printed reports.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Upload failed', description: (e as Error).message })
    } finally {
      setUploading(false)
    }
  }

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader
          title="Company identity"
          subtitle="Used on every printed report, exported document and outgoing email."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label="Registered name" required error={form.fieldError('legal_name')}>
            <Input value={v.legal_name} onChange={(e) => form.set('legal_name', e.target.value)} />
          </Field>
          <Field label="Trading name" hint="Shown in the app header." error={form.fieldError('trade_name')}>
            <Input value={v.trade_name ?? ''} onChange={(e) => form.set('trade_name', e.target.value)} />
          </Field>
          <Field label="Registered address" className="sm:col-span-2" error={form.fieldError('address')}>
            <Input value={v.address ?? ''} onChange={(e) => form.set('address', e.target.value)} />
          </Field>
          <Field label="TIN" error={form.fieldError('tin')}>
            <Input value={v.tin ?? ''} onChange={(e) => form.set('tin', e.target.value)} placeholder="000-000-000-000" />
          </Field>
          <Field label="Contact number" error={form.fieldError('phone')}>
            <Input value={v.phone ?? ''} onChange={(e) => form.set('phone', e.target.value)} />
          </Field>
          <Field label="Contact email" error={form.fieldError('email')}>
            <Input type="email" value={v.email ?? ''} onChange={(e) => form.set('email', e.target.value)} />
          </Field>
          <Field label="Currency" required error={form.fieldError('currency')}>
            <Input value={v.currency} onChange={(e) => form.set('currency', e.target.value.toUpperCase())} maxLength={3} />
          </Field>
          <Field label="Fiscal year starts" required error={form.fieldError('fiscal_year_start')}>
            <Select
              value={String(v.fiscal_year_start)}
              onChange={(e) => form.set('fiscal_year_start', Number(e.target.value))}
            >
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(
                (month, i) => (
                  <option key={month} value={i + 1}>
                    {month}
                  </option>
                ),
              )}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Logo" subtitle="PNG, JPG, SVG or WebP up to 2 MB. Appears on report letterheads." />
        <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2">
            {logoUrl ? (
              <img src={logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImageIcon className="size-7 text-ink-3" />
            )}
          </div>
          <label className="cursor-pointer">
            <span
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium transition-colors hover:bg-surface-2',
                uploading && 'pointer-events-none opacity-60',
              )}
            >
              <Upload className="size-4" />
              {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onLogo(file)
              }}
            />
          </label>
        </div>
      </Card>

      <SaveBar saving={form.saving} error={form.error} />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Email                                                                       */
/* -------------------------------------------------------------------------- */

function EmailPanel() {
  const toast = useToast()
  const form = useSettingsForm(api.getSmtpSettings, api.saveSmtpSettings, 'Email settings')
  const [testTo, setTestTo] = React.useState('')
  const [testing, setTesting] = React.useState(false)

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  const runTest = async () => {
    setTesting(true)
    try {
      const result = await api.sendTestEmail(testTo)
      toast(
        result.sent
          ? { tone: 'success', title: 'Test email sent', description: `Check the inbox for ${testTo}.` }
          : { tone: 'error', title: 'Could not send', description: result.error ?? 'Unknown error.' },
      )
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send', description: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={form.submit} className="space-y-4">
        <Card>
          <CardHeader
            title="Outgoing mail (SMTP)"
            subtitle="Sign-in codes, approval requests and payroll notices are sent from here."
            action={
              <Badge tone={v.enabled ? 'good' : 'neutral'} dot>
                {v.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            }
          />
          <div className="px-5 pb-5">
            <label className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
              <span>
                <span className="block text-[13px] font-medium text-ink">Send transactional email</span>
                <span className="block text-xs text-ink-3">
                  With this off, codes and notifications are recorded but never delivered.
                </span>
              </span>
              <Switch checked={v.enabled} onChange={(on) => form.set('enabled', on)} label="Enable email" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SMTP host" required={v.enabled} error={form.fieldError('host')}>
                <Input value={v.host ?? ''} onChange={(e) => form.set('host', e.target.value)} placeholder="smtp.gmail.com" />
              </Field>
              <Field label="Port" required={v.enabled} error={form.fieldError('port')}>
                <Input
                  type="number"
                  value={v.port ?? 587}
                  onChange={(e) => form.set('port', Number(e.target.value))}
                  placeholder="587"
                />
              </Field>
              <Field label="Encryption" error={form.fieldError('encryption')}>
                <Select value={v.encryption ?? 'tls'} onChange={(e) => form.set('encryption', e.target.value as 'tls')}>
                  <option value="tls">STARTTLS (port 587)</option>
                  <option value="ssl">SSL/TLS (port 465)</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Username" error={form.fieldError('username')}>
                <Input value={v.username ?? ''} onChange={(e) => form.set('username', e.target.value)} autoComplete="off" />
              </Field>
              <Field
                label="Password"
                hint="Stored encrypted. Leave the dots untouched to keep the current one."
                error={form.fieldError('password')}
              >
                <Input
                  type="password"
                  value={v.password ?? ''}
                  onChange={(e) => form.set('password', e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="From address" required={v.enabled} error={form.fieldError('from_address')}>
                <Input
                  type="email"
                  value={v.from_address ?? ''}
                  onChange={(e) => form.set('from_address', e.target.value)}
                  placeholder="noreply@yourcompany.com"
                />
              </Field>
              <Field label="From name" error={form.fieldError('from_name')}>
                <Input value={v.from_name ?? ''} onChange={(e) => form.set('from_name', e.target.value)} />
              </Field>
              <Field label="Reply-to" error={form.fieldError('reply_to')}>
                <Input type="email" value={v.reply_to ?? ''} onChange={(e) => form.set('reply_to', e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <SaveBar saving={form.saving} error={form.error} />
      </form>

      <Card>
        <CardHeader title="Send a test" subtitle="Confirms the credentials before anyone depends on them." />
        <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
          <Field label="Send to" className="min-w-56 flex-1">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourcompany.com" />
          </Field>
          <Button variant="secondary" onClick={runTest} loading={testing} disabled={!testTo || !v.enabled}>
            <Send className="size-4" />
            Send test email
          </Button>
        </div>
        {!v.enabled && (
          <p className="px-5 pb-5 text-xs text-ink-3">Turn sending on and save before testing.</p>
        )}
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

function SecurityPanel() {
  const form = useSettingsForm(api.getSecuritySettings, api.saveSecuritySettings, 'Security policy')

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader title="Sign-in policy" subtitle="Applies to every account except where overridden per user." />
        <div className="space-y-4 px-5 pb-5">
          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
            <span>
              <span className="block text-[13px] font-medium text-ink">Require an emailed code at sign-in</span>
              <span className="block text-xs text-ink-3">
                A six-digit code, valid for ten minutes and usable once. Needs email to be configured.
              </span>
            </span>
            <Switch
              checked={v.require_auth_code}
              onChange={(on) => form.set('require_auth_code', on)}
              label="Require auth code"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Sign out after inactivity"
              hint="Minutes"
              required
              error={form.fieldError('session_timeout_minutes')}
            >
              <Input
                type="number"
                min={5}
                max={480}
                value={v.session_timeout_minutes}
                onChange={(e) => form.set('session_timeout_minutes', Number(e.target.value))}
              />
            </Field>
            <Field label="Lock after failed attempts" required error={form.fieldError('max_failed_attempts')}>
              <Input
                type="number"
                min={3}
                max={20}
                value={v.max_failed_attempts}
                onChange={(e) => form.set('max_failed_attempts', Number(e.target.value))}
              />
            </Field>
            <Field label="Lockout duration" hint="Minutes" required error={form.fieldError('lockout_minutes')}>
              <Input
                type="number"
                min={1}
                max={1440}
                value={v.lockout_minutes}
                onChange={(e) => form.set('lockout_minutes', Number(e.target.value))}
              />
            </Field>
            <Field
              label="Minimum password length"
              hint="Characters"
              required
              error={form.fieldError('min_password_length')}
            >
              <Input
                type="number"
                min={4}
                max={64}
                value={v.min_password_length ?? 4}
                onChange={(e) => form.set('min_password_length', Number(e.target.value))}
              />
            </Field>
            <Field
              label="Audit trail retention"
              hint="Days"
              required
              error={form.fieldError('audit_retention_days')}
            >
              <Input
                type="number"
                min={90}
                value={v.audit_retention_days ?? 730}
                onChange={(e) => form.set('audit_retention_days', Number(e.target.value))}
              />
            </Field>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
            <span>
              <span className="block text-[13px] font-medium text-ink">Restrict sign-in by location</span>
              <span className="block text-xs text-ink-3">
                Enforces the Geo-IP rules on the next tab. Your own connection can never be blocked.
              </span>
            </span>
            <Switch
              checked={v.geo_fencing_enabled}
              onChange={(on) => form.set('geo_fencing_enabled', on)}
              label="Enable geo fencing"
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-3.5">
            <span>
              <span className="block text-[13px] font-medium text-ink">Restrict sign-in to shift hours</span>
              <span className="block text-xs text-ink-3">
                Rank-and-file accounts may only sign in within their assigned shift's window. Supervisors,
                executives, managers and anyone with no shift assigned are never restricted.
              </span>
            </span>
            <Switch
              checked={v.login_hours_enabled ?? false}
              onChange={(on) => form.set('login_hours_enabled', on)}
              label="Enable shift-hour sign-in"
            />
          </label>
        </div>
      </Card>

      <SaveBar saving={form.saving} error={form.error} />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Geo-IP                                                                      */
/* -------------------------------------------------------------------------- */

function GeoPanel() {
  const toast = useToast()
  const [rules, setRules] = React.useState<api.GeoRule[] | null>(null)
  const [connection, setConnection] = React.useState<api.ConnectionInfo | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<{ kind: api.GeoRule['kind']; value: string; effect: api.GeoRule['effect']; label: string }>({
    kind: 'country',
    value: '',
    effect: 'allow',
    label: '',
  })

  const refresh = React.useCallback(async () => {
    const [list, current] = await Promise.all([api.listGeoRules(), api.currentConnection()])
    setRules(list)
    setConnection(current)
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    refresh()
      .catch((e: Error) => toast({ tone: 'error', title: 'Could not load rules', description: e.message }))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!liveApi()) return <OfflineNotice />
  if (loading) return <Card className="h-64 shimmer" />

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      await refresh()
      toast({ tone: 'success', title: success })
    } catch (e) {
      toast({ tone: 'error', title: 'Rule not applied', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const allowMyIp = () =>
    run(
      () => api.createGeoRule({ kind: 'ip', value: connection!.ip!, effect: 'allow', label: 'My current connection' }),
      'Your address is now allowed',
    )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Your connection" subtitle="Detected from this request — use it to whitelist yourself first." />
        <div className="flex flex-wrap items-center gap-4 px-5 pb-5">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">IP address</p>
            <p className="mt-1 font-mono text-sm text-ink">{connection?.ip ?? 'unknown'}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Country</p>
            <p className="mt-1 text-sm text-ink">
              {connection?.isLocal ? 'Local network' : (connection?.country ?? 'unknown')}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Status</p>
            <p className="mt-1">
              <Badge tone={connection?.allowed ? 'good' : 'critical'} dot>
                {connection?.allowed ? 'Allowed' : 'Blocked'}
              </Badge>
            </p>
          </div>
          {connection?.ip && !connection.isLocal && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={allowMyIp} loading={busy}>
              <Check className="size-3.5" />
              Allow my address
            </Button>
          )}
        </div>
        {connection?.isLocal && (
          <p className="border-t border-line px-5 py-3 text-xs text-ink-3">
            You are on a local or private network. Those addresses always pass, whatever the rules say — that is what
            stops a bad rule from locking you out of your own office.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Add a rule" subtitle="Blocks are evaluated first, then IP allows, then country allows." />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-[9rem_9rem_1fr_1fr_auto]">
          <Field label="Type">
            <Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as api.GeoRule['kind'] })}>
              <option value="country">Country</option>
              <option value="ip">Single IP</option>
              <option value="cidr">IP range</option>
            </Select>
          </Field>
          <Field label="Effect">
            <Select value={draft.effect} onChange={(e) => setDraft({ ...draft, effect: e.target.value as 'allow' })}>
              <option value="allow">Allow</option>
              <option value="block">Block</option>
            </Select>
          </Field>
          <Field
            label="Value"
            hint={draft.kind === 'country' ? 'Two letters, e.g. PH' : draft.kind === 'cidr' ? 'e.g. 203.0.113.0/24' : 'e.g. 203.0.113.5'}
          >
            <Input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
          </Field>
          <Field label="Label" hint="Optional note for the next administrator.">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={!draft.value.trim()}
              loading={busy}
              onClick={() =>
                run(
                  () =>
                    api.createGeoRule({
                      kind: draft.kind,
                      value: draft.value.trim(),
                      effect: draft.effect,
                      label: draft.label || undefined,
                    }),
                  'Rule added',
                ).then(() => setDraft({ ...draft, value: '', label: '' }))
              }
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Rules" subtitle={`${rules?.length ?? 0} configured`} />
        {!rules?.length ? (
          <EmptyState
            icon={Globe}
            title="No rules yet"
            description="With no rules, every location is allowed. Add a country allow-rule to restrict access to where you operate."
          />
        ) : (
          <div className="divide-y divide-line border-t border-line">
            {rules.map((rule) => (
              <div key={rule.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Badge tone={rule.effect === 'allow' ? 'good' : 'critical'}>{rule.effect}</Badge>
                <span className="font-mono text-[13px] text-ink">{rule.value}</span>
                <span className="text-xs text-ink-3">{rule.kind}</span>
                {rule.label && <span className="text-xs text-ink-3">· {rule.label}</span>}
                <div className="ml-auto flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-ink-3">
                    Active
                    <Switch
                      checked={rule.is_active}
                      onChange={(on) => run(() => api.toggleGeoRule(rule.id, on), on ? 'Rule enabled' : 'Rule disabled')}
                      label="Toggle rule"
                    />
                  </label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete rule ${rule.value}`}
                    onClick={() => run(() => api.deleteGeoRule(rule.id), 'Rule removed')}
                  >
                    <Trash2 className="size-4 text-critical" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Timekeeping                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * What the punch clock asks for.
 *
 * The PIN is the only thing separating "this person clocked in" from "somebody
 * who knew the shared password clocked somebody in", so switching it off is
 * offered plainly with its consequence stated rather than buried as a checkbox.
 */
function TimekeepingPanel() {
  const form = useSettingsForm(api.getTimekeepingSettings, api.saveTimekeepingSettings, 'Timekeeping settings')

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader
          title="Punch clock"
          subtitle="What an employee has to provide to record a time in, break or time out."
        />
        <div className="space-y-4 px-5 pb-5">
          <label className="flex items-start gap-3">
            <Switch
              checked={v.require_punch_pin}
              onChange={(checked) => form.set('require_punch_pin', checked)}
              label="Require a PIN at every punch"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">Require a PIN at every punch</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                {v.require_punch_pin
                  ? 'Each of the four presses asks for the employee’s own PIN. Anyone without one set cannot clock in until they choose it.'
                  : 'Time in, break out, break in and time out are one press each. A record then proves somebody knew the sign-in password, not which employee it was.'}
              </span>
            </span>
          </label>

          {v.require_punch_pin && (
            <Field
              label="PIN length"
              hint="Four digits is the usual choice; longer is harder to shoulder-surf."
              error={form.fieldError('pin_length')}
              className="max-w-xs"
            >
              <Input
                type="number"
                min={4}
                max={8}
                value={v.pin_length}
                onChange={(e) => form.set('pin_length', Number(e.target.value))}
              />
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Integrity checks"
          subtitle="What Punch Integrity treats as worth a second look. These flag; they never block."
        />
        <div className="space-y-4 px-5 pb-5">
          <label className="flex items-start gap-3">
            <Switch
              checked={v.flag_shared_devices}
              onChange={(checked) => form.set('flag_shared_devices', checked)}
              label="Flag shared devices"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">Flag shared devices</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                Notice when one phone or terminal punches for several people in a day.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <Switch
              checked={v.restrict_punch_to_areas}
              onChange={(checked) => form.set('restrict_punch_to_areas', checked)}
              label="Only allow punches from approved areas"
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-ink">Only allow punches from approved areas</span>
              <span className="mt-0.5 block text-xs text-ink-3">
                Uses the same fences as Geo-IP. Leave off unless those are set up — it will refuse punches otherwise.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="People per device before it is suspicious"
              error={form.fieldError('shared_device_threshold')}
            >
              <Input
                type="number"
                min={1}
                max={50}
                value={v.shared_device_threshold}
                onChange={(e) => form.set('shared_device_threshold', Number(e.target.value))}
              />
            </Field>
            <Field
              label="Burst window (seconds)"
              hint="Punches from one device inside this gap count as a burst."
              error={form.fieldError('burst_window_seconds')}
            >
              <Input
                type="number"
                min={10}
                max={3600}
                value={v.burst_window_seconds}
                onChange={(e) => form.set('burst_window_seconds', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      </Card>

      <SaveBar saving={form.saving} error={form.error} />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Payroll defaults                                                            */
/* -------------------------------------------------------------------------- */

function PayrollPanel() {
  const form = useSettingsForm(api.getPayrollSettings, api.savePayrollSettings, 'Payroll settings')

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader
          title="Payroll defaults"
          subtitle="How semi-monthly pay is derived. Statutory rates live in Admin → Statutory tables."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
          <Field
            label="Statutory deduction cutoff"
            hint="Which half of the month carries SSS, PhilHealth and Pag-IBIG."
            required
          >
            <Select
              value={v.statutory_schedule}
              onChange={(e) => form.set('statutory_schedule', e.target.value as 'second')}
            >
              <option value="first">First cutoff (1–15)</option>
              <option value="second">Second cutoff (16–end)</option>
              <option value="split">Split evenly across both</option>
            </Select>
          </Field>
          <Field
            label="Working days factor"
            hint="313 for a six-day week, 261 for five."
            required
            error={form.fieldError('working_days_factor')}
          >
            <Input
              type="number"
              value={v.working_days_factor}
              onChange={(e) => form.set('working_days_factor', Number(e.target.value))}
            />
          </Field>
          <Field label="Hours per day" required error={form.fieldError('hours_per_day')}>
            <Input
              type="number"
              value={v.hours_per_day}
              onChange={(e) => form.set('hours_per_day', Number(e.target.value))}
            />
          </Field>
        </div>
      </Card>

      <SaveBar saving={form.saving} error={form.error} />
    </form>
  )
}


/* -------------------------------------------------------------------------- */
/* Logistics                                                                   */
/* -------------------------------------------------------------------------- */

function LogisticsPanel() {
  const form = useSettingsForm(api.getLogisticsSettings, api.saveLogisticsSettings, 'Logistics settings')

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader
          title="Delivery estimates"
          subtitle="Distance is measured straight-line and multiplied by the road factor. Calibrate these against real trip sheets and the estimates get better."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-3">
          <Field
            label="Road factor"
            hint="Road km ÷ straight-line km. 1.3 suits provincial Mindanao; raise it for mountain routes."
            required
            error={form.fieldError('roadFactor')}
          >
            <Input type="number" step="0.01" value={v.roadFactor} onChange={(e) => form.set('roadFactor', Number(e.target.value))} />
          </Field>
          <Field
            label="Average speed"
            hint="km/h door to door, including traffic and stops."
            required
            error={form.fieldError('averageSpeedKph')}
          >
            <Input type="number" step="1" value={v.averageSpeedKph} onChange={(e) => form.set('averageSpeedKph', Number(e.target.value))} />
          </Field>
          <Field
            label="Handling time"
            hint="Minutes on site: gate, unload, paperwork."
            required
            error={form.fieldError('handlingMinutes')}
          >
            <Input type="number" step="5" value={v.handlingMinutes} onChange={(e) => form.set('handlingMinutes', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Fuel" subtitle="Used to cost every planned run." />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field label="Fuel price per litre" required error={form.fieldError('fuelPricePerLitre')}>
            <Input type="number" step="0.01" value={v.fuelPricePerLitre} onChange={(e) => form.set('fuelPricePerLitre', Number(e.target.value))} />
          </Field>
          <Field
            label="Default consumption"
            hint="km per litre, used when a vehicle has no figure of its own."
            required
            error={form.fieldError('defaultKmPerLitre')}
          >
            <Input type="number" step="0.1" value={v.defaultKmPerLitre} onChange={(e) => form.set('defaultKmPerLitre', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Personal vehicles"
          subtitle="A trip made in a personally-owned vehicle is paid back in pesos, not fuel — this is the rate that payout is worked out from."
        />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <Field
            label="Mileage reimbursement rate"
            hint="Pesos per km. Applied to a trip's routed distance when the vehicle is personally-owned."
            required
            error={form.fieldError('ratePerKm')}
          >
            <Input type="number" step="0.5" value={v.ratePerKm} onChange={(e) => form.set('ratePerKm', Number(e.target.value))} />
          </Field>
        </div>
      </Card>

      <SaveBar saving={form.saving} error={form.error} />
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Address lookup                                                              */
/* -------------------------------------------------------------------------- */

function MapsPanel() {
  const form = useSettingsForm(api.getMapsSettings, api.saveMapsSettings, 'Address lookup')

  if (!liveApi()) return <OfflineNotice />
  if (form.loading) return <Card className="h-64 shimmer" />
  if (!form.values) return <Card className="p-5"><p className="text-sm text-critical">{form.error}</p></Card>

  const v = form.values

  return (
    <form onSubmit={form.submit} className="space-y-4">
      <Card>
        <CardHeader
          title="Address lookup"
          subtitle="Turns a customer's written address into map coordinates, which is what the delivery planner routes on. Nobody types latitude and longitude."
        />
        <div className="space-y-4 px-5 pb-5">
          {/* Stated plainly because "no key" is a supported configuration, not
              a half-finished setup somebody should feel obliged to fix. */}
          <p className="rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
            This works without any setup — addresses are looked up on OpenStreetMap, which is free
            and needs no account. Adding a Google Maps key improves the hit rate on small streets
            and new subdivisions, which is where OpenStreetMap is thinnest. Either way, anyone can
            still paste a Google Maps link to pin an address exactly.
          </p>

          <Field
            label="Google Maps API key"
            hint="Optional. From Google Cloud Console with the Geocoding API enabled — Google bills per lookup, so results are cached for 30 days."
            error={form.fieldError('google_api_key')}
          >
            <Input
              type="password"
              autoComplete="off"
              placeholder="Leave blank to use OpenStreetMap"
              value={v.google_api_key ?? ''}
              onChange={(e) => form.set('google_api_key', e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={form.saving}>
          Save changes
        </Button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

type Tab =
  | 'company' | 'email' | 'security' | 'geo' | 'locations'
  | 'timekeeping' | 'payroll' | 'logistics' | 'maps'

const TABS: { value: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'company', label: 'Company', icon: Building2 },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'security', label: 'Security', icon: ShieldCheck },
  { value: 'geo', label: 'Geo-IP', icon: Globe },
  { value: 'locations', label: 'Access Locations', icon: MapPinned },
  { value: 'timekeeping', label: 'Timekeeping', icon: Clock },
  { value: 'payroll', label: 'Payroll', icon: Wallet },
  { value: 'logistics', label: 'Logistics', icon: Truck },
  { value: 'maps', label: 'Address Lookup', icon: MapPinned },
]

export function SystemSettings() {
  const [tab, setTab] = React.useState<Tab>('company')

  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Company identity, email delivery, sign-in security, payroll and delivery defaults — all stored in the database, changeable without a redeploy."
        meta={
          !liveApi() && (
            <Badge tone="warning" dot>
              Preview data — not connected to MySQL
            </Badge>
          )
        }
      />

      <div className="mb-4 overflow-x-auto">
        <Segmented
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({
            value: t.value,
            label: (
              <span className="flex items-center gap-1.5">
                <t.icon className="size-3.5" />
                {t.label}
              </span>
            ),
          }))}
        />
      </div>

      {tab === 'company' && <CompanyPanel />}
      {tab === 'email' && <EmailPanel />}
      {tab === 'security' && <SecurityPanel />}
      {tab === 'geo' && <GeoPanel />}
      {tab === 'locations' && <AccessLocations />}
      {tab === 'timekeeping' && <TimekeepingPanel />}
      {tab === 'payroll' && <PayrollPanel />}
      {tab === 'logistics' && <LogisticsPanel />}
      {tab === 'maps' && <MapsPanel />}
    </div>
  )
}
