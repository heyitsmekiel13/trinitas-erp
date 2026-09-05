import * as React from 'react'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BellOff,
  Building2,
  ChevronUp,
  Info,
  LogOut,
  MessagesSquare,
  MoreVertical,
  Paperclip,
  Pin,
  Plug,
  RefreshCw,
  BarChart3,
  Search,
  Send,
  SquarePen,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { liveApi } from '@/lib/adminApi'
import {
  deleteMessage,
  editMessage,
  reactToMessage,
  sendMessage,
  sendAttachments,
  pingTyping,
  pinMessage,
  searchMessages,
  forwardMessage,
  syncDepartmentRooms,
  archiveConversation,
  leaveConversation,
  deleteConversation,
  type ChatConversation,
  type ChatMessage,
  type ChatPoll,
} from '@/lib/chatApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar, Badge, Button, Input, Tooltip } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuSeparator, Modal } from '@/components/ui/overlay'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { MessageBubble } from './MessageBubble'
import { NewConversation } from './NewConversation'
import { NewPoll } from './NewPoll'
import { RoomDetails } from './RoomDetails'
import { useChat } from './useChat'

/**
 * Workspace messaging.
 *
 * Two panes on a desktop, one at a time on a phone — the same shape every
 * messaging app has settled on, because a thread wants the full width of a
 * small screen and a list of rooms is worth keeping visible on a large one.
 *
 * Everything here needs the API. There is no preview dataset for messages on
 * purpose: a mocked conversation that cannot be replied to teaches nobody
 * anything, and would quietly hide a broken endpoint.
 */

/** Relative day label above each group of messages. */
function dayLabel(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'

  return date.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "3m", "2h", "Mon" — the age stamp on a room in the list. */
function shortAge(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const minutes = Math.floor((Date.now() - then) / 60_000)

  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  if (minutes < 7 * 24 * 60) return new Date(iso).toLocaleDateString('en-PH', { weekday: 'short' })

  return new Date(iso).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })
}

function roomGlyph(conversation: ChatConversation) {
  if (conversation.icon) return <span className="text-lg leading-none">{conversation.icon}</span>
  if (conversation.kind === 'department') return <Building2 className="size-4 text-ink-3" />
  if (conversation.kind === 'group') return <Users className="size-4 text-ink-3" />
  return null
}

