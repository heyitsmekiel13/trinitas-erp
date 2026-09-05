import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, CircleUser, LayoutDashboard, LifeBuoy, ListChecks, MessagesSquare, PanelLeftClose, Settings2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCompany } from '@/lib/company'
import { useUnreadMessages } from '@/lib/unread'
import { useUi } from '@/app/store'
import { useAuth, useIsSuperAdmin } from '@/app/auth'
import { ADMIN_MODULES, DEPARTMENTS, modulePath } from '@/app/registry'
import { prefetchDepartment } from '@/app/departmentChunks'
import { Tooltip } from '@/components/ui/primitives'

function Brand({ collapsed }: { collapsed: boolean }) {
  const company = useCompany()

  return (
    <NavLink
      to="/"
      className="flex h-16 items-center gap-2.5 px-4 focus-visible:outline-offset-[-2px]"
      aria-label={`${company.name} home`}
    >
      {company.logoUrl ? (
        <img src={company.logoUrl} alt="" className="size-9 shrink-0 rounded-xl object-contain" />
      ) : (
        <span className="grad-brand flex size-9 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white shadow-[0_2px_8px_rgb(225_29_52/0.35)]">
          {company.name.trim().charAt(0).toUpperCase() || 'T'}
        </span>
      )}
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-none font-bold tracking-tight text-ink uppercase">
            {company.name}
          </span>
          <span className="mt-1 block text-[10px] leading-none font-medium tracking-[0.18em] text-ink-3">
            ERP SUITE
          </span>
        </span>
      )}
    </NavLink>
  )
}

const linkBase =
  'group relative flex items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors duration-100'

/** Active items carry a gradient left-marker — brand presence without shouting. */
function ActiveMarker() {
  return <span className="grad-brand absolute top-1/2 -left-2 h-5 w-1 -translate-y-1/2 rounded-r-full" />
}

