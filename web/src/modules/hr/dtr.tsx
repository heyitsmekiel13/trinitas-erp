import * as React from 'react'
import { CalendarRange, Download, FileSpreadsheet, Printer, Search, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import { getDtr, getDtrBulk, listDtrPeriods, liveApi, type Dtr, type DtrDay, type DtrPeriod } from '@/lib/adminApi'
import { exportExcel, printRegion, printReport, type ExportColumn, type ReportSection } from '@/lib/export'
import { fmtDate, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { currentUser } from '@/app/auth'
import { Badge, Button, Combobox, Field, Input } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlay'

/**
 * Waits for an off-screen "print stage" to actually hold one child per
 * record, rather than guessing how long that takes with a fixed delay —
 * see the comment at its call site in `BulkDownloadDialog` for why a fixed
 * delay was the actual bug in "download all" reading a half-rendered batch.
 * Polled on animation frames rather than a timer, so it resolves the moment
 * the browser has genuinely painted, not on a schedule that assumes how
 * fast that is. Gives up after 5 seconds — long past anything reasonable —
 * so a real failure surfaces as an error instead of a button that spins
 * forever.
 */
function waitForStage(ref: React.RefObject<HTMLDivElement | null>, expectedCount: number): Promise<HTMLDivElement | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now()

    const check = () => {
      const el = ref.current
      if (el && el.children.length >= expectedCount) {
        resolve(el)
        return
      }
      if (performance.now() - startedAt > 5000) {
        resolve(null)
        return
      }
      requestAnimationFrame(check)
    }

    requestAnimationFrame(check)
  })
}

/**
 * The daily time record for one employee over one cut-off.
 *
 * The thing HR is actually asked for — by the employee querying a deduction,
 * by payroll reconciling a run, and by a DOLE inspector who wants to see the
 * time records for a period and will not accept a filtered list.
 *
 * Every calendar day in the cut-off gets a row, including the ones nobody
 * clocked in for. A DTR that quietly omits absences is the one document where
 * the gap is the entire point.
 */

/** Minutes as "1h 53m" — nobody reads 113 minutes as anything useful. */
function duration(minutes: number): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

const STATUS_TONE: Record<string, 'good' | 'warning' | 'critical' | 'neutral' | 'info'> = {
  Present: 'good',
  Late: 'warning',
  Absent: 'critical',
  'On Leave': 'info',
  'Rest Day': 'neutral',
  Holiday: 'info',
  Scheduled: 'neutral',
  Undertime: 'warning',
  Halfday: 'warning',
}

function Totals({ totals }: { totals: Dtr['totals'] }) {
  const cells = [
    { label: 'Days present', value: num(totals.daysPresent), of: `of ${totals.daysInPeriod} days` },
    { label: 'Hours worked', value: num(totals.hoursWorked, 2) },
    { label: 'Overtime', value: `${num(totals.overtimeHours, 2)} h` },
    { label: 'Night differential', value: `${num(totals.nightDiffHours, 2)} h` },
    { label: 'Late', value: duration(totals.lateMinutes), of: `${totals.timesLate}×` },
    { label: 'Undertime', value: duration(totals.undertimeMinutes) },
    { label: 'Absent', value: num(totals.daysAbsent) },
    { label: 'On leave', value: num(totals.daysOnLeave) },
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="bg-surface p-3">
          <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">{c.label}</p>
          <p className="tabular mt-1 text-[17px] font-semibold text-ink">{c.value}</p>
          {c.of && <p className="text-[11px] text-ink-3">{c.of}</p>}
        </div>
      ))}
    </div>
  )
}

