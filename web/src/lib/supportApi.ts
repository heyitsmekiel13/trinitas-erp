import { API_BASE_URL } from './api'
import { useAuth } from '@/app/auth'
import { ApiError } from './adminApi'

/**
 * Support tickets.
 *
 * One set of calls for both sides. The API decides what each account may see —
 * an administrator gets every ticket, everybody else gets their own — so the
 * client does not carry a second copy of that rule, and `isAdmin` comes back
 * from the server rather than being worked out here.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    credentials: 'include',
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(payload.message ?? `Request failed (${response.status}).`, response.status, payload.errors ?? {})
  }

  return (payload.data ?? payload) as T
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export const TICKET_CATEGORIES = [
  'Access',
  'Payroll',
  'Attendance',
  'System fault',
  'Data correction',
  'Equipment',
  'Request',
  'Other',
] as const

export const TICKET_PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'] as const

export const TICKET_STATUSES = ['Open', 'In progress', 'Waiting on you', 'Resolved', 'Closed'] as const

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export type TicketFile = {
  id: number
  name: string
  url: string
  mimeType: string | null
  size: number
  isImage: boolean
  width: number | null
  height: number | null
  uploadedBy: string | null
}

export type TicketCard = {
  id: number
  reference: string
  subject: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  raisedBy: string | null
  raisedById: number
  raiserEmployeeNo: string | null
  assignedTo: string | null
  messageCount: number
  attachmentCount: number
  createdAt: string | null
  lastActivityAt: string | null
  idleHours: number
  isStale: boolean
  isOpen: boolean
}

export type TicketMessage = {
  id: number
  body: string
  author: string | null
  authorId: number | null
  internal: boolean
  fromStaff: boolean
  createdAt: string | null
  attachments: TicketFile[]
}

export type TicketDetail = {
  id: number
  reference: string
  subject: string
  body: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  raisedBy: string | null
  raisedById: number
  raiserEmployeeNo: string | null
  raiserDepartment: string | null
  raiserMobile: string | null
  raiserEmail: string | null
  assignedTo: string | null
  assignedToId: number | null
  resolution: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  closedAt: string | null
  satisfaction: number | null
  createdAt: string | null
  lastActivityAt: string | null
  idleHours: number
  isOpen: boolean
  canAdminister: boolean
  messages: TicketMessage[]
  attachments: TicketFile[]
}

export type TicketList = {
  isAdmin: boolean
  tickets: TicketCard[]
  counts: {
    open: number
    inProgress: number
    waiting: number
    resolved: number
    closed: number
    urgent: number
    stale: number
  }
}

/* -------------------------------------------------------------------------- */
/* Calls                                                                       */
/* -------------------------------------------------------------------------- */

export const getTickets = (params: { status?: string; openOnly?: boolean } = {}) => {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.openOnly) query.set('openOnly', '1')

  return get<TicketList>(`support/tickets${query.toString() ? `?${query}` : ''}`)
}

export const getTicket = (id: number) => get<TicketDetail>(`support/tickets/${id}`)

export const raiseTicket = (body: {
  subject: string
  body: string
  category?: string
  priority?: string
}) => post<{ id: number; reference: string }>('support/tickets', body)

export const updateTicket = (id: number, body: Record<string, unknown>) =>
  patch<{ id: number }>(`support/tickets/${id}`, body)

/** `internal` is ignored by the API for anybody who is not an administrator. */
export const replyToTicket = (id: number, body: string, internal = false) =>
  post<{ id: number }>(`support/tickets/${id}/replies`, { body, internal })

export const resolveTicket = (id: number, resolution: string) =>
  post<{ id: number }>(`support/tickets/${id}/resolve`, { resolution })

export const closeTicket = (id: number, satisfaction?: number) =>
  post<{ id: number }>(`support/tickets/${id}/close`, satisfaction ? { satisfaction } : {})

export const reopenTicket = (id: number) => post<{ id: number }>(`support/tickets/${id}/reopen`)

export function uploadTicketFiles(ticketId: number, files: File[], messageId?: number) {
  const form = new FormData()
  files.forEach((file) => form.append('files[]', file))
  if (messageId) form.append('message_id', String(messageId))

  return request<TicketFile[]>(`support/tickets/${ticketId}/attachments`, { method: 'POST', body: form })
}

/* -------------------------------------------------------------------------- */
/* My own delivery reviews                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A verdict the Process & Performance office has deliberately shared.
 *
 * Only ever about the signed-in account, and only ever a review — the
 * observation register stays inside the office, because findings only get
 * recorded honestly if they are not written under argument.
 */
export type MyReview = {
  id: number
  reference: string | null
  title: string | null
  project: string | null
  verdict: string
  timelinessDays: number | null
  qualityScore: number | null
  findings: string | null
  actionRequired: string | null
  followUpOn: string | null
  dueDate: string | null
  completedOn: string | null
  reviewer: string | null
  disclosedAt: string | null
  status: 'Awaiting response' | 'Accepted' | 'Disputed' | 'Closed'
  myResponse: string | null
  myRespondedAt: string | null
  officeReply: string | null
  officeRepliedAt: string | null
  canRespond: boolean
}

export const getMyReviews = () =>
  get<{ awaitingResponse: number; reviews: MyReview[] }>('me/compliance')

/** `accept: false` disputes it, and asks the office to answer. */
export const respondToReview = (id: number, response: string, accept: boolean) =>
  post<{ id: number; status: string }>(`me/compliance/${id}/respond`, { response, accept })
