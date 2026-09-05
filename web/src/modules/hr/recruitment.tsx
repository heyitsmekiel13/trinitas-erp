import * as React from 'react'
import {
  Briefcase, CheckCircle2, ExternalLink, FilePlus2, Globe, UserPlus, Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource, queryClient } from '@/lib/api'
import {
  getApplicant,
  getPipeline,
  hireApplicant,
  liveApi,
  moveApplicant,
  type ApplicantDetail,
  type ProfileGap,
  type RecruitmentPipeline,
} from '@/lib/adminApi'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Combobox, Field, Input } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { ApplicantDossier } from './applicantDossier'
import { OpenVacancies } from './vacancies'
import { GuidedStep, STAGE_TONE, StageRail, stageBar, stageOf } from './pipeline'
import { NewHireGaps } from './onboarding'
import { OfferPanel } from './offer'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'

/**
 * Opens one of recruitment's forms in its own tab.
 *
 * Both intake forms left this screen for a tab of their own. They are long
 * enough to deserve a page, and — the reason it actually matters — a recruiter
 * working through a stack of CVs keys one applicant after another while the
 * board stays where it was, filtered as they left it. A modal made that a
 * cycle of open, fill, close, re-filter.
 *
 * `noopener` because these are same-origin pages that have no business
 * reaching back into this one through `window.opener`.
 */
const openTab = (path: string) => window.open(path, '_blank', 'noopener')

/**
 * Recruitment as a pipeline rather than a list.
 *
 * The API has enforced the stage order and the hire transaction for a while;
 * the screen was still a flat table where the only way to change anything was
 * to edit a stage column. So the moves the server will accept are now the
 * buttons on screen, and hiring is the dialog it deserves — it creates a 201
 * file and a sign-in, which is not something to trigger from a dropdown.
 */


