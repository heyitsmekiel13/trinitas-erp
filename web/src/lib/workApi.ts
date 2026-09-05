import { API_BASE_URL } from './api'
import { useAuth } from '@/app/auth'
import { ApiError } from './adminApi'

/**
 * Typed client for Process & Performance.
 *
 * Separate from `adminApi` because the split is real: those endpoints are
 * super-admin configuration, these are the company's day-to-day work tool.
 * Keeping them apart means the biggest module in the app does not have to be
 * appended to a 1,700-line file, and a reader can see the whole work API at
 * once.
 *
 * The compliance calls sit at the bottom behind their own heading. They are
 * the ones that 404 for anybody outside the office — deliberately, so the
 * existence of an assessment is not disclosed to its subject.
 */

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token

  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      // FormData sets its own multipart boundary; naming a content type here
      // would corrupt every upload.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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

/**
 * Turns a stored path into something the browser can fetch.
 *
 * The API returns the path rather than a finished URL, because `Storage::url()`
 * builds against the server's own APP_URL — which is not the origin the React
 * app is served from in development, and need not be in production either. The
 * company logo resolves the same way, in `lib/company.ts`.
 */
export function fileUrl(path: string): string {
  return `${API_BASE_URL}/public-files/${path}`
}

/** Fills in `url` on an attachment the API sent as a bare path. */
function withUrl<T extends { path: string }>(file: T): T & { url: string } {
  return { ...file, url: fileUrl(file.path) }
}

const get = <T>(path: string) => request<T>(path)
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type Priority = 'Low' | 'Normal' | 'High' | 'Urgent'
export type ProjectStatus = 'Planning' | 'Active' | 'On hold' | 'Completed' | 'Cancelled'

export type DirectoryEntry = {
  id: number
  name: string
  username: string
  email: string | null
  department: string | null
  position: string | null
}

export type ProjectCard = {
  id: number
  code: string
  name: string
  description: string | null
  status: ProjectStatus
  priority: string
  visibility: string
  owner: string | null
  ownerId: number | null
  department: string | null
  startDate: string | null
  dueDate: string | null
  colour: string
  totalTasks: number
  doneTasks: number
  openTasks: number
  overdueTasks: number
  myTasks: number
  progress: number
  memberCount: number
  members: { id: number; name: string }[]
  archived: boolean
}

export type Section = {
  id: number
  name: string
  colour: string | null
  position: number
  wipLimit: number | null
  isDone: boolean
  isDefault: boolean
}

export type ProjectLabel = { id: number; name: string; colour: string }

export type CustomFieldType = 'text' | 'number' | 'date' | 'select'

export type CustomFieldDef = {
  key: string
  label: string
  type: CustomFieldType
  options?: string[] | null
}

export type ProjectDetail = {
  id: number
  code: string
  name: string
  description: string | null
  status: ProjectStatus
  priority: string
  visibility: string
  ownerId: number | null
  owner: string | null
  departmentId: number | null
  department: string | null
  startDate: string | null
  dueDate: string | null
  slaDays: number
  colour: string
  archived: boolean
  customFieldDefs: CustomFieldDef[]
  sections: Section[]
  labels: ProjectLabel[]
  members: { id: number; name: string; username: string; role: string }[]
  canEvaluate: boolean
}

export type TaskCard = {
  id: number
  reference: string
  title: string
  priority: Priority
  projectId: number
  project: string | null
  projectColour: string | null
  sectionId: number | null
  section: string | null
  assigneeId: number | null
  assignee: string | null
  startDate: string | null
  dueDate: string | null
  isDone: boolean
  daysLate: number | null
  progress: number
  estimateHours: number | null
  subtaskCount: number
  subtasksDone: number
  commentCount: number
  attachmentCount: number
  deadlineMoves: number
  labels: ProjectLabel[]
}

export type TaskFile = {
  id: number
  name: string
  /** Path inside the public disk, e.g. `tasks/12/abc.png`. */
  path: string
  /** Absolute URL, composed against the API host by `withUrl` below. */
  url: string
  mimeType: string | null
  size: number
  isImage: boolean
  width: number | null
  height: number | null
  uploadedBy: string | null
  uploadedAt: string | null
}

