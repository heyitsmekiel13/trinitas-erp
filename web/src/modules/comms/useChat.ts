import * as React from 'react'
import { useUnread } from '@/lib/unread'
import {
  fetchUpdates,
  listConversations,
  listMessages,
  markConversationRead,
  type ChatConversation,
  type ChatMessage,
} from '@/lib/chatApi'

/**
 * The messaging client's state and its poll loop.
 *
 * There is no websocket here on purpose: the ERP is deployed to shared hosting
 * with no process that can hold a connection open. Polling is the honest
 * alternative, so the cost is kept where it belongs — the open thread asks for
 * messages after the highest id it already has, which is one indexed range
 * scan, and the room list refreshes on a slower beat because a list that
 * reorders every two seconds is harder to click than to read.
 *
 * A failed poll is deliberately silent. The network drops, the laptop sleeps,
 * the token is refreshed mid-flight; none of that deserves a toast, and the
 * next tick recovers on its own.
 */

/** How often the open thread asks for new messages. */
const MESSAGE_POLL_MS = 3_000
/** How often the room list and unread counts refresh. */
const LIST_POLL_MS = 12_000

/** Merges polled messages into the thread without duplicating or reordering. */
function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return existing

  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const message of incoming) byId.set(message.id, message)

  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export function useChat() {
  const [conversations, setConversations] = React.useState<ChatConversation[]>([])
  const [activeId, setActiveId] = React.useState<number | null>(null)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  /**
   * The badge total lives in the shared store, not in local state — the
   * sidebar and top bar are rendering it too, and this page holds the freshest
   * figure the server has given anybody.
   */
  const setUnreadTotal = useUnread((s) => s.setTotal)
  const unreadTotal = useUnread((s) => s.total)
  const [loadingRooms, setLoadingRooms] = React.useState(true)
  const [loadingThread, setLoadingThread] = React.useState(false)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  /**
   * The three signals that make a thread feel live rather than fetched.
   *
   * All ride the poll that was already running, so they cost nothing extra —
   * see the `updates` endpoint, which derives each of them from rows it had to
   * read anyway.
   */
  const [typing, setTyping] = React.useState<string[]>([])
  const [seenBy, setSeenBy] = React.useState<string[]>([])
  const [present, setPresent] = React.useState<{ name: string; online: boolean }[]>([])

  /**
   * The poll's high-water mark, held in a ref rather than state.
   *
   * The interval closes over its first render, so reading the id from state
   * would make every tick ask for everything after the id that was current
   * when the thread opened — the same messages, forever.
   */
  const lastIdRef = React.useRef(0)
  const activeIdRef = React.useRef<number | null>(null)

  const [otherCount, setOtherCount] = React.useState(0)

  const active = React.useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  )

  /* ---------------------------------------------------------------- rooms */

  /**
   * Which list is on screen: the working one, or the archive.
   *
   * Kept here rather than in the page because the poll has to follow it —
   * refreshing the archive with the live list, or the other way round, would
   * swap the screen out from under whoever is reading it.
   */
  const [showArchived, setShowArchived] = React.useState(false)

  const refreshRooms = React.useCallback(
    async (silent = false) => {
      try {
        /* The archive is fetched alongside, not instead. Its count is on the
           toggle even while the live list is showing, so a thread put away is
           findable rather than gone. */
        const [rooms, archived] = await Promise.all([
          listConversations(showArchived),
          listConversations(!showArchived),
        ])

        setConversations(rooms)
        setOtherCount(archived.length)

        // Muted rooms never contribute to the badge, and neither does anything
        // in the archive — putting a thread away is saying it can wait.
        setUnreadTotal(
          (showArchived ? archived : rooms)
            .filter((r) => !r.muted)
            .reduce((sum, r) => sum + r.unread, 0),
        )
        setError(null)
      } catch (err) {
        // Only the first load may surface an error; a failed background refresh
        // must not replace a working screen with a red box.
        if (!silent) setError(err)
      } finally {
        if (!silent) setLoadingRooms(false)
      }
    },
    [showArchived],
  )

  React.useEffect(() => {
    void refreshRooms()
    const timer = setInterval(() => void refreshRooms(true), LIST_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshRooms])

  /* --------------------------------------------------------------- thread */

  const openConversation = React.useCallback((id: number | null) => {
    setActiveId(id)
    activeIdRef.current = id
    setMessages([])
    lastIdRef.current = 0
    setHasMore(false)
    setTyping([])
    setSeenBy([])
    setPresent([])
  }, [])

  React.useEffect(() => {
    if (activeId === null) return

    let cancelled = false
    setLoadingThread(true)

    void (async () => {
      try {
        const page = await listMessages(activeId)
        if (cancelled) return

        setMessages(page.messages)
        setHasMore(page.hasMore)
        lastIdRef.current = page.messages.at(-1)?.id ?? 0

        // Opening a thread is reading it — clear the badge straight away
        // rather than waiting for the next list poll to notice.
        const { unreadTotal: total } = await markConversationRead(activeId)
        if (cancelled) return
        setUnreadTotal(total)
        setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, unread: 0 } : c)))
      } catch (err) {
        if (!cancelled) setError(err)
      } finally {
        if (!cancelled) setLoadingThread(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeId])

  /* ----------------------------------------------------------------- poll */

  React.useEffect(() => {
    if (activeId === null) return

    const tick = async () => {
      // The tab is hidden — nobody is reading, so nothing needs fetching.
      if (document.hidden) return

      try {
        const {
          messages: fresh,
          polls,
          unreadTotal: total,
          typing: whoIsTyping,
          seenBy: readers,
          present: people,
        } = await fetchUpdates(activeId, lastIdRef.current)
        // A room switch may have landed while this request was in flight.
        if (activeIdRef.current !== activeId) return

        setUnreadTotal(total)
        setTyping(whoIsTyping ?? [])
        setSeenBy(readers ?? [])
        setPresent(people ?? [])

        // Tallies move without a new message arriving, so they come back
        // separately and are folded into the lines already on screen.
        if (polls && Object.keys(polls).length) {
          setMessages((prev) =>
            prev.map((m) => {
              const poll = polls[String(m.id)]
              return poll ? { ...m, poll } : m
            }),
          )
        }

        if (!fresh.length) return

        setMessages((prev) => mergeMessages(prev, fresh))
        lastIdRef.current = Math.max(lastIdRef.current, ...fresh.map((m) => m.id))

        // Keep the room list's preview line in step without a second request.
        const newest = fresh.at(-1)!
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  unread: 0,
                  lastMessageAt: newest.at,
                  lastMessage: {
                    id: newest.id,
                    body: newest.body,
                    withdrawn: newest.withdrawn,
                    isSystem: newest.isSystem,
                    author: newest.author,
                    authorId: newest.authorId,
                    at: newest.at,
                  },
                }
              : c,
          ),
        )
      } catch {
        // Silent by design — see the note at the top of this file.
      }
    }

    const timer = setInterval(() => void tick(), MESSAGE_POLL_MS)
    return () => clearInterval(timer)
  }, [activeId])

  /* -------------------------------------------------------------- history */

  const loadOlder = React.useCallback(async () => {
    if (activeId === null || !messages.length || loadingOlder) return

    setLoadingOlder(true)
    try {
      const page = await listMessages(activeId, messages[0]!.id)
      setMessages((prev) => mergeMessages(prev, page.messages))
      setHasMore(page.hasMore)
    } catch {
      // Nothing to say — the button simply stays available to try again.
    } finally {
      setLoadingOlder(false)
    }
  }, [activeId, messages, loadingOlder])

  /* ------------------------------------------------------- local mutation */

  /**
   * Drops a message the server has just accepted straight into the thread.
   *
   * `moveToTop` is false for an edit or a reaction — those change a line that
   * is already there and must not shuffle the room back up the list as though
   * somebody had just spoken.
   */
  const applyMessage = React.useCallback((message: ChatMessage, moveToTop = false) => {
    setMessages((prev) => mergeMessages(prev, [message]))
    lastIdRef.current = Math.max(lastIdRef.current, message.id)

    if (!moveToTop) return

    setConversations((prev) =>
      prev.map((c) =>
        c.id === message.conversationId
          ? {
              ...c,
              lastMessageAt: message.at,
              lastMessage: {
                id: message.id,
                body: message.body,
                withdrawn: message.withdrawn,
                isSystem: message.isSystem,
                author: message.author,
                authorId: message.authorId,
                at: message.at,
              },
            }
          : c,
      ),
    )
  }, [])

  /** Removes a message hidden for this reader only. */
  const dropMessage = React.useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return {
    conversations,
    active,
    activeId,
    messages,
    unreadTotal,
    loadingRooms,
    loadingThread,
    loadingOlder,
    hasMore,
    error,
    typing,
    seenBy,
    present,
    openConversation,
    refreshRooms,
    showArchived,
    setShowArchived,
    /** How many are in the list you are not looking at. */
    otherCount,
    loadOlder,
    applyMessage,
    dropMessage,
    setConversations,
  }
}