export function SidebarNav() {
  const { pathname } = useLocation()
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const expanded = useUi((s) => s.expanded)
  const toggleExpanded = useUi((s) => s.toggleExpanded)
  const setMobileNav = useUi((s) => s.setMobileNav)
  const unread = useUnreadMessages()
  const superAdmin = useIsSuperAdmin()
  // Courtesy filter — see AuthUser.allowedDepartments. `undefined` (older
  // payload, offline bootstrap) and `'all'` both mean "show everything".
  const allowedDepartments = useAuth((s) => s.user)?.allowedDepartments
  const visibleDepartments =
    allowedDepartments === undefined || allowedDepartments === 'all'
      ? DEPARTMENTS
      : DEPARTMENTS.filter((dept) => allowedDepartments.includes(dept.id))

  const closeMobile = () => setMobileNav(false)

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 pb-4" aria-label="Main navigation">
      {/* Command Center */}
      <NavLink
        to="/"
        end
        onClick={closeMobile}
        className={({ isActive }) =>
          cn(
            linkBase,
            collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2',
            isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && <ActiveMarker />}
            <LayoutDashboard className="size-[18px] shrink-0" />
            {!collapsed && <span className="truncate">Command Center</span>}
          </>
        )}
      </NavLink>

      {/* Self service. Placed above the departments because for most of the
          workforce it is the only screen in the ERP they will ever open.

          Hidden from the super administrator: the account is a system login,
          not a person — it has no 201 file, no shift and no payslips, so the
          page could only ever show them empty. */}
      {!superAdmin && (
      <NavLink
        to="/me"
        onClick={closeMobile}
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors',
            isActive ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            collapsed && 'justify-center',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && <ActiveMarker />}
            <CircleUser className="size-[18px] shrink-0" />
            {!collapsed && <span className="truncate">My Workspace</span>}
          </>
        )}
      </NavLink>
      )}

      {/* Messaging. Sits with self service rather than under a department,
          because it belongs to everybody with an account. */}
      <NavLink
        to="/messages"
        onClick={closeMobile}
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors',
            isActive ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            collapsed && 'justify-center',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && <ActiveMarker />}
            <span className="relative shrink-0">
              <MessagesSquare className="size-[18px]" />
              {/* Collapsed to a dot on the rail — there is no room for a
                  number beside a 68px icon, and its presence is the point. */}
              {unread > 0 && collapsed && (
                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-critical ring-2 ring-surface" />
              )}
            </span>
            {!collapsed && (
              <>
                <span className="flex-1 truncate">Messages</span>
                {unread > 0 && (
                  <span className="grad-brand flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </>
            )}
          </>
        )}
      </NavLink>

      {/* The personal task queue.

          Hidden from the super administrator, for the same reason My Workspace
          above it is: that account is a system login rather than a person, so
          nothing is ever assigned to it and the page could only ever be empty.
          Everyone else keeps it here — work is assigned to people, not to
          departments, so somebody in Warehouse who never opens Process &
          Performance still needs one place to find what they have been given.

          For an administrator the same screen is one click away at
          Process & Performance → My Tasks, which is why a second entry on the
          rail was only ever duplication for them. */}
      {!superAdmin && (
        <NavLink
          to="/tasks"
          onClick={closeMobile}
          className={({ isActive }) =>
            cn(
              'relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors',
              isActive ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              collapsed && 'justify-center',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && !collapsed && <ActiveMarker />}
              <ListChecks className="size-[18px] shrink-0" />
              {!collapsed && <span className="truncate">Tasks</span>}
            </>
          )}
        </NavLink>
      )}

      {/* Support.

          For everybody, administrator included — the administrator's version
          of this route is the queue of everyone else's tickets, so it belongs
          on the rail rather than only under Administration. */}
      <NavLink
        to="/support"
        onClick={closeMobile}
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors',
            isActive ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            collapsed && 'justify-center',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && <ActiveMarker />}
            <LifeBuoy className="size-[18px] shrink-0" />
            {!collapsed && <span className="truncate">Support</span>}
          </>
        )}
      </NavLink>

      {!collapsed && (
        <p className="px-2.5 pt-5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">
          Departments
        </p>
      )}
      {collapsed && <div className="my-3 h-px bg-line" />}

      {visibleDepartments.map((dept) => {
        const isOpen = expanded.includes(dept.id)
        const inSection = pathname === `/${dept.id}` || pathname.startsWith(`/${dept.id}/`)
        const Icon = dept.icon

        // Collapsed rail: the department icon links straight to its dashboard.
        if (collapsed) {
          return (
            <Tooltip key={dept.id} content={dept.label} className="w-full">
              <NavLink
                to={`/${dept.id}`}
                onClick={closeMobile}
                onMouseEnter={() => prefetchDepartment(dept.id)}
                className={cn(
                  linkBase,
                  'w-full justify-center px-0 py-2.5',
                  inSection ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                )}
                aria-label={dept.label}
              >
                <Icon className="size-[18px] shrink-0" />
              </NavLink>
            </Tooltip>
          )
        }

        return (
          <div key={dept.id}>
            <button
              onClick={() => toggleExpanded(dept.id)}
              onMouseEnter={() => prefetchDepartment(dept.id)}
              aria-expanded={isOpen}
              className={cn(
                linkBase,
                'w-full px-2.5 py-2',
                inSection ? 'text-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )}
            >
              <Icon className={cn('size-[18px] shrink-0', inSection && 'text-brand-500')} />
              <span className="flex-1 truncate text-left">{dept.short}</span>
              <ChevronDown
                className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-200', isOpen && 'rotate-180')}
              />
            </button>

            {isOpen && (
              <div className="mt-0.5 mb-1 ml-[1.4rem] space-y-0.5 border-l border-line pl-2.5">
                {dept.modules.map((mod) => (
                  <NavLink
                    key={mod.id || 'index'}
                    to={modulePath(dept.id, mod.id)}
                    end={mod.id === ''}
                    onClick={closeMobile}
                    className={({ isActive }) =>
                      cn(
                        'relative block truncate rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                        isActive
                          ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                          : 'text-ink-3 hover:bg-surface-3 hover:text-ink-2',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="grad-brand absolute top-1/2 -left-[11px] h-4 w-[3px] -translate-y-1/2 rounded-r-full" />
                        )}
                        {mod.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Administration. Super administrators only — the API refuses these
          routes to anybody else, so showing them would offer a door that does
          not open. */}
      {superAdmin && (
        <>
      {!collapsed && (
        <p className="px-2.5 pt-5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-ink-3 uppercase">
          Administration
        </p>
      )}
      {collapsed && <div className="my-3 h-px bg-line" />}

      {collapsed ? (
        <Tooltip content="Administration" className="w-full">
          <NavLink
            to="/admin/users"
            onClick={closeMobile}
            className={cn(
              linkBase,
              'w-full justify-center px-0 py-2.5',
              pathname.startsWith('/admin')
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
            )}
            aria-label="Administration"
          >
            <Settings2 className="size-[18px]" />
          </NavLink>
        </Tooltip>
      ) : (
        ADMIN_MODULES.map((mod) => {
          const Icon = mod.icon
          return (
            <NavLink
              key={mod.id}
              to={`/admin/${mod.id}`}
              onClick={closeMobile}
              className={({ isActive }) =>
                cn(
                  linkBase,
                  'px-2.5 py-2',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <ActiveMarker />}
                  <Icon className="size-[18px] shrink-0" />
                  <span className="truncate">{mod.label}</span>
                </>
              )}
            </NavLink>
          )
        })
      )}
        </>
      )}
    </nav>
  )
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggleSidebar = useUi((s) => s.toggleSidebar)

  return (
    <aside
      data-print="hide"
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden shrink-0 flex-col border-r border-line bg-surface lg:flex',
        'transition-[width] duration-200 ease-[var(--ease-out-soft)]',
        collapsed ? 'w-[68px]' : 'w-[264px]',
      )}
    >
      <Brand collapsed={collapsed} />
      <SidebarNav />
      <div className="border-t border-line p-3">
        <button
          onClick={toggleSidebar}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <PanelLeftClose className={cn('size-[18px] transition-transform duration-200', collapsed && 'rotate-180')} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}

export function MobileSidebar() {
  const open = useUi((s) => s.mobileNavOpen)
  const setMobileNav = useUi((s) => s.setMobileNav)

  if (!open) return null

  return (
    <div className="lg:hidden" data-print="hide">
      <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" onClick={() => setMobileNav(false)} aria-hidden />
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r border-line bg-surface shadow-[var(--shadow-pop)] motion-safe:animate-[fade-in-up_.2s_var(--ease-out-soft)]"
        aria-label="Navigation menu"
      >
        <div className="flex items-center justify-between pr-3">
          <Brand collapsed={false} />
          <button
            onClick={() => setMobileNav(false)}
            className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink"
            aria-label="Close navigation"
          >
            <X className="size-5" />
          </button>
        </div>
        <SidebarNav />
      </aside>
    </div>
  )
}
