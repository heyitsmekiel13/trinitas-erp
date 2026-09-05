import * as React from 'react'
import { Bell, Check, Mail, Plus, TriangleAlert, X } from 'lucide-react'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, CardHeader, Input, Switch } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'

const OFFLINE_MESSAGE =
  'These settings are stored in MySQL. Run SETUP DATABASE.bat, start the API, then set VITE_API_URL in web/.env so the app reads and writes live data.'

/**
 * Who gets emailed for what.
 *
 * Every automated email in the system is gated by exactly one of these rows
 * — an event nobody has configured a rule for sends nothing, and an event
 * whose rule names no roles and no addresses also sends nothing. This is the
 * only place that routing is edited; before this screen existed it was
 * database-only, so changing "who hears about a resignation" meant a direct
 * SQL edit.
 *
 * Rows are seeded, not created here — the set of events is fixed by what
 * the code actually fires, so this screen only edits recipients and the
 * on/off switches, never adds or removes a row.
 */
export function NotificationRules() {
  const toast = useToast()
  const [rules, setRules] = React.useState<api.NotificationRule[] | null>(null)
  const [roles, setRoles] = React.useState<{ code: string; name: string }[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [savingId, setSavingId] = React.useState<number | null>(null)
  const [newEmail, setNewEmail] = React.useState<Record<number, string>>({})

  const refresh = React.useCallback(async () => {
    const [ruleRows, roleRows] = await Promise.all([api.listNotificationRules(), api.listRoles()])
    setRules(ruleRows)
    setRoles(roleRows)
  }, [])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)
      return
    }
    let cancelled = false
    refresh()
      .then(() => !cancelled && setLoading(false))
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const save = async (rule: api.NotificationRule, values: Partial<api.NotificationRule>) => {
    setRules((prev) => prev?.map((r) => (r.id === rule.id ? { ...r, ...values } : r)) ?? prev)
    setSavingId(rule.id)
    try {
      const saved = await api.saveNotificationRule(rule.id, values)
      setRules((prev) => prev?.map((r) => (r.id === rule.id ? saved : r)) ?? prev)
    } catch (e) {
      toast({ tone: 'error', title: `Could not update ${rule.name}`, description: (e as Error).message })
      void refresh()
    } finally {
      setSavingId(null)
    }
  }

  const toggleRole = (rule: api.NotificationRule, code: string) => {
    const next = rule.recipientRoles.includes(code)
      ? rule.recipientRoles.filter((r) => r !== code)
      : [...rule.recipientRoles, code]
    void save(rule, { recipientRoles: next })
  }

  const addEmail = (rule: api.NotificationRule) => {
    const email = (newEmail[rule.id] ?? '').trim()
    if (!email || (rule.recipientEmails ?? []).includes(email)) return
    setNewEmail((prev) => ({ ...prev, [rule.id]: '' }))
    void save(rule, { recipientEmails: [...(rule.recipientEmails ?? []), email] })
  }

  const removeEmail = (rule: api.NotificationRule, email: string) => {
    void save(rule, { recipientEmails: (rule.recipientEmails ?? []).filter((e) => e !== email) })
  }

  return (
    <div>
      <PageHeader
        title="Notification Rules"
        description="Which roles (and which extra addresses) hear about each automated event by email. A rule with nothing checked sends nothing, to nobody."
        meta={
          !liveApi() && (
            <Badge tone="warning" dot>
              Preview data — not connected to MySQL
            </Badge>
          )
        }
      />

      {!liveApi() ? (
        <Card className="p-5">
          <EmptyState icon={Bell} title="Not connected to the database yet" description={OFFLINE_MESSAGE} />
        </Card>
      ) : loading ? (
        <Card className="h-64 shimmer" />
      ) : error || !rules ? (
        <Card className="p-5">
          <p className="flex items-center gap-1.5 text-sm text-critical">
            <TriangleAlert className="size-3.5 shrink-0" />
            {error}
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Events" subtitle={`${rules.length} automated events`} />
          <div className="divide-y divide-line border-t border-line">
            {rules.map((rule) => {
              const noRecipients = rule.recipientRoles.length === 0 && (rule.recipientEmails ?? []).length === 0
              return (
                <div key={rule.id} className="space-y-2.5 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                        {rule.name}
                        {noRecipients && (
                          <Badge tone="neutral" dot>
                            No recipients — sends nothing
                          </Badge>
                        )}
                      </p>
                      {rule.description && <p className="mt-0.5 max-w-xl text-xs text-ink-3">{rule.description}</p>}
                      <p className="mt-0.5 font-mono text-[10.5px] text-ink-3">{rule.event}</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-xs text-ink-3">
                      <Mail className="size-3.5" />
                      Email
                      <Switch
                        checked={rule.emailEnabled}
                        onChange={(on) => savingId !== rule.id && save(rule, { emailEnabled: on })}
                        label={`Email for ${rule.name}`}
                        className={savingId === rule.id ? 'pointer-events-none opacity-60' : undefined}
                      />
                    </label>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Roles</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {roles.length === 0 ? (
                        <span className="text-xs text-ink-3">No roles defined yet.</span>
                      ) : (
                        roles.map((role) => {
                          const on = rule.recipientRoles.includes(role.code)
                          return (
                            <button
                              key={role.code}
                              type="button"
                              disabled={savingId === rule.id}
                              onClick={() => toggleRole(rule, role.code)}
                              className={
                                on
                                  ? 'flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-800'
                                  : 'flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-3 hover:bg-surface-2 hover:text-ink'
                              }
                            >
                              {on && <Check className="size-3" />}
                              {role.name}
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Extra addresses</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {(rule.recipientEmails ?? []).map((email) => (
                        <span
                          key={email}
                          className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pr-1.5 pl-3 text-xs font-medium text-ink"
                        >
                          {email}
                          <button
                            type="button"
                            onClick={() => removeEmail(rule, email)}
                            aria-label={`Remove ${email}`}
                            className="rounded-full p-0.5 text-ink-3 hover:bg-surface-3 hover:text-critical"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                      <Input
                        value={newEmail[rule.id] ?? ''}
                        onChange={(e) => setNewEmail((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                        placeholder="name@example.com"
                        className="max-w-[12rem]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addEmail(rule)
                          }
                        }}
                      />
                      <Button variant="secondary" size="xs" disabled={!(newEmail[rule.id] ?? '').trim()} onClick={() => addEmail(rule)}>
                        <Plus className="size-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
