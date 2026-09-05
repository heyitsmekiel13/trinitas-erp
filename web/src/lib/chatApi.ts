import { API_BASE_URL } from './api'
import { ApiError } from './adminApi'
import { useAuth } from '@/app/auth'

/**
 * Typed client for workspace messaging.
 *
 * Kept apart from `adminApi` because chat is the one part of the ERP that
 * polls: these calls run every few seconds while a thread is open, and they
 * must stay silent — a dropped poll is a non-event, not something to shout
 * about in a toast. `request` therefore surfaces real failures and nothing
 * else, and the polling hook swallows what it gets.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      // FormData sets its own content type, boundary and all. Overriding it
      // with application/json makes the upload arrive as an unparsable blob.
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    credentials: 'include',
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      payload.message ?? `Request failed (${response.status}).`,
      response.status,
      payload.errors ?? {},
    )
  }

  return (payload.data ?? payload) as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const upload = <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form })
const del = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) })

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export type ChatKind = 'direct' | 'group' | 'department'

export type ChatReaction = {
  emoji: string
  count: number
  /** Whether the signed-in reader is one of them. */
  mine: boolean
  by: string[]
}

export type PollOption = {
  id: number
  label: string
  votes: number
  /** Share of participants, not of ticks — see the note on `totalVoters`. */
  share: number
  /** Whether the signed-in reader backed this option. */
  mine: boolean
  /** Empty on an anonymous poll — the API never sends the names. */
  voters: string[]
}

export type ChatPoll = {
  id: number
  messageId: number
  question: string
  allowMultiple: boolean
  isAnonymous: boolean
  closed: boolean
  closesAt: string | null
  closedAt: string | null
  author: string | null
  authorId: number | null
  mine: boolean
  /**
   * How many people took part — not how many boxes were ticked, which on a
   * multiple-choice poll is a bigger and far less useful number.
   */
  totalVoters: number
  hasVoted: boolean
  options: PollOption[]
}

export type ChatAttachment = {
  id: number
  /** `image` renders inline; `file` is a chip you download. */
  kind: 'image' | 'video' | 'audio' | 'file'
  /** API path, not a public URL — membership is re-checked on every fetch. */
  url: string
  name: string
  mime: string | null
  size: string
  /** Set for images so the bubble can hold its shape before the file lands. */
  width: number | null
  height: number | null
}

export type ChatMessage = {
  id: number
  conversationId: number
  authorId: number | null
  author: string
  mine: boolean
  /** Null when the message was withdrawn — the body never leaves the server. */
  body: string | null
  withdrawn: boolean
  isSystem: boolean
  editedAt: string | null
  at: string | null
  canWithdraw: boolean
  canEdit: boolean
  replyTo: { id: number; author: string | null; body: string | null; withdrawn: boolean } | null
  attachments: ChatAttachment[]
  reactions: ChatReaction[]
  /** Set when this line carries a poll. Null on an ordinary message. */
  poll: ChatPoll | null
}

export type ChatConversation = {
  id: number
  kind: ChatKind
  /** Already resolved for the reader — a direct thread is the other person. */
  name: string
  topic: string | null
  icon: string | null
  muted: boolean
  role: 'member' | 'admin'
  unread: number
  memberCount: number
  members: { id: number; name: string; status: string }[]
  lastMessage: {
    id: number
    body: string | null
    withdrawn: boolean
    isSystem: boolean
    author: string | null
    authorId: number | null
    at: string | null
  } | null
  lastMessageAt: string | null
  /** The one message held at the top of the room. Null when nothing is pinned. */
  pinned: { id: number; body: string | null; author: string | null; at: string | null } | null
  /** Set when this reader has put the thread away. Per person, never shared. */
  archivedAt: string | null
  /** What this reader may do to it. Decided by the server, not guessed here. */
  canLeave: boolean
  canDelete: boolean
}

