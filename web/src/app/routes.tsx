import type { ComponentType } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { SessionGuard } from '@/components/layout/SessionGuard'
import { RequireEmployee, RequireSuperAdmin } from '@/components/layout/RequireSuperAdmin'
import { ADMIN_MODULES, DEPARTMENTS } from './registry'
import { DEPARTMENT_CHUNKS, type PageModule } from './departmentChunks'

/** Everything inside the shell requires an authenticated, active session. */
function GuardedShell() {
  return (
    <SessionGuard>
      <AppShell />
    </SessionGuard>
  )
}

function departmentRoutes(): RouteObject[] {
  return DEPARTMENTS.map((dept) => ({
    path: dept.id,
    children: dept.modules.map((mod) => ({
      ...(mod.id ? { path: mod.id } : { index: true }),
      lazy: async () => {
        const chunk = await DEPARTMENT_CHUNKS[dept.id]!()
        const Component = chunk.PAGES[mod.id]
        if (!Component) throw new Error(`No page registered for ${dept.id}/${mod.id || 'index'}`)
        return { Component }
      },
    })),
  }))
}

export const router = createBrowserRouter([
  {
    path: '/login',
    lazy: async () => ({ Component: (await import('@/modules/auth/Login')).Login }),
  },
  {
    // The After-Sales client booking page. Outside the shell on purpose: it
    // opens in its own tab, needs no sign-in, and wears the letterhead rather
    // than the application chrome.
    //
    // Declared before `/book` because it is a longer, more specific path — the
    // maintenance portal below does not take children.
    path: '/book/service',
    lazy: async () => ({
      Component: (await import('@/modules/afterSales/BookingPage')).ServiceBookingPage,
    }),
  },
  {
    /*
     * The careers site.
     *
     * Public, outside the shell, and its own destination entirely: the people
     * who use it do not work here and have no account. `/careers/:slug` is a
     * real, linkable address for one vacancy, because a job posting that
     * cannot be shared as a link is a job posting nobody sees.
     */
    path: '/careers',
    lazy: async () => ({ Component: (await import('@/modules/careers/Portal')).CareersPortal }),
  },
  {
    path: '/careers/:slug',
    lazy: async () => ({ Component: (await import('@/modules/careers/Portal')).CareersPortal }),
  },
  {
    /*
     * The scanned-badge lookup — where an employee ID card's QR code points.
     *
     * Public, outside the shell, same reasoning as the careers site above:
     * whoever scans a badge has no account and should not be handed a view
     * of the internal ERP just to confirm someone's employment.
     */
    path: '/id/:token',
    lazy: async () => ({ Component: (await import('@/modules/public/IdCheck')).IdCheck }),
  },
  {
    /*
     * Recruitment's two intake forms.
     *
     * Both open in their own tab from the recruitment board. They are full
     * pages rather than dialogs because both are long — a manpower request is
     * an authorisation, and encoding an applicant now carries their whole
     * personal record — and because a recruiter keying a stack of walk-in CVs
     * wants the form to stay open while they work through them.
     *
     * Behind the session guard: these are internal documents, unlike the
     * careers site above.
     */
    path: '/hr/manpower-request',
    lazy: async () => {
      const { ManpowerRequestPage } = await import('@/modules/hr/ManpowerRequestPage')
      return {
        Component: () => (
          <SessionGuard>
            <ManpowerRequestPage />
          </SessionGuard>
        ),
      }
    },
  },
  {
    path: '/hr/applicant-intake',
    lazy: async () => {
      const { ApplicantIntakePage } = await import('@/modules/hr/ApplicantIntakePage')
      return {
        Component: () => (
          <SessionGuard>
            <ApplicantIntakePage />
          </SessionGuard>
        ),
      }
    },
  },
  {
    // Raising a fuel request. Outside the shell because the map wants the
    // width, but still behind the session guard — a trip ticket is an internal
    // document, unlike the client booking page above.
    path: '/fuel-request',
    lazy: async () => {
      const { FuelRequestPage } = await import('@/modules/maintenance/FuelRequestPage')
      return {
        Component: () => (
          <SessionGuard>
            <FuelRequestPage />
          </SessionGuard>
        ),
      }
    },
  },
  {
    // The maintenance booking portal is deliberately outside the app shell — it
    // opens in its own tab and is reachable by technicians and requesters.
    path: '/book',
    lazy: async () => ({ Component: (await import('@/modules/booking/Portal')).BookingPortal }),
  },
  {
    // First-run setup. Signed-in but deliberately outside the shell — a
    // wizard reads better without the sidebar competing for attention.
    path: '/setup',
    lazy: async () => {
      const { SetupWizard } = await import('@/modules/setup/Wizard')
      return {
        Component: () => (
          <SessionGuard>
            <SetupWizard />
          </SessionGuard>
        ),
      }
    },
  },
  {
    path: '/',
    Component: GuardedShell,
    children: [
      {
        index: true,
        lazy: async () => ({ Component: (await import('@/modules/executive')).PAGES[''] as ComponentType }),
      },
      {
        // Employee self service. Inside the shell so the departments an
        // employee is entitled to see stay one click away, but reachable by
        // everyone — most of the workforce has no department page at all.
        path: 'me',
        lazy: async () => {
          const { SelfServicePortal } = await import('@/modules/me')
          return {
            Component: () => (
              <RequireEmployee>
                <SelfServicePortal />
              </RequireEmployee>
            ),
          }
        },
      },
      {
        // Messaging. Cross-cutting like self service — everybody with an
        // account has one, regardless of which departments they can open.
        path: 'messages',
        lazy: async () => ({ Component: (await import('@/modules/comms')).Messages }),
      },
      {
        /*
         * The personal task queue.
         *
         * Cross-cutting for the same reason as messaging and self service:
         * work is assigned to people, not to departments, and somebody in
         * Warehouse who has never opened Process & Performance still needs to
         * see what they have been given. The same component also renders
         * inside the department at /process/my-tasks — one screen, reachable
         * from wherever the person already is.
         */
        path: 'tasks',
        lazy: async () => ({ Component: (await import('@/modules/process')).MyTasks }),
      },
      {
        /*
         * Support tickets.
         *
         * Cross-cutting, like messaging and the task queue: anybody with an
         * account can have a problem, and the request was that they raise it
         * from their own sign-in. The same component serves the administrator
         * at /admin/tickets — the API decides which of the two views comes
         * back, so there is one screen rather than two that drift.
         */
        path: 'support',
        lazy: async () => ({ Component: (await import('@/modules/support')).SupportDesk }),
      },
      ...departmentRoutes(),
      {
        path: 'admin',
        children: ADMIN_MODULES.map((mod) => ({
          path: mod.id,
          lazy: async () => {
            const chunk = (await import('@/modules/admin')) as PageModule
            const Page = chunk.PAGES[mod.id]!
            return {
              Component: () => (
                <RequireSuperAdmin>
                  <Page />
                </RequireSuperAdmin>
              ),
            }
          },
        })),
      },
      {
        path: '*',
        lazy: async () => ({ Component: (await import('@/modules/NotFound')).NotFound }),
      },
    ],
  },
])
