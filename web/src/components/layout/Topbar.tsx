import * as React from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronRight, HelpCircle, KeyRound, LogOut, Menu as MenuIcon, Moon, Search, Settings, Sun, UserCog } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { getNotifications, liveApi, markNoticeRead } from '@/lib/adminApi'
import { useResolvedTheme, useUi } from '@/app/store'
import { currentUser, useAuth } from '@/app/auth'
import { ADMIN_MODULES, DEPARTMENT_BY_ID } from '@/app/registry'
import { Avatar, Badge, Button, Tooltip } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/overlay'
import { ChangePassword } from './ChangePassword'



/**
 * Top-level pages that belong to nobody's department.
 *
 * Without these they fall through to the department lookup, miss, and label
 * themselves "Command Center" — which is not where the reader is.
 */
const STANDALONE_CRUMBS: Record<string, string> = {
  me: 'My Workspace',
  messages: 'Messages',
}

function useBreadcrumbs() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return [{ label: 'Command Center', to: '/' }]

  const [first, second] = parts

  if (first && STANDALONE_CRUMBS[first]) {
    return [{ label: STANDALONE_CRUMBS[first]!, to: `/${first}` }]
  }

  if (first === 'admin') {
    const mod = ADMIN_MODULES.find((m) => m.id === second)
    return [
      { label: 'Administration', to: '/admin/users' },
      ...(mod ? [{ label: mod.label, to: `/admin/${mod.id}` }] : []),
    ]
  }

  const dept = DEPARTMENT_BY_ID[first!]
  if (!dept) return [{ label: 'Command Center', to: '/' }]

  const crumbs = [{ label: dept.label, to: `/${dept.id}` }]
  if (second) {
    const mod = dept.modules.find((m) => m.id === second)
    if (mod) crumbs.push({ label: mod.label, to: `/${dept.id}/${mod.id}` })
  }
  return crumbs
}

/**
 * Light and dark, on one click.
 *
 * No menu and no "system" option to pick: the app still *starts* on the system
 * preference, and the first click simply flips whatever is currently on screen
 * to the other one. Choosing a mode is a decision somebody makes once and then
 * wants applied instantly — making them open a menu and aim at a third option
 * they will never choose is three interactions for a binary.
 *
 * The icon shows what a click will do rather than where you are, which is the
 * convention every OS-level toggle uses: a moon means "go dark".
 */
function ThemeToggle() {
  const resolved = useResolvedTheme()
  const toggleTheme = useUi((s) => s.toggleTheme)

  const goingDark = resolved === 'light'
  const Icon = goingDark ? Moon : Sun
  const label = goingDark ? 'Switch to dark mode' : 'Switch to light mode'

  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label={label}>
        <Icon className="size-[18px]" />
      </Button>
    </Tooltip>
  )
}

/**
 * The bell, carrying things that are actually true.
 *
 * It used to show four hard-coded examples — overdue invoices and a purchase
 * order awaiting approval, none of which existed anywhere in the database. A
 * permanent red dot over made-up items is worse than an empty bell, because it
 * teaches everybody that the dot means nothing, and then the one notice that
 * mattered is the one nobody opens.
 *
 * Every item now comes from a row somebody can act on, and the dot only
 * appears when there is something that is not merely informational.
 */
