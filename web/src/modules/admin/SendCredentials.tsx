import * as React from 'react'
import { AlertTriangle, Check, KeyRound, Mail, MailWarning, Send, ShieldCheck, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import {
  credentialReach,
  liveApi,
  sendCredentials,
  sendCredentialsBulk,
  type CredentialReach,
  type CredentialResult,
  type CredentialSummary,
} from '@/lib/adminApi'
import { Badge, Button, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Issuing sign-in details.
 *
 * The password emailed is always freshly generated and always temporary — the
 * account is flagged to force a change, and the credential expires on its own
 * after 72 hours. So this screen never shows or asks for a password anybody
 * chose: there is nothing here worth intercepting for long.
 *
 * Bulk sending is deliberately a two-step confirmation with the reach stated in
 * words. "Send to everyone" that quietly resets 113 passwords is the kind of
 * button that gets pressed once and regretted immediately.
 */

const STATUS_TONE: Record<CredentialResult['status'], 'good' | 'critical' | 'warning' | 'neutral'> = {
  sent: 'good',
  failed: 'critical',
  'no-email': 'warning',
  skipped: 'neutral',
}

function ResultList({ results }: { results: CredentialResult[] }) {
  if (!results.length) return null

  return (
    <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
      {results.map((result, i) => (
        <div key={`${result.id ?? result.user}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
          <Badge tone={STATUS_TONE[result.status]} dot>
            {result.status === 'no-email' ? 'no email' : result.status}
          </Badge>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-ink">{result.user}</span>
            <span className="block truncate text-[11px] text-ink-3">{result.message}</span>
          </span>
          {/* Only present when the send failed — so the credential that was
              already issued can still be handed over another way. */}
          {result.password && (
            <code className="rounded bg-surface-3 px-2 py-1 font-mono text-[12px] font-semibold text-ink">
              {result.password}
            </code>
          )}
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** Sends one person their details. Rendered in the user detail dialog. */
export function SendCredentialsAction({
  user,
  done,
}: {
  user: { id?: number; name?: string; email?: string | null }
  done?: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<CredentialResult | null>(null)

  const id = Number(user.id ?? 0)
  if (!liveApi() || !id) return null

  const hasEmail = Boolean(user.email && String(user.email).includes('@'))

  const submit = async () => {
    setBusy(true)
    try {
      const outcome = await sendCredentials(id)
      setResult(outcome)
      toast({
        tone: outcome.status === 'sent' ? 'success' : outcome.status === 'failed' ? 'error' : 'warning',
        title: outcome.status === 'sent' ? 'Sign-in details sent' : 'Not sent',
        description: outcome.message,
      })
      if (outcome.status === 'sent') done?.()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="size-3.5" />
        Send sign-in details
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setResult(null)
        }}
        size="md"
        title="Send sign-in details"
        description={user.name ?? undefined}
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setOpen(false)
                setResult(null)
              }}
            >
              Close
            </Button>
            {!result && (
              <Button variant="primary" size="sm" loading={busy} disabled={!hasEmail} onClick={submit}>
                <Send className="size-3.5" />
                Send it
              </Button>
            )}
          </>
        }
      >
        {result ? (
          <ResultList results={[result]} />
        ) : hasEmail ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-[13px] text-ink-2">
              <Mail className="mt-0.5 size-4 shrink-0 text-brand-500" />
              <span>
                A new temporary password will be generated and emailed to{' '}
                <strong className="text-ink">{user.email}</strong>.
              </span>
            </p>
            <ul className="space-y-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[12px] text-ink-2">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good" />
                They must choose their own password the first time they sign in.
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-good" />
                The temporary password stops working after 72 hours.
              </li>
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                Any password they are using now will stop working immediately.
              </li>
            </ul>
          </div>
        ) : (
          <p className="flex items-start gap-2 text-[13px] text-ink-2">
            <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" />
            This account has no email address, so there is nowhere to send it. Add one first, or reset the password
            from the employee record and hand it over in person.
          </p>
        )}
      </Modal>
    </>
  )
}

/* -------------------------------------------------------------------------- */

/** Sends to many at once. Rendered in the page header. */
export function SendCredentialsBulk() {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [reach, setReach] = React.useState<CredentialReach | null>(null)
  const [scope, setScope] = React.useState<'never-signed-in' | 'with-email'>('never-signed-in')
  const [confirmText, setConfirmText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [summary, setSummary] = React.useState<CredentialSummary | null>(null)

  if (!liveApi()) return null

  const start = async () => {
    setOpen(true)
    setSummary(null)
    setConfirmText('')
    try {
      setReach(await credentialReach())
    } catch {
      setReach(null)
    }
  }

  const count = reach ? (scope === 'never-signed-in' ? reach.neverSignedIn : reach.withEmail) : 0
  // Typing the number back is a deliberate speed bump — this resets passwords.
  const confirmed = confirmText.trim() === String(count) && count > 0

  const submit = async () => {
    setBusy(true)
    try {
      const outcome = await sendCredentialsBulk({ scope })
      setSummary(outcome)
      toast({
        tone: outcome.failed > 0 ? 'warning' : 'success',
        title: `${outcome.sent} sent`,
        description:
          outcome.failed > 0
            ? `${outcome.failed} could not be delivered — their passwords were still reset.`
            : 'Everyone selected has their details.',
      })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={start}>
        <Send className="size-3.5" />
        <span className="hidden sm:inline">Send sign-in details</span>
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Send sign-in details in bulk"
        description="Each person gets their own freshly generated temporary password."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {summary ? 'Close' : 'Cancel'}
            </Button>
            {!summary && (
              <Button variant="primary" size="sm" loading={busy} disabled={!confirmed} onClick={submit}>
                <Send className="size-3.5" />
                Send to {num(count)}
              </Button>
            )}
          </>
        }
      >
        {summary ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Sent', summary.sent, 'good'],
                ['Failed', summary.failed, 'critical'],
                ['Skipped', summary.skipped, 'neutral'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="rounded-xl border border-line p-3 text-center">
                  <p className="text-[10px] tracking-wider text-ink-3 uppercase">{label}</p>
                  <p
                    className={cn(
                      'tabular mt-1 text-[22px] font-semibold',
                      tone === 'good' ? 'text-good' : tone === 'critical' ? 'text-critical' : 'text-ink-2',
                    )}
                  >
                    {num(Number(value))}
                  </p>
                </div>
              ))}
            </div>
            <ResultList results={summary.results} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {(
                [
                  {
                    id: 'never-signed-in' as const,
                    title: 'People who have never signed in',
                    body: 'The usual case — new accounts that have not been used yet. Nobody working today is disturbed.',
                    count: reach?.neverSignedIn ?? 0,
                  },
                  {
                    id: 'with-email' as const,
                    title: 'Everyone with an email address',
                    body: 'Resets every password, including people signed in right now. Use only when re-issuing across the board.',
                    count: reach?.withEmail ?? 0,
                  },
                ]
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setScope(option.id)
                    setConfirmText('')
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-all',
                    scope === option.id
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950'
                      : 'border-line bg-surface hover:border-brand-300',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                      scope === option.id ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong',
                    )}
                  >
                    {scope === option.id && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{option.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{option.body}</span>
                  </span>
                  <Badge tone={option.id === 'with-email' ? 'warning' : 'neutral'}>{num(option.count)}</Badge>
                </button>
              ))}
            </div>

            {reach && reach.withoutEmail > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-ink-2">
                <MailWarning className="mt-0.5 size-3.5 shrink-0 text-warning" />
                {num(reach.withoutEmail)} active account{reach.withoutEmail === 1 ? ' has' : 's have'} no email
                address and cannot be reached. They are skipped.
              </p>
            )}

            <div className="rounded-xl border border-critical/40 bg-critical/5 p-3">
              <p className="flex items-start gap-2 text-[12px] text-ink-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-critical" />
                <span>
                  This resets {num(count)} password{count === 1 ? '' : 's'} and sends {num(count)} email
                  {count === 1 ? '' : 's'}. It cannot be undone. Type <strong className="text-ink">{count}</strong> to
                  confirm.
                </span>
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={String(count)}
                className="mt-2 max-w-[8rem] text-center font-mono"
              />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

/** The "nobody can reach these people" warning for the page header. */
export function CredentialReachBadge() {
  const [reach, setReach] = React.useState<CredentialReach | null>(null)

  React.useEffect(() => {
    if (!liveApi()) return
    credentialReach().then(setReach).catch(() => setReach(null))
  }, [])

  if (!reach) return null

  return (
    <>
      {reach.withoutEmail > 0 && (
        <Badge tone="warning">
          <X className="size-3" />
          {num(reach.withoutEmail)} without an email
        </Badge>
      )}
      {reach.mustChange > 0 && (
        <Badge tone="info">{num(reach.mustChange)} awaiting first sign-in</Badge>
      )}
    </>
  )
}
