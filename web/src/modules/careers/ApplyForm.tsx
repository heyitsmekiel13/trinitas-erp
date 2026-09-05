import * as React from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileText, Loader2, Sparkles, Trash2, TriangleAlert, Upload, X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { readResume, submitApplication, type ApplicationReceipt, type JobDetail, type ResumeRead } from '@/lib/careersApi'
import { ApiError } from '@/lib/adminApi'
import { EDUCATION_LEVELS, PROVINCES } from './shared'

/**
 * Applying for a job.
 *
 * The whole design rests on one decision: the CV fills the form, and then the
 * person checks it. Not the other way round, and never silently.
 *
 * An applicant tracking system that reads a document and files whatever it
 * found has quietly made the machine the author of somebody's employment
 * record. When it gets a surname wrong — and on Philippine names it will,
 * because "Juan Miguel Dela Cruz" has a two-word surname and no document says
 * so — nobody catches it, because a filled field looks the same as a checked
 * one. So every value the parser produces arrives in an editable input marked
 * as having come from the CV, the mark disappears the moment it is touched,
 * and the last screen before sending is a plain-language summary of what is
 * about to be filed.
 *
 * The other decision worth naming: four short steps rather than one long form.
 * Most of this is completed on a phone, and a thirty-field page on a phone is
 * a page people abandon halfway down.
 */

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
  expectedSalary: string
  linkedinUrl: string
  portfolioUrl: string
  coverLetter: string
}

const EMPTY: Values = {
  firstName: '', middleName: '', lastName: '', email: '', phone: '',
  birthdate: '', gender: '', civilStatus: '', nationality: 'Filipino',
  addressLine: '', city: '', province: '', postalCode: '',
  educationLevel: '', school: '', course: '', yearGraduated: '',
  yearsExperience: '', currentEmployer: '', currentTitle: '',
  availableFrom: '', expectedSalary: '',
  linkedinUrl: '', portfolioUrl: '', coverLetter: '',
}

const STEPS = ['Your CV', 'About you', 'Background', 'Review'] as const

/** Fields the application is genuinely incomplete without, per step. */
const REQUIRED: Record<number, (keyof Values)[]> = {
  1: ['firstName', 'lastName', 'email', 'phone', 'city', 'province'],
  2: [],
}