export type TaskDetail = {
  id: number
  reference: string
  title: string
  description: string | null
  priority: Priority
  projectId: number
  project: string | null
  projectColour: string | null
  sectionId: number | null
  section: string | null
  isDone: boolean
  parentId: number | null
  assigneeId: number | null
  assignee: string | null
  reporter: string | null
  startDate: string | null
  dueDate: string | null
  completedAt: string | null
  daysLate: number | null
  estimateHours: number | null
  loggedHours: number
  progress: number
  customFields: Record<string, string | number | null>
  projectFieldDefs: CustomFieldDef[]
  labels: ProjectLabel[]
  watchers: { id: number; name: string }[]
  subtasks: {
    id: number
    reference: string
    title: string
    isDone: boolean
    assignee: string | null
    assigneeId: number | null
    dueDate: string | null
  }[]
  comments: {
    id: number
    body: string
    author: string | null
    authorId: number | null
    mentions: number[]
    createdAt: string | null
    editedAt: string | null
    attachments: TaskFile[]
  }[]
  attachments: TaskFile[]
  dependencies: { id: number; type: string; taskId: number; reference: string | null; title: string | null; isDone: boolean }[]
  blocking: { taskId: number; reference: string | null; title: string | null; isDone: boolean }[]
  activity: { id: number; action: string; field: string | null; from: string | null; to: string | null; user: string | null; at: string | null }[]
  deadline: { originalDue: string | null; moves: number; reassignments: number }
}

export type BoardPayload = {
  sections: (Section & { tasks: TaskCard[] })[]
  unsectioned: TaskCard[]
}

export type MyTasks = {
  buckets: Record<'overdue' | 'today' | 'week' | 'later' | 'undated' | 'done', TaskCard[]>
  counts: { overdue: number; today: number; week: number; open: number }
}

/* -------------------------------------------------------------------------- */
/* Projects and tasks — everybody                                              */
/* -------------------------------------------------------------------------- */

export const getDirectory = () => get<DirectoryEntry[]>('process/directory')

/**
 * The project list.
 *
 * `archived` swaps the list rather than extending it — mixing eleven live
 * projects with three retired ones makes the live list worse, and the only
 * reason to look at an archived project is to restore it.
 */
export const getProjects = (archived = false) =>
  get<ProjectCard[]>(`process/projects${archived ? '?archived=1' : ''}`)
export const getProject = (id: number) => get<ProjectDetail>(`process/projects/${id}`)
export const createProject = (body: Record<string, unknown>) =>
  post<{ id: number; code: string }>('process/projects', body)
export const updateProject = (id: number, body: Record<string, unknown>) =>
  patch<{ id: number }>(`process/projects/${id}`, body)
export const deleteProject = (id: number) => del<{ deleted: boolean }>(`process/projects/${id}`)

export const getBoard = (projectId: number) => get<BoardPayload>(`process/projects/${projectId}/board`)

/** Every open-plus-recent task the requester can see, across every project — filtered client-side from here. */
export const getAllTasks = () => get<TaskCard[]>('tasks')

export const createSection = (projectId: number, body: Record<string, unknown>) =>
  post<{ id: number }>(`process/projects/${projectId}/sections`, body)
export const updateSection = (projectId: number, sectionId: number, body: Record<string, unknown>) =>
  patch<{ id: number }>(`process/projects/${projectId}/sections/${sectionId}`, body)
export const deleteSection = (projectId: number, sectionId: number) =>
  del<{ deleted: boolean }>(`process/projects/${projectId}/sections/${sectionId}`)

export const syncMembers = (projectId: number, members: { userId: number; role?: string }[]) =>
  post<{ count: number }>(`process/projects/${projectId}/members`, { members })

export const createLabel = (projectId: number, body: Record<string, unknown>) =>
  post<ProjectLabel>(`process/projects/${projectId}/labels`, body)
export const deleteLabel = (projectId: number, labelId: number) =>
  del<{ deleted: boolean }>(`process/projects/${projectId}/labels/${labelId}`)

export const createTask = (projectId: number, body: Record<string, unknown>) =>
  post<{ id: number; reference: string }>(`process/projects/${projectId}/tasks`, body)

export const getMyTasks = () => get<MyTasks>('tasks/mine')
/**
 * One task, with every attachment URL resolved.
 *
 * Done here rather than in the components, so no screen has to know that the
 * API sends paths — and so a new place that renders an attachment cannot
 * forget to.
 */
export const getTask = (id: number): Promise<TaskDetail> =>
  get<TaskDetail>(`tasks/${id}`).then((task) => ({
    ...task,
    attachments: task.attachments.map(withUrl),
    comments: task.comments.map((comment) => ({ ...comment, attachments: comment.attachments.map(withUrl) })),
  }))
