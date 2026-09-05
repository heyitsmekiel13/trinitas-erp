import * as React from 'react'
import {
  Award, Check, ChevronDown, FileText, Languages, Loader2, RefreshCw, Sparkles,
  TriangleAlert, Upload,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  getOcrHealth, openApplicantResume, reassessApplicant, updateApplicantDetails, uploadApplicantResume,
  type ApplicantDetail, type Assessment, type OcrHealth, type ParsedResumeFields,
} from '@/lib/adminApi'
import { fmtDate, money } from '@/lib/format'
import { Badge, Button, Textarea } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'

/**
 * Everything on an applicant that is not their stage.
 *
 * Recruitment's panel used to show a name, an email, a phone number and a row
 * of stage buttons, which is enough to move somebody through a pipeline and
 * nowhere near enough to decide whether they should be in it. This is the
 * rest: where they live, what they studied, what they have done, what they
 * want to be paid, and the CV itself.
 *
 * The part worth explaining is "What the CV said".
 *
 * The parser reads a document and produces a set of guesses. Those guesses are
 * stored, but they are stored *separately* from the applicant's fields and
 * they are never written into them by anything except a person clicking a
 * button here. So the panel can show a recruiter, field by field, what the
 * machine thought and what the record currently says, and let them take one,
 * some or none of it.
 *
 * That is slower than merging automatically. It is also the only version of
 * this that stays honest at scale: once a parsed value is indistinguishable
 * from a confirmed one, nobody ever checks it again, and a misread surname
 * follows the person into their 201 file and their payslip.
 */

/** Which parsed keys map onto which stored value, and how each one reads. */
const SUGGESTIBLE: { key: keyof ParsedResumeFields; label: string; of: (a: ApplicantDetail) => unknown }[] = [
  { key: 'firstName', label: 'First name', of: (a) => a.firstName },
  { key: 'middleName', label: 'Middle name', of: (a) => a.middleName },
  { key: 'lastName', label: 'Last name', of: (a) => a.lastName },
  { key: 'email', label: 'Email', of: (a) => a.email },
  { key: 'phone', label: 'Mobile', of: (a) => a.phone },
  { key: 'birthdate', label: 'Date of birth', of: (a) => a.personal.birthdate },
  { key: 'gender', label: 'Sex', of: (a) => a.personal.gender },
  { key: 'civilStatus', label: 'Civil status', of: (a) => a.personal.civilStatus },
  { key: 'nationality', label: 'Nationality', of: (a) => a.personal.nationality },
  { key: 'addressLine', label: 'Street', of: (a) => a.personal.addressLine },
  { key: 'city', label: 'City', of: (a) => a.personal.city },
  { key: 'province', label: 'Province', of: (a) => a.personal.province },
  { key: 'postalCode', label: 'Postal code', of: (a) => a.personal.postalCode },
  { key: 'educationLevel', label: 'Education', of: (a) => a.background.educationLevel },
  { key: 'school', label: 'School', of: (a) => a.background.school },
  { key: 'course', label: 'Course', of: (a) => a.background.course },
  { key: 'yearGraduated', label: 'Year finished', of: (a) => a.background.yearGraduated },
  { key: 'yearsExperience', label: 'Years of experience', of: (a) => a.background.yearsExperience },
  { key: 'currentTitle', label: 'Current title', of: (a) => a.background.currentTitle },
  { key: 'currentEmployer', label: 'Current employer', of: (a) => a.background.currentEmployer },
  { key: 'linkedinUrl', label: 'LinkedIn', of: (a) => a.background.linkedinUrl },
  { key: 'portfolioUrl', label: 'Portfolio', of: (a) => a.background.portfolioUrl },
]

/** "2019-03" as "Mar 2019". The CV's own precision, not more. */
function monthLabel(ym: string): string {
  const [year, month] = ym.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const index = Number(month) - 1

  return names[index] ? `${names[index]} ${year}` : ym
}

