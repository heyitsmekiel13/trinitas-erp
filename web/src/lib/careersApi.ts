import { API_BASE_URL } from './api'
import { ApiError } from './adminApi'

/**
 * The careers site's client.
 *
 * Separate from `adminApi` for one reason that matters: nothing here sends a
 * bearer token. These calls are made by people who have no account and never
 * will, from a tab that has no session, and the moment this module starts
 * reaching into the auth store it becomes possible for a signed-in employee's
 * token to travel with a public request by accident.
 */

/** A row in the job list. */
export type JobSummary = {
  slug: string
  title: string
  department: string | null
  location: string | null
  employmentType: string
  workSetup: string
  experienceLevel: string
  summary: string | null
  openings: number
  postedOn: string | null
  postedDaysAgo: number | null
  closesOn: string | null
  salary: { min: number | null; max: number | null } | null
}

/** The same posting, opened. */
export type JobDetail = JobSummary & {
  responsibilities: string[]
  qualifications: string[]
  benefits: string[]
}

export type JobBoard = {
  jobs: JobSummary[]
  departments: string[]
  locations: string[]
  types: string[]
  setups: string[]
}

/** Everything the parser thought it read, none of it yet a fact. */
export type ResumeRead = {
  token: string
  status: 'Parsed' | 'Unreadable'
  method: string
  confidence: number
  fields: Partial<Record<ParsedField, string | number>>
  skills: string[]
  notes: string[]
  filename: string
}

export type ParsedField =
  | 'firstName' | 'middleName' | 'lastName' | 'fullName'
  | 'email' | 'phone'
  | 'addressLine' | 'city' | 'province' | 'postalCode'
  | 'birthdate' | 'gender' | 'civilStatus' | 'nationality'
  | 'educationLevel' | 'school' | 'course' | 'yearGraduated'
  | 'yearsExperience' | 'currentEmployer' | 'currentTitle'
  | 'linkedinUrl' | 'portfolioUrl'

export type ApplicationReceipt = {
  reference: string
  name: string
  role: string
  appliedOn: string | null
  resumeAttached: boolean
  updated: boolean
  message: string
}

export type ApplicationStatus = {
  reference: string
  name: string
  role: string | null
  appliedOn: string | null
  updatedOn: string | null
  status: string
  message: string
  closed: boolean
  resumeOnFile: boolean
  /** An offer, when one has been made. Answerable right here. */
  offer: {
    position: string | null
    salary: number | null
    startDate: string | null
    expiresOn: string | null
    notes: string | null
    response: 'Accepted' | 'Declined' | null
    expired: boolean
    awaitingAnswer: boolean
  } | null
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      // FormData sets its own boundary; setting the header by hand breaks it.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  })

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      payload.message ??
        (response.status === 429
          ? 'That is a lot of requests in a short time. Wait a minute and try again.'
          : `Something went wrong (${response.status}).`),
      response.status,
      payload.errors ?? {},
    )
  }

  return (payload.data ?? payload) as T
}

export function listJobs(filters: Record<string, string> = {}): Promise<JobBoard> {
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value.trim() !== ''),
  ).toString()

  return call<JobBoard>(`careers/jobs${query ? `?${query}` : ''}`)
}

export const getJob = (slug: string) => call<JobDetail>(`careers/jobs/${encodeURIComponent(slug)}`)

/**
 * Uploads a CV and gets back what it says.
 *
 * The file stays on the server under the returned token for a few hours, so
 * submitting the application quotes the token rather than sending the document
 * a second time — which on a phone is the difference between a form that works
 * on mobile data and one that does not.
 */
export function readResume(file: File): Promise<ResumeRead> {
  const body = new FormData()
  body.append('resume', file)

  return call<ResumeRead>('careers/resume/parse', { method: 'POST', body })
}

export const submitApplication = (values: Record<string, unknown>) =>
  call<ApplicationReceipt>('careers/apply', { method: 'POST', body: JSON.stringify(values) })

export const checkStatus = (reference: string, email: string) =>
  call<ApplicationStatus>('careers/status', {
    method: 'POST',
    body: JSON.stringify({ reference, email }),
  })

/**
 * Answering an offer.
 *
 * Guarded by the same pair as the status lookup — the reference code and the
 * email it was filed with — so the links in the offer email are not a
 * permanent forwardable key to somebody's salary.
 */
export const respondToOffer = (
  reference: string,
  email: string,
  decision: 'Accepted' | 'Declined',
  reason?: string,
) =>
  call<{ decision: string; message: string }>('careers/offer/respond', {
    method: 'POST',
    body: JSON.stringify({ reference, email, decision, ...(reason ? { reason } : {}) }),
  })
