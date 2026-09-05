import * as React from 'react'
import {
  CheckCircle2, FileText, Loader2, Sparkles, Trash2, TriangleAlert, Upload, UserPlus, X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import { useCompany } from '@/lib/company'
import {
  createApplicantIntake, liveApi, readResumeForIntake, type ResumeRead,
} from '@/lib/adminApi'
import { ApiError } from '@/lib/adminApi'
import { Button, Combobox, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { EDUCATION_LEVELS, PROVINCES } from '@/modules/careers/shared'
import { Shell } from './ManpowerRequestPage'

/**
 * Encoding an applicant, in HR's own hands.
 *
 * The careers site takes care of the people who apply online. This is for
 * everybody else — the walk-in with a folder of photocopies, the referral
 * whose CV arrived by Viber, the stack of paper from a job fair — and it does
 * the same two things in the same order: read the CV, then let a person check
 * what was read.
 *
 * The details are typed by a recruiter rather than the candidate, which
 * changes exactly one thing about how it is built: nothing here is treated as
 * more reliable for being keyed by staff. A recruiter copying a phone number
 * off a printout mistypes it about as often as anybody else, so the parsed
 * values are still shown as suggestions, still marked, and still theirs to
 * correct — the marking is what tells the next person which fields nobody has
 * actually read.
 *
 * A page in its own tab rather than a dialog because this is a long form and
 * because it is worked through in batches: the tab stays open while a stack of
 * CVs goes through it, one after another.
 */

type Row = Record<string, unknown>

type Values = {
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  birthdate: string
  gender: string
  civilStatus: string
  nationality: string
  addressLine: string
  city: string
  province: string
  postalCode: string
  educationLevel: string
  school: string
  course: string
  yearGraduated: string
  yearsExperience: string
  currentEmployer: string
  currentTitle: string
  availableFrom: string
  currentSalary: string
  expectedSalary: string
  linkedinUrl: string
  portfolioUrl: string
  coverLetter: string
  screeningNotes: string
}

const EMPTY: Values = {
  firstName: '', middleName: '', lastName: '', email: '', phone: '',
  birthdate: '', gender: '', civilStatus: '', nationality: 'Filipino',
  addressLine: '', city: '', province: '', postalCode: '',
  educationLevel: '', school: '', course: '', yearGraduated: '',
  yearsExperience: '', currentEmployer: '', currentTitle: '',
  availableFrom: '', currentSalary: '', expectedSalary: '',
  linkedinUrl: '', portfolioUrl: '', coverLetter: '', screeningNotes: '',
}

const SOURCES = ['Referral', 'Walk-in', 'Job Board', 'Agency', 'Social Media', 'University'] as const

const today = () => new Date().toISOString().slice(0, 10)

export function ApplicantIntakePage() {
  const toast = useToast()
  const company = useCompany()

  const [values, setValues] = React.useState<Values>(EMPTY)
  const [fromResume, setFromResume] = React.useState<Set<keyof Values>>(new Set())
  const [skills, setSkills] = React.useState<string[]>([])
  const [skillDraft, setSkillDraft] = React.useState('')

  /* Opened from a vacancy card on the board, the request is already known —
     `/hr/applicant-intake?requisition=12`. Sourcing against a named vacancy is
     what counts the seat at hire, so carrying it through the tab boundary
     matters more than it looks. */
  const [requisitionId, setRequisitionId] = React.useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get('requisition')
    const id = Number(raw)

    return raw && Number.isFinite(id) && id > 0 ? id : null
  })
  const [positionId, setPositionId] = React.useState<number | null>(null)
  const [source, setSource] = React.useState<string>('Walk-in')
  const [applied, setApplied] = React.useState(today())

  const [resume, setResume] = React.useState<ResumeRead | null>(null)
  const [reading, setReading] = React.useState(false)

  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  const [done, setDone] = React.useState<{ code: string; name: string; resumeAttached: boolean } | null>(null)

  const { data: positions = [] } = useResource<Row[]>('hr/positions', () => [])
  const { data: requisitions = [] } = useResource<Row[]>('hr/requisitions', () => [])

  // Sourcing happens against a vacancy, so only the ones still taking
  // candidates are offered.
  const openRequisitions = React.useMemo(
    () => requisitions.filter((r) => ['Approved', 'Sourcing'].includes(String(r.status))),
    [requisitions],
  )

  // The requisition already names the position. Taking it from there is one
  // less field to key and one less way for the two to disagree.
  React.useEffect(() => {
    if (requisitionId === null) return
    const row = requisitions.find((r) => Number(r.id) === requisitionId)
    if (row?.positionId != null) setPositionId(Number(row.positionId))
  }, [requisitionId, requisitions])

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setFromResume((marked) => {
      if (!marked.has(key)) return marked
      const next = new Set(marked)
      next.delete(key)
      return next
    })
    setFieldErrors((errors) => {
      if (!errors[key]) return errors
      const { [key]: _gone, ...rest } = errors
      return rest
    })
  }

  const takeFile = async (file: File | null | undefined) => {
    if (!file) return

    setReading(true)
    setProblem('')

    try {
      const read = await readResumeForIntake(file)
      setResume(read)

      const filled = new Set<keyof Values>()

      setValues((current) => {
        const next = { ...current }

        for (const [key, value] of Object.entries(read.fields)) {
          const field = key as keyof Values

          // Never overwrites something already keyed. If the recruiter typed
          // a corrected number off the printout, the CV does not win.
          if (field in next && !next[field] && value !== null && value !== undefined) {
            next[field] = String(value)
            filled.add(field)
          }
        }

        return next
      })

      setFromResume(filled)

      if (read.skills.length) {
        setSkills((current) => (current.length ? current : read.skills))
      }

      toast({
        tone: read.status === 'Parsed' ? 'success' : 'warning',
        title: read.status === 'Parsed' ? `Read ${Object.keys(read.fields).length} details from the CV` : 'CV could not be read',
        description:
          read.status === 'Parsed'
            ? 'Check every marked field before saving.'
            : 'It is still attached — key the details in by hand.',
      })
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setReading(false)
    }
  }

  const reset = () => {
    setValues(EMPTY)
    setFromResume(new Set())
    setSkills([])
    setResume(null)
    setApplied(today())
    setProblem('')
    setFieldErrors({})
    setDone(null)
  }

  const valid =
    values.firstName.trim() !== '' && values.lastName.trim() !== '' && positionId !== null && applied !== ''

  const submit = async () => {
    setBusy(true)
    setProblem('')
    setFieldErrors({})

    try {
      const created = await createApplicantIntake({
        ...Object.fromEntries(
          Object.entries(values)
            .map(([key, value]) => [key, value.trim()])
            .filter(([, value]) => value !== ''),
        ),
        ...(values.yearGraduated ? { yearGraduated: Number(values.yearGraduated) } : {}),
        ...(values.yearsExperience ? { yearsExperience: Number(values.yearsExperience) } : {}),
        ...(values.currentSalary ? { currentSalary: Number(values.currentSalary) } : {}),
        ...(values.expectedSalary ? { expectedSalary: Number(values.expectedSalary) } : {}),
        positionId,
        ...(requisitionId ? { requisitionId } : {}),
        source,
        appliedOn: applied,
        ...(skills.length ? { skills } : {}),
        ...(resume?.token ? { resumeToken: resume.token } : {}),
      })

      setDone({ code: created.code, name: created.name, resumeAttached: created.resumeAttached })
      toast({ tone: 'success', title: `${created.name} added to the pipeline`, description: 'Stage: Applied' })
    } catch (error) {
      if (error instanceof ApiError) {
        setProblem(error.message)
        setFieldErrors(
          Object.fromEntries(Object.entries(error.errors).map(([key, list]) => [key, list[0] ?? ''])),
        )
      } else {
        setProblem((error as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------------------------------------------------- */

  const badge = (field: keyof Values) =>
    fromResume.has(field) ? (
      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-brand-50 px-1 py-px text-[9px] font-semibold tracking-wide text-brand-700 uppercase dark:bg-brand-950 dark:text-brand-300">
        <Sparkles className="size-2.5" />
        from CV
      </span>
    ) : null

  const text = (
    field: keyof Values,
    label: string,
    options: { required?: boolean; type?: string; hint?: string; className?: string; placeholder?: string } = {},
  ) => (
    <Field
      label={label}
      required={options.required}
      hint={options.hint}
      error={fieldErrors[field]}
      className={options.className}
      composite
    >
      <span className="mb-1 block">{badge(field)}</span>
      <Input
        type={options.type ?? 'text'}
        value={values[field]}
        placeholder={options.placeholder}
        onChange={(e) => set(field)(e.target.value)}
        className={fromResume.has(field) ? 'border-brand-300 dark:border-brand-800' : undefined}
      />
    </Field>
  )

  if (!liveApi()) {
    return (
      <Shell company={company.name}>
        <div className="card">
          <EmptyState
            icon={UserPlus}
            title="Applicant intake needs the live API"
            description="Applicants and their CVs are written straight to the database."
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
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">{done.name} is in the pipeline</h1>
          <p className="tabular mt-1 text-[15px] font-semibold text-ink">{done.code}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            They enter at <strong className="text-ink">Applied</strong> and move a stage at a time from the
            recruitment board.
            {done.resumeAttached
              ? ' Their CV is on file and searchable.'
              : ' No CV was attached — one can be added from their panel on the board.'}
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" onClick={() => window.close()}>
              Close this tab
            </Button>
            <Button onClick={reset}>
              <UserPlus className="size-4" />
              Add another
            </Button>
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <Shell company={company.name}>
      <div className="mx-auto max-w-3xl space-y-4 pb-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Add an applicant</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            For anybody who did not apply through the careers site. Upload their CV first and most of this
            fills itself — check what it read before saving.
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink">Their CV</h2>

          {resume ? (
            <div className="rounded-xl border border-line p-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-brand-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{resume.filename}</p>
                  {resume.status === 'Parsed' ? (
                    <p className="mt-0.5 text-[12px] text-ink-2">
                      Read {Object.keys(resume.fields).length} details
                      {resume.skills.length ? ` and ${resume.skills.length} skills` : ''} · confidence{' '}
                      <span className="tabular font-medium">{resume.confidence}%</span>
                      {resume.method === 'ocr' && ' · read by text recognition'}
                    </p>
                  ) : (
                    <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-warning">
                      <TriangleAlert className="mt-px size-3.5 shrink-0" />
                      No readable text. The file is still attached to the applicant.
                    </p>
                  )}
                  {resume.notes.map((note) => (
                    <p key={note} className="mt-1 text-[11px] leading-relaxed text-ink-3">
                      {note}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setResume(null)
                    setFromResume(new Set())
                  }}
                  className="rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-critical"
                  title="Remove"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ) : (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void takeFile(e.dataTransfer.files?.[0])
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-5 py-8 text-center transition-colors',
                'hover:border-brand-400 hover:bg-surface-2',
              )}
            >
              <input
                type="file"
                accept=".pdf,.doc,.docx,.rtf,.txt,.png,.jpg,.jpeg,.webp"
                className="sr-only"
                onChange={(e) => void takeFile(e.target.files?.[0])}
              />
              {reading ? (
                <>
                  <Loader2 className="size-6 animate-spin text-brand-500" />
                  <p className="text-[13px] font-medium text-ink">Reading the CV…</p>
                </>
              ) : (
                <>
                  <Upload className="size-6 text-brand-500" />
                  <p className="text-[13px] font-medium text-ink">Drop the CV here, or click to choose one</p>
                  <p className="text-[11px] text-ink-3">
                    PDF, Word, or a photo or scan. Scans are read by text recognition where the server has it.
                  </p>
                </>
              )}
            </label>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink">The vacancy</h2>

          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Field
              label="Manpower request"
              hint={
                openRequisitions.length === 0
                  ? 'None open — raise one first, or source against the position directly.'
                  : 'Fills the position, and counts the seat when they are hired.'
              }
              composite
            >
              <Combobox
                value={requisitionId}
                options={openRequisitions.map((r) => ({
                  value: Number(r.id),
                  label: String(r.no ?? ''),
                  sublabel: `${String(r.position ?? '')} · ${Number(r.openings ?? 0)} open`,
                }))}
                onChange={(v) => setRequisitionId(v === null ? null : Number(v))}
                placeholder="Optional"
              />
            </Field>
            <Field label="Position" required error={fieldErrors.positionId} composite>
              <Combobox
                value={positionId}
                options={positions.map((p) => ({ value: Number(p.id), label: String(p.title ?? '') }))}
                onChange={(v) => setPositionId(v === null ? null : Number(v))}
                placeholder="Which role"
              />
            </Field>

            <Field label="Source" required hint="How they reached us.">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Applied on" required error={fieldErrors.appliedOn}>
              <Input type="date" value={applied} max={today()} onChange={(e) => setApplied(e.target.value)} />
            </Field>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink">Personal details</h2>

          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {text('firstName', 'First name', { required: true })}
            {text('lastName', 'Last name', { required: true, hint: 'Including any part like "Dela" or "San".' })}
            {text('middleName', 'Middle name', { className: 'sm:col-span-2' })}

            {text('email', 'Email', { type: 'email' })}
            {text('phone', 'Mobile', { placeholder: '09XX XXX XXXX' })}

            {text('birthdate', 'Date of birth', { type: 'date' })}
            <Field label="Civil status" composite>
              <span className="mb-1 block">{badge('civilStatus')}</span>
              <Select value={values.civilStatus} onChange={(e) => set('civilStatus')(e.target.value)}>
                <option value="">Not stated</option>
                {['Single', 'Married', 'Widowed', 'Separated'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>

            <Field label="Sex" composite>
              <span className="mb-1 block">{badge('gender')}</span>
              <Select value={values.gender} onChange={(e) => set('gender')(e.target.value)}>
                <option value="">Not stated</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </Select>
            </Field>
            {text('nationality', 'Nationality')}

            {text('addressLine', 'House number and street', { className: 'sm:col-span-2' })}
            {text('city', 'City or municipality')}

            <Field label="Province" composite>
              <span className="mb-1 block">{badge('province')}</span>
              <Select value={values.province} onChange={(e) => set('province')(e.target.value)}>
                <option value="">Choose…</option>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </Field>

            {text('postalCode', 'Postal code', { className: 'sm:col-span-2' })}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink">Education and experience</h2>

          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Field label="Highest education" composite>
              <span className="mb-1 block">{badge('educationLevel')}</span>
              <Select value={values.educationLevel} onChange={(e) => set('educationLevel')(e.target.value)}>
                <option value="">Choose…</option>
                {EDUCATION_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </Select>
            </Field>
            {text('yearGraduated', 'Year finished', { type: 'number' })}

            {text('school', 'School or university', { className: 'sm:col-span-2' })}
            {text('course', 'Course or degree', { className: 'sm:col-span-2' })}

            {text('currentTitle', 'Current or last job title')}
            {text('currentEmployer', 'Current or last employer')}

            {text('yearsExperience', 'Years of experience', { type: 'number' })}
            {text('availableFrom', 'Available from', { type: 'date' })}

            {text('currentSalary', 'Current salary', { type: 'number', hint: 'Internal. Never shown to the applicant.' })}
            {text('expectedSalary', 'Expected salary', { type: 'number' })}

            {text('linkedinUrl', 'LinkedIn')}
            {text('portfolioUrl', 'Portfolio or website')}
          </div>

          <Field label="Skills" hint="Press Enter after each one." composite>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-line p-2">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2"
                >
                  {skill}
                  <button
                    onClick={() => setSkills((s) => s.filter((x) => x !== skill))}
                    className="text-ink-3 hover:text-critical"
                    aria-label={`Remove ${skill}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ',') return
                  e.preventDefault()
                  const value = skillDraft.trim()
                  if (value && !skills.includes(value) && skills.length < 30) {
                    setSkills((s) => [...s, value])
                  }
                  setSkillDraft('')
                }}
                placeholder={skills.length ? 'Add another…' : 'e.g. Forklift'}
                className="min-w-[8rem] flex-1 bg-transparent text-[13px] text-ink outline-none"
              />
            </div>
          </Field>

          <Field label="Screening notes" hint="What you thought. Internal, and never shown to the applicant." composite>
            <Textarea
              value={values.screeningNotes}
              onChange={(e) => set('screeningNotes')(e.target.value)}
              rows={3}
            />
          </Field>
        </section>

        {problem && (
          <p role="alert" className="text-[12px] text-critical">
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => window.close()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || busy} loading={busy}>
            <UserPlus className="size-4" />
            Add to pipeline
          </Button>
        </div>
      </div>
    </Shell>
  )
}