/** One row in the left-hand list. */
function RoomRow({
  conversation,
  active,
  onOpen,
  onArchive,
  onDeleteForMe,
  onLeave,
  onDelete,
}: {
  conversation: ChatConversation
  active: boolean
  onOpen: () => void
  onArchive: () => void
  onDeleteForMe: () => void
  onLeave: () => void
  onDelete: () => void
}) {
  const last = conversation.lastMessage
  const preview = !last
    ? 'No messages yet'
    : last.withdrawn
      ? 'Message deleted'
      : last.isSystem
        ? last.body
        : `${last.authorId === null ? '' : `${last.author?.split(' ')[0] ?? ''}: `}${last.body ?? ''}`

  const archived = conversation.archivedAt !== null

  return (
    /* The row is a container with the open button inside it rather than being
       the button, because a menu trigger cannot live inside another button —
       nesting them makes the whole row unclickable in Safari and reads as one
       control to a screen reader. */
    <li className="group/row relative">
      <button
        onClick={onOpen}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-xl py-2 pr-9 pl-2.5 text-left transition-colors',
          active ? 'bg-brand-50 dark:bg-brand-950' : 'hover:bg-surface-3',
        )}
        aria-current={active ? 'true' : undefined}
      >
        <span className="relative shrink-0">
          {conversation.kind === 'direct' ? (
            <Avatar name={conversation.name} size="md" />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-full bg-surface-3 ring-1 ring-line">
              {roomGlyph(conversation) ?? <Users className="size-4 text-ink-3" />}
            </span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                conversation.unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-2',
              )}
            >
              {conversation.name}
            </span>
            <span className="shrink-0 text-[10px] text-ink-3">{shortAge(conversation.lastMessageAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[11px]',
                conversation.unread > 0 ? 'font-medium text-ink-2' : 'text-ink-3',
              )}
            >
              {preview}
            </span>
            {conversation.muted && <BellOff className="size-3 shrink-0 text-ink-3" />}
            {conversation.unread > 0 && (
              <span className="grad-brand flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                {conversation.unread > 99 ? '99+' : conversation.unread}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Always reachable, not only on hover: a hover-only control does not
          exist on a touch screen, which is where half of this is read. */}
      <span className="absolute top-1/2 right-1 -translate-y-1/2">
        <Menu
          align="end"
          trigger={({ toggle }) => (
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggle()
              }}
              aria-label={`Options for ${conversation.name}`}
              className={cn(
                'rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink',
                'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100',
                // On touch there is no hover, so it stays visible.
                '[@media(hover:none)]:opacity-100',
              )}
            >
              <MoreVertical className="size-3.5" />
            </button>
          )}
        >
          <MenuItem icon={archived ? ArchiveRestore : Archive} onClick={onArchive}>
            {archived ? 'Move back to conversations' : 'Archive'}
          </MenuItem>

          {/* The Messenger-shaped action: gone from your list, untouched for
              anybody else, back on its own if they write again. Technically
              the same thing Archive does — offered separately, worded the
              way people actually ask for it. */}
          {!archived && (
            <MenuItem icon={Trash2} danger onClick={onDeleteForMe}>
              Delete conversation
            </MenuItem>
          )}

          {conversation.canLeave && !archived && (
            <MenuItem icon={LogOut} onClick={onLeave}>
              Leave the group
            </MenuItem>
          )}

          {conversation.canDelete && (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onClick={onDelete}>
                Delete for everybody
              </MenuItem>
            </>
          )}
        </Menu>
      </span>
    </li>
  )
}