/** A span of months as somebody would say it out loud. */
function tenure(months: number): string {
  if (months < 12) return `${months} mo`

  const years = Math.floor(months / 12)
  const rest = months % 12

  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`
}

const SIGNAL_TONE: Record<string, string> = {
  met: 'text-good',
  partial: 'text-warning',
  missing: 'text-critical',
  unknown: 'text-ink-3',
}

const SIGNAL_MARK: Record<string, string> = {
  met: '✓',
  partial: '~',
  missing: '✕',
  unknown: '?',
}

const BAND_TONE: Record<string, 'good' | 'info' | 'warning' | 'neutral'> = {
  'Strong match': 'good',
  Possible: 'info',
  'Weak match': 'warning',
  'Not enough to say': 'neutral',
}

/**
 * The screening opinion, shown as reasoning rather than as a verdict.
 *
 * The layout is the argument: the band and the sentence first, then the
 * signals that produced them, then every requirement on the advert with the
 * words from the CV that decided it. A recruiter who disagrees can see exactly
 * which line to disagree with, which is the whole difference between a
 * screening aid and an automated rejection.
 *
 * Concerns sit apart and are stated as not affecting the number, because they
 * are things to raise in an interview rather than reasons to skip one.
 */
function AssessmentPanel({
  assessment,
  onReassess,
  busy,
}: {
  assessment: Assessment
  onReassess: () => void
  busy: boolean
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5">
            <Badge tone={BAND_TONE[assessment.band] ?? 'neutral'}>{assessment.band}</Badge>
            <span className="tabular text-[13px] font-semibold text-ink">{assessment.score}</span>
            <span className="text-[11px] text-ink-3">/ 100</span>
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{assessment.summary}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onReassess} disabled={busy} title="Re-read against the advert as it now stands">
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
          Re-assess
        </Button>
      </div>

      <div className="mt-2 space-y-1">
        {assessment.signals.map((signal) => (
          <div key={signal.label} className="flex items-baseline gap-2 text-[12px]">
            <span className={cn('w-3 shrink-0 text-center font-bold', SIGNAL_TONE[signal.status])}>
              {SIGNAL_MARK[signal.status]}
            </span>
            <span className="w-24 shrink-0 text-[11px] text-ink-3">{signal.label}</span>
            <span className="min-w-0 flex-1 text-ink-2">{signal.detail}</span>
          </div>
        ))}
      </div>

      {assessment.concerns.length > 0 && (
        <div className="mt-2 rounded bg-surface-2 p-2">
          <p className="mb-1 text-[10px] font-medium tracking-wide text-ink-3 uppercase">
            Worth raising — does not affect the score
          </p>
          {assessment.concerns.map((concern) => (
            <p key={concern} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-2">
              <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
              {concern}
            </p>
          ))}
        </div>
      )}

      {(assessment.requirements.length > 0 || assessment.missingSkills.length > 0) && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-brand-600"
          >
            <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
            {open ? 'Hide' : 'Show'} the advert, line by line
          </button>

          {open && (
            <div className="mt-1.5 space-y-1.5">
              {assessment.requirements.map((requirement) => (
                <div key={requirement.text} className="flex items-start gap-2 text-[12px]">
                  <span className={cn('w-3 shrink-0 text-center font-bold', SIGNAL_TONE[requirement.status])}>
                    {SIGNAL_MARK[requirement.status]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-2">{requirement.text}</span>
                    {requirement.evidence.length > 0 && (
                      <span className="mt-0.5 block text-[10px] text-ink-3">
                        found in the CV: {requirement.evidence.join(', ')}
                      </span>
                    )}
                  </span>
                </div>
              ))}

              {assessment.missingSkills.length > 0 && (
                <p className="text-[11px] text-ink-3">
                  Named on the advert, not evidenced:{' '}
                  <span className="text-ink-2">{assessment.missingSkills.join(', ')}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
        A reading aid for ordering a stack of applications. It never moves anybody through a stage, and a low
        score is a reason to read the CV rather than a reason not to.
      </p>
    </div>
  )
}

export function ApplicantDossier({
  applicant,
  onChanged,
}: {
  applicant: ApplicantDetail
  onChanged: (next: ApplicantDetail) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [showExcerpt, setShowExcerpt] = React.useState(false)
  const [notes, setNotes] = React.useState(applicant.screeningNotes ?? '')
  const [editingNotes, setEditingNotes] = React.useState(false)

  React.useEffect(() => {
    setNotes(applicant.screeningNotes ?? '')
    setEditingNotes(false)
  }, [applicant.id, applicant.screeningNotes])

  const resume = applicant.resume

  /* Fetched only when it might explain something on screen — an unreadable
     scan or a low-confidence OCR read — rather than on every dossier open. */
  const [ocrHealth, setOcrHealth] = React.useState<OcrHealth | null>(null)
  const wantsOcrHealth = resume?.method === 'ocr' && (resume.status === 'Unreadable' || resume.confidence < 50)

  React.useEffect(() => {
    if (!wantsOcrHealth) return
    getOcrHealth().then(setOcrHealth).catch(() => setOcrHealth(null))
  }, [wantsOcrHealth])

  /* Only the fields where the CV says something the record does not already
     say. A suggestion that matches what is stored is not a suggestion. */
  const suggestions = React.useMemo(() => {
    if (!resume) return []

    return SUGGESTIBLE.filter((field) => {
      const read = resume.parsedFields[field.key]
      if (read === undefined || read === null || read === '') return false

      const stored = field.of(applicant)

      return String(stored ?? '').trim().toLowerCase() !== String(read).trim().toLowerCase()
    })
  }, [applicant, resume])

  const newSkills = React.useMemo(
    () => (resume?.parsedSkills ?? []).filter((skill) => !applicant.skills.includes(skill)),
    [applicant.skills, resume],
  )

  const write = async (values: Record<string, unknown>, label: string) => {
    setBusy(label)
    try {
      onChanged(await updateApplicantDetails(applicant.id, values))
      toast({ tone: 'success', title: `${label} updated` })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save that.', description: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const acceptAll = () =>
    void write(
      Object.fromEntries(suggestions.map((field) => [field.key, resume!.parsedFields[field.key]])),
      'Details',
    )

  const reassess = async () => {
    setBusy('assessment')
    try {
      onChanged(await reassessApplicant(applicant.id))
    } catch (error) {
      toast({ tone: 'error', title: 'Could not re-assess.', description: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const replaceResume = async (file: File | null | undefined) => {
    if (!file) return

    setBusy('resume')
    try {
      onChanged(await uploadApplicantResume(applicant.id, file))
      toast({ tone: 'success', title: 'CV attached and read' })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not attach that file.', description: (error as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const rows: [string, React.ReactNode][] = [
    ['Where they live', [applicant.personal.city, applicant.personal.province].filter(Boolean).join(', ')],
    [
      'Education',
      [applicant.background.educationLevel, applicant.background.course].filter(Boolean).join(' · '),
    ],
    ['School', applicant.background.school],
    [
      'Currently',
      [applicant.background.currentTitle, applicant.background.currentEmployer].filter(Boolean).join(' at '),
    ],
    [
      'Experience',
      applicant.background.yearsExperience != null ? `${applicant.background.yearsExperience} years` : null,
    ],
    ['Expects', applicant.expectedSalary ? money(applicant.expectedSalary) : null],
    [
      'Can start',
      applicant.background.availableFrom ? fmtDate(applicant.background.availableFrom) : null,
    ],
    [
      'Links',
      [applicant.background.linkedinUrl, applicant.background.portfolioUrl].filter(Boolean).length > 0 ? (
        <span className="flex flex-wrap gap-x-3">
          {applicant.background.linkedinUrl && (
            <a
              href={applicant.background.linkedinUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-600 underline underline-offset-2 dark:text-brand-400"
            >
              LinkedIn
            </a>
          )}
          {applicant.background.portfolioUrl && (
            <a
              href={applicant.background.portfolioUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-600 underline underline-offset-2 dark:text-brand-400"
            >
              Portfolio
            </a>
          )}
        </span>
      ) : null,
    ],
  ]

  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')

  return (
    <div className="space-y-3 border-t border-line pt-3">
      {/* ----------------------------------------------------------------- */}
      {shown.length > 0 && (
        <dl className="grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
          {shown.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</dt>
              <dd className="text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {applicant.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {applicant.skills.map((skill) => (
            <span
              key={skill}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {applicant.coverLetter && (
        <div className="rounded-lg bg-surface-2 p-2.5">
          <p className="mb-1 text-[10px] font-medium tracking-wide text-ink-3 uppercase">In their words</p>
          <p className="text-[12px] leading-relaxed whitespace-pre-line text-ink-2">{applicant.coverLetter}</p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {applicant.assessment && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            Against the advert
          </p>
          <AssessmentPanel
            assessment={applicant.assessment}
            busy={busy === 'assessment'}
            onReassess={() => void reassess()}
          />
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      <div className="border-t border-line pt-3">
        <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">CV</p>

        {resume ? (
          <div className="rounded-lg border border-line p-2.5">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 size-4 shrink-0 text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-ink">{resume.filename ?? 'Document'}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {resume.uploadedAt && `Uploaded ${fmtDate(resume.uploadedAt.slice(0, 10))}`}
                  {resume.bytes != null && ` · ${Math.max(1, Math.round(resume.bytes / 1024))} KB`}
                  {resume.status === 'Parsed' && ` · read ${resume.confidence}% confident`}
                  {resume.method === 'ocr' && ' · text recognition'}
                </p>

                {resume.status === 'Parsed' && resume.confidence < 50 && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-warning">
                    <TriangleAlert className="mt-px size-3 shrink-0" />
                    <span>
                      <Badge tone="warning" className="mr-1">Needs manual review</Badge>
                      Confidence is low — check every field below against the CV before trusting a suggestion.
                    </span>
                  </p>
                )}

                {resume.status === 'Unreadable' && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-warning">
                    <TriangleAlert className="mt-px size-3 shrink-0" />
                    No readable text — the file is on record but nothing was extracted from it.
                  </p>
                )}

                {wantsOcrHealth && ocrHealth && !ocrHealth.available && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] text-ink-3">
                    <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
                    This is a scanned or photographed document and text recognition is not installed on this
                    server, so nothing could be read from it. Ask the candidate for a text-based PDF or DOCX
                    instead, or have your administrator install Tesseract OCR.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void openApplicantResume(applicant.id).catch((error) =>
                    toast({ tone: 'error', title: 'Could not open the CV.', description: (error as Error).message }),
                  )
                }}
              >
                <FileText className="size-3.5" />
                Open CV
              </Button>

              <ResumeUploadButton
                busy={busy === 'resume'}
                label="Replace"
                onFile={(file) => void replaceResume(file)}
              />
            </div>

            {resume.excerpt && (
              <div className="mt-2">
                <button
                  onClick={() => setShowExcerpt((s) => !s)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 hover:text-brand-600"
                >
                  <ChevronDown className={cn('size-3 transition-transform', showExcerpt && 'rotate-180')} />
                  {showExcerpt ? 'Hide' : 'Show'} what was read from it
                </button>
                {showExcerpt && (
                  <pre className="mt-1.5 max-h-56 overflow-auto rounded bg-surface-2 p-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-3">
                    {resume.excerpt}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line p-3 text-center">
            <p className="text-[12px] text-ink-3">No CV on file.</p>
            <ResumeUploadButton
              busy={busy === 'resume'}
              label="Attach a CV"
              className="mt-2"
              onFile={(file) => void replaceResume(file)}
            />
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {resume && (resume.positions.length > 0 || resume.certifications.length > 0) && (
        <div className="border-t border-line pt-3">
          <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
            Read from the CV
          </p>

          {/* The work history with its dates. This is what "six years of
              experience" is actually made of, and it is the difference between
              a claim on a form and something a screener can check. */}
          {resume.positions.length > 0 && (
            <ol className="space-y-1.5">
              {resume.positions.map((position, index) => (
                <li key={`${position.title ?? ''}-${position.from ?? index}`} className="flex gap-2">
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      position.current ? 'bg-good' : 'bg-line-strong',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-ink">
                      {position.title ?? 'Position'}
                      {position.employer && <span className="font-normal text-ink-2"> · {position.employer}</span>}
                    </span>
                    <span className="block text-[11px] text-ink-3">
                      {position.from ? monthLabel(position.from) : '—'} –{' '}
                      {position.current ? 'present' : position.to ? monthLabel(position.to) : '—'}
                      {position.months ? ` · ${tenure(position.months)}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {resume.education.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {resume.education.map((entry, index) => (
                <li key={`${entry.school ?? ''}-${index}`} className="text-[12px] text-ink-2">
                  {[entry.course, entry.school].filter(Boolean).join(' · ')}
                  {entry.year ? <span className="text-ink-3"> · {entry.year}</span> : null}
                </li>
              ))}
            </ul>
          )}

          {resume.certifications.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
              <Award className="size-3.5 shrink-0 text-brand-500" />
              {resume.certifications.join(' · ')}
            </p>
          )}

          {resume.languages.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-2">
              <Languages className="size-3.5 shrink-0 text-brand-500" />
              {resume.languages.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {resume && (suggestions.length > 0 || newSkills.length > 0) && (
        <div className="rounded-lg border border-brand-300 bg-brand-50 p-2.5 dark:border-brand-800 dark:bg-brand-950">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
              <Sparkles className="size-3" />
              What the CV said
            </p>
            {suggestions.length > 1 && (
              <Button size="sm" variant="ghost" onClick={acceptAll} disabled={busy !== null}>
                <Check className="size-3.5" />
                Use all {suggestions.length}
              </Button>
            )}
          </div>

          <p className="mb-2 text-[11px] leading-relaxed text-ink-3">
            Read from the document and not yet on the record. Nothing here is saved until you say so.
          </p>

          <div className="space-y-1">
            {suggestions.map((field) => {
              const read = resume.parsedFields[field.key]
              const stored = field.of(applicant)

              return (
                <div key={field.key} className="flex items-center gap-2 text-[12px]">
                  <span className="w-28 shrink-0 text-[11px] text-ink-3">{field.label}</span>
                  <span className="min-w-0 flex-1 truncate text-ink" title={String(read)}>
                    {String(read)}
                    {stored ? (
                      <span className="ml-1.5 text-[11px] text-ink-3 line-through">{String(stored)}</span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void write({ [field.key]: read }, field.label)}
                  >
                    <Check className="size-3.5" />
                    Use
                  </Button>
                </div>
              )
            })}

            {newSkills.length > 0 && (
              <div className="flex items-center gap-2 border-t border-brand-200 pt-1.5 text-[12px] dark:border-brand-900">
                <span className="w-28 shrink-0 text-[11px] text-ink-3">Skills</span>
                <span className="min-w-0 flex-1 truncate text-ink" title={newSkills.join(', ')}>
                  {newSkills.join(', ')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void write({ skills: [...applicant.skills, ...newSkills] }, 'Skills')}
                >
                  <Check className="size-3.5" />
                  Add
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      <div className="border-t border-line pt-3">
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Screening notes</p>

        {editingNotes ? (
          <>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                disabled={busy !== null}
                loading={busy === 'Screening notes'}
                onClick={() => void write({ screeningNotes: notes }, 'Screening notes').then(() => setEditingNotes(false))}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNotes(applicant.screeningNotes ?? '')
                  setEditingNotes(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <button
            onClick={() => setEditingNotes(true)}
            className="w-full rounded-lg border border-dashed border-line p-2 text-left text-[12px] leading-relaxed text-ink-2 transition-colors hover:border-brand-400 hover:bg-surface-2"
          >
            {applicant.screeningNotes || <span className="text-ink-3">Add a note about this candidate…</span>}
          </button>
        )}
      </div>

      {/* Consent is worth showing, not burying: it is the record that this
          person agreed to us holding their file. */}
      {applicant.appliedVia === 'Careers Portal' && (
        <p className="text-[11px] text-ink-3">
          Applied through the careers site
          {applicant.reference && ` · ref ${applicant.reference}`}
          {applicant.consentedAt && ` · consented ${fmtDate(applicant.consentedAt)}`}
        </p>
      )}
    </div>
  )
}

/** A file picker that looks like the rest of the buttons. */
function ResumeUploadButton({
  onFile,
  busy,
  label,
  className,
}: {
  onFile: (file: File | undefined) => void
  busy: boolean
  label: string
  className?: string
}) {
  return (
    <label
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] font-medium text-ink-2',
        'transition-colors hover:border-brand-400 hover:bg-surface-2',
        busy && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <input
        type="file"
        accept=".pdf,.doc,.docx,.rtf,.txt,.png,.jpg,.jpeg,.webp"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
      {label}
    </label>
  )
}

/** How the application arrived, shown on the board beside the name. */
export function SourceBadge({ applicant }: { applicant: ApplicantDetail }) {
  return applicant.appliedVia === 'Careers Portal' ? (
    <Badge tone="info">Careers site</Badge>
  ) : (
    <Badge tone="neutral">{applicant.source}</Badge>
  )
}