export type ChatMember = {
  id: number
  name: string
  role: 'member' | 'admin'
  /** True for the signed-in reader's own row — decides what Leave acts on. */
  mine: boolean
  muted: boolean
  status: string | null
  joinedAt: string | null
}

export type DirectoryEntry = {
  id: number
  name: string
  username: string | null
  department: string | null
  status: string
}

/* -------------------------------------------------------------------------- */
/* Rooms                                                                       */
/* -------------------------------------------------------------------------- */

export const listConversations = (archived = false) =>
  get<ChatConversation[]>(`chat/conversations${archived ? '?archived=1' : ''}`)

/**
 * Puts a conversation away, or brings it back.
 *
 * Per person. Archiving a thread you share with somebody takes it off your
 * list and leaves theirs exactly as it was — nothing is deleted, and nothing
 * is marked read.
 */
export const archiveConversation = (id: number, archived = true) =>
  post<{ id: number; archived: boolean; message: string }>(
    `chat/conversations/${id}/archive`,
    { archived },
  )

/** Leaves a group. Direct and department rooms refuse — archive those. */
export const leaveConversation = (id: number) =>
  post<{ id: number; message: string }>(`chat/conversations/${id}/leave`)

/** Deletes a group for everybody. Only its own admin may. */
export const deleteConversation = (id: number) =>
  del<{ id: number; message: string }>(`chat/conversations/${id}`)

export const listDirectory = () => get<DirectoryEntry[]>('chat/directory')

export const listMembers = (conversationId: number) =>
  get<ChatMember[]>(`chat/conversations/${conversationId}/members`)

/** Opens the one-to-one thread with somebody, reusing it if it already exists. */
export const openDirect = (userId: number) => post<ChatConversation>('chat/direct', { userId })

export const createGroup = (body: { name: string; memberIds: number[]; icon?: string; topic?: string }) =>
  post<ChatConversation>('chat/conversations', body)

export const updateConversation = (
  id: number,
  changes: { name?: string; icon?: string; topic?: string; muted?: boolean },
) => patch<ChatConversation>(`chat/conversations/${id}`, changes)

export const addMembers = (id: number, userIds: number[]) =>
  post<{ added: number; conversation: ChatConversation }>(`chat/conversations/${id}/members`, { userIds })

export const removeMember = (id: number, userId: number) =>
  del<{ removed: number; left: boolean }>(`chat/conversations/${id}/members/${userId}`)

/** Creates a room per department and brings membership up to date. Rerunnable. */
export const syncDepartmentRooms = () => post<{ created: number; added: number }>('chat/departments/sync')

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export const listMessages = (conversationId: number, before?: number, limit = 40) =>
  get<{ messages: ChatMessage[]; hasMore: boolean }>(
    `chat/conversations/${conversationId}/messages?${new URLSearchParams({
      limit: String(limit),
      ...(before ? { before: String(before) } : {}),
    })}`,
  )

/**
 * The poll loop. Returns what is new, refreshed tallies for any poll still
 * taking votes, and the badge count for the top bar.
 *
 * `polls` is keyed by the id of the message carrying each poll.
 */
export const fetchUpdates = (conversationId: number, after: number) =>
  get<{
    messages: ChatMessage[]
    polls: Record<string, ChatPoll>
    unreadTotal: number
    /** Names, excluding you. Empty most of the time. */
    typing: string[]
    /** Who has read as far as the newest message. */
    seenBy: string[]
    present: { name: string; online: boolean }[]
  }>(`chat/conversations/${conversationId}/updates?after=${after}`)

export const sendMessage = (conversationId: number, body: string, replyToId?: number) =>
  post<ChatMessage>(`chat/conversations/${conversationId}/messages`, {
    body,
    ...(replyToId ? { replyToId } : {}),
  })

export const editMessage = (messageId: number, body: string) =>
  patch<ChatMessage>(`chat/messages/${messageId}`, { body })