function DayRow({ row }: { row: DtrDay }) {
  return (
    <tr
      className={cn(
        'border-b border-line last:border-0',
        // Non-working days recede; days that need attention do not.
        (row.status === 'Rest Day' || row.status === 'Holiday') && 'bg-surface-2 text-ink-3',
        row.status === 'Absent' && 'bg-critical/5',
        row.incomplete && 'bg-warning/5',
      )}
    >
      <td className="px-2.5 py-1.5 whitespace-nowrap">
        <span className="tabular text-[13px] text-ink">{fmtDate(row.date)}</span>
        <span className={cn('ml-1.5 text-[11px]', row.isWeekend ? 'text-warning' : 'text-ink-3')}>{row.day}</span>
      </td>
      <td className="tabular px-2.5 py-1.5 text-[13px]">{row.timeIn ?? '—'}</td>
      <td className="tabular px-2.5 py-1.5 text-[13px] text-ink-3">{row.breakOut ?? '—'}</td>
      <td className="tabular px-2.5 py-1.5 text-[13px] text-ink-3">{row.breakIn ?? '—'}</td>
      <td className="tabular px-2.5 py-1.5 text-[13px]">{row.timeOut ?? '—'}</td>
      <td className="tabular px-2.5 py-1.5 text-right text-[13px] font-medium">
        {row.hoursWorked ? num(row.hoursWorked, 2) : '—'}
      </td>
      <td className="tabular px-2.5 py-1.5 text-right text-[13px]">{row.overtimeHours ? num(row.overtimeHours, 2) : '—'}</td>
      <td className={cn('tabular px-2.5 py-1.5 text-right text-[13px]', row.lateMinutes && 'font-medium text-warning')}>
        {duration(row.lateMinutes)}
      </td>
      <td className={cn('tabular px-2.5 py-1.5 text-right text-[13px]', row.undertimeMinutes && 'text-warning')}>
        {duration(row.undertimeMinutes)}
      </td>
      <td className="px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
          {row.incomplete && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
              <TriangleAlert className="size-3" />
              No time out
            </span>
          )}
        </div>
        {(row.holiday || row.leaveType || row.remarks) && (
          <p className="mt-0.5 text-[11px] text-ink-3">
            {[row.holiday, row.leaveType, row.remarks].filter(Boolean).join(' · ')}
          </p>
        )}
      </td>
    </tr>
  )
}

/**
 * One employee's DTR, as a document — the letterhead, the totals, the
 * calendar table and the signature block. Pulled out of `DtrSummary` so the
 * exact same markup is what a bulk export builds one of per employee, rather
 * than a second, easily-drifting copy of the same layout.
 */
