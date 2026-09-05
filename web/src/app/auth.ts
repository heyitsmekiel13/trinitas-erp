import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { API_BASE_URL, queryClient } from '@/lib/api'
import { useUi } from './store'

/**
 * Authentication and session security.
 *
 * Talks to the Laravel API when one is configured. Until then it accepts the
 * seeded bootstrap credential so the app is usable during development — the
 * fallback is disabled the moment VITE_API_URL is set.
 */

export type AuthUser = {
  id: string
  name: string
  email: string
  role: string
  branch: string
  avatarInitials?: string
  /** Employee number this account belongs to, when it maps to one. */
  employeeNo?: string
  /** HR department, so a form charged to one can fill it in rather than ask. */
  departmentId?: number | null
  department?: string | null
  /**
   * Permission codes from the API. A super administrator gets `['*']`.
   *
   * Used only to decide what to draw — the API refuses administration routes
   * on its own, so editing this in devtools reveals an empty screen, not data.
   */
  permissions?: string[]
  /**
   * True while the account is still on its issued password. The API refuses
   * every route except the ones needed to change it, so this only decides
   * which screen to show — it is not the protection itself.
   */
  mustChangePassword?: boolean
  /**
   * Whether this account belongs to the Process & Performance office.
   *
   * Decides whether the compliance screens appear in the menu. Not the
   * control: every compliance route is behind middleware that answers 404 to
   * anybody else, so flipping this in devtools reveals a 404, not a register.
   */
  processOffice?: boolean
  /**
   * Which business departments this account may see in the sidebar.
   * `'all'` when the feature is off or this account is exempt.
   *
   * Courtesy only, exactly like {@link processOffice}: the API's
   * `department-access` middleware is the actual control, so hiding or
   * showing a menu item here never changes what a route will answer.
   */
  allowedDepartments?: string[] | 'all'
}

/** Seeded bootstrap account. The backend seeder creates the same credential. */
const BOOTSTRAP = {
  username: 'superadmin',
  password: 'admin123',
  user: {
    id: 'u-1',
    name: 'Super Administrator',
    email: 'superadmin@trinitas.com.ph',
    role: 'System Administrator',
    branch: 'Head Office — Muntinlupa',
    permissions: ['*'],
  } satisfies AuthUser,
}

export type LoginResult =
  | { status: 'ok' }
  | { status: 'code-required'; challengeId: string }
  | { status: 'error'; message: string }

/** The admin's own session, set aside while looking through somebody else's. */
type ImpersonatorSession = { token: string; user: AuthUser }

type AuthState = {
  user: AuthUser | null
  token: string | null
  /** Epoch ms of the last user interaction — drives inactivity logout. */
  lastActivity: number
  /** Minutes of inactivity before the session ends. 0 disables it. */
  autoLogoutMinutes: number
  login: (username: string, password: string) => Promise<LoginResult>
  verifyCode: (challengeId: string, code: string) => Promise<LoginResult>
  logout: (reason?: string) => void
  touch: () => void
  /** Applied after the user changes their own password. */
  setUser: (user: AuthUser) => void
  setAutoLogoutMinutes: (minutes: number) => void
  logoutReason: string | null
  clearLogoutReason: () => void
  /**
   * Non-null exactly while "logged in as" somebody else — see
   * `modules/admin/impersonate.tsx`. Holds the admin's own token and user so
   * "Return to admin" is a local swap, not a second sign-in.
   */
  impersonatorSession: ImpersonatorSession | null
  beginImpersonation: (token: string, user: AuthUser) => void
  endImpersonation: () => void
}

const liveApi = () => Boolean(import.meta.env.VITE_API_URL)

/**
 * Posts to the API, turning a failed connection into an answer rather than an
 * exception.
 *
 * `fetch` rejects — it does not return a status — when the server is down, the
 * address is wrong, or the browser blocks the response for CORS. Letting that
 * propagate left the sign-in button spinning forever with nothing on screen to
 * explain why, which is the worst possible version of "it does not work".
 * Status 0 is the convention here for "never reached the server".
 */
async function post(path: string, body: unknown) {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
  } catch {
    return {
      ok: false,
      status: 0,
      payload: {
        message: `Could not reach the server at ${API_BASE_URL}. Check that the API is running, and that this address is in its allowed origins.`,
      } as Record<string, string>,
    }
  }

  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

/**
 * Asks the browser for this device's location once, right after signing
 * in, and volunteers it to the server if granted — see
 * `AuthController::reportLocation()` for what it is attached to (the
 * `login_attempts` row this same sign-in just created) and who can read it
 * back (system administrators only, from Admin → Login Activity).
 *
 * Never retried, and never blocks or delays sign-in itself: a denied,
 * unavailable, or timed-out prompt just means this login has no location on
 * it, exactly as if the browser had no geolocation API at all. The "ask once"
 * is the browser's own permission model — once answered, it is not shown
 * again on a later login unless the person changes it themselves in their
 * browser settings.
 */