export function ApplyForm({
  job,
  onSubmitted,
  onCancel,
}: {
  job: JobDetail
  onSubmitted: (receipt: ApplicationReceipt) => void
  onCancel: () => void
}) {
  const [step, setStep] = React.useState(0)
  const [values, setValues] = React.useState<Values>(EMPTY)
  const [skills, setSkills] = React.useState<string[]>([])
  const [skillDraft, setSkillDraft] = React.useState('')
  const [consent, setConsent] = React.useState(false)

  const [resume, setResume] = React.useState<ResumeRead | null>(null)
  const [reading, setReading] = React.useState(false)
  const [readError, setReadError] = React.useState('')

  /** Which fields still hold exactly what the CV said. Drives the badges. */
  const [fromResume, setFromResume] = React.useState<Set<keyof Values>>(new Set())

  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  const set = (key: keyof Values) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    // Touched by a human, so it is no longer the machine's answer.
    setFromResume((marked) => {
      if (!marked.has(key)) return marked
      const next = new Set(marked)
      next.delete(key)
      return next
    })
    setFieldErrors((errors) => {
      if (!errors[key]) return errors
      const { [key]: _removed, ...rest } = errors
      return rest
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Step 1 — the CV                                                         */
  /* ---------------------------------------------------------------------- */

  const takeFile = async (file: File | null | undefined) => {
    if (!file) return

    setReading(true)
    setReadError('')

    try {
      const read = await readResume(file)
      setResume(read)

      // Only blank fields are filled. Somebody who typed their number and then
      // uploaded a CV meant the number they typed.
      const filled = new Set<keyof Values>()

      setValues((current) => {
        const next = { ...current }

        for (const [key, value] of Object.entries(read.fields)) {
          const field = key as keyof Values

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
    } catch (error) {
      setReadError((error as Error).message)
    } finally {
      setReading(false)
    }
  }

  const dropZone = (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void takeFile(e.dataTransfer.files?.[0])
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-5 py-9 text-center transition-colors',
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
          <p className="text-[13px] font-medium text-ink">Reading your CV…</p>
          <p className="text-[11px] text-ink-3">This takes a few seconds.</p>
        </>
      ) : (
        <>
          <Upload className="size-6 text-brand-500" />
          <p className="text-[13px] font-medium text-ink">Drop your CV here, or tap to choose one</p>
          <p className="text-[11px] text-ink-3">PDF, Word, or a photo of it. Up to 5 MB.</p>
        </>
      )}
    </label>
  )

  /* ---------------------------------------------------------------------- */
  /* Submitting                                                              */
  /* ---------------------------------------------------------------------- */

  const missing = (forStep: number) =>
    (REQUIRED[forStep] ?? []).filter((field) => values[field].trim() === '')

  const next = () => {
    const gaps = missing(step)

    if (gaps.length) {
      setFieldErrors(Object.fromEntries(gaps.map((field) => [field, 'This one is needed.'])))
      return
    }

    setFieldErrors({})
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const submit = async () => {
    setBusy(true)
    setProblem('')
    setFieldErrors({})

    try {
      const receipt = await submitApplication({
        slug: job.slug,
        ...Object.fromEntries(
          Object.entries(values)
            .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
            .filter(([, value]) => value !== ''),
        ),
        ...(values.yearGraduated ? { yearGraduated: Number(values.yearGraduated) } : {}),
        ...(values.yearsExperience ? { yearsExperience: Number(values.yearsExperience) } : {}),
        ...(values.expectedSalary ? { expectedSalary: Number(values.expectedSalary) } : {}),
        ...(skills.length ? { skills } : {}),
        ...(resume?.token ? { resumeToken: resume.token } : {}),
        consent: true,
      })

      onSubmitted(receipt)
    } catch (error) {
      if (error instanceof ApiError) {
        setProblem(error.message)
        setFieldErrors(
          Object.fromEntries(Object.entries(error.errors).map(([key, list]) => [key, list[0] ?? ''])),
        )

        // Send them back to the step holding the problem rather than leaving
        // them staring at a review page with an error about a field they
        // cannot see.
        const firstBad = Object.keys(error.errors)[0] as keyof Values | undefined

        if (firstBad && REQUIRED[1].includes(firstBad)) setStep(1)
        else if (firstBad && firstBad in EMPTY) setStep(2)
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

  return (
    <div className="card p-0">
      {/* Where they are. Four steps is short enough that showing all four is
          reassuring rather than daunting. */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-4 py-3">
        {STEPS.map((name, index) => (
          <React.Fragment key={name}>
            {index > 0 && <span className="h-px w-4 shrink-0 bg-line" />}
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                index === step
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                  : index < step
                    ? 'text-good'
                    : 'text-ink-3',
              )}
            >
              {index < step ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <span className="tabular">{index + 1}.</span>
              )}
              {name}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        {/* ---------------------------------------------------------------- */}
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Start with your CV</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                Upload it and we will read what we can into the form, so you are checking answers rather than
                typing them. Everything it fills in stays yours to correct on the next screen.
              </p>
            </div>

            {resume ? (
              <div className="rounded-xl border border-line p-3">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 size-5 shrink-0 text-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{resume.filename}</p>

                    {resume.status === 'Parsed' ? (
                      <p className="mt-0.5 text-[12px] text-ink-2">
                        Read {Object.keys(resume.fields).length} details
                        {resume.skills.length ? ` and ${resume.skills.length} skills` : ''} from it.
                        {resume.confidence < 60 && ' Some of it was hard to make out — please check carefully.'}
                      </p>
                    ) : (
                      <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-warning">
                        <TriangleAlert className="mt-px size-3.5 shrink-0" />
                        We could not read this one, but it is attached to your application. Fill the form in by hand.
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
                    title="Remove this CV"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              dropZone
            )}

            {readError && <p className="text-[12px] text-critical">{readError}</p>}

            <p className="text-[12px] text-ink-3">
              Do not have one to hand? You can{' '}
              <button
                onClick={() => setStep(1)}
                className="font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400"
              >
                fill the form in yourself
              </button>{' '}
              instead — a CV is not required.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">About you</h2>
              <p className="mt-1 text-[13px] text-ink-2">
                {fromResume.size > 0
                  ? 'We filled in what your CV told us. Please check every one — a wrong number is a call you never get.'
                  : 'The details we need to be able to contact you.'}
              </p>
            </div>

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              {text('firstName', 'First name', { required: true })}
              {text('lastName', 'Last name', { required: true, hint: 'Including any part like "Dela" or "San".' })}
              {text('middleName', 'Middle name', { className: 'sm:col-span-2' })}

              {text('email', 'Email address', { required: true, type: 'email' })}
              {text('phone', 'Mobile number', { required: true, placeholder: '09XX XXX XXXX' })}

              {text('birthdate', 'Date of birth', { type: 'date' })}
              <Field label="Civil status" composite>
                <span className="mb-1 block">{badge('civilStatus')}</span>
                <Select value={values.civilStatus} onChange={(e) => set('civilStatus')(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  {['Single', 'Married', 'Widowed', 'Separated'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>

              <Field label="Sex" composite>
                <span className="mb-1 block">{badge('gender')}</span>
                <Select value={values.gender} onChange={(e) => set('gender')(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </Select>
              </Field>
              {text('nationality', 'Nationality')}

              {text('addressLine', 'House number and street', { className: 'sm:col-span-2' })}
              {text('city', 'City or municipality', { required: true })}

              <Field label="Province" required error={fieldErrors.province} composite>
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
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Your background</h2>
              <p className="mt-1 text-[13px] text-ink-2">
                None of this is required, but it is what a hiring manager reads first. Leave anything blank
                that does not apply.
              </p>
            </div>

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
              {text('expectedSalary', 'Expected monthly salary', {
                type: 'number',
                hint: 'In pesos. Leave blank if you would rather discuss it.',
              })}

              {text('availableFrom', 'Available from', {
                type: 'date',
                hint: 'When you could start if offered the role.',
              })}
              {text('linkedinUrl', 'LinkedIn', { placeholder: 'https://linkedin.com/in/…' })}

              {text('portfolioUrl', 'Portfolio or website', {
                placeholder: 'https://…',
                className: 'sm:col-span-2',
              })}
            </div>

            {/* Skills as chips rather than a comma-separated box, because the
                recruiter's screen filters on them one at a time. */}
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
                  placeholder={skills.length ? 'Add another…' : 'e.g. Microsoft Excel'}
                  className="min-w-[8rem] flex-1 bg-transparent text-[13px] text-ink outline-none"
                />
              </div>
            </Field>

            <Field label="Anything you would like to add" composite>
              <Textarea
                value={values.coverLetter}
                onChange={(e) => set('coverLetter')(e.target.value)}
                rows={4}
                placeholder="Why this role, or anything your CV does not say."
              />
            </Field>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Check and send</h2>
              <p className="mt-1 text-[13px] text-ink-2">
                This is exactly what will be filed against{' '}
                <span className="font-medium text-ink">{job.title}</span>.
              </p>
            </div>

            <dl className="grid gap-x-5 gap-y-2 rounded-xl border border-line p-4 text-[13px] sm:grid-cols-2">
              {[
                ['Name', [values.firstName, values.middleName, values.lastName].filter(Boolean).join(' ')],
                ['Email', values.email],
                ['Mobile', values.phone],
                ['Where you live', [values.city, values.province].filter(Boolean).join(', ')],
                ['Education', [values.educationLevel, values.course].filter(Boolean).join(' · ')],
                ['School', values.school],
                ['Currently', [values.currentTitle, values.currentEmployer].filter(Boolean).join(' at ')],
                ['Experience', values.yearsExperience ? `${values.yearsExperience} years` : ''],
                ['Expected salary', values.expectedSalary ? `₱${Number(values.expectedSalary).toLocaleString('en-PH')}` : ''],
                ['CV attached', resume ? resume.filename : 'None'],
                ['Skills', skills.join(', ')],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[11px] tracking-wide text-ink-3 uppercase">{label}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
            </dl>

            {/* Consent is a decision, not a formality, so it is stated in the
                words of the thing being agreed to and unticked by default. */}
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--brand-500,#2563eb)]"
              />
              <span className="text-[12px] leading-relaxed text-ink-2">
                I confirm the details above are mine and are true, and I agree that they and my CV may be held
                and used to consider me for work here, under the Data Privacy Act of 2012. I can ask for a copy
                or for them to be removed at any time.
              </span>
            </label>

            {problem && (
              <p role="alert" className="text-[12px] text-critical">
                {problem}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <Button
          variant="ghost"
          onClick={() => (step === 0 ? onCancel() : setStep((s) => s - 1))}
          disabled={busy}
        >
          <ArrowLeft className="size-4" />
          {step === 0 ? 'Back to the role' : 'Back'}
        </Button>

        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={reading}>
            Continue
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={() => void submit()} disabled={!consent || busy} loading={busy}>
            Send application
          </Button>
        )}
      </div>
    </div>
  )
}