function NotificationBell() {
  const navigate = useNavigate()
  const token = useAuth((s) => s.token)
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    // These are business facts on a human timescale, not a live feed. Refetched
    // when the tab regains focus, which is when somebody is about to look.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    /* Not before there is a session to ask with. Polling without one produces
       a 401 every five minutes on the sign-in screen, which is noise in the
       console and a wasted round trip. */
    enabled: liveApi() && Boolean(token) && token !== 'bootstrap-session',
    retry: false,
  })

  const items = data?.items ?? []
  const unread = data?.unread ?? 0

  return (
    <Menu
      className="w-[min(92vw,24rem)]"
      trigger={({ toggle }) => (
        <Tooltip content="Notifications">
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Notifications" className="relative">
            <Bell className="size-[18px]" />
            {unread > 0 && (
              <span className="absolute top-1 right-1 size-2 rounded-full bg-critical ring-2 ring-surface" />
            )}
          </Button>
        </Tooltip>
      )}
    >
      <MenuLabel>Notifications</MenuLabel>

      {items.length === 0 ? (
        <p className="px-2.5 py-6 text-center text-[12px] text-ink-3">
          Nothing needs you right now.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (n.noticeId) {
                  void markNoticeRead(n.noticeId).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
                }
                navigate(n.link)
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-surface-3"
            >
              <span
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  n.tone === 'critical' ? 'bg-critical' : n.tone === 'warning' ? 'bg-warning' : 'bg-series-1',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug font-medium text-ink">{n.title}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{n.detail}</span>
                <span className="mt-0.5 block truncate text-[10px] tracking-wide text-ink-3 uppercase">{n.meta}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}

export function Topbar() {
  const setMobileNav = useUi((s) => s.setMobileNav)
  const setCommandOpen = useUi((s) => s.setCommandOpen)
  const [changingPassword, setChangingPassword] = React.useState(false)
  const logout = useAuth((s) => s.logout)
  const user = useAuth((s) => s.user) ?? currentUser()
  const crumbs = useBreadcrumbs()

  return (
    <header
      data-print="hide"
      className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md sm:px-5"
    >
      <button
        onClick={() => setMobileNav(true)}
        className="-ml-1 rounded-lg p-2 text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <MenuIcon className="size-5" />
      </button>

      {/* Breadcrumbs collapse to the last crumb on small screens. */}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1 text-[13px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1
            return (
              // Keyed by position, not by `to`: Administration has no index
              // route of its own so it links to /admin/users, which is also
              // where the Users crumb points — two crumbs, one destination.
              <li key={`${c.to}-${i}`} className={cn('flex items-center gap-1', !last && 'hidden sm:flex')}>
                {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-3" />}
                {last ? (
                  <span className="truncate font-semibold text-ink">{c.label}</span>
                ) : (
                  <Link to={c.to} className="truncate text-ink-3 transition-colors hover:text-ink-2">
                    {c.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Search: full control on desktop, icon on mobile. */}
      <button
        onClick={() => setCommandOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 md:flex xl:w-80"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setCommandOpen(true)} aria-label="Search">
        <Search className="size-[18px]" />
      </Button>

      <NotificationBell />
      <ThemeToggle />

      <Menu
        className="w-64"
        trigger={({ toggle }) => (
          <button onClick={toggle} className="ml-0.5 rounded-full focus-visible:outline-offset-2" aria-label="Account menu">
            <Avatar name={user.name} size="sm" />
          </button>
        )}
      >
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <Avatar name={user.name} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[11px] text-ink-3">{user.email}</p>
          </div>
        </div>
        <div className="px-2.5 pb-2">
          <Badge tone="brand">{user.role}</Badge>
        </div>
        <MenuSeparator />
        <MenuItem icon={UserCog}>My profile</MenuItem>
        {/* Accounts are issued a four-digit password and are not forced to
            change it, so the way to change it has to be somewhere a person
            will actually come across — not buried in a settings page. */}
        <MenuItem icon={KeyRound} onClick={() => setChangingPassword(true)}>
          Change password
        </MenuItem>
        <MenuItem icon={Settings}>Preferences</MenuItem>
        <MenuItem icon={HelpCircle}>Help & documentation</MenuItem>
        <MenuSeparator />
        <MenuItem icon={LogOut} danger onClick={() => logout('You signed out.')}>
          Sign out
        </MenuItem>
      </Menu>

      <ChangePassword open={changingPassword} onClose={() => setChangingPassword(false)} />
    </header>
  )
}