export const updateTask = (id: number, body: Record<string, unknown>) => patch<{ id: number }>(`tasks/${id}`, body)
export const deleteTask = (id: number) => del<{ deleted: boolean }>(`tasks/${id}`)
export const moveTask = (id: number, sectionId: number, position?: number) =>
  post<{ id: number }>(`tasks/${id}/move`, { section_id: sectionId, position })
export const completeTask = (id: number) => post<{ id: number }>(`tasks/${id}/complete`)
export const reopenTask = (id: number) => post<{ id: number }>(`tasks/${id}/reopen`)
export const commentOnTask = (id: number, body: string, mentions: number[] = []) =>
  post<{ id: number }>(`tasks/${id}/comments`, { body, mentions })
export const addDependency = (id: number, dependsOnId: number, type = 'blocks') =>
  post<{ id: number }>(`tasks/${id}/dependencies`, { depends_on_id: dependsOnId, type })
export const removeDependency = (id: number, dependencyId: number) =>
  del<{ deleted: boolean }>(`tasks/${id}/dependencies/${dependencyId}`)

/** Sends today's reminder now. Safe to press twice — the API dedupes per day. */
export const nudgeTask = (id: number) => post<{ sent: number; message: string }>(`tasks/${id}/nudge`)

/**
 * Uploads files against a task.
 *
 * Takes the browser's own File objects so a drag-and-drop, a paste and a file
 * picker are all the same call.
 */
export function uploadTaskFiles(taskId: number, files: File[], commentId?: number) {
  const form = new FormData()
  files.forEach((file) => form.append('files[]', file))
  if (commentId) form.append('comment_id', String(commentId))

  return request<TaskFile[]>(`tasks/${taskId}/attachments`, { method: 'POST', body: form }).then((files) =>
    files.map(withUrl),
  )
}

export const deleteTaskFile = (taskId: number, attachmentId: number) =>
  del<{ deleted: boolean }>(`tasks/${taskId}/attachments/${attachmentId}`)

/* -------------------------------------------------------------------------- */
/* Compliance — the Process & Performance office only                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything below 404s for anybody outside the office.
 *
 * The screens that call these are already hidden from other accounts, so a
 * 404 here means either a genuinely missing record or somebody reaching an
 * endpoint they were never offered — both are handled the same way.
 */

export type ComplianceFlagRow = {
  id: number
  kind: string
  kindLabel: string
  severity: 'Low' | 'Medium' | 'High' | 'Critical'
  summary: string
  detail: Record<string, unknown> | null
  observedOn: string | null
  acknowledged: boolean
  resolved: boolean
  taskId: number | null
  taskRef: string | null
  taskTitle: string | null
  project: string | null
  subject: string | null
  subjectId: number | null
}

export type ComplianceDashboard = {
  generatedAt: string
  kpis: {
    openTasks: number
    overdue: number
    dueToday: number
    dueThisWeek: number
    undated: number
    completedThisMonth: number
    onTimeThisMonth: number
    onTimeRate: number | null
    openFlags: number
    criticalFlags: number
  }
  flagsByKind: { name: string; value: number }[]
  flagsBySeverity: { name: string; value: number }[]
  projects: {
    id: number
    code: string
    name: string
    owner: string | null
    status: string
    dueDate: string | null
    totalTasks: number
    openTasks: number
    doneTasks: number
    overdueTasks: number
    progress: number
  }[]
  ageing: { name: string; value: number }[]
  worstOffenders: { name: string; value: number }[]
  coverage: Coverage
  onTimeTrend: { name: string; onTime: number; late: number; value: number | null }[]
}

export type EvaluationQueueRow = {
  taskId: number
  reference: string
  title: string
  project: string | null
  subject: string | null
  subjectId: number | null
  dueDate: string | null
  completedOn: string | null
  daysLate: number | null
  deadlineMoves: number
  reassignments: number
  originalDue: string | null
}

export type ReviewRow = {
  id: number
  taskId: number | null
  reference: string | null
  title: string | null
  project: string | null
  subject: string | null
  reviewer: string | null
  verdict: string
  timelinessDays: number | null
  qualityScore: number | null
  findings: string | null
  actionRequired: string | null
  followUpOn: string | null
  reviewedAt: string | null
  disclosed: boolean
  disclosedAt: string | null
  responseStatus: 'Internal' | 'Awaiting response' | 'Accepted' | 'Disputed' | 'Closed'
  subjectResponse: string | null
  subjectRespondedAt: string | null
  officeReply: string | null
  escalatedCaseId: number | null
  escalatedCaseNo: string | null
}