function reportLoginLocation(token: string) {
  if (!liveApi() || typeof navigator === 'undefined' || !navigator.geolocation) return

  navigator.geolocation.getCurrentPosition(
    (position) => {
      void fetch(`${API_BASE_URL}/auth/login-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      }).catch(() => {})
    },
    () => {
      /* Denied, unavailable, or timed out — nothing to report. */
    },
    { timeout: 10_000, maximumAge: 0 },
  )
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      lastActivity: Date.now(),
      autoLogoutMinutes: 30,
      logoutReason: null,

      login: async (username, password) => {
        if (liveApi()) {
          const { ok, status, payload } = await post('auth/login', { username, password })
          if (status === 423) return { status: 'error', message: payload.message ?? 'Access blocked from this location.' }
          if (!ok) return { status: 'error', message: payload.message ?? 'Incorrect username or password.' }
          if (payload.requires_code) return { status: 'code-required', challengeId: payload.challenge_id }
          set({ user: payload.user, token: payload.token, lastActivity: Date.now(), logoutReason: null })
          useUi.getState().setExpanded([])
          reportLoginLocation(payload.token)
          return { status: 'ok' }
        }

        // Offline bootstrap path.
        await new Promise((r) => setTimeout(r, 350))
        if (username.trim().toLowerCase() === BOOTSTRAP.username && password === BOOTSTRAP.password) {
          set({ user: BOOTSTRAP.user, token: 'bootstrap-session', lastActivity: Date.now(), logoutReason: null })
          useUi.getState().setExpanded([])
          return { status: 'ok' }
        }
        return { status: 'error', message: 'Incorrect username or password.' }
      },

      verifyCode: async (challengeId, code) => {
        const { ok, payload } = await post('auth/verify-code', { challenge_id: challengeId, code })
        if (!ok) return { status: 'error', message: payload.message ?? 'That code is not valid or has expired.' }
        set({ user: payload.user, token: payload.token, lastActivity: Date.now(), logoutReason: null })
        useUi.getState().setExpanded([])
        reportLoginLocation(payload.token)
        return { status: 'ok' }
      },

      logout: (reason) => {
        if (liveApi() && get().token) void post('auth/logout', {})
        set({ user: null, token: null, logoutReason: reason ?? null, impersonatorSession: null })
      },

      touch: () => set({ lastActivity: Date.now() }),
      setUser: (user) => set({ user }),
      setAutoLogoutMinutes: (autoLogoutMinutes) => set({ autoLogoutMinutes }),
      clearLogoutReason: () => set({ logoutReason: null }),

      impersonatorSession: null,

      beginImpersonation: (token, user) => {
        const { token: adminToken, user: adminUser } = get()
        if (!adminToken || !adminUser) return
        set({ impersonatorSession: { token: adminToken, user: adminUser }, token, user, lastActivity: Date.now() })
        useUi.getState().setExpanded([])
        // Every cached fetch so far belongs to the admin's own view — an
        // impersonated screen must never render it from cache while its own
        // request is in flight.
        queryClient.clear()
      },

      endImpersonation: () => {
        const admin = get().impersonatorSession
        if (!admin) return
        set({ token: admin.token, user: admin.user, impersonatorSession: null, lastActivity: Date.now() })
        useUi.getState().setExpanded([])
        queryClient.clear()
      },
    }),
    {
      name: 'trinitas.auth',
      partialize: (s) => ({
        user: s.user,
        token: s.token,
        lastActivity: s.lastActivity,
        autoLogoutMinutes: s.autoLogoutMinutes,
        impersonatorSession: s.impersonatorSession,
      }),
    },
  ),
)

export const BOOTSTRAP_CREDENTIAL = { username: BOOTSTRAP.username, password: BOOTSTRAP.password }

/**
 * The signed-in user, readable outside React (print headers, export metadata).
 * Falls back to the bootstrap identity so printing never renders "undefined".
 */
export function currentUser(): AuthUser {
  return useAuth.getState().user ?? BOOTSTRAP.user
}

/**
 * Whether an account may reach Administration.
 *
 * The API grants a super administrator the wildcard permission, so that is
 * what this looks for rather than matching on the role's display name — a
 * label somebody could rename.
 */
export function isSuperAdmin(user: AuthUser | null | undefined): boolean {
  return Boolean(user?.permissions?.includes('*'))
}

/** Reactive form of {@link isSuperAdmin}, for components. */
export function useIsSuperAdmin(): boolean {
  return isSuperAdmin(useAuth((s) => s.user))
}

/**
 * Whether to draw the compliance screens.
 *
 * The API decides this and sends it on the session payload — the client must
 * not try to work it out from a department name, because it would then be a
 * second implementation of a rule that already exists on the server, free to
 * disagree with it.
 */
export function useIsProcessOffice(): boolean {
  return Boolean(useAuth((s) => s.user)?.processOffice)
}

/**
 * Whether the signed-in account may see a given registry department id.
 *
 * Courtesy only — see {@link AuthUser.allowedDepartments}. Defaults to
 * `true` when the field is absent (bootstrap/offline account, or an API
 * payload predating this field), matching the feature's off-by-default
 * "everyone sees everything" behavior.
 */
export function useCanSeeDepartment(departmentId: string): boolean {
  const allowed = useAuth((s) => s.user)?.allowedDepartments
  return allowed === undefined || allowed === 'all' || allowed.includes(departmentId)
}

/** Drives the "Viewing as" banner — see AppShell. */
export function useImpersonation() {
  const session = useAuth((s) => s.impersonatorSession)
  const user = useAuth((s) => s.user)
  const end = useAuth((s) => s.endImpersonation)
  return { active: session !== null, adminName: session?.user.name ?? null, viewingAs: user?.name ?? null, end }
}
