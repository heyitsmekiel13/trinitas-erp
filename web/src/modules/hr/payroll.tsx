import * as React from 'react'
import { CheckCircle2, Download, DoorOpen, FileSpreadsheet, FileText, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
import { dataset } from '@/data/dataset'
import { money, num } from '@/lib/format'
import { AUB_HEADERS, exportAubMasterfileCsv, exportAubMasterfileExcel } from '@/lib/aub'
import * as api from '@/lib/adminApi'
import { ApiError, liveApi } from '@/lib/adminApi'
import { invalidateResource } from '@/lib/api'
import type { MasterfileEmployee } from '@/data/payroll'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import * as forms from './forms'
import { ResetSignIn } from './actions'
import { EmployeeFilePanel, OnboardingBanner, OnboardingTaskPanel } from './onboarding'
import { SectionHeading } from '@/components/layout/PageHeader'
import { Avatar, Badge, Button, StatusBadge } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuLabel, Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/* ========================================================================== */
/* Masterfile (the 201 file, in AUB upload shape)                             */
/* ========================================================================== */

/**
 * Uploads the AUB masterfile.
 *
 * Two passes on purpose: choosing a file validates it without writing
 * anything, and a second, explicit click commits. HR sees the exact row
 * count, every correction and every warning before the database changes.
 */
function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const toast = useToast()
  const [file, setFile] = React.useState<File | null>(null)
  const [report, setReport] = React.useState<api.ImportReport | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failure, setFailure] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setReport(null)
    setFailure('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const close = () => {
    reset()
    onClose()
  }

  const validate = async (chosen: File) => {
    setBusy(true)
    setFailure('')
    setFile(chosen)
    try {
      setReport(await api.importEmployees(chosen, true))
    } catch (e) {
      // A file with errors comes back as 422 carrying the same report shape.
      const payload = (e as ApiError & { report?: api.ImportReport }).report
      setReport(payload ?? null)
      setFailure((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!file) return
    setBusy(true)
    try {
      const result = await api.importEmployees(file, false)
      setReport(result)
      onImported()
      toast({
        tone: 'success',
        title: `${result.created.employees_created ?? 0} employees imported`,
        description: result.created.users_created
          ? `${result.created.users_created} sign-in accounts created.`
          : undefined,
      })
    } catch (e) {
      toast({ tone: 'error', title: 'Import failed', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const done = report?.applied === true

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Import payroll masterfile"
      description="Upload the AUB template — .xlsx straight from HR, or .csv. Nothing is written until you confirm."
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!report || report.errors > 0 || busy}
              loading={busy}
              onClick={commit}
            >
              Import {report ? `${num(report.rows)} rows` : ''}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {!done && (
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-surface-2',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            <Upload className="mb-2 size-6 text-ink-3" />
            <span className="text-[13px] font-medium text-ink">
              {file?.name ?? 'Choose the AUB masterfile'}
            </span>
            <span className="mt-1 text-xs text-ink-3">.xlsx, .xls or .csv — 32 columns, headers on row 1</span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0]
                if (chosen) void validate(chosen)
              }}
            />
          </label>
        )}

        {busy && !report && <div className="shimmer h-20 rounded-xl" />}

        {report && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: done ? 'Imported' : 'Rows found', value: num(report.rows), tone: 'neutral' as const },
                { label: 'Errors', value: num(report.errors), tone: report.errors ? ('critical' as const) : ('good' as const) },
                { label: 'Warnings', value: num(report.warnings), tone: report.warnings ? ('warning' as const) : ('good' as const) },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-line bg-surface-2 p-3 text-center">
                  <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">{stat.label}</p>
                  <p
                    className={cn(
                      'mt-1 text-lg font-semibold',
                      stat.tone === 'critical' ? 'text-critical' : stat.tone === 'warning' ? 'text-warning' : 'text-ink',
                    )}
                  >
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>

            {done && (
              <div className="rounded-xl bg-good/10 p-3.5 ring-1 ring-good/25 ring-inset">
                <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <CheckCircle2 className="size-4 text-good" />
                  Written to the database
                </p>
                <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-2">
                  {Object.entries(report.created).map(([key, count]) => (
                    <li key={key} className="flex justify-between gap-3">
                      <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="tabular font-medium text-ink">{num(count)}</span>
                    </li>
                  ))}
                </ul>
                {(report.created.users_created ?? 0) > 0 && (
                  <p className="mt-3 border-t border-good/25 pt-2.5 text-xs text-ink-2">
                    Each new account signs in with their employee number minus the <code className="font-mono">UNI</code>{' '}
                    prefix, and must choose a new password on first use.
                  </p>
                )}
              </div>
            )}

            {failure && !report.errors && (
              <div className="rounded-xl bg-critical/10 p-3 ring-1 ring-critical/25 ring-inset">
                <p className="text-[13px] text-critical">{failure}</p>
              </div>
            )}

            {report.issues.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-good/10 p-3 text-[13px] text-ink-2 ring-1 ring-good/25 ring-inset">
                <CheckCircle2 className="size-4 text-good" />
                Every row passed validation.
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="border-b border-line">
                      {['Row', 'Employee', 'Issue'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.issues.map((issue, i) => (
                      <tr key={i} className="border-b border-line/60 last:border-0">
                        <td className="px-3 py-1.5 text-ink-3">{issue.row}</td>
                        <td className="px-3 py-1.5 font-mono text-ink-2">{issue.employee_no}</td>
                        <td className="px-3 py-1.5">
                          <span className="flex flex-wrap items-start gap-1.5">
                            <Badge tone={issue.severity === 'error' ? 'critical' : 'warning'}>{issue.column}</Badge>
                            <span className="text-ink-2">{issue.message}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <details className="rounded-xl border border-line bg-surface-2 p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Expected column order</summary>
          <ol className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-ink-3">
            {AUB_HEADERS.map((h, i) => (
              <li key={h}>
                {i + 1}. {h}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </Modal>
  )
}

export function Masterfile() {
  const c = cols<MasterfileEmployee>()
  const toast = useToast()
  const [importOpen, setImportOpen] = React.useState(false)
  const rows = React.useMemo(() => dataset().masterfile, [])

  return (
    <>
      {/* Standing notice, above the list rather than beside it. A record
          created by a hire is complete in everything the candidate could tell
          us and empty in everything only HR can — and left alone, that
          surfaces as a failed payroll run a fortnight later. */}
      <OnboardingBanner />

      <ResourcePage
        title="Employees"
        description="The 201 file in AUB payroll masterfile format — employment, statutory registration and pay rate for every employee."
        endpoint="hr/employees"
        loader={() => rows}
        exportName="employee-masterfile"
        createLabel="New employee"
        formFields={forms.employeeFields}
        formDefaults={forms.employeeDefaults}
        formTitle="employee"
        detailActions={(row, done) => <ResetSignIn row={row} done={done} />}
        pageSize={25}
        filters={[
          { columnId: 'payrollGroup', label: 'Payroll group' },
          { columnId: 'branchUnit', label: 'Branch' },
          { columnId: 'employmentStatus', label: 'Status' },
          { columnId: 'perHour', label: 'Rate type' },
        ]}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-3.5" />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <Menu
              trigger={({ toggle }) => (
                <Button variant="secondary" size="sm" onClick={toggle}>
                  <Download className="size-3.5" />
                  <span className="hidden sm:inline">AUB file</span>
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>AUB upload template</MenuLabel>
                  {liveApi() ? (
                    // Live: the API streams it straight from the database, so
                    // the file always matches what payroll will actually run.
                    <MenuItem
                      icon={FileText}
                      onClick={() => {
                        void api
                          .downloadEmployeeExport()
                          .catch((e: Error) => toast({ tone: 'error', title: 'Export failed', description: e.message }))
                        close()
                      }}
                    >
                      CSV — text-safe, from the database
                    </MenuItem>
                  ) : (
                    <>
                      <MenuItem
                        icon={FileSpreadsheet}
                        onClick={() => {
                          exportAubMasterfileExcel(rows)
                          close()
                        }}
                      >
                        Excel (.xls) — text-safe
                      </MenuItem>
                      <MenuItem
                        icon={FileText}
                        onClick={() => {
                          exportAubMasterfileCsv(rows)
                          close()
                        }}
                      >
                        CSV
                      </MenuItem>
                    </>
                  )}
                </>
              )}
            </Menu>
          </>
        }
        detailTitle={(row) => row.fullName}
        detailSubtitle={(row) => `${row.employeeNo} · ${row.positionTitle}`}
        renderDetail={(row) => <MasterfileDetail row={row} />}
        columns={[
          c.primary('fullName', 'Employee', (row) => `${row.employeeNo} · ${row.positionTitle}`),
          c.text('branchUnit', 'Branch / unit'),
          c.tag('payrollGroup', 'Payroll group', 'brand', true),
          c.text('department', 'Department', { secondary: true }),
          c.number('level', 'Level', { secondary: true }),
          c.money('salary', 'Rate', { bold: true }),
          c.tag('perHour', 'Per hour', 'info'),
          c.money('monthlyEquivalent', 'Monthly equiv.', { compact: true, secondary: true }),
          c.text('atmAccount', 'AUB account', { secondary: true, mono: true }),
          c.date('dateHired', 'Date hired', { secondary: true }),
          c.status('employmentStatus', 'Status'),
        ]}
      />
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        // The employee list is cached by TanStack Query; drop it so the table
        // reflects the import without a page reload.
        onImported={() => void invalidateResource('hr/employees')}
      />
    </>
  )
}

/**
 * Starts the clearance process ahead of the actual last day.
 *
 * A resignation is real weeks before employment_status is ever changed —
 * that flip happens on the last working day, once payroll needs it. Waiting
 * for it to start property turnover and clearance is how those things never
 * start early enough to matter. `OffboardingOperations::initiate()` is
 * idempotent, so this and the automatic trigger on the status change can
 * never produce two cases for the same departure.
 */
/**
 * "There is history here" — without this, an employee's own record has no
 * sign that an offboarding case exists at all, open or closed. The standalone
 * Offboarding board was the only place that fact was visible.
 */
function OffboardingCaseChip({ employeeId }: { employeeId: number }) {
  const [cases, setCases] = React.useState<api.EmployeeOffboardingCase[]>([])

  React.useEffect(() => {
    api.getEmployeeOffboardingCases(employeeId).then(setCases).catch(() => setCases([]))
  }, [employeeId])

  if (cases.length === 0) return null

  const open = cases.find((c) => c.open)

  return open ? (
    <Badge tone="critical">Offboarding in progress</Badge>
  ) : (
    <Badge tone="neutral">{cases.length} past offboarding case{cases.length === 1 ? '' : 's'}</Badge>
  )
}

function InitiateOffboardingButton({ employeeId, employmentStatus }: { employeeId: number; employmentStatus: string }) {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState<'Resignation' | 'Termination' | 'End of Contract' | 'Retirement'>('Resignation')
  const [lastWorkingDay, setLastWorkingDay] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  if (employmentStatus === 'RESIGNED' || employmentStatus === 'TERMINATED') return null

  const submit = async () => {
    setBusy(true)
    try {
      const result = await api.initiateOffboarding(employeeId, reason, lastWorkingDay || undefined)
      // Re-clicking this on somebody already mid-offboarding used to look
      // like nothing happened — it silently returned the existing case
      // rather than starting a second one. Now it says so.
      toast(
        result.wasAlreadyOpen
          ? { tone: 'info', title: 'Already in progress', description: 'Offboarding was already started for them — nothing new was created.' }
          : { tone: 'success', title: 'Offboarding started', description: 'The clearance checklist has been generated.' },
      )
      setOpen(false)
    } catch (error) {
      toast({ tone: 'error', title: 'Could not start offboarding.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" className="text-critical" onClick={() => setOpen(true)}>
        <DoorOpen className="size-3.5" />
        Initiate offboarding
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title="Initiate offboarding"
        description="Generates the clearance checklist and notifies HR and Finance."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void submit()}>Start offboarding</Button>
          </>
        }
      >
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            >
              <option value="Resignation">Resignation</option>
              <option value="Termination">Termination</option>
              <option value="End of Contract">End of Contract</option>
              <option value="Retirement">Retirement</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-3 uppercase">Last working day (optional)</label>
            <input
              type="date"
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className={cn('mt-1 text-[13px] break-words text-ink', mono && 'font-mono text-[12px]')}>{value}</dd>
    </div>
  )
}

function MasterfileDetail({ row }: { row: MasterfileEmployee }) {
  return (
    <div className="space-y-6">
      {/* What is still missing from this file, and what each gap blocks. It
          leads the record because it is the only part of it that is somebody's
          job today. */}
      {liveApi() && <EmployeeFilePanel employeeId={Number(row.id)} />}
      {liveApi() && <OnboardingTaskPanel employeeId={Number(row.id)} />}

      <div className="flex items-center gap-3">
        <Avatar name={row.fullName} size="lg" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">{row.fullName}</p>
          <p className="text-xs text-ink-3">
            {row.positionTitle} · {row.branchUnit}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone="brand">{row.payrollGroup}</Badge>
            <StatusBadge status={row.employmentStatus} />
            {row.minimumWageEarner === 'YES' && <Badge tone="info">Minimum wage earner</Badge>}
            {row.confidential === 'YES' && <Badge tone="warning">Confidential</Badge>}
            {liveApi() && <OffboardingCaseChip employeeId={Number(row.id)} />}
          </div>
        </div>
        {liveApi() && (
          <div className="ml-auto">
            <InitiateOffboardingButton employeeId={Number(row.id)} employmentStatus={row.employmentStatus} />
          </div>
        )}
      </div>

      <section>
        <SectionHeading title="Employment" />
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Row label="Employee no." value={row.employeeNo} mono />
          <Row label="Business group" value={row.group} />
          <Row label="Department" value={row.department} />
          <Row label="Level" value={row.level} />
          <Row label="Date hired" value={new Date(row.dateHired).toLocaleDateString('en-PH')} />
          <Row label="Civil status" value={row.civilStatus} />
        </dl>
      </section>

      <section>
        <SectionHeading title="Compensation" />
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Row
            label={row.perHour === 'YES' ? 'Hourly rate' : 'Monthly rate'}
            value={<span className="font-semibold">{money(row.salary)}</span>}
          />
          <Row label="Daily rate" value={money(row.dailyRate)} />
          <Row label="Monthly equivalent" value={money(row.monthlyEquivalent)} />
          <Row label="Payroll frequency" value={row.payrollFrequency === 'S' ? 'Semi-monthly' : 'Monthly'} />
          <Row label="Payment mode" value={row.paymentMode} />
          <Row label="AUB account" value={row.atmAccount} mono />
        </dl>
      </section>

      <section>
        <SectionHeading title="Statutory registration" description="Numbers as filed with each agency." />
        <dl className="grid grid-cols-2 gap-x-5 gap-y-4">
          {[
            ['TIN', row.tin, row.taxExempted],
            ['SSS', row.sss, row.sssExempted],
            ['PhilHealth', row.phic, row.phicExempted],
            ['Pag-IBIG', row.pagibig, row.pagibigExempted],
          ].map(([label, value, exempt]) => (
            <Row
              key={label}
              label={label!}
              value={
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[12px]">{value}</span>
                  {exempt === 'YES' && <Badge tone="warning">Exempt</Badge>}
                </span>
              }
            />
          ))}
        </dl>
      </section>
    </div>
  )
}