export type ScoreRow = {
  userId: number
  name: string | null
  department: string | null
  tasksDue: number
  completed: number
  onTime: number
  late: number
  stillOverdue: number
  deadlinesMoved: number
  onTimeRate: number | null
  averageDaysLate: number | null
}

export const getComplianceDashboard = () => get<ComplianceDashboard>('process/compliance/dashboard')

export const getComplianceFlags = (params: { kind?: string; severity?: string; includeResolved?: boolean } = {}) => {
  const query = new URLSearchParams()
  if (params.kind) query.set('kind', params.kind)
  if (params.severity) query.set('severity', params.severity)
  query.set('includeResolved', params.includeResolved ? '1' : '0')

  return get<ComplianceFlagRow[]>(`process/compliance/flags?${query}`)
}

export const acknowledgeFlag = (id: number) => post<{ id: number }>(`process/compliance/flags/${id}/acknowledge`)
export const resolveFlag = (id: number) => post<{ id: number }>(`process/compliance/flags/${id}/resolve`)
export const runComplianceScan = () => post<Record<string, number>>('process/compliance/scan')

export const getEvaluationQueue = () => get<EvaluationQueueRow[]>('process/compliance/queue')
export const getReviews = () => get<ReviewRow[]>('process/compliance/reviews')
export const recordEvaluation = (body: Record<string, unknown>) =>
  post<{ id: number }>('process/compliance/reviews', body)

export const getScores = (period?: string) =>
  get<{ period: string; rows: ScoreRow[] }>(`process/compliance/scores${period ? `?period=${period}` : ''}`)

/* -------------------------------------------------------------------------- */
/* Process metrics — office only                                               */
/* -------------------------------------------------------------------------- */

/** Coverage: how much of the workforce the register can actually see. */
export type Coverage = {
  headcount: number
  covered: number
  overall: number | null
  byDepartment: { name: string; headcount: number; covered: number; value: number }[]
}

export type Durations = {
  count: number
  median: number | null
  p85: number | null
  p95: number | null
  fastest: number | null
  slowest: number | null
  distribution?: { name: string; value: number }[]
}

export type ProcessMetrics = {
  window: number
  cycleTime: Durations
  leadTime: Durations
  throughput: { name: string; value: number }[]
  onTimeTrend: { name: string; onTime: number; late: number; value: number | null }[]
  flow: { sections: string[]; series: Record<string, unknown>[] }
  coverage: Coverage
}

export const getProcessMetrics = (days = 90) =>
  get<ProcessMetrics>(`process/compliance/metrics?days=${days}`)

/**
 * Shares a verdict with the person it is about.
 *
 * One-way and deliberate. Most reviews never leave the office; this is the act
 * that turns an internal finding into something a person can read and answer,
 * and it should feel like a decision because it is one.
 */
export const discloseReview = (id: number, note?: string) =>
  post<{ id: number; status: string }>(`process/compliance/reviews/${id}/disclose`, { note })

/** Answers a dispute. `verdict` corrects the finding where the reply was right. */
export const replyToReview = (id: number, body: { reply: string; outcome: 'Accepted' | 'Closed'; verdict?: string }) =>
  post<{ id: number; status: string }>(`process/compliance/reviews/${id}/reply`, body)

/**
 * Hands the matter to Employee Relations.
 *
 * Refused by the API unless the verdict has been disclosed first — raising a
 * disciplinary case off a finding somebody has never seen is the shortcut the
 * whole disclosure mechanism exists to prevent.
 */
export const escalateReview = (id: number, details: string) =>
  post<{ caseId: number; caseNo: string; message: string }>(
    `process/compliance/reviews/${id}/escalate`,
    { details },
  )

/* -------------------------------------------------------------------------- */
/* Recurrence, templates, time, capacity and goals                             */
/* -------------------------------------------------------------------------- */

export const FREQUENCIES = ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export type Recurrence = {
  id: number
  title: string
  description: string | null
  priority: Priority
  assignee: string | null
  assigneeId: number | null
  section: string | null
  sectionId: number | null
  frequency: Frequency
  weekday: number | null
  dayOfMonth: number | null
  dueInDays: number
  startsOn: string | null
  endsOn: string | null
  nextRunOn: string | null
  timesRaised: number
  isActive: boolean
  /** Plain English — a rule nobody can read is a rule nobody trusts. */
  describes: string
  upcoming: { raisedOn: string; dueOn: string }[]
}

