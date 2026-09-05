import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserCog } from 'lucide-react'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { useAuth } from '@/app/auth'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'

/**
 * "Log in as" — seeing the app exactly the way one real person sees it.
 *
 * Lists real accounts (`admin/impersonation/users`), not the Users & Roles
 * screen's preview data — this is the one admin screen in the app that has
 * to be honest about who actually exists, because clicking a name here
 * really signs in as them.
 */
export function Impersonate() {
  const toast = useToast()
  const navigate = useNavigate()
  const beginImpersonation = useAuth((s) => s.beginImpersonation)
  const [users, setUsers] = React.useState<api.ImpersonatableUser[] | null>(null)
  const [q, setQ] = React.useState('')
  const [busyId, setBusyId] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!liveApi()) return
    api.listImpersonatableUsers().then(setUsers).catch(() => setUsers([]))
  }, [])

  const matches = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = users ?? []
    if (!term) return list
    return list.filter(
      (u) => u.name.toLowerCase().includes(term) || u.username.toLowerCase().includes(term) || (u.department ?? '').toLowerCase().includes(term),
    )
  }, [users, q])

  const logInAs = async (user: api.ImpersonatableUser) => {
    setBusyId(user.id)
    try {
      const { token, user: authUser } = await api.startImpersonation(user.id)
      beginImpersonation(token, authUser)
      toast({ tone: 'success', title: `Viewing as ${user.name}` })
      navigate('/')
    } catch (e) {
      toast({ tone: 'error', title: 'Could not start that session', description: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Log In As"
        description="See the application exactly as one person sees it — every screen, every restriction, nothing assumed. Every session here is logged, and the account below always knows it is being looked through."
      />

      {!liveApi() ? (
        <Card className="p-5 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to use this.</Card>
      ) : (
        <Card>
          <div className="p-4 sm:p-5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, username, or department…"
                className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-[13px] text-ink"
              />
            </div>
          </div>
          <div className="max-h-[32rem] divide-y divide-line overflow-y-auto border-t border-line">
            {users !== null && matches.length === 0 && (
              <EmptyState icon={UserCog} title="No accounts match that search" description="Try a different name or department." />
            )}
            {matches.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{u.name}</p>
                  <p className="truncate text-[11px] text-ink-3">
                    {u.username} {u.department ? `· ${u.department}` : ''}
                  </p>
                </div>
                <Badge tone={u.status === 'Active' ? 'good' : 'neutral'}>{u.status}</Badge>
                <Button variant="secondary" size="sm" loading={busyId === u.id} onClick={() => void logInAs(u)}>
                  <UserCog className="size-3.5" />
                  Log in as
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
