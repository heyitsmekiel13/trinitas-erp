import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, BadgeCheck, Banknote, Briefcase, Building2, CheckCircle2, Clock, Copy, MapPin,
  Search, Share2, Sparkles, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCompany } from '@/lib/company'
import { liveApi } from '@/lib/adminApi'
import {
  checkStatus, getJob, listJobs, respondToOffer,
  type ApplicationReceipt, type ApplicationStatus, type JobBoard, type JobDetail, type JobSummary,
} from '@/lib/careersApi'
import { Badge, Button, Field, Input, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { ApplyForm } from './ApplyForm'
import { CareersLetterhead, postedLabel, salaryBand } from './shared'

/**
 * The careers site.
 *
 * An in-house job board, built to work the way the ones candidates already use
 * work — a list on the left, the role open beside it, and an apply button that
 * does not send anybody to a login screen. Everything here is reachable
 * without an account, because a jobseeker will not make one to apply and every
 * company that asks them to loses most of them at that step.
 *
 * It is not a copy of a public board in one respect that matters: there is no
 * account, so there is no "your applications" page to come back to. What
 * replaces it is the reference code handed over at the end and the status
 * lookup in the header — which is the same promise without the sign-up.
 */
export function CareersPortal() {
  const { slug } = useParams<{ slug?: string }>()
  const navigate = useNavigate()
  const company = useCompany()
  const toast = useToast()

  const [board, setBoard] = React.useState<JobBoard | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState('')

  const [term, setTerm] = React.useState('')
  const [where, setWhere] = React.useState('')
  const [filters, setFilters] = React.useState({ department: '', type: '', setup: '' })
  const [query, setQuery] = React.useState({ q: '', location: '' })

  const [job, setJob] = React.useState<JobDetail | null>(null)
  const [jobLoading, setJobLoading] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [receipt, setReceipt] = React.useState<ApplicationReceipt | null>(null)
  const [checking, setChecking] = React.useState(false)

  /*
   * Arriving from the links in an offer email.
   *
   * `/careers?reference=TRN-...&email=...&offer=accept` opens the status
   * dialog with the application already loaded. The pair in the query string
   * is the same credential the dialog asks for by hand, so the link is not a
   * standalone key to somebody's salary — a forwarded one is useless without
   * the address it was filed with.
   */
  const fromOfferLink = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const reference = params.get('reference')
    const email = params.get('email')

    return reference && email ? { reference, email } : undefined
  }, [])

  React.useEffect(() => {
    if (fromOfferLink) setChecking(true)
  }, [fromOfferLink])

  /* The list. Re-read whenever a filter changes; the search box itself only
     applies on submit, so typing does not fire a request per keystroke. */
  React.useEffect(() => {
    let cancelled = false

    setLoading(true)
    listJobs({ ...query, ...filters })
      .then((data) => {
        if (!cancelled) {
          setBoard(data)
          setFailed('')
        }
      })
      .catch((error) => {
        if (!cancelled) setFailed((error as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [query, filters])

  /* The opened role. Driven by the URL so a posting can be linked to, shared
     and opened cold — which is most of what a careers site is for. */
  React.useEffect(() => {
    if (!slug) {
      setJob(null)
      setApplying(false)
      setReceipt(null)
      return
    }

    let cancelled = false
    setJobLoading(true)

    getJob(slug)
      .then((data) => {
        if (!cancelled) setJob(data)
      })
      .catch(() => {
        if (!cancelled) setJob(null)
      })
      .finally(() => {
        if (!cancelled) setJobLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [slug])

  const open = (next: JobSummary) => {
    setApplying(false)
    setReceipt(null)
    navigate(`/careers/${next.slug}`)
  }

  const share = async () => {
    const url = window.location.href

    try {
      if (navigator.share) {
        await navigator.share({ title: job?.title ?? 'Vacancy', url })
        return
      }

      await navigator.clipboard.writeText(url)
      toast({ tone: 'success', title: 'Link copied' })
    } catch {
      // A cancelled share sheet is not an error worth telling anybody about.
    }
  }

  if (!liveApi()) {
    return (
      <CareersLetterhead>
        <div className="card">
          <EmptyState
            icon={Briefcase}
            title="The careers site needs the live API"
            description="Job postings and applications are read and written straight to the database."
          />
        </div>
      </CareersLetterhead>
    )
  }

  return (
    <CareersLetterhead
      action={
        <Button variant="ghost" size="sm" onClick={() => setChecking(true)}>
          <BadgeCheck className="size-4" />
          Check an application
        </Button>
      }
    >
      <StatusDialog open={checking} onClose={() => setChecking(false)} initial={fromOfferLink} />

      {/* -------------------------------------------------------------- */}
      {slug ? (
        <div>
          <button
            onClick={() => navigate('/careers')}
            className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-2 hover:text-brand-600"
          >
            <ArrowLeft className="size-3.5" />
            All open roles
          </button>

          {jobLoading ? (
            <p className="text-[13px] text-ink-3">Loading…</p>
          ) : !job ? (
            <div className="card">
              <EmptyState
                icon={Briefcase}
                title="That role is no longer open"
                description="It may have been filled or withdrawn. Have a look at what else is going."
                action={<Button onClick={() => navigate('/careers')}>See open roles</Button>}
              />
            </div>
          ) : receipt ? (
            <Receipt receipt={receipt} onDone={() => navigate('/careers')} />
          ) : applying ? (
            <div className="mx-auto max-w-3xl">
              <p className="mb-3 text-[13px] text-ink-2">
                Applying for <span className="font-semibold text-ink">{job.title}</span>
                {job.location && ` · ${job.location}`}
              </p>
              <ApplyForm job={job} onSubmitted={setReceipt} onCancel={() => setApplying(false)} />
            </div>
          ) : (
            <JobPage job={job} onApply={() => setApplying(true)} onShare={() => void share()} />
          )}
        </div>
      ) : (
        <>
          {/* The pitch. Short, because nobody reads a careers page for the
              prose — they came to see what is open. */}
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Work at {company.name}
            </h1>
            <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-2">
              Every vacancy we have is here, applied for in about two minutes. Upload your CV and most of the
              form fills itself — you check it rather than type it.
            </p>
          </div>

          {/* Search. Two boxes, the way every job board does it, because that
              is the shape people already know. */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setQuery({ q: term.trim(), location: where.trim() })
            }}
            className="card mb-4 flex flex-wrap items-end gap-2 p-3"
          >
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Job title, skill, or keyword"
                className="pl-9"
                aria-label="What"
              />
            </div>
            <div className="relative min-w-[10rem] flex-1">
              <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
              <Input
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="City or branch"
                className="pl-9"
                aria-label="Where"
              />
            </div>
            <Button type="submit">Search</Button>
          </form>

          {board && (board.departments.length > 0 || board.types.length > 0) && (
            <div className="mb-4 flex flex-wrap gap-2">
              <Select
                value={filters.department}
                onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}
                className="w-auto"
                aria-label="Department"
              >
                <option value="">All departments</option>
                {board.departments.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </Select>
              <Select
                value={filters.type}
                onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
                className="w-auto"
                aria-label="Employment type"
              >
                <option value="">Any type</option>
                {board.types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <Select
                value={filters.setup}
                onChange={(e) => setFilters((f) => ({ ...f, setup: e.target.value }))}
                className="w-auto"
                aria-label="Work setup"
              >
                <option value="">Any setup</option>
                {board.setups.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>

              {(filters.department || filters.type || filters.setup || query.q || query.location) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({ department: '', type: '', setup: '' })
                    setQuery({ q: '', location: '' })
                    setTerm('')
                    setWhere('')
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          )}

          {failed && <p className="mb-3 text-[12px] text-critical">{failed}</p>}

          {loading && !board ? (
            <p className="text-[13px] text-ink-3">Loading roles…</p>
          ) : !board || board.jobs.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Briefcase}
                title="Nothing open right now"
                description={
                  query.q || query.location || filters.department
                    ? 'Nothing matches that search. Try clearing the filters.'
                    : 'There are no vacancies posted at the moment. Do check back.'
                }
              />
            </div>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-ink-3">
                <span className="tabular font-semibold text-ink">{board.jobs.length}</span> open{' '}
                {board.jobs.length === 1 ? 'role' : 'roles'}
              </p>
              <div className="grid gap-2">
                {board.jobs.map((row) => (
                  <JobCard key={row.slug} job={row} onOpen={() => open(row)} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </CareersLetterhead>
  )
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

function JobCard({ job, onOpen }: { job: JobSummary; onOpen: () => void }) {
  const pay = salaryBand(job)

  return (
    <button
      onClick={onOpen}
      className="card w-full p-4 text-left transition-colors hover:border-brand-400 hover:bg-surface-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">{job.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
            {job.department && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" />
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {job.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" />
              {job.employmentType}
            </span>
          </p>
        </div>
        <Badge tone={job.workSetup === 'Remote' ? 'good' : job.workSetup === 'Hybrid' ? 'info' : 'neutral'}>
          {job.workSetup}
        </Badge>
      </div>

      {pay && (
        <p className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-ink">
          <Banknote className="size-3.5 text-good" />
          {pay}
        </p>
      )}

      {job.summary && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{job.summary}</p>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-3">
        <span>{postedLabel(job)}</span>
        {job.openings > 1 && (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3" />
            {job.openings} openings
          </span>
        )}
        {job.closesOn && <span>Closes {new Date(job.closesOn).toLocaleDateString('en-PH')}</span>}
      </p>
    </button>
  )
}

/* -------------------------------------------------------------------------- */
/* One role                                                                    */
/* -------------------------------------------------------------------------- */

function JobPage({
  job,
  onApply,
  onShare,
}: {
  job: JobDetail
  onApply: () => void
  onShare: () => void
}) {
  const pay = salaryBand(job)

  const section = (title: string, items: string[]) =>
    items.length > 0 && (
      <section>
        <h2 className="mb-1.5 text-[13px] font-semibold text-ink">{title}</h2>
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-500" />
              {item}
            </li>
          ))}
        </ul>
      </section>
    )

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className="card space-y-5 p-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{job.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
            {job.department && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-4" />
                {job.department}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-4" />
                {job.location}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="size-4" />
              {job.employmentType} · {job.workSetup}
            </span>
          </p>

          {pay && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-good/10 px-2.5 py-1 text-[13px] font-semibold text-good">
              <Banknote className="size-4" />
              {pay}
            </p>
          )}
        </div>

        {job.summary && (
          <p className="text-[14px] leading-relaxed whitespace-pre-line text-ink-2">{job.summary}</p>
        )}

        {section('What you would be doing', job.responsibilities)}
        {section('What we are looking for', job.qualifications)}
        {section('What we offer', job.benefits)}
      </div>

      {/* The apply panel follows the reader down a long advert, because the
          decision to apply is usually made at the bottom of one. */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="card space-y-3 p-4">
          <Button className="w-full" onClick={onApply}>
            Apply for this role
          </Button>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <Sparkles className="mt-px size-3.5 shrink-0 text-brand-500" />
            Upload your CV and we fill the form in from it. About two minutes, no account needed.
          </p>

          <div className="space-y-1.5 border-t border-line pt-3 text-[12px] text-ink-2">
            <p className="flex justify-between gap-2">
              <span className="text-ink-3">Level</span>
              <span className="text-right font-medium text-ink">{job.experienceLevel}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-ink-3">Openings</span>
              <span className="tabular text-right font-medium text-ink">{job.openings}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span className="text-ink-3">Posted</span>
              <span className="text-right font-medium text-ink">{postedLabel(job).replace('Posted ', '')}</span>
            </p>
            {job.closesOn && (
              <p className="flex justify-between gap-2">
                <span className="text-ink-3">Closes</span>
                <span className="text-right font-medium text-ink">
                  {new Date(job.closesOn).toLocaleDateString('en-PH')}
                </span>
              </p>
            )}
          </div>

          <Button variant="ghost" size="sm" className="w-full" onClick={onShare}>
            <Share2 className="size-4" />
            Share this role
          </Button>
        </div>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* After sending                                                               */
/* -------------------------------------------------------------------------- */

function Receipt({ receipt, onDone }: { receipt: ApplicationReceipt; onDone: () => void }) {
  const toast = useToast()

  return (
    <div className="card mx-auto max-w-xl p-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-good" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">
        {receipt.updated ? 'Application updated' : 'Application sent'}
      </h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{receipt.message}</p>

      {/* The reference is the whole substitute for an account, so it is the
          largest thing on the page and copyable in one tap. */}
      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4">
        <p className="text-[11px] tracking-wide text-ink-3 uppercase">Your reference</p>
        <p className="tabular mt-1 text-2xl font-bold tracking-wider text-ink">{receipt.reference}</p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => {
            void navigator.clipboard.writeText(receipt.reference)
            toast({ tone: 'success', title: 'Reference copied' })
          }}
        >
          <Copy className="size-3.5" />
          Copy
        </Button>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
        Keep it somewhere safe. Together with the email address you applied with, it is how you check on this
        application from the link at the top of the page.
        {!receipt.resumeAttached && ' Your CV was not attached — you can send it again with the same details if you want it on file.'}
      </p>

      <Button className="mt-5" onClick={onDone}>
        See other roles
      </Button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Checking an application                                                     */
/* -------------------------------------------------------------------------- */

function StatusDialog({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  /** Carried in from the offer email's link, so nothing has to be retyped. */
  initial?: { reference: string; email: string }
}) {
  const [reference, setReference] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [result, setResult] = React.useState<ApplicationStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [answer, setAnswer] = React.useState<string | null>(null)
  const [declining, setDeclining] = React.useState(false)
  const [reason, setReason] = React.useState('')

  const look = async (ref?: string, mail?: string) => {
    const useRef = ref ?? reference
    const useMail = mail ?? email

    setBusy(true)
    setProblem('')
    setResult(null)

    try {
      setResult(await checkStatus(useRef, useMail))
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /*
   * Arriving from the offer email.
   *
   * The reference and the address are both in the link, so the dialog opens
   * with the application already loaded rather than asking somebody to copy
   * their own code out of the message they have just clicked.
   */
  React.useEffect(() => {
    if (!open || !initial) return

    setReference(initial.reference)
    setEmail(initial.email)
    void look(initial.reference, initial.email)
    // Runs once per arrival; `look` reads its arguments rather than state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const respond = async (decision: 'Accepted' | 'Declined') => {
    setBusy(true)
    setProblem('')

    try {
      const outcome = await respondToOffer(
        reference,
        email,
        decision,
        decision === 'Declined' ? reason : undefined,
      )

      setAnswer(outcome.message)
      setDeclining(false)
      await look()
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Check an application"
      description="Your reference code and the email you applied with. Both, so nobody else can look yours up."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button
            onClick={() => void look()}
            disabled={busy || reference.trim().length < 6 || !email.includes('@')}
            loading={busy}
          >
            Check
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Reference code" required>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value.toUpperCase())}
            placeholder="TRN-XXX-XXXX"
            className="tabular tracking-wider"
          />
        </Field>
        <Field label="Email address" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        {problem && <p className="text-[12px] text-critical">{problem}</p>}

        {result && (
          <div
            className={cn(
              'rounded-xl border p-3',
              result.closed ? 'border-line bg-surface-2' : 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950',
            )}
          >
            <p className="text-[13px] font-semibold text-ink">{result.status}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{result.message}</p>
            <p className="mt-2 text-[11px] text-ink-3">
              {result.role ?? 'Application'}
              {result.appliedOn && ` · applied ${new Date(result.appliedOn).toLocaleDateString('en-PH')}`}
              {result.updatedOn && ` · last moved ${new Date(result.updatedOn).toLocaleDateString('en-PH')}`}
            </p>
          </div>
        )}

        {/* The offer, answerable right here. The email carries the same two
            buttons, and emails get lost — this page does not. */}
        {result?.offer && (
          <div className="rounded-xl border border-brand-300 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-950">
            <p className="text-[13px] font-semibold text-ink">
              You have an offer{result.offer.position ? ` — ${result.offer.position}` : ''}
            </p>

            <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
              {[
                ['Monthly salary', result.offer.salary ? `₱${result.offer.salary.toLocaleString('en-PH')}` : null],
                [
                  'Proposed start',
                  result.offer.startDate ? new Date(result.offer.startDate).toLocaleDateString('en-PH') : null,
                ],
                [
                  'Reply by',
                  result.offer.expiresOn ? new Date(result.offer.expiresOn).toLocaleDateString('en-PH') : null,
                ],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
            </dl>

            {result.offer.notes && (
              <p className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-line text-ink-2">
                {result.offer.notes}
              </p>
            )}

            {result.offer.response ? (
              <p className="mt-2 text-[12px] font-medium text-ink-2">
                You {result.offer.response === 'Accepted' ? 'accepted' : 'declined'} this offer. Thank you for
                telling us.
              </p>
            ) : result.offer.expired ? (
              <p className="mt-2 text-[12px] text-critical">
                This offer has passed its reply date. Do get in touch and we will look at it again.
              </p>
            ) : declining ? (
              <div className="mt-2 space-y-2">
                <Field
                  label="Anything you would like to tell us"
                  hint="Optional, and it will not be held against a future application."
                >
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setDeclining(false)} disabled={busy}>
                    Back
                  </Button>
                  <Button size="sm" onClick={() => void respond('Declined')} disabled={busy} loading={busy}>
                    Confirm decline
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void respond('Accepted')} disabled={busy}>
                  Accept the offer
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeclining(true)} disabled={busy}>
                  Decline
                </Button>
              </div>
            )}
          </div>
        )}

        {answer && <p className="text-[12px] text-good">{answer}</p>}
      </div>
    </Modal>
  )
}
