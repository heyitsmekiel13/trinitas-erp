import * as React from 'react'
import {
  ArrowLeft, Briefcase, CheckCircle2, ExternalLink, FilePlus2, Globe, Megaphone, RefreshCw,
  TriangleAlert, Wand2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import { useCompany } from '@/lib/company'
import { createRecord, draftAdvert, liveApi, publishPosting, type AdvertDraft } from '@/lib/adminApi'
import { Button, Combobox, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'

/**
 * Raising a manpower request, and — in the same sitting — the advert it
 * becomes.
 *
 * This used to be a dialog on the recruitment board. It is a page in its own
 * tab now for two reasons. The first is practical: it is opened by a
 * department manager who has been told to justify a headcount, not by the
 * recruiter watching the pipeline, and making them load the whole board to get
 * at a form is backwards. The second is that the form grew — an authorisation
 * and a job advert are different documents written for different readers, and
 * both fit on a page in a way neither fits in a modal.
 *
 * The second half is optional and off by default. A manpower request is an
 * internal control document and raising one does not oblige anybody to post it
 * publicly; but when the vacancy is going on the careers site anyway, writing
 * the advert here means the two are created together and cannot disagree about
 * which job they describe.
 */

type Row = Record<string, unknown>

const optionsOf = (rows: Row[], label = 'name') =>
  rows.map((r) => ({
    value: Number(r.id),
    label: String(r[label] ?? r.name ?? r.title ?? r.code ?? ''),
    sublabel: String(r.code ?? ''),
  }))

const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Project-based', 'Internship'] as const
const WORK_SETUPS = ['On-site', 'Hybrid', 'Remote'] as const
const LEVELS = ['Entry level', 'Associate', 'Mid-Senior', 'Manager', 'Director'] as const

export function ManpowerRequestPage() {
  const toast = useToast()
  const company = useCompany()

  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [done, setDone] = React.useState<
    { no: string; slug: string | null; published: boolean; snag: string | null } | null
  >(null)


  /* The authorisation. */
  const [positionId, setPositionId] = React.useState<number | null>(null)
  const [departmentId, setDepartmentId] = React.useState<number | null>(null)
  const [branchId, setBranchId] = React.useState<number | null>(null)
  const [headcount, setHeadcount] = React.useState('1')
  const [neededBy, setNeededBy] = React.useState('')
  const [budgetRate, setBudgetRate] = React.useState('')

  /* The advert. */
  const [advertise, setAdvertise] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [titleTouched, setTitleTouched] = React.useState(false)
  const [location, setLocation] = React.useState('')
  const [employmentType, setEmploymentType] = React.useState<string>('Full-time')
  const [workSetup, setWorkSetup] = React.useState<string>('On-site')
  const [level, setLevel] = React.useState<string>('Entry level')
  const [summary, setSummary] = React.useState('')
  const [responsibilities, setResponsibilities] = React.useState('')
  const [qualifications, setQualifications] = React.useState('')
  const [benefits, setBenefits] = React.useState('')
  const [salaryMin, setSalaryMin] = React.useState('')
  const [salaryMax, setSalaryMax] = React.useState('')
  const [salaryVisible, setSalaryVisible] = React.useState(false)
  const [closesOn, setClosesOn] = React.useState('')
  const [publishNow, setPublishNow] = React.useState(true)

  /* What the draft said, and whether anybody has touched it since. Kept so the
     screen can be honest about which fields are still the machine's words —
     and so ticking the box a second time does not wipe an edit. */
  const [drafted, setDrafted] = React.useState<AdvertDraft | null>(null)
  const [drafting, setDrafting] = React.useState(false)
  const [edited, setEdited] = React.useState(false)

  const { data: positions = [] } = useResource<Row[]>('hr/positions', () => [])
  const { data: departments = [] } = useResource<Row[]>('hr/departments', () => [])
  const { data: branches = [] } = useResource<Row[]>('hr/branch-units', () => [])

  const position = positions.find((p) => Number(p.id) === positionId)
  const branch = branches.find((b) => Number(b.id) === branchId)

  /* The advert's heading and location follow the request until somebody
     changes them, because they are the same facts written twice. */
  React.useEffect(() => {
    if (!titleTouched && position) setTitle(String(position.title ?? ''))
  }, [position, titleTouched])

  React.useEffect(() => {
    if (branch) setLocation((current) => current || String(branch.name ?? ''))
  }, [branch])

  /**
   * Writes the advert from the role.
   *
   * Runs when the box is ticked and again if the position changes underneath
   * it, because an advert for the previous role is worse than an empty one.
   * It never overwrites something a person has edited — that is what `edited`
   * is for, and losing somebody's paragraph to an automatic refresh is the
   * fastest way to make them stop trusting the feature.
   */
  const generate = React.useCallback(
    async (force = false) => {
      if (positionId === null) return
      if (edited && !force) return

      setDrafting(true)
      try {
        const draft = await draftAdvert({
          positionId,
          title: title.trim() || undefined,
        })

        setDrafted(draft)
        setEdited(false)

        if (!titleTouched) setTitle(draft.title)
        setEmploymentType(draft.employmentType)
        setWorkSetup(draft.workSetup)
        setLevel(draft.experienceLevel)
        setSummary(draft.summary)
        setResponsibilities(draft.responsibilities)
        setQualifications(draft.qualifications)
        setBenefits(draft.benefits)

        /* The band follows the approved budget rate when this request has one,
           because that is the company's own number for the seat. When it does
           not, the library's market range is filled in but left unpublished —
           an indicative figure on the internet is a promise nobody made. */
        const band = budgetRate
          ? [Math.round(Number(budgetRate) * 0.9), Math.round(Number(budgetRate) * 1.15)]
          : [draft.salaryMin, draft.salaryMax]

        setSalaryMin(String(band[0]))
        setSalaryMax(String(band[1]))
        setSalaryVisible(Boolean(budgetRate))
      } catch {
        setDrafted(null)
      } finally {
        setDrafting(false)
      }
    },
    // `title` and `budgetRate` are read, not depended on: re-drafting on every
    // keystroke in either would fight the person typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positionId, edited, titleTouched],
  )

  React.useEffect(() => {
    if (advertise) void generate()
  }, [advertise, generate])

  const valid = positionId !== null && departmentId !== null && Number(headcount) >= 1

  /**
   * Raises the request, and — when asked — the advert with it.
   *
   * Three server calls, and the reason this is not one try/catch around all
   * of them is a bug that actually happened: publishing failed, the `catch`
   * printed a red line, and the success screen never appeared. But the
   * requisition and the advert had both been created. So the screen said
   * nothing had worked while the database said two things had, and pressing
   * the button again raised a duplicate.
   *
   * Each step is therefore tracked separately, and anything already created is
   * kept. A partial result is reported as a partial result — what exists, what
   * does not, and what to do about it — because the alternative is a person
   * who cannot tell whether to press the button again.
   */
  const submit = async () => {
    setBusy(true)
    setProblem('')

    let requisition: { id: number; no: string }

    try {
      requisition = await createRecord<{ id: number; no: string }>('hr/requisitions', {
        positionId,
        departmentId,
        ...(branchId ? { branchId } : {}),
        headcount: Number(headcount),
        ...(neededBy ? { neededBy } : {}),
        ...(budgetRate ? { budgetRate: Number(budgetRate) } : {}),
        // Raised ready to source. A vacancy nobody may fill is not a vacancy,
        // and the approval step lives in the approvals module, not here.
        status: 'Approved',
      })
    } catch (err) {
      setProblem((err as Error).message)
      setBusy(false)

      return
    }

    /* From here the vacancy exists. Nothing below is allowed to hide that. */
    if (!advertise) {
      setDone({ no: requisition.no, slug: null, published: false, snag: null })
      toast({ tone: 'success', title: 'Manpower request raised' })
      setBusy(false)

      return
    }

    let slug: string | null = null
    let published = false
    let snag: string | null = null

    try {
      const posting = await createRecord<{ id: number; slug: string }>('hr/job-postings', {
        title: title.trim() || String(position?.title ?? 'Vacancy'),
        requisitionId: requisition.id,
        positionId,
        departmentId,
        ...(branchId ? { branchId } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        employmentType,
        workSetup,
        experienceLevel: level,
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(responsibilities.trim() ? { responsibilities: responsibilities.trim() } : {}),
        ...(qualifications.trim() ? { qualifications: qualifications.trim() } : {}),
        ...(benefits.trim() ? { benefits: benefits.trim() } : {}),
        ...(salaryMin ? { salaryMin: Number(salaryMin) } : {}),
        ...(salaryMax ? { salaryMax: Number(salaryMax) } : {}),
        salaryVisible,
        openings: Number(headcount),
        ...(closesOn ? { closesOn } : {}),
      })

      slug = posting.slug

      if (publishNow) {
        try {
          await publishPosting(posting.id, closesOn || undefined)
          published = true
        } catch (err) {
          // The advert exists and is a draft. Saying exactly that is the
          // difference between somebody publishing it in one click from
          // Recruitment and somebody raising the whole thing again.
          snag =
            `The advert was saved as a draft but could not be published: ${(err as Error).message} ` +
            'Publish it from Recruitment → Job Postings when you are ready.'
        }
      }
    } catch (err) {
      snag =
        `The manpower request was raised, but the advert could not be saved: ${(err as Error).message} ` +
        'Write the advert from Recruitment → Job Postings — the vacancy itself is fine.'
    }

    setDone({ no: requisition.no, slug, published, snag })
    toast({
      tone: snag ? 'warning' : 'success',
      title: 'Manpower request raised',
      description: snag ? 'The advert needs a second look.' : undefined,
    })
    setBusy(false)
  }

  if (!liveApi()) {
    return (
      <Shell company={company.name}>
        <div className="card">
          <EmptyState
            icon={Briefcase}
            title="This form needs the live API"
            description="Manpower requests are written straight to the database."
          />
        </div>
      </Shell>
    )
  }

  if (done) {
    return (
      <Shell company={company.name}>
        <div className="card mx-auto max-w-lg p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-good" />
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Request raised</h1>
          <p className="tabular mt-1 text-[15px] font-semibold text-ink">{done.no}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Applicants can be sourced against it now. Seats are counted off it as people are hired, and it
            closes itself when the last one is taken.
          </p>

          {done.snag && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-left text-[12px] leading-relaxed text-warning">
              <TriangleAlert className="mt-px size-4 shrink-0" />
              {done.snag}
            </p>
          )}

          {done.slug && !done.snag && (
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-2">
              {done.published ? (
                <>
                  The advert is live on the careers site.{' '}
                  <a
                    href={`/careers/${done.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400"
                  >
                    Open it
                    <ExternalLink className="size-3" />
                  </a>{' '}
                  — that link is what you share.
                </>
              ) : (
                'The advert was saved as a draft. Publish it from Recruitment when you are ready for applications.'
              )}
            </p>
          )}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" onClick={() => window.close()}>
              Close this tab
            </Button>
            {/* When something did not finish, the way to finish it is one
                click away rather than a instruction to go and find it. */}
            {done.snag && (
              <Button
                variant="secondary"
                onClick={() => window.open('/hr/recruitment', '_blank', 'noopener')}
              >
                <Megaphone className="size-4" />
                Open Job Postings
              </Button>
            )}
            <Button
              onClick={() => {
                setDone(null)
                setPositionId(null)
                setHeadcount('1')
                setNeededBy('')
                setBudgetRate('')
                setAdvertise(false)
                setTitleTouched(false)
                setSummary('')
                setResponsibilities('')
                setQualifications('')
                setBenefits('')
              }}
            >
              <FilePlus2 className="size-4" />
              Raise another
            </Button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell company={company.name}>
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Raise a manpower request</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            The approved vacancy applicants are sourced against. Seats are counted off it as people are hired,
            and it closes itself once the last one is filled.
          </p>
        </div>

        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink">The vacancy</h2>

          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Field label="Position" required composite>
              <Combobox
                value={positionId}
                options={optionsOf(positions, 'title')}
                onChange={(v) => setPositionId(v === null ? null : Number(v))}
                placeholder="Which role"
              />
            </Field>
            <Field
              label="Department"
              required
              hint="Where the seat sits. The 201 file is filed against it at hire."
              composite
            >
              <Combobox
                value={departmentId}
                options={optionsOf(departments)}
                onChange={(v) => setDepartmentId(v === null ? null : Number(v))}
                placeholder="Which department"
              />
            </Field>

            <Field label="Branch" composite>
              <Combobox
                value={branchId}
                options={optionsOf(branches)}
                onChange={(v) => setBranchId(v === null ? null : Number(v))}
                placeholder="Where they will be based"
              />
            </Field>
            <Field label="Headcount" required hint="How many seats this request authorises.">
              <Input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
            </Field>

            <Field label="Needed by">
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </Field>
            <Field label="Budget rate" hint="The agreed figure when nothing else is negotiated at offer.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={budgetRate}
                onChange={(e) => setBudgetRate(e.target.value)}
              />
            </Field>
          </div>
        </section>

        {/* --------------------------------------------------------------- */}
        <section className="card p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={advertise}
              onChange={(e) => setAdvertise(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand-500,#2563eb)]"
            />
            <span>
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Megaphone className="size-4 text-brand-500" />
                Post this on the careers site as well
              </span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                The advert is written for you from the role — what the job involves, what it asks for, and the
                package — benchmarked to how the position is normally advertised. Read it through and change
                whatever does not fit. The budget rate above is never published; the band below is what
                candidates see, and only if you say so.
              </span>
            </span>
          </label>

          {advertise && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              {/* Where the words came from, and what still needs a human. An
                  advert generated and published without anybody reading it is
                  worse than an empty one — it is wrong at length. */}
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
                    <Wand2 className="mt-px size-4 shrink-0 text-brand-500" />
                    <span>
                      {drafting
                        ? 'Writing the advert from the role…'
                        : drafted
                          ? `Drafted for a ${drafted.experienceLevel.toLowerCase()} ${drafted.family.replace('-', ' ')} role. Read it through — every line is yours to change.`
                          : 'Choose a position and the advert will be written for you.'}
                    </span>
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={drafting || positionId === null}
                    onClick={() => void generate(true)}
                    title="Rewrite from the role, discarding your edits"
                  >
                    <RefreshCw className={cn('size-3.5', drafting && 'animate-spin')} />
                    Rewrite
                  </Button>
                </div>

                {drafted && (
                  <p
                    className={cn(
                      'mt-1.5 text-[11px] leading-relaxed',
                      drafted.salaryBasis === 'budget' ? 'text-ink-3' : 'text-warning',
                    )}
                  >
                    {budgetRate
                      ? 'The band is built around the budget rate on this request.'
                      : drafted.note}
                  </p>
                )}
              </div>

              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                <Field label="Advert heading" required hint="What a jobseeker will see in the list." className="sm:col-span-2">
                  <Input
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value)
                      setTitleTouched(true)
                    }}
                    placeholder="e.g. Accounting Supervisor"
                  />
                </Field>

                <Field label="Location shown" hint="Left blank, the branch name is used.">
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} />
                </Field>
                <Field label="Employment type" required>
                  <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)}>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </Select>
                </Field>

                <Field label="Work setup" required>
                  <Select value={workSetup} onChange={(e) => setWorkSetup(e.target.value)}>
                    {WORK_SETUPS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Level" required>
                  <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <Field
                label="Summary"
                hint="Two or three sentences. This is the part that decides whether anybody reads the rest."
                composite
              >
                <Textarea value={summary} onChange={(e) => {
                    setSummary(e.target.value)
                    setEdited(true)
                  }} rows={3} />
              </Field>

              <Field label="What they would be doing" hint="One per line." composite>
                <Textarea
                  value={responsibilities}
                  onChange={(e) => {
                    setResponsibilities(e.target.value)
                    setEdited(true)
                  }}
                  rows={4}
                  placeholder={'Prepare monthly financial statements\nSupervise two accounting assistants'}
                />
              </Field>

              <Field label="What you are looking for" hint="One per line." composite>
                <Textarea
                  value={qualifications}
                  onChange={(e) => {
                    setQualifications(e.target.value)
                    setEdited(true)
                  }}
                  rows={4}
                  placeholder={'Graduate of BS Accountancy\nAt least three years in a similar role'}
                />
              </Field>

              <Field label="What you offer" hint="One per line. Optional, but it is what makes people apply." composite>
                <Textarea value={benefits} onChange={(e) => {
                    setBenefits(e.target.value)
                    setEdited(true)
                  }} rows={3} />
              </Field>

              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
                <Field label="Salary from">
                  <Input
                    type="number"
                    min={0}
                    value={salaryMin}
                    onChange={(e) => setSalaryMin(e.target.value)}
                  />
                </Field>
                <Field label="Salary to">
                  <Input
                    type="number"
                    min={0}
                    value={salaryMax}
                    onChange={(e) => setSalaryMax(e.target.value)}
                  />
                </Field>
                <Field label="Applications close">
                  <Input type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
                </Field>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-surface-2 p-3">
                <input
                  type="checkbox"
                  checked={salaryVisible}
                  onChange={(e) => setSalaryVisible(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--brand-500,#2563eb)]"
                />
                <span className="text-[12px] leading-relaxed text-ink-2">
                  Show the salary band on the advert. Adverts that state one get materially more applications;
                  leaving it off keeps the figure internal.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-surface-2 p-3">
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(e) => setPublishNow(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--brand-500,#2563eb)]"
                />
                <span className="text-[12px] leading-relaxed text-ink-2">
                  Publish it straight away. Untick to save it as a draft and publish from Recruitment later.
                </span>
              </label>
            </div>
          )}
        </section>

        {problem && (
          <p role="alert" className="text-[12px] text-critical">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pb-8">
          <Button variant="ghost" onClick={() => window.close()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy} loading={busy}>
            <FilePlus2 className="size-4" />
            {advertise && publishNow ? 'Raise request and publish' : 'Raise request'}
          </Button>
        </div>
      </div>
    </Shell>
  )
}

/**
 * The chrome for a form that opened in its own tab.
 *
 * Deliberately no sidebar: this tab exists to complete one document and then
 * be closed, and a navigation rail invites somebody to wander off half way
 * through it.
 */
export function Shell({
  company,
  children,
  subtitle = 'Human Resources · Recruitment',
  aside,
}: {
  company: string
  children: React.ReactNode
  subtitle?: string
  aside?: React.ReactNode
}) {
  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold tracking-tight text-ink uppercase">{company}</p>
            <p className="text-[11px] font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-400">
              {subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {aside}
            <a
              href="/hr/recruitment"
              className={cn(
                'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-ink-2',
                'transition-colors hover:bg-surface-2 hover:text-brand-600',
              )}
            >
              <ArrowLeft className="size-3.5" />
              Recruitment
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">{children}</main>

      <footer className="border-t border-line py-4 text-center text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3" />
          Internal form · this tab can be closed once you are done
        </span>
      </footer>
    </div>
  )
}