export function Messages() {
  const toast = useToast()
  const chat = useChat()
  const {
    conversations,
    active,
    activeId,
    messages,
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
    otherCount,
    loadOlder,
    applyMessage,
    dropMessage,
    setConversations,
  } = chat

  const [query, setQuery] = React.useState('')

  /** The room a destructive menu item is asking about. */
  const [confirming, setConfirming] = React.useState<{ room: ChatConversation; act: 'leave' | 'delete' | 'delete-for-me' } | null>(
    null,
  )
  const [acting, setActing] = React.useState(false)

  /**
   * Puts a thread away, or brings it back.
   *
   * Optimistic: the row disappears from the list the moment it is pressed,
   * because waiting a round trip to see a list change you just asked for feels
   * broken. A failure puts it back and says so.
   */
  const toggleArchive = async (room: ChatConversation) => {
    const wasArchived = room.archivedAt !== null

    setConversations((rooms) => rooms.filter((r) => r.id !== room.id))

    if (room.id === activeId) openConversation(null)

    try {
      const result = await archiveConversation(room.id, !wasArchived)
      toast({ tone: 'success', title: wasArchived ? 'Back in your list' : 'Archived', description: result.message })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not do that.', description: (err as Error).message })
    } finally {
      void refreshRooms(true)
    }
  }

  const confirmAct = async () => {
    if (!confirming) return

    const { room, act } = confirming

    setActing(true)
    try {
      const result =
        act === 'leave'
          ? await leaveConversation(room.id)
          : act === 'delete-for-me'
            // Same call `toggleArchive` makes — archiving already is
            // Messenger's "delete a conversation": gone from this list,
            // untouched for anybody else, and back on its own the moment
            // somebody writes in it again. This entry point exists because
            // that is not what "Archive" sounds like it does.
            ? await archiveConversation(room.id, true)
            : await deleteConversation(room.id)

      const titles = { leave: 'Left the group', delete: 'Deleted', 'delete-for-me': 'Conversation deleted' } as const
      toast({ tone: 'success', title: titles[act], description: result.message })

      setConversations((rooms) => rooms.filter((r) => r.id !== room.id))
      if (room.id === activeId) openConversation(null)
      setConfirming(null)
      void refreshRooms(true)
    } catch (err) {
      // The server's refusal explains which of the three this room allows.
      toast({ tone: 'error', title: 'Could not do that.', description: (err as Error).message })
    } finally {
      setActing(false)
    }
  }

  const [composing, setComposing] = React.useState(false)
  const [showDetails, setShowDetails] = React.useState(false)
  const [polling, setPolling] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<ChatMessage | null>(null)
  /** Files staged in the composer, not yet sent. */
  const [staged, setStaged] = React.useState<File[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)
  /** In-conversation search. Null when the bar is closed. */
  const [finding, setFinding] = React.useState<string | null>(null)
  const [hits, setHits] = React.useState<ChatMessage[] | null>(null)
  /** The message waiting to be sent on to another room. */
  const [forwarding, setForwarding] = React.useState<ChatMessage | null>(null)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)

  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const composerRef = React.useRef<HTMLTextAreaElement>(null)
  /** Set while loading history, so prepending pages does not yank the view. */
  const pinnedHeightRef = React.useRef<number | null>(null)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.topic ?? '').toLowerCase().includes(q),
    )
  }, [conversations, query])

  /* --------------------------------------------------------------- scroll */

  const atBottomRef = React.useRef(true)

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  React.useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return

    // Loading older messages: hold the reader's place by restoring the
    // distance from the bottom, which the new content above has not changed.
    if (pinnedHeightRef.current !== null) {
      el.scrollTop = el.scrollHeight - pinnedHeightRef.current
      pinnedHeightRef.current = null
      return
    }

    // Otherwise follow the conversation down, unless the reader has
    // deliberately scrolled up to read something older.
    if (atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  React.useEffect(() => {
    atBottomRef.current = true
  }, [activeId])

  const readOlder = async () => {
    const el = scrollerRef.current
    if (el) pinnedHeightRef.current = el.scrollHeight - el.scrollTop
    await loadOlder()
  }

  /* ------------------------------------------------------------- commands */

  /** Holds one message at the top of the room, or clears whatever is there. */
  const pin = async (messageId: number | null) => {
    if (activeId === null) return
    try {
      const room = await pinMessage(activeId, messageId)
      setConversations((prev) => prev.map((c) => (c.id === room.id ? room : c)))
      toast({ tone: 'success', title: messageId ? 'Pinned to the top' : 'Pin removed' })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not pin that', description: (err as Error).message })
    }
  }

  /** Finds a message in this room. Empty query closes the results. */
  const runSearch = async (q: string) => {
    if (activeId === null) return
    if (q.trim().length < 2) return setHits(null)
    try {
      setHits(await searchMessages(activeId, q.trim()))
    } catch {
      setHits([])
    }
  }


  /**
   * Tells the room somebody is writing.
   *
   * Throttled to one ping every three seconds rather than fired per keystroke:
   * the server's window is six, so three keeps the indicator continuously
   * alive while halving the traffic of a naive implementation.
   */
  const onlineNow = present.filter((p) => p.online).length

  const lastPingRef = React.useRef(0)
  const noteTyping = () => {
    if (activeId === null) return
    const now = Date.now()
    if (now - lastPingRef.current < 3_000) return
    lastPingRef.current = now
    void pingTyping(activeId).catch(() => {
      // A dropped keystroke ping is not worth telling anybody about.
    })
  }

  const send = async () => {
    const body = draft.trim()
    if ((!body && !staged.length) || activeId === null || sending) return

    setSending(true)
    try {
      // Files and text go together in one message — "here you go" with three
      // photos is one thing said, not two.
      const message = staged.length
        ? await sendAttachments(activeId, staged, body, replyTo?.id)
        : await sendMessage(activeId, body, replyTo?.id)
      applyMessage(message, true)
      setDraft('')
      setStaged([])
      setReplyTo(null)
      atBottomRef.current = true
      composerRef.current?.focus()
    } catch (err) {
      toast({ tone: 'error', title: 'Message not sent.', description: (err as Error).message })
    } finally {
      setSending(false)
    }
  }

  const react = async (message: ChatMessage, emoji: string | null) => {
    try {
      applyMessage(await reactToMessage(message.id, emoji))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not react.', description: (err as Error).message })
    }
  }

  const edit = async (message: ChatMessage, body: string) => {
    try {
      applyMessage(await editMessage(message.id, body))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not edit that.', description: (err as Error).message })
      throw err
    }
  }

  const remove = async (message: ChatMessage, scope: 'me' | 'everyone') => {
    try {
      await deleteMessage(message.id, scope)
      if (scope === 'me') {
        dropMessage(message.id)
      } else {
        // A withdrawn message stays put as a tombstone, so the row is
        // rewritten rather than removed.
        applyMessage({ ...message, body: null, withdrawn: true, reactions: [], canEdit: false, canWithdraw: false })
      }
    } catch (err) {
      toast({ tone: 'error', title: 'Could not delete that.', description: (err as Error).message })
    }
  }

  /** A vote or a close landed — swap the poll into the line carrying it. */
  const applyPoll = (message: ChatMessage, poll: ChatPoll) => applyMessage({ ...message, poll })

  const jumpTo = (id: number) => {
    const el = document.getElementById(`message-${id}`)
    if (!el) {
      toast({ tone: 'info', title: 'That message is further back.', description: 'Load older messages to reach it.' })
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-brand-400', 'rounded-2xl')
    setTimeout(() => el.classList.remove('ring-2', 'ring-brand-400', 'rounded-2xl'), 1_500)
  }

  const syncDepartments = async () => {
    setSyncing(true)
    try {
      const { created, added } = await syncDepartmentRooms()
      await refreshRooms()
      toast({
        tone: 'success',
        title: 'Department rooms are up to date.',
        description: `${created} created, ${added} ${added === 1 ? 'person' : 'people'} added.`,
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not sync the rooms.', description: (err as Error).message })
    } finally {
      setSyncing(false)
    }
  }

  const applyRoomChange = (updated: ChatConversation) =>
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))

  /* ----------------------------------------------------------------- gate */

  if (!liveApi()) {
    return (
      <>
        <PageHeader
          title="Messages"
          description="Direct messages, group chats and a room for every department."
        />
        <div className="card">
          <EmptyState
            icon={Plug}
            title="Messaging needs the live API"
            description="Conversations are read and written straight to the database — there is no preview data for them. Point VITE_API_URL at the Laravel API and sign in to start messaging."
          />
        </div>
      </>
    )
  }

  if (error && !conversations.length) {
    return (
      <>
        <PageHeader title="Messages" />
        <ErrorState error={error} onRetry={() => void refreshRooms()} />
      </>
    )
  }

  /* ----------------------------------------------------------------- view */

  const showAuthors = (active?.memberCount ?? 0) > 2

  return (
    <>
      <PageHeader
        title="Messages"
        description="Direct messages, group chats and a room for every department."
        actions={
          <>
            <Button variant="ghost" onClick={() => void syncDepartments()} disabled={syncing}>
              <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
              Sync department rooms
            </Button>
            <Button onClick={() => setComposing(true)}>
              <SquarePen className="size-4" />
              New conversation
            </Button>
          </>
        }
      />

      <div className="card flex h-[calc(100vh-13rem)] min-h-[30rem] overflow-hidden p-0">
        {/* ------------------------------------------------------ room list */}
        <aside
          className={cn(
            'flex w-full shrink-0 flex-col border-r border-line md:w-[19rem]',
            // On a phone the list gives way entirely once a thread is open.
            activeId !== null && 'hidden md:flex',
          )}
        >
          <div className="space-y-2 border-b border-line p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={showArchived ? 'Search archived…' : 'Search conversations…'}
                className="pl-9"
                aria-label="Search conversations"
              />
            </div>

            {/* Only shown once there is an archive to look at. A permanent
                empty tab is a control that teaches people it does nothing. */}
            {(showArchived || otherCount > 0) && (
              <button
                onClick={() => {
                  setShowArchived(!showArchived)
                  openConversation(null)
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors',
                  showArchived ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-3',
                )}
              >
                {showArchived ? <ArrowLeft className="size-3.5" /> : <Archive className="size-3.5" />}
                {showArchived ? 'Back to conversations' : 'Archived'}
                <span className="ml-auto text-[11px] text-ink-3">{otherCount}</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-1.5">
            {loadingRooms ? (
              <p className="px-3 py-6 text-center text-xs text-ink-3">Loading conversations…</p>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={MessagesSquare}
                title={
                  query
                    ? 'Nothing matches that'
                    : showArchived
                      ? 'Nothing archived'
                      : 'No conversations yet'
                }
                description={
                  query
                    ? 'Try a different name.'
                    : showArchived
                      ? 'Threads you put away appear here, and come back the moment you need them.'
                      : 'Start a direct message, or sync the department rooms to bring everyone in at once.'
                }
                action={
                  !query ? (
                    <Button size="sm" onClick={() => setComposing(true)}>
                      <SquarePen className="size-3.5" />
                      New conversation
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((conversation) => (
                  <RoomRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === activeId}
                    onOpen={() => {
                      openConversation(conversation.id)
                      setReplyTo(null)
                      setDraft('')
                    }}
                    onArchive={() => void toggleArchive(conversation)}
                    onDeleteForMe={() => setConfirming({ room: conversation, act: 'delete-for-me' })}
                    onLeave={() => setConfirming({ room: conversation, act: 'leave' })}
                    onDelete={() => setConfirming({ room: conversation, act: 'delete' })}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* --------------------------------------------------------- thread */}
        <section className={cn('flex min-w-0 flex-1 flex-col', activeId === null && 'hidden md:flex')}>
          {!active ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={MessagesSquare}
                title="Pick a conversation"
                description="Choose a room on the left, or start a new one."
              />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="md:hidden"
                  onClick={() => openConversation(null)}
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="size-4" />
                </Button>

                {active.kind === 'direct' ? (
                  <Avatar name={active.name} size="sm" />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 ring-1 ring-line">
                    {roomGlyph(active) ?? <Users className="size-3.5 text-ink-3" />}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-ink">{active.name}</p>
                  <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-3">
                    {/* Presence, where it answers a question worth asking.
                        In a direct thread "are they there" decides whether you
                        wait for a reply or ring them; in a room of forty it is
                        just a green dot, so the member count stays. */}
                    {active.kind === 'direct' && onlineNow > 0 && (
                      <>
                        <span className="size-1.5 shrink-0 rounded-full bg-good" aria-hidden />
                        <span className="text-good">Active now</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    {active.kind === 'direct'
                      ? 'Direct message'
                      : `${active.memberCount} ${active.memberCount === 1 ? 'member' : 'members'}${
                          onlineNow > 0 ? ` · ${onlineNow} online` : ''
                        }${active.topic ? ` · ${active.topic}` : ''}`}
                  </p>
                </div>

                {active.muted && <Badge tone="neutral">Muted</Badge>}
                {active.kind === 'department' && <Badge tone="info">Department</Badge>}

                <Tooltip content="Search this conversation">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setFinding((f) => (f === null ? '' : null))
                      setHits(null)
                    }}
                    aria-label="Search this conversation"
                  >
                    <Search className="size-4" />
                  </Button>
                </Tooltip>

                <Tooltip content="Conversation details">
                  <Button variant="ghost" size="icon-sm" onClick={() => setShowDetails(true)} aria-label="Conversation details">
                    <Info className="size-4" />
                  </Button>
                </Tooltip>
              </header>

              {/* Finding something said weeks ago.
                  Scoped to this room rather than everything, because that is
                  how people remember it — "it was in the dispatch thread". */}
              {finding !== null && (
                <div className="border-b border-line bg-surface-2 px-3 py-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
                    <input
                      autoFocus
                      value={finding}
                      onChange={(e) => {
                        setFinding(e.target.value)
                        void runSearch(e.target.value)
                      }}
                      placeholder="Search in this conversation…"
                      aria-label="Search in this conversation"
                      className="h-8 w-full rounded-lg border border-line bg-surface pr-8 pl-8 text-[12px] text-ink outline-none focus:border-brand-400"
                    />
                    <button
                      onClick={() => {
                        setFinding(null)
                        setHits(null)
                      }}
                      className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink"
                      aria-label="Close search"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {hits !== null && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface">
                      {hits.length === 0 ? (
                        <p className="px-3 py-2 text-[12px] text-ink-3">Nothing matched.</p>
                      ) : (
                        hits.map((hit) => (
                          <div key={hit.id} className="border-b border-line px-3 py-2 last:border-0">
                            <p className="text-[11px] font-medium text-ink-2">
                              {hit.mine ? 'You' : hit.author}
                              {hit.at && (
                                <span className="ml-1.5 font-normal text-ink-3">
                                  {new Date(hit.at).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })}
                                </span>
                              )}
                            </p>
                            <p className="line-clamp-2 text-[12px] text-ink">{hit.body}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* The one message held above the scroll.
                  Every group thread ends up with an address or a cut-off time
                  that matters more than the rest and scrolls away within the
                  hour. */}
              {active.pinned && (
                <div className="flex items-start gap-2 border-b border-line bg-brand-50/60 px-3 py-2 dark:bg-brand-950/40">
                  <Pin className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-medium tracking-wide text-brand-700 uppercase dark:text-brand-300">
                      Pinned{active.pinned.author ? ` · ${active.pinned.author}` : ''}
                    </span>
                    <span className="line-clamp-2 text-[12px] text-ink">{active.pinned.body}</span>
                  </span>
                  <button
                    onClick={() => void pin(null)}
                    className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink"
                    aria-label="Remove pin"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              {/* ------------------------------------------------- messages */}
              <div ref={scrollerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-2 py-3">
                {hasMore && (
                  <div className="mb-2 flex justify-center">
                    <Button variant="ghost" size="sm" onClick={() => void readOlder()} disabled={loadingOlder}>
                      <ChevronUp className="size-3.5" />
                      {loadingOlder ? 'Loading…' : 'Load older messages'}
                    </Button>
                  </div>
                )}

                {loadingThread ? (
                  <p className="py-8 text-center text-xs text-ink-3">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <EmptyState
                    icon={MessagesSquare}
                    title="No messages yet"
                    description="Say something to get this conversation started."
                  />
                ) : (
                  <ul>
                    {messages.map((message, i) => {
                      const previous = messages[i - 1]
                      const newDay = dayLabel(message.at) !== dayLabel(previous?.at ?? null)
                      const grouped =
                        !newDay &&
                        !message.isSystem &&
                        !!previous &&
                        !previous.isSystem &&
                        previous.authorId === message.authorId

                      return (
                        <React.Fragment key={message.id}>
                          {newDay && (
                            <li className="my-3 flex items-center gap-2 px-2">
                              <span className="h-px flex-1 bg-line" />
                              <span className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">
                                {dayLabel(message.at)}
                              </span>
                              <span className="h-px flex-1 bg-line" />
                            </li>
                          )}
                          <MessageBubble
                            message={message}
                            grouped={grouped}
                            showAuthor={showAuthors}
                            onReply={setReplyTo}
                            onReact={(m, emoji) => void react(m, emoji)}
                            onEdit={edit}
                            onDelete={(m, scope) => void remove(m, scope)}
                            onPin={(m) => void pin(m.id)}
                        onForward={(m) => setForwarding(m)}
                        onJumpTo={jumpTo}
                            onPollChanged={applyPoll}
                          />
                        </React.Fragment>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Who has read it, and who is writing.
                  Both sit directly above the composer because that is where
                  the eye already is after sending. */}
              {(seenBy.length > 0 || typing.length > 0) && (
                <div className="flex min-h-5 items-center gap-2 px-3 pb-1 text-[11px] text-ink-3">
                  {typing.length > 0 ? (
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span className="flex gap-0.5" aria-hidden>
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="size-1 animate-bounce rounded-full bg-ink-3"
                            style={{ animationDelay: `${i * 120}ms` }}
                          />
                        ))}
                      </span>
                      {typing.length === 1
                        ? `${typing[0]} is typing…`
                        : typing.length === 2
                          ? `${typing[0]} and ${typing[1]} are typing…`
                          : `${typing.length} people are typing…`}
                    </span>
                  ) : (
                    <span className="truncate">
                      Seen by {seenBy.length <= 3 ? seenBy.join(', ') : `${seenBy.slice(0, 2).join(', ')} and ${seenBy.length - 2} others`}
                    </span>
                  )}
                </div>
              )}

              {/* ------------------------------------------------- composer */}
              <div className="border-t border-line p-2.5">
                {replyTo && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand-400 bg-surface-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-medium text-ink-2">
                        Replying to {replyTo.mine ? 'yourself' : replyTo.author}
                      </span>
                      <span className="line-clamp-1 text-[11px] text-ink-3">{replyTo.body}</span>
                    </span>
                    <button
                      onClick={() => setReplyTo(null)}
                      className="shrink-0 rounded p-0.5 text-ink-3 hover:text-ink"
                      aria-label="Cancel reply"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}

                {/* Files waiting to go with the next message. Shown as they
                    will arrive — a picture as a picture, anything else as a
                    chip — so nobody sends the wrong screenshot. */}
                {staged.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {staged.map((file, i) => (
                      <span key={`${file.name}-${i}`} className="relative">
                        {file.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt=""
                            className="size-14 rounded-lg border border-line object-cover"
                          />
                        ) : (
                          <span className="flex h-14 max-w-[10rem] items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5">
                            <Paperclip className="size-3.5 shrink-0 text-ink-3" />
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-medium text-ink">{file.name}</span>
                              <span className="block text-[10px] text-ink-3">
                                {Math.max(1, Math.round(file.size / 1024))} KB
                              </span>
                            </span>
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setStaged((f) => f.filter((_, j) => j !== i))}
                          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-critical text-white"
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const picked = [...(e.target.files ?? [])]
                      e.target.value = ''
                      // Ten megabytes is the server's limit; catching it here
                      // saves a round trip and a confusing 422.
                      const tooBig = picked.filter((f) => f.size > 10 * 1024 * 1024)
                      if (tooBig.length) {
                        toast({
                          tone: 'error',
                          title: 'Too large to send',
                          description: `${tooBig[0]!.name} is over 10 MB.`,
                        })
                      }
                      setStaged((f) => [...f, ...picked.filter((x) => x.size <= 10 * 1024 * 1024)].slice(0, 10))
                    }}
                  />
                  <Tooltip content="Attach a photo or file">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => fileRef.current?.click()}
                      aria-label="Attach a photo or file"
                    >
                      <Paperclip className="size-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Create a poll">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPolling(true)}
                      aria-label="Create a poll"
                    >
                      <BarChart3 className="size-4" />
                    </Button>
                  </Tooltip>
                  <textarea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value)
                      noteTyping()
                    }}
                    onKeyDown={(e) => {
                      // Enter sends; Shift+Enter is a new line. The other way
                      // round is technically defensible and universally hated.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    placeholder={`Message ${active.name}…`}
                    aria-label="Write a message"
                    className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-400"
                  />
                  <Button
                    onClick={() => void send()}
                    disabled={(!draft.trim() && !staged.length) || sending}
                    size="icon"
                    aria-label="Send message"
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Forwarding.
          A copy attributed to whoever forwarded it, not a move — a message
          appearing in a thread under the name of somebody who is not in that
          thread is both confusing and a small leak. */}
      <Modal
        open={forwarding !== null}
        onClose={() => setForwarding(null)}
        size="sm"
        title="Forward to…"
        description={forwarding?.body ? `“${forwarding.body.slice(0, 90)}”` : 'Sends the attachment on.'}
        footer={
          <Button variant="ghost" onClick={() => setForwarding(null)}>
            Cancel
          </Button>
        }
      >
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {conversations
            .filter((c) => c.id !== activeId)
            .map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  onClick={async () => {
                    if (!forwarding) return
                    try {
                      await forwardMessage(forwarding.id, room.id)
                      setForwarding(null)
                      void refreshRooms(true)
                      toast({ tone: 'success', title: `Forwarded to ${room.name}` })
                    } catch (err) {
                      toast({ tone: 'error', title: 'Could not forward', description: (err as Error).message })
                    }
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  {room.kind === 'direct' ? (
                    <Avatar name={room.name} size="sm" />
                  ) : (
                    <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 ring-1 ring-line">
                      {roomGlyph(room) ?? <Users className="size-3.5 text-ink-3" />}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{room.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {room.kind === 'direct' ? 'Direct message' : `${room.memberCount} members`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          {conversations.filter((c) => c.id !== activeId).length === 0 && (
            <li className="px-2.5 py-3 text-[12px] text-ink-3">No other conversation to forward to yet.</li>
          )}
        </ul>
      </Modal>

      <NewConversation
        open={composing}
        onClose={() => setComposing(false)}
        onOpened={(conversation) => {
          void refreshRooms(true)
          openConversation(conversation.id)
        }}
      />

      {active && (
        <NewPoll
          open={polling}
          conversationId={active.id}
          conversationName={active.name}
          onClose={() => setPolling(false)}
          onCreated={(message) => {
            applyMessage(message, true)
            atBottomRef.current = true
          }}
        />
      )}

      {active && (
        <RoomDetails
          conversation={active}
          open={showDetails}
          onClose={() => setShowDetails(false)}
          onChanged={applyRoomChange}
          onLeft={() => {
            openConversation(null)
            void refreshRooms(true)
          }}
        />
      )}

      {/* Leaving and deleting are the ones that touch other people (or, for
          delete-for-me, are worth a pause before the thread vanishes from
          view) — all three ask first, and the question says exactly what
          happens. */}
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          confirming?.act === 'leave'
            ? `Leave ${confirming.room.name}?`
            : `Delete ${confirming?.room.name ?? 'this conversation'}?`
        }
        description={
          confirming?.act === 'leave'
            ? 'You will stop receiving messages from it, and the group is told you left. You can be added back.'
            : confirming?.act === 'delete-for-me'
              ? 'It disappears from your list. Nothing changes for anybody else, and it comes back on its own the moment somebody writes in it again.'
              : 'It disappears for everybody in it, not just you. The messages are kept for the audit trail but nobody will see the room again.'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={acting}>
              Cancel
            </Button>
            <Button
              variant={confirming?.act === 'leave' ? 'primary' : 'danger'}
              onClick={() => void confirmAct()}
              disabled={acting}
              loading={acting}
            >
              {confirming?.act === 'leave'
                ? 'Leave the group'
                : confirming?.act === 'delete-for-me'
                  ? 'Delete conversation'
                  : 'Delete for everybody'}
            </Button>
          </>
        }
      >
        {confirming?.act === 'delete' && (
          <p className="text-[12px] leading-relaxed text-ink-2">
            {confirming.room.memberCount} {confirming.room.memberCount === 1 ? 'person is' : 'people are'} in
            this group. If you only want it off your own list, archive it instead.
          </p>
        )}
      </Modal>
    </>
  )
}

export default Messages