const DtrDocument = React.forwardRef<HTMLDivElement, { dtr: Dtr }>(function DtrDocument({ dtr }, ref) {
  return (
    <div ref={ref} className="space-y-4">
      {/* Letterhead. Printed copies get filed and have to identify
          themselves without the screen around them. */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{dtr.employee.name}</h2>
            <p className="mt-0.5 text-[12px] text-ink-2">
              {dtr.employee.employeeNo}
              {dtr.employee.position && ` · ${dtr.employee.position}`}
              {dtr.employee.department && ` · ${dtr.employee.department}`}
              {dtr.employee.branch && ` · ${dtr.employee.branch}`}
            </p>
            {dtr.employee.shift && (
              <p className="mt-0.5 text-[11px] text-ink-3">
                Shift: {dtr.employee.shift} ({dtr.employee.shiftHours})
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Cut-off</p>
            <p className="text-[13px] font-semibold text-ink">{dtr.period.label}</p>
          </div>
        </div>
      </div>

      <Totals totals={dtr.totals} />

      {dtr.totals.incompleteDays > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-[12px] text-warning">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          {dtr.totals.incompleteDays} {dtr.totals.incompleteDays === 1 ? 'day has' : 'days have'} a time in with no
          time out. Payroll cannot compute those hours — correct them in Attendance &amp; Time before the run.
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[52rem] border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
              <th className="px-2.5 py-2 text-left">Date</th>
              <th className="px-2.5 py-2 text-left">In</th>
              <th className="px-2.5 py-2 text-left">Break out</th>
              <th className="px-2.5 py-2 text-left">Break in</th>
              <th className="px-2.5 py-2 text-left">Out</th>
              <th className="px-2.5 py-2 text-right">Hours</th>
              <th className="px-2.5 py-2 text-right">OT</th>
              <th className="px-2.5 py-2 text-right">Late</th>
              <th className="px-2.5 py-2 text-right">Undertime</th>
              <th className="px-2.5 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {dtr.days.map((row) => (
              <DayRow key={row.date} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Signature block. A DTR is a document somebody attests to. */}
      <div className="card grid gap-8 p-5 sm:grid-cols-3">
        {['Employee', 'Immediate supervisor', 'HR / Timekeeper'].map((role) => (
          <div key={role}>
            <div className="h-10 border-b border-line-strong" />
            <p className="mt-1 text-[11px] text-ink-3">{role}</p>
          </div>
        ))}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-3">
        Certified correct from the punch clock records, approved leave and the holiday calendar on file.
      </p>
    </div>
  )
})

/**
 * Every employee in one payroll group, downloaded as one document —
 * personalised per person (their own letterhead block, their own table) but
 * printed as a single job so it comes out as one PDF rather than one per
 * employee. Renders off-screen: `printReport`'s `element` sections clone
 * from the live DOM, so each employee's `DtrDocument` has to actually be
 * mounted somewhere, just not somewhere the admin has to look at.
 */
function BulkDownloadDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [payrollGroupId, setPayrollGroupId] = React.useState<number | null>(null)
  const [periodId, setPeriodId] = React.useState<number | null>(null)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [periods, setPeriods] = React.useState<DtrPeriod[]>([])
  const [records, setRecords] = React.useState<Dtr[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [preparing, setPreparing] = React.useState(false)
  const [customRange, setCustomRange] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)

  const { data: payrollGroups = [] } = useResource<Record<string, unknown>[]>('hr/payroll-groups', () => [])

  React.useEffect(() => {
    if (!liveApi()) return
    void listDtrPeriods().then(setPeriods).catch(() => setPeriods([]))
  }, [])

  const groups = React.useMemo(
    () =>
      payrollGroups.map((g) => ({
        value: Number(g.id),
        label: String(g.name ?? g.code ?? ''),
        sublabel: g.employees != null ? `${g.employees} employee(s)` : undefined,
      })),
    [payrollGroups],
  )

  const ready = Boolean(payrollGroupId && (periodId || (from && to)))

  const build = async () => {
    if (!payrollGroupId) return
    setLoading(true)
    setRecords(null)
    try {
      const data = await getDtrBulk(payrollGroupId, periodId ? { periodId } : { from, to })
      setRecords(data)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not build those records', description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  const download = async () => {
    if (!records || records.length === 0) return
    setPreparing(true)
    try {
      // `printReport` clones from the live DOM, not from React state, so the
      // off-screen stage has to have actually finished rendering every
      // employee before it is read. A fixed delay is what this used to wait
      // on, and it was the bug: it was tuned against a handful of
      // employees, and a bigger payroll category — the exact case "download
      // all" exists for — takes longer to lay out than that delay allowed,
      // so the read ran while the stage still held only its first few
      // employees. Polling for the stage to actually hold one child per
      // record removes the guess entirely; it waits exactly as long as
      // rendering genuinely takes, for a group of 3 or of 200.
      const stage = await waitForStage(stageRef, records.length)

      if (!stage) {
        toast({
          tone: 'error',
          title: 'Could not prepare the download',
          description: 'The batch did not finish rendering in time. Try again, or download a smaller group.',
        })
        return
      }

      const sections: ReportSection[] = []
      records.forEach((dtr, i) => {
        if (i > 0) sections.push({ kind: 'pagebreak' })
        sections.push({
          kind: 'element',
          title: `${dtr.employee.name} — ${dtr.employee.employeeNo}`,
          element: stage.children[i] as HTMLElement,
        })
      })

      const groupName = groups.find((g) => g.value === payrollGroupId)?.label ?? 'Payroll group'
      const cutoff = records[0]?.period.label ?? ''

      printReport(sections, {
        title: 'Daily Time Records',
        subtitle: `${groupName} · ${cutoff} · ${records.length} employee(s)`,
        preparedBy: currentUser().name,
      })
    } finally {
      setPreparing(false)
    }
  }

  /**
   * One row per employee — days rendered and the other cut-off totals,
   * without the day-by-day detail. What "download all" produces is the
   * full DTR for filing; this is the same batch read for a headcount
   * check or a payroll reconciliation, where nobody wants to open 138
   * individual records to add up a column.
   */
  const downloadSummary = () => {
    if (!records || records.length === 0) return

    const columns: ExportColumn<Dtr>[] = [
      { header: 'Employee No.', value: (d) => d.employee.employeeNo },
      { header: 'Name', value: (d) => d.employee.name },
      { header: 'Department', value: (d) => d.employee.department ?? '' },
      { header: 'Branch', value: (d) => d.employee.branch ?? '' },
      { header: 'Days in period', value: (d) => d.totals.daysInPeriod },
      { header: 'Days present', value: (d) => d.totals.daysPresent },
      { header: 'Days absent', value: (d) => d.totals.daysAbsent },
      { header: 'Days on leave', value: (d) => d.totals.daysOnLeave },
      { header: 'Rest days', value: (d) => d.totals.restDays },
      { header: 'Holidays', value: (d) => d.totals.holidays },
      { header: 'Hours worked', value: (d) => d.totals.hoursWorked },
      { header: 'Overtime hours', value: (d) => d.totals.overtimeHours },
      { header: 'Night diff hours', value: (d) => d.totals.nightDiffHours },
      { header: 'Times late', value: (d) => d.totals.timesLate },
      { header: 'Late (minutes)', value: (d) => d.totals.lateMinutes },
      { header: 'Undertime (minutes)', value: (d) => d.totals.undertimeMinutes },
      { header: 'Incomplete days', value: (d) => d.totals.incompleteDays },
    ]

    const groupName = groups.find((g) => g.value === payrollGroupId)?.label ?? 'Payroll group'
    const cutoff = records[0]?.period.label ?? ''

    exportExcel(
      `dtr-summary-${groupName}-${cutoff}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      `DTR Summary — ${groupName} · ${cutoff}`,
      columns,
      records,
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Download DTRs by payroll category"
      description="Every active employee in one payroll group, over one cut-off — one file, each person on their own page."
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payroll category" required composite>
            <Combobox
              value={payrollGroupId}
              options={groups}
              onChange={(v) => setPayrollGroupId(v === null ? null : Number(v))}
              placeholder="Choose a payroll group…"
            />
          </Field>
          <Field label="Payroll cut-off" composite>
            <Combobox
              value={periodId}
              options={periods.map((p) => ({
                value: p.id,
                label: p.label,
                sublabel: p.from && p.to ? `${p.from} → ${p.to}` : undefined,
              }))}
              onChange={(v) => {
                setPeriodId(v === null ? null : Number(v))
                if (v !== null) {
                  setFrom('')
                  setTo('')
                }
              }}
              placeholder={periods.length ? 'Choose a cut-off…' : 'No payroll periods yet'}
            />
          </Field>
        </div>

        {customRange ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Custom range</span>
              <button
                type="button"
                onClick={() => {
                  setCustomRange(false)
                  setFrom('')
                  setTo('')
                }}
                className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
              >
                Use a cut-off instead
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                aria-label="From"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setPeriodId(null)
                }}
              />
              <Input
                type="date"
                aria-label="To"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  setPeriodId(null)
                }}
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCustomRange(true)}
            className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
          >
            Or use a custom date range instead
          </button>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[11px] text-ink-3">
            {records ? `${records.length} employee(s) built and ready.` : 'Build the batch, then download it.'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void build()} disabled={!ready || loading} loading={loading}>
              <Search className="size-4" />
              Build
            </Button>
            <Button variant="secondary" onClick={downloadSummary} disabled={!records || records.length === 0}>
              <FileSpreadsheet className="size-4" />
              Summary (Excel)
            </Button>
            <Button onClick={() => void download()} disabled={!records || records.length === 0} loading={preparing}>
              <Download className="size-4" />
              Download all
            </Button>
          </div>
        </div>
      </div>

      {/* Off-screen — this is what `download()` clones from, never what the
          admin looks at directly. */}
      {records && (
        <div className="fixed top-0 left-[-9999px]" aria-hidden ref={stageRef}>
          {records.map((dtr) => (
            <DtrDocument key={dtr.employee.employeeNo} dtr={dtr} />
          ))}
        </div>
      )}
    </Modal>
  )
}

export function DtrSummary() {
  const toast = useToast()
  const [employeeId, setEmployeeId] = React.useState<number | null>(null)
  const [periodId, setPeriodId] = React.useState<number | null>(null)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [dtr, setDtr] = React.useState<Dtr | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [bulkOpen, setBulkOpen] = React.useState(false)
  const [customRange, setCustomRange] = React.useState(false)
  const printRef = React.useRef<HTMLDivElement>(null)

  const { data: employees = [] } = useResource<Record<string, unknown>[]>('hr/employees', () => [])
  const [periods, setPeriods] = React.useState<DtrPeriod[]>([])

  React.useEffect(() => {
    if (!liveApi()) return
    void listDtrPeriods().then(setPeriods).catch(() => setPeriods([]))
  }, [])

  const people = React.useMemo(
    () =>
      employees.map((e) => ({
        value: Number(e.id),
        label: String(e.fullName ?? e.name ?? ''),
        sublabel: String(e.employeeNo ?? ''),
      })),
    [employees],
  )

  const run = async () => {
    if (!employeeId) return

    setLoading(true)
    setError(null)
    try {
      setDtr(await getDtr(employeeId, periodId ? { periodId } : { from, to }))
    } catch (err) {
      setError(err)
      setDtr(null)
      toast({ tone: 'error', title: 'Could not build that record.', description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  const ready = Boolean(employeeId && (periodId || (from && to)))

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="DTR Summary" description="The daily time record for one employee over one cut-off." />
        <div className="card">
          <EmptyState
            icon={CalendarRange}
            title="The DTR needs the live API"
            description="Time records are read straight from the database — there is no preview data for them."
          />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="DTR Summary"
        description="Every day in the cut-off for one employee — worked, absent, on leave or rest day — with the totals payroll and DOLE ask for."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <Download className="size-4" />
              Download by payroll category
            </Button>
            {dtr && (
              <Button
                variant="secondary"
                onClick={() =>
                  printRegion(printRef.current, {
                    title: 'Daily Time Record',
                    subtitle: `${dtr.employee.name} · ${dtr.employee.employeeNo}`,
                    criteria: [
                      { label: 'Cut-off', value: dtr.period.label },
                      ...(dtr.employee.department ? [{ label: 'Department', value: dtr.employee.department }] : []),
                      ...(dtr.employee.branch ? [{ label: 'Branch', value: dtr.employee.branch }] : []),
                      ...(dtr.employee.shift ? [{ label: 'Shift', value: dtr.employee.shift }] : []),
                    ],
                    preparedBy: currentUser().name,
                  })
                }
              >
                <Printer className="size-4" />
                Print / Download PDF
              </Button>
            )}
          </div>
        }
      />

      {bulkOpen && <BulkDownloadDialog onClose={() => setBulkOpen(false)} />}

      {/* --------------------------------------------------------- picker */}
      <div className="card mb-4 p-4" data-print="hide">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Employee" required composite className="lg:col-span-2">
            <Combobox
              value={employeeId}
              options={people}
              onChange={(v) => setEmployeeId(v === null ? null : Number(v))}
              placeholder="Search by name or employee number…"
            />
          </Field>

          <Field label="Payroll cut-off" composite>
            <Combobox
              value={periodId}
              options={periods.map((p) => ({
                value: p.id,
                label: p.label,
                sublabel: p.from && p.to ? `${p.from} → ${p.to}` : undefined,
              }))}
              onChange={(v) => {
                setPeriodId(v === null ? null : Number(v))
                // The two are alternatives; choosing one clears the other so
                // it is never ambiguous which window is being asked for.
                if (v !== null) {
                  setFrom('')
                  setTo('')
                }
              }}
              placeholder={periods.length ? 'Choose a cut-off…' : 'No payroll periods yet'}
              emptyLabel="No payroll periods have been created"
            />
          </Field>

          {/* A custom range is the exception, not the second half of a pair
              — a cut-off already covers the normal case, so asking for both
              on screen at once read as two ways to say the same thing. This
              stays out of the way until it is actually needed. */}
          {customRange ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-2">Custom range</span>
                <button
                  type="button"
                  onClick={() => {
                    setCustomRange(false)
                    setFrom('')
                    setTo('')
                  }}
                  className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
                >
                  Use a cut-off instead
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="date"
                  aria-label="From"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    setPeriodId(null)
                  }}
                />
                <Input
                  type="date"
                  aria-label="To"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                    setPeriodId(null)
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-end pb-2.5">
              <button
                type="button"
                onClick={() => setCustomRange(true)}
                className="text-[12px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
              >
                Or use a custom date range instead
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-3">
            {periods.length === 0
              ? 'No payroll cut-offs exist yet — use the date range, or create periods under Payroll.'
              : 'Pick a cut-off, or set your own dates for a range that does not line up with one.'}
          </p>
          <Button onClick={() => void run()} disabled={!ready || loading} loading={loading}>
            <Search className="size-4" />
            Build record
          </Button>
        </div>
      </div>

      {error && !dtr && <ErrorState error={error} onRetry={() => void run()} />}

      {!dtr && !error && (
        <div className="card">
          <EmptyState
            icon={CalendarRange}
            title="Choose an employee and a period"
            description="The record is built from the punch clock, approved leave, the holiday calendar and the roster."
          />
        </div>
      )}

      {dtr && (
        <div ref={printRef}>
          <DtrDocument dtr={dtr} />
        </div>
      )}
    </>
  )
}
