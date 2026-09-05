import * as React from 'react'
import { create } from 'zustand'
import { fetchUnreadTotal } from './chatApi'
import { liveApi } from './adminApi'
import { useAuth } from '@/app/auth'

/**
 * The unread badge shown in the shell.
 *
 * A shared store rather than a hook with its own fetch, because two things
 * know the count and they must not disagree. The background poll keeps it
 * honest while the reader is anywhere else in the ERP; the messaging page
 * publishes the exact figure the server just returned whenever it opens or
 * reads a room. Without the second half, opening a conversation cleared the
 * room's own badge instantly while the sidebar went on claiming an unread
 * message for up to another poll interval.
 */
type UnreadState = {
  total: number
  setTotal: (total: number) => void
}

export const useUnread = create<UnreadState>((set) => ({
  total: 0,
  setTotal: (total) => set({ total }),
}))

/** Read-only accessor for the badge itself. */
export function useUnreadMessages(): number {
  return useUnread((s) => s.total)
}

/** How often the shell re-checks while the reader is elsewhere in the ERP. */
const POLL_MS = 30_000

/**
 * Runs the background poll. Mounted once, by the app shell.
 *
 * Failures are swallowed. An unread count that could not be fetched is not
 * news, and the shell must never show an error because a poll missed.
 */
export function useUnreadPoll(): void {
  const token = useAuth((s) => s.token)
  const setTotal = useUnread((s) => s.setTotal)

  React.useEffect(() => {
    if (!liveApi() || !token || token === 'bootstrap-session') {
      setTotal(0)
      return
    }

    let cancelled = false

    const tick = async () => {
      // The tab is hidden — nobody is looking at the badge.
      if (document.hidden) return
      try {
        const { unreadTotal } = await fetchUnreadTotal()
        if (!cancelled) setTotal(unreadTotal)
      } catch {
        // Silent by design — see the note above.
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [token, setTotal])
}