/**
 * Deletes a message.
 *
 * `me` hides it from the caller alone; `everyone` withdraws it, which only the
 * author may do and only inside the server's withdraw window.
 */
export const deleteMessage = (messageId: number, scope: 'me' | 'everyone') =>
  del<{ id: number; scope: string }>(`chat/messages/${messageId}`, { scope })

/** Sets, replaces or clears the caller's reaction. Null clears it. */
export const reactToMessage = (messageId: number, emoji: string | null) =>
  post<ChatMessage>(`chat/messages/${messageId}/react`, { emoji })

export const markConversationRead = (conversationId: number, messageId?: number) =>
  post<{ unreadTotal: number }>(`chat/conversations/${conversationId}/read`, messageId ? { messageId } : {})

/**
 * Sends a message carrying files.
 *
 * The body is optional — "here you go" with three photos is a complete
 * message, and requiring a caption just gets a full stop typed into the box.
 */
export const sendAttachments = (
  conversationId: number,
  files: File[],
  body?: string,
  replyToId?: number,
) => {
  const form = new FormData()
  files.forEach((file) => form.append('files[]', file))
  if (body?.trim()) form.append('body', body.trim())
  if (replyToId) form.append('replyToId', String(replyToId))

  return upload<ChatMessage>(`chat/conversations/${conversationId}/attachments`, form)
}

/**
 * The URL for an attachment.
 *
 * The API already returns a signed absolute URL, so this passes it straight
 * through; the relative branch is only there for a payload from an older
 * server that has not been redeployed yet.
 */
export const attachmentSrc = (path: string) =>
  /^https?:\/\//i.test(path) ? path : `${API_BASE_URL}/${path}`

/**
 * Says "still typing" and gets back who else is.
 *
 * Deliberately its own route rather than riding the updates poll: it fires on
 * a keystroke and must not drag the message payload along behind it.
 */
export const pingTyping = (conversationId: number) =>
  post<{ typing: string[] }>(`chat/conversations/${conversationId}/typing`)

/** Pins one message to the top of the room. Pass null to clear it. */
export const pinMessage = (conversationId: number, messageId: number | null) =>
  post<ChatConversation>(`chat/conversations/${conversationId}/pin`, { messageId })

/** Copies a message into another room, attributed to whoever forwarded it. */
export const forwardMessage = (messageId: number, conversationId: number) =>
  post<ChatMessage>(`chat/messages/${messageId}/forward`, { conversationId })

/** Finds a message inside one conversation. */
export const searchMessages = (conversationId: number, q: string) =>
  get<ChatMessage[]>(`chat/conversations/${conversationId}/search?q=${encodeURIComponent(q)}`)

export const fetchUnreadTotal = () => get<{ unreadTotal: number }>('chat/unread')

/* -------------------------------------------------------------------------- */
/* Polls                                                                       */
/* -------------------------------------------------------------------------- */

/** Asks a question. Returns the carrier message, poll attached. */
export const createPoll = (
  conversationId: number,
  body: {
    question: string
    options: string[]
    allowMultiple?: boolean
    isAnonymous?: boolean
    closesAt?: string
  },
) => post<ChatMessage>(`chat/conversations/${conversationId}/polls`, body)

/** Casts a vote — or takes it back, by choosing an option already backed. */
export const votePoll = (pollId: number, optionId: number) =>
  post<ChatPoll>(`chat/polls/${pollId}/vote`, { optionId })

/** Ends a poll early, or reopens it. Author or group admin only. */
export const setPollClosed = (pollId: number, closed: boolean) =>
  patch<ChatPoll>(`chat/polls/${pollId}`, { closed })

export const getPoll = (pollId: number) => get<ChatPoll>(`chat/polls/${pollId}`)

/** Bounds enforced by the API; mirrored here so the form can say so first. */
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 10

/** The reactions offered by the picker, in the order Messenger shows them. */
export const REACTION_CHOICES = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const
