import * as React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { ForcePasswordChange } from '@/modules/auth/ForcePasswordChange'
import { Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'

/** Warn this many seconds before the session is ended. */
const WARNING_SECONDS = 60

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown'] as const

/**
 * Blocks unauthenticated access and ends idle sessions.
 *
 * The countdown is driven by a timestamp rather than a running timer, so a
 * backgrounded tab (where timers are throttled) still logs out on time.
 */
export function SessionGuard({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user)
  const autoLogoutMinutes = useAuth((s) => s.autoLogoutMinutes)
  const touch = useAuth((s) => s.touch)
  const logout = useAuth((s) => s.logout)
  const location = useLocation()

  const [secondsLeft, setSecondsLeft] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!user || autoLogoutMinutes <= 0) return

    // Throttle: one timestamp write per 5s is plenty and keeps typing cheap.
    let lastWrite = 0
    const onActivity = () => {
      const now = Date.now()
      if (now - lastWrite > 5000) {
        lastWrite = now
        touch()
      }
    }
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true })

    const limitMs = autoLogoutMinutes * 60_000
    const tick = setInterval(() => {
      const idleMs = Date.now() - useAuth.getState().lastActivity
      const remaining = Math.ceil((limitMs - idleMs) / 1000)
      if (remaining <= 0) {
        setSecondsLeft(null)
        logout('Your session ended after a period of inactivity.')
      } else if (remaining <= WARNING_SECONDS) {
        setSecondsLeft(remaining)
      } else {
        setSecondsLeft((current) => (current === null ? null : null))
      }
    }, 1000)

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity)
      clearInterval(tick)
    }
  }, [user, autoLogoutMinutes, touch, logout])

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  // Accounts still on their issued password see only this. The API refuses
  // every other route anyway, so the app behind it would be empty regardless.
  if (user.mustChangePassword) {
    return <ForcePasswordChange />
  }

  return (
    <>
      {children}
      <Modal
        open={secondsLeft !== null}
        onClose={() => {
          touch()
          setSecondsLeft(null)
        }}
        size="sm"
        title="Still there?"
        description="You will be signed out automatically to protect this session."
        footer={
          <>
            <Button variant="secondary" onClick={() => logout('You signed out.')}>
              Sign out now
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                touch()
                setSecondsLeft(null)
              }}
            >
              Stay signed in
            </Button>
          </>
        }
      >
        <div className="flex items-center gap-3">
          <span className="grad-brand-soft flex size-10 shrink-0 items-center justify-center rounded-xl">
            <ShieldAlert className="size-5 text-brand-500" />
          </span>
          <p className="text-[13px] text-ink-2">
            No activity detected. Signing out in{' '}
            <span className="tabular font-semibold text-ink">{secondsLeft ?? 0}</span> seconds.
          </p>
        </div>
      </Modal>
    </>
  )
}