export type Template = {
  id: number
  name: string
  description: string | null
  colour: string
  slaDays: number
  sectionCount: number
  taskCount: number
  labelCount: number
  timesUsed: number
  createdBy: string | null
}

export type TimeEntry = {
  id: number
  user: string | null
  userId: number
  startedAt: string | null
  stoppedAt: string | null
  minutes: number
  hours: number
  note: string | null
  manual: boolean
  running: boolean
}

export type RunningTimer = {
  id: number
  taskId: number
  reference: string | null
  title: string | null
  startedAt: string
  minutes: number
} | null

export type CapacityRow = {
  userId: number
  name: string
  department: string | null
  availableHours: number
  committedHours: number
  leaveDays: number
  openTasks: number
  unestimated: number
  loadPct: number | null
}

export type Goal = {
  id: number
  name: string
  description: string | null
  owner: string | null
  ownerId: number | null
  department: string | null
  period: string
  status: 'Draft' | 'Active' | 'Achieved' | 'Missed' | 'Abandoned'
  targetValue: number | null
  currentValue: number
  unit: string | null
  dueOn: string | null
  progress: number
  /** Which of the three sources the percentage came from. */
  progressSource: string
  projects: { id: number; code: string; name: string; colour: string; status: string }[]
}

export const getRecurrences = (projectId: number) =>
  get<Recurrence[]>(`process/projects/${projectId}/recurrences`)
export const createRecurrence = (projectId: number, body: Record<string, unknown>) =>
  post<{ id: number; describes: string }>(`process/projects/${projectId}/recurrences`, body)
export const updateRecurrence = (id: number, body: Record<string, unknown>) =>
  patch<{ id: number }>(`process/recurrences/${id}`, body)
export const deleteRecurrence = (id: number) => del<{ deleted: boolean }>(`process/recurrences/${id}`)
export const runRecurrences = () =>
  post<{ raised: number; skipped: number; closed: number }>('process/recurrences/run')

export type SearchResults = {
  tasks: { id: number; reference: string; title: string; project: string | null; projectColour: string | null }[]
  projects: { id: number; code: string; name: string; colour: string }[]
}

export const searchProcess = (q: string) => get<SearchResults>(`process/search?q=${encodeURIComponent(q)}`)

export const getTemplates = () => get<Template[]>('process/templates')
export const saveAsTemplate = (projectId: number, body: Record<string, unknown>) =>
  post<{ id: number }>(`process/projects/${projectId}/template`, body)
export const createFromTemplate = (templateId: number, body: Record<string, unknown>) =>
  post<{ id: number; code: string }>(`process/templates/${templateId}/create`, body)
export const deleteTemplate = (id: number) => del<{ deleted: boolean }>(`process/templates/${id}`)

export const getTimeEntries = (taskId: number) =>
  get<{ entries: TimeEntry[]; estimateHours: number | null; loggedHours: number }>(`tasks/${taskId}/time`)
export const startTimer = (taskId: number, note?: string) =>
  post<{ id: number; startedAt: string }>(`tasks/${taskId}/timer/start`, { note })
export const stopTimer = () => post<{ id?: number; minutes?: number; message?: string }>('tasks/timer/stop')
export const getRunningTimer = () => get<RunningTimer>('tasks/timer/current')
export const logTime = (taskId: number, minutes: number, note?: string, on?: string) =>
  post<{ id: number }>(`tasks/${taskId}/time`, { minutes, note, on })
export const deleteTimeEntry = (id: number) => del<{ deleted: boolean }>(`process/time-entries/${id}`)

export const getCapacity = (days = 14) =>
  get<{ days: number; hoursPerDay: number; workingDays: number; people: CapacityRow[] }>(
    `process/capacity?days=${days}`,
  )

export const getGoals = (period?: string) =>
  get<Goal[]>(`process/goals${period ? `?period=${period}` : ''}`)
export const createGoal = (body: Record<string, unknown>) => post<{ id: number }>('process/goals', body)
export const updateGoal = (id: number, body: Record<string, unknown>) => patch<{ id: number }>(`process/goals/${id}`, body)
export const deleteGoal = (id: number) => del<{ deleted: boolean }>(`process/goals/${id}`)