/** The hire dialog. Everything a 201 file cannot be created without. */
function HireDialog({
  applicant,
  open,
  onClose,
  onHired,
}: {
  applicant: ApplicantDetail
  open: boolean
  onClose: () => void
  onHired: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [issued, setIssued] = React.useState<{
    employeeNo: string
    username?: string
    password?: string
    profile: { status: string; summary: string; missing: ProfileGap[] }
  } | null>(null)

  /* The name parts, when the application carried them — which it does for
     anybody who applied through the careers site or was encoded on the intake
     form. Splitting the display name on spaces is the fallback, and it gets
     compound surnames wrong, so it is not used when the real answer is on
     record. */
  const parts = applicant.name.trim().split(/\s+/)
  const [firstName, setFirstName] = React.useState(applicant.firstName ?? parts[0] ?? '')
  const [lastName, setLastName] = React.useState(
    applicant.lastName ?? (parts.length > 1 ? parts[parts.length - 1]! : ''),
  )
  const [dateHired, setDateHired] = React.useState(new Date().toISOString().slice(0, 10))
  const [salary, setSalary] = React.useState<number | null>(applicant.expectedSalary)
  const [departmentId, setDepartmentId] = React.useState<number | null>(null)
  const [branchId, setBranchId] = React.useState<number | null>(null)
  const [payrollGroupId, setPayrollGroupId] = React.useState<number | null>(null)

  const { data: departments = [] } = useResource<Record<string, unknown>[]>('hr/departments', () => [])
  const { data: branches = [] } = useResource<Record<string, unknown>[]>('hr/branch-units', () => [])
  const { data: payrollGroups = [] } = useResource<Record<string, unknown>[]>('hr/payroll-groups', () => [])

  const opts = (rows: Record<string, unknown>[]) =>
    rows.map((r) => ({ value: Number(r.id), label: String(r.name ?? r.code ?? ''), sublabel: String(r.code ?? '') }))

  const submit = async () => {
    setBusy(true)
    setProblem('')
    try {
      const result = await hireApplicant(applicant.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        ...(applicant.middleName ? { middleName: applicant.middleName } : {}),
        ...(applicant.email ? { email: applicant.email } : {}),
        ...(applicant.phone ? { mobile: applicant.phone } : {}),
        dateHired,
        ...(salary != null ? { salary } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(branchId ? { branchId } : {}),
        ...(payrollGroupId ? { payrollGroupId } : {}),
      })

      setIssued({
        employeeNo: result.employee.employeeNo,
        username: result.credentials.username,
        password: result.credentials.password,
        profile: result.profile,
      })
      toast({ tone: 'success', title: `${result.employee.name} hired`, description: result.employee.employeeNo })
      onHired()
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Once hired, the dialog becomes the handover slip — the password is shown
  // exactly once and is never recoverable afterwards.
  if (issued) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Hired"
        description="The 201 file and the sign-in have been created."
        size="sm"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-[13px] text-good">
            <CheckCircle2 className="size-4" />
            Employee number {issued.employeeNo}
          </p>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Sign-in to hand over</p>
            <p className="tabular mt-1 text-[15px] font-semibold text-ink">
              {issued.username} / {issued.password}
            </p>
            <p className="mt-1.5 text-[11px] text-ink-3">
              They must change this on first sign-in. It is not stored in a readable form, so write it down now
              — this is the only time it is shown.
            </p>
          </div>

          {/* What the application could not answer. Said here because whoever
              pressed Hire is certainly looking at the screen right now; the
              banner, the badge and the bell exist for when nobody is. */}
          <NewHireGaps profile={issued.profile} />
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Hire ${applicant.name}`}
      description="Creates the 201 file, issues the sign-in, and counts the seat against the manpower request."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!firstName.trim() || !lastName.trim() || busy} loading={busy}>
            Hire
          </Button>
        </>
      }
    >
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field label="First name" required>
          <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>

        <Field label="Department" hint="Taken from the manpower request when it names one." composite>
          <Combobox
            value={departmentId}
            options={opts(departments)}
            onChange={(v) => setDepartmentId(v === null ? null : Number(v))}
            placeholder="From the requisition"
          />
        </Field>
        <Field label="Branch" composite>
          <Combobox
            value={branchId}
            options={opts(branches)}
            onChange={(v) => setBranchId(v === null ? null : Number(v))}
            placeholder="From the requisition"
          />
        </Field>

        <Field
          label="Payroll group"
          required
          hint="Decides which cut-off they are paid on — never guessed."
          composite
        >
          <Combobox
            value={payrollGroupId}
            options={opts(payrollGroups)}
            onChange={(v) => setPayrollGroupId(v === null ? null : Number(v))}
            placeholder="Choose…"
          />
        </Field>
        <Field label="Date hired" required>
          <Input type="date" value={dateHired} onChange={(e) => setDateHired(e.target.value)} />
        </Field>

        <Field label="Salary" hint="Defaults to the requisition's budget rate." className="sm:col-span-2" composite>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">₱</span>
            <Input
              type="number"
              className="tabular pl-7 text-right"
              value={salary ?? ''}
              onChange={(e) => setSalary(e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </Field>
      </div>

      <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[11px] leading-relaxed text-ink-3">
        New hires start on <strong className="text-ink-2">probation</strong>. Under Philippine law that runs six
        months from the date hired unless the role is apprenticed or seasonal — regularisation is a separate
        change to the 201 file.
      </p>

      {problem && (
        <p role="alert" className="mt-2 text-[12px] text-critical">
          {problem}
        </p>
      )}
    </Modal>
  )
}

/** One applicant, with the moves the server will accept. */
function ApplicantPanel({
  id,
  onChanged,
}: {
  id: number
  onChanged: () => void
}) {
  const toast = useToast()
  const [applicant, setApplicant] = React.useState<ApplicantDetail | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [hiring, setHiring] = React.useState(false)
  const [offering, setOffering] = React.useState(false)

  const load = React.useCallback(async () => {
    try {
      setApplicant(await getApplicant(id))
    } catch {
      setApplicant(null)
    }
  }, [id])

  React.useEffect(() => {
    void load()
  }, [load])

  const move = async (stage: string) => {
    setBusy(true)
    try {
      setApplicant(await moveApplicant(id, stage))
      onChanged()
      toast({ tone: 'success', title: `Moved to ${stage}` })
    } catch (err) {
      toast({ tone: 'error', title: 'Could not move them.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!applicant) return <p className="p-4 text-xs text-ink-3">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-ink">{applicant.name}</p>
          <p className="mt-0.5 text-[12px] text-ink-2">
            {applicant.code}
            {applicant.position && ` · ${applicant.position}`}
            {applicant.department && ` · ${applicant.department}`}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {applicant.source} · applied {applicant.applied ? fmtDate(applicant.applied) : '—'}
            {applicant.requisition && ` · ${applicant.requisition}`}
          </p>
        </div>
        <Badge tone={STAGE_TONE[applicant.stage] ?? 'neutral'}>{applicant.stage}</Badge>
      </div>

      {(applicant.email || applicant.phone) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink-2">
          {applicant.email && <a href={`mailto:${applicant.email}`} className="hover:text-brand-600">{applicant.email}</a>}
          {applicant.phone && <a href={`tel:${applicant.phone}`} className="hover:text-brand-600">{applicant.phone}</a>}
        </div>
      )}

      {/* The cycle, as a guided step.
          The rules have not changed — the server has always decided what may
          follow what. What changed is that the screen now says where they are,
          what the stage is for, and what the one obvious next act is, instead
          of showing three same-looking buttons named after stages. */}
      <div className="border-t border-line pt-3">
        <GuidedStep
          applicant={applicant}
          busy={busy}
          onMove={(stage) => void move(stage)}
          onHire={() => setHiring(true)}
          onOffer={() => setOffering(true)}
        />
      </div>

      <OfferPanel
        applicant={applicant}
        onChanged={setApplicant}
        composing={offering}
        onCompose={setOffering}
      />

      <ApplicantDossier applicant={applicant} onChanged={setApplicant} />

      {hiring && (
        <HireDialog
          applicant={applicant}
          open={hiring}
          onClose={() => {
            setHiring(false)
            void load()
          }}
          onHired={() => {
            onChanged()
            // The masterfile and the requisition both changed.
            void queryClient.invalidateQueries({ queryKey: ['resource'] })
          }}
        />
      )}
    </div>
  )
}

export function RecruitmentBoard() {
  const [pipeline, setPipeline] = React.useState<RecruitmentPipeline | null>(null)
  const [selected, setSelected] = React.useState<number | null>(null)
  const [stageFilter, setStageFilter] = React.useState<string | null>(null)

  const { data: applicants = [], refetch } = useResource<Record<string, unknown>[]>('hr/applicants', () => [])
  const { data: requisitions = [], refetch: refetchRequisitions } =
    useResource<Record<string, unknown>[]>('hr/requisitions', () => [])

  const loadPipeline = React.useCallback(async () => {
    if (!liveApi()) return
    try {
      setPipeline(await getPipeline())
    } catch {
      setPipeline(null)
    }
  }, [])

  React.useEffect(() => {
    void loadPipeline()
  }, [loadPipeline])

  const refresh = React.useCallback(() => {
    void refetch()
    void refetchRequisitions()
    void loadPipeline()
    void queryClient.invalidateQueries({ queryKey: ['resource'] })
  }, [refetch, refetchRequisitions, loadPipeline])

  /*
   * The intake forms now live in other tabs, so nothing on this page knows
   * when one of them saved. Coming back to this tab is the signal: it is what
   * a recruiter does immediately after adding somebody, and re-reading three
   * lists at that moment is cheap.
   */
  React.useEffect(() => {
    const onFocus = () => refresh()

    window.addEventListener('focus', onFocus)

    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const shown = React.useMemo(
    () => (stageFilter ? applicants.filter((a) => a.stage === stageFilter) : applicants),
    [applicants, stageFilter],
  )

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Recruitment" description="Manpower requests, the applicant pipeline and hiring." />
        <div className="card">
          <EmptyState icon={Users} title="Recruitment needs the live API" description="Applicants are read and written straight to the database." />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Recruitment"
        description="Applicants against approved vacancies — moved a stage at a time, and hired into the masterfile."
        actions={
          <>
            <Button variant="ghost" onClick={() => openTab('/careers')} title="The public job board, as a candidate sees it">
              <Globe className="size-4" />
              Careers site
            </Button>
            <Button variant="ghost" onClick={() => openTab('/hr/manpower-request')}>
              <FilePlus2 className="size-4" />
              Raise manpower request
              <ExternalLink className="size-3 opacity-60" />
            </Button>
            <Button onClick={() => openTab('/hr/applicant-intake')}>
              <UserPlus className="size-4" />
              Add applicant
              <ExternalLink className="size-3 opacity-60" />
            </Button>
          </>
        }
      />

      {pipeline && (
        <StatGrid className="mb-4">
          <StatTile label="In the pipeline" value={num(pipeline.active)} icon={Users} hint="Not yet hired or rejected" />
          <StatTile label="Hired this month" value={num(pipeline.hiredThisMonth)} icon={UserPlus} />
          <StatTile label="Open requisitions" value={num(pipeline.openRequisitions)} icon={Briefcase} />
          <StatTile label="Seats to fill" value={num(pipeline.seatsToFill)} icon={Briefcase} hint="Approved headcount still vacant" />
        </StatGrid>
      )}

      <OpenVacancies
        requisitions={requisitions}
        onChanged={refresh}
        onSource={(id) => openTab(`/hr/applicant-intake?requisition=${id}`)}
      />

      {/* The board. Counts per stage, and the age of the oldest — a candidate
          parked three weeks at Interview is the thing worth seeing. */}
      {pipeline && (
        <div className="card mb-4 overflow-x-auto p-3">
          <div className="flex min-w-max gap-2">
            <button
              onClick={() => setStageFilter(null)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                stageFilter === null ? 'border-brand-400 bg-brand-50 dark:bg-brand-950' : 'border-line hover:border-line-strong',
              )}
            >
              <p className="text-[11px] text-ink-3">All</p>
              <p className="tabular text-[17px] font-semibold text-ink">{num(pipeline.active)}</p>
            </button>

            {/* One tile per stage, each wearing the stage's own colour. The
                strip across the top is what makes the board readable as a
                sequence rather than as seven equal boxes. */}
            {pipeline.stages.map((s) => (
              <button
                key={s.stage}
                onClick={() => setStageFilter(s.stage === stageFilter ? null : s.stage)}
                title={stageOf(s.stage).meaning}
                className={cn(
                  'relative min-w-[7.5rem] overflow-hidden rounded-lg border px-3 py-2 text-left transition-colors',
                  s.stage === stageFilter
                    ? 'border-brand-400 bg-brand-50 dark:bg-brand-950'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <span className={cn('absolute inset-x-0 top-0 h-1', stageBar(s.stage))} />
                <p className="mt-0.5 truncate text-[11px] text-ink-3">{s.stage}</p>
                <p className="tabular text-[17px] font-semibold text-ink">{num(s.count)}</p>
                {s.count > 0 && (
                  <p className={cn('text-[10px]', s.oldestDays > 21 ? 'font-medium text-warning' : 'text-ink-3')}>
                    oldest {s.oldestDays}d
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[30rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Applicant</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Fit</th>
                <th className="px-3 py-2 text-left">Applied</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={Users}
                      title={stageFilter ? `Nobody at ${stageFilter}` : 'No applicants yet'}
                      description="Use Add applicant above. Sourcing against a manpower request fills the position and counts the seat at hire."
                    />
                  </td>
                </tr>
              ) : (
                shown.map((a) => (
                  <tr
                    key={Number(a.id)}
                    onClick={() => setSelected(Number(a.id))}
                    className={cn(
                      'cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-surface-2',
                      selected === Number(a.id) && 'bg-brand-50 dark:bg-brand-950',
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="text-[13px] font-medium text-ink">{String(a.name ?? '')}</span>
                      <span className="ml-1.5 text-[11px] text-ink-3">{String(a.code ?? '')}</span>
                    </td>
                    <td className="px-3 py-2 text-[13px] text-ink-2">{String(a.position ?? '—')}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STAGE_TONE[String(a.stage)] ?? 'neutral'}>{String(a.stage)}</Badge>
                      <span className="mt-1 flex w-24">
                        <StageRail stage={String(a.stage)} compact />
                      </span>
                    </td>
                    {/* How the CV reads against the advert. A sort order for a
                        stack of applications, never a decision — the panel
                        beside the table shows the reasoning behind it. */}
                    <td className="px-3 py-2">
                      {a.matchScore == null ? (
                        <span className="text-[11px] text-ink-3">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-block h-1.5 w-8 shrink-0 overflow-hidden rounded-full bg-surface-2',
                            )}
                          >
                            <span
                              className={cn(
                                'block h-full rounded-full',
                                Number(a.matchScore) >= 75
                                  ? 'bg-good'
                                  : Number(a.matchScore) >= 50
                                    ? 'bg-info'
                                    : 'bg-warning',
                              )}
                              style={{ width: `${Math.max(4, Number(a.matchScore))}%` }}
                            />
                          </span>
                          <span className="tabular text-[12px] text-ink-2">{Number(a.matchScore)}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[13px] text-ink-2">
                      {a.applied ? fmtDate(String(a.applied)) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-4">
          {selected ? (
            <ApplicantPanel id={selected} onChanged={refresh} />
          ) : (
            <EmptyState
              icon={UserPlus}
              title="Pick an applicant"
              description="Their stage, their details, and the moves available from here."
            />
          )}
        </div>
      </div>
    </>
  )
}
