import * as React from 'react'
import {
  Banknote,
  CalendarPlus,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Landmark,
  Pencil,
  Play,
  Printer,
  Send,
  ShieldAlert,
  Table2,
  Trash2,
  TriangleAlert,
  UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useIsSuperAdmin } from '@/app/auth'
import { useResource, queryClient } from '@/lib/api'
import {
  addPayslip,
  approveRun,
  computeRun,
  createRecord,
  deleteRecord,
  downloadAubTemplate,
  generatePayrollPeriods,
  getAubWarnings,
  getRegister,
  getRemittances,
  liveApi,
  releaseRun,
  updateRecord,
  type RegisterLine,
  type PayrollRegister,
  type PayrollRunSummary,
  type RemittanceSummary,
} from '@/lib/adminApi'
import { PayslipAdjustDialog } from './payslipAdjust'
import { printRegion } from '@/lib/export'
import { exportAubCreditFile, exportAubCreditFileExcel, type AubCreditFileResult } from '@/lib/aub'
import { fmtDate, money, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Combobox, Field } from '@/components/ui/primitives'
import { Modal, Menu, MenuItem } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { currentUser } from '@/app/auth'

/**
 * Payroll runs, computed rather than described.
 *
 * The page used to list a fabricated set of runs from the preview dataset —
 * there was no way to create a cut-off, no engine to compute one, and nothing
 * that produced a payslip. The whole chain now exists: generate the year's
 * cut-offs, run a group against one, review the register, approve it, release
 * it.
 *
 * Each status change is deliberate. Computed produces the register, approved
 * is somebody signing it off, released means the money has gone — and a
 * released run cannot be recomputed, because correcting it is a reversal.
 */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'good'> = {
  Draft: 'neutral',
  Computed: 'info',
  Approved: 'warning',
  Released: 'good',
}

function RegisterDialog({
  runId,
  open,
  onClose,
  onChanged,
}: {
  runId: number
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [data, setData] = React.useState<PayrollRegister | null>(null)
  // Distinct from "still loading" — a run that loaded fine once but has
  // since been deleted out from under an open dialog otherwise looks
  // identical to a slow network forever, since `data` just stays at
  // whatever it last successfully held.
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [adjusting, setAdjusting] = React.useState<RegisterLine | null>(null)
  const [addingEmployee, setAddingEmployee] = React.useState(false)
  const [newEmployeeId, setNewEmployeeId] = React.useState<number | null>(null)

  /** Names who the bank file left out, and why — cash/cheque, or no account number on file. */
  const announceBankFile = (result: AubCreditFileResult) => {
    if (result.excluded.length === 0) return
    toast({
      tone: 'warning',
      title: `${result.excluded.length} employee${result.excluded.length === 1 ? '' : 's'} left out of the bank file`,
      description: result.excluded.map((e) => `${e.employee} (${e.reason})`).join('; '),
    })
  }

  // Only loaded for the "somebody was missed" dialog, which is rare enough
  // that the list is fetched with the register rather than on demand.
  const { data: employees = [] } = useResource<Record<string, unknown>[]>('hr/employees', () => [])
  const printRef = React.useRef<HTMLDivElement>(null)

  const load = React.useCallback(async () => {
    try {
      setData(await getRegister(runId))
      setLoadError(null)
    } catch (err) {
      setData(null)
      setLoadError((err as Error).message || 'This run could not be loaded.')
    }
  }, [runId])

  React.useEffect(() => {
    void load()
  }, [load])

  const act = async (what: 'compute' | 'approve' | 'release') => {
    setBusy(true)
    try {
      if (what === 'compute') {
        const r = await computeRun(runId)
        toast({ tone: 'success', title: `${r.payslips} payslips computed`, description: `Net ${money(r.net)}` })
      } else if (what === 'approve') {
        await approveRun(runId)
        toast({ tone: 'success', title: 'Run approved' })
      } else {
        await releaseRun(runId)
        toast({ tone: 'success', title: 'Run released', description: 'The cut-off is now closed.' })
      }
      await load()
      onChanged()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not do that.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const run = data?.run
  const lines = data?.payslips ?? []
  const flagged = lines.filter((l) => l.notes)

  /* The server decides. A run that has been approved or released is closed to
     every one of these controls, and asking the browser to remember which
     statuses those are is how the two drift apart. */
  const editable = data?.editable ?? false

  const addEmployee = async () => {
    if (!newEmployeeId) return

    setBusy(true)
    try {
      await addPayslip(runId, newEmployeeId)
      toast({ tone: 'success', title: 'Payslip added to the run' })
      setAddingEmployee(false)
      setNewEmployeeId(null)
      await load()
      onChanged()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not add them.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={run ? `${run.no} · ${run.group}` : 'Payroll register'}
      description={run ? `${run.periodLabel ?? run.period} · ${run.headcount} employees` : undefined}
      size="2xl"
      footer={
        <>
          {run && <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge>}
          <span className="mr-auto" />
          {run && run.status !== 'Released' && (
            <Button variant="secondary" size="sm" onClick={() => void act('compute')} disabled={busy}>
              <Play className="size-3.5" />
              {run.status === 'Draft' ? 'Compute' : 'Recompute'}
            </Button>
          )}
          {editable && lines.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddingEmployee(true)}
              disabled={busy}
              title="For somebody the run missed — a mid-cut-off hire, or a late transfer into the group"
            >
              <UserPlus className="size-3.5" />
              Add employee
            </Button>
          )}
          {lines.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                printRegion(printRef.current, {
                  title: 'Payroll Register',
                  subtitle: `${run?.no} · ${run?.group}`,
                  criteria: [{ label: 'Cut-off', value: run?.periodLabel ?? run?.period ?? '' }],
                  preparedBy: currentUser().name,
                  confidential: true,
                })
              }
            >
              <Printer className="size-3.5" />
              Print
            </Button>
          )}
          {lines.length > 0 && run?.status !== 'Draft' && (
            <Menu
              trigger={({ toggle }) => (
                <Button variant="secondary" size="sm" onClick={toggle}>
                  <Landmark className="size-3.5" />
                  Bank file
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={Table2}
                    onClick={() => {
                      void (async () => {
                        try {
                          const warnings = await getAubWarnings(run!.id)
                          if (warnings.length > 0) {
                            toast({
                              tone: 'warning',
                              title: `${warnings.length} thing${warnings.length === 1 ? '' : 's'} to double-check in this workbook`,
                              description: warnings.join(' '),
                            })
                          }
                        } catch {
                          // The warning check failing shouldn't block the download itself.
                        }
                        await downloadAubTemplate(
                          run!.id,
                          `AUB_HRIS_${(run?.periodLabel ?? run?.period ?? '').replace(/[^\w]+/g, '_')}.xlsx`,
                        )
                        // The download itself gives no visible confirmation —
                        // it hands the file to the browser's own download
                        // mechanism, which shows nothing in-app at all. Without
                        // this, a clean run with no warnings produced zero
                        // feedback whatsoever, and looked exactly like nothing
                        // had happened even when it worked correctly.
                        toast({
                          tone: 'success',
                          title: 'Workbook downloaded',
                          description: 'Check your browser’s downloads for the AUB HRIS file.',
                        })
                      })().catch((e) =>
                        toast({ tone: 'error', title: 'Could not build the workbook', description: (e as Error).message }),
                      )
                      close()
                    }}
                  >
                    AUB HRIS workbook (.xlsx) — the full template, filled in
                  </MenuItem>
                  <MenuItem
                    icon={FileSpreadsheet}
                    onClick={() => {
                      announceBankFile(exportAubCreditFileExcel(lines, run?.periodLabel ?? run?.period ?? ''))
                      close()
                    }}
                  >
                    Excel (.xls) — AUB PAYROLL layout only
                  </MenuItem>
                  <MenuItem
                    icon={FileText}
                    onClick={() => {
                      announceBankFile(exportAubCreditFile(lines, run?.periodLabel ?? run?.period ?? ''))
                      close()
                    }}
                  >
                    CSV — text-safe, from the database
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
          {run?.status === 'Computed' && (
            <Button size="sm" onClick={() => void act('approve')} disabled={busy}>
              <CheckCircle2 className="size-3.5" />
              Approve
            </Button>
          )}
          {run?.status === 'Approved' && (
            <Button size="sm" onClick={() => void act('release')} disabled={busy}>
              <Send className="size-3.5" />
              Release
            </Button>
          )}
        </>
      }
    >
      {loadError ? (
        <EmptyState
          icon={TriangleAlert}
          title="This run could not be loaded"
          description={`${loadError} It may have been deleted, including by another tab or another person — close this and refresh the list.`}
        />
      ) : !run ? (
        <p className="p-4 text-xs text-ink-3">Loading…</p>
      ) : lines.length === 0 ? (
        <EmptyState
          icon={Play}
          title="Not computed yet"
          description="Compute the run to build the register from attendance and the statutory tables."
        />
      ) : (
        <div ref={printRef} className="space-y-3">
          <StatGrid>
            <StatTile label="Gross pay" value={money(run.grossPay)} icon={Banknote} />
            <StatTile label="Deductions" value={money(run.totalDeductions)} hint={`Tax ${money(run.withholdingTax)}`} />
            <StatTile label="Net pay" value={money(run.netPay)} icon={Banknote} />
            <StatTile
              label="Employer cost"
              value={money(run.employerCost)}
              hint={`Share ${money(run.statutoryEmployer)}`}
            />
          </StatGrid>

          {flagged.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-[12px] text-warning">
              <TriangleAlert className="mt-px size-4 shrink-0" />
              {flagged.length} {flagged.length === 1 ? 'payslip needs' : 'payslips need'} a look before approval — see
              the notes column.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[62rem] border-collapse">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                  <th className="px-2 py-2 text-left">Employee</th>
                  <th className="px-2 py-2 text-right">Basic</th>
                  <th className="px-2 py-2 text-right">OT</th>
                  <th className="px-2 py-2 text-right">Gross</th>
                  <th className="px-2 py-2 text-right">SSS</th>
                  <th className="px-2 py-2 text-right">PhilHealth</th>
                  <th className="px-2 py-2 text-right">Pag-IBIG</th>
                  <th className="px-2 py-2 text-right">Tax</th>
                  <th className="px-2 py-2 text-right">Deductions</th>
                  <th className="px-2 py-2 text-right">Net pay</th>
                  {editable && <th data-print="hide" className="w-10 px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className={cn('border-b border-line last:border-0', l.notes && 'bg-warning/5')}>
                    <td className="px-2 py-1.5">
                      <span className="text-[12px] font-medium text-ink">{l.employee}</span>
                      <span className="ml-1 text-[10px] text-ink-3">{l.employeeNo}</span>
                      {l.notes && <p className="text-[10px] text-warning">{l.notes}</p>}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{money(l.basicPay)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{l.overtimePay ? money(l.overtimePay) : '—'}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px] font-medium">{money(l.grossPay)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{money(l.sss)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{money(l.philhealth)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{money(l.pagibig)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px]">{money(l.withholdingTax)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px] text-critical">{money(l.totalDeductions)}</td>
                    <td className="tabular px-2 py-1.5 text-right text-[12px] font-semibold text-ink">{money(l.netPay)}</td>
                    {editable && (
                      <td data-print="hide" className="px-2 py-1.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Adjust ${l.employee}'s payslip`}
                          title="Allowances, holiday and rest day pay, one-off items"
                          onClick={() => setAdjusting(l)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* The two write paths on a register, both server-guarded. */}
      <PayslipAdjustDialog
        payslip={adjusting}
        open={adjusting !== null}
        onClose={() => setAdjusting(null)}
        onSaved={() => {
          void load()
          onChanged()
        }}
      />

      <Modal
        open={addingEmployee}
        onClose={() => setAddingEmployee(false)}
        title="Add an employee to this run"
        description="For somebody the run missed — hired mid-cut-off, or moved into this payroll group after it was computed. Recomputing would also pick them up, but it would discard every adjustment already made to the other payslips."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingEmployee(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void addEmployee()} disabled={!newEmployeeId || busy} loading={busy}>
              <UserPlus className="size-4" />
              Add payslip
            </Button>
          </>
        }
      >
        <Field
          label="Employee"
          required
          hint="They must already be in this run's payroll group, or they would be paid on the wrong cut-off."
          composite
        >
          <Combobox
            value={newEmployeeId}
            options={employees
              .filter((e) => !lines.some((l) => l.employeeNo === String(e.employeeNo ?? '')))
              .map((e) => ({
                value: Number(e.id),
                label: String(e.fullName ?? e.name ?? ''),
                sublabel: String(e.employeeNo ?? ''),
              }))}
            onChange={(v) => setNewEmployeeId(v === null ? null : Number(v))}
            placeholder="Who was missed"
          />
        </Field>
      </Modal>
    </Modal>
  )
}

/**
 * Which of a run's controls are still available.
 *
 * Editing means re-pointing the run at a different cut-off or group, and that
 * only makes sense while it is a draft: a computed run has payslips calculated
 * against a specific period's dates, and moving the header underneath them
 * does not recompute anything — it just makes the register describe a payroll
 * that never happened.
 *
 * Deleting is allowed one step further, up to Computed, because nothing has
 * left the bank yet. Approved is the line: somebody has signed that register.
 * The server enforces both; this only decides what to show, so a button is
 * never offered for something that will be refused.
 */
const canEditRun = (status: string) => status === 'Draft'
const canDeleteRun = (status: string) => status === 'Draft' || status === 'Computed'

export function PayrollRuns() {
  const toast = useToast()
  const isSuperAdmin = useIsSuperAdmin()
  const [openRun, setOpenRun] = React.useState<number | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<PayrollRunSummary | null>(null)
  const [removing, setRemoving] = React.useState<PayrollRunSummary | null>(null)
  // Only ever true alongside `removing`, and only for a run that already
  // failed the ordinary delete guard — a super-admin choosing to override it.
  const [forcing, setForcing] = React.useState(false)
  const [periodId, setPeriodId] = React.useState<number | null>(null)
  const [groupId, setGroupId] = React.useState<number | null>(null)
  const [busy, setBusy] = React.useState(false)

  const { data: runs = [], refetch } = useResource<PayrollRunSummary[]>('hr/payroll-runs', () => [])
  const { data: periods = [] } = useResource<Record<string, unknown>[]>('hr/payroll-periods', () => [])
  const { data: groups = [] } = useResource<Record<string, unknown>[]>('hr/payroll-groups', () => [])

  const refresh = () => {
    void refetch()
    void queryClient.invalidateQueries({ queryKey: ['resource'] })
  }

  const generate = async () => {
    setBusy(true)
    try {
      const r = await generatePayrollPeriods(new Date().getFullYear())
      toast({
        tone: 'success',
        title: r.created ? `${r.created} cut-offs created for ${r.year}` : `${r.year} is already set up`,
      })
      refresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not generate.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!periodId || !groupId) return
    setBusy(true)
    try {
      const run = await createRecord<{ id: number }>('hr/payroll-runs', { periodId, groupId })
      setCreating(false)
      refresh()
      setOpenRun(run.id)
    } catch (err) {
      toast({ tone: 'error', title: 'Could not start the run.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  /** Opens the same dialog as New, with the run's current choices loaded. */
  const startEdit = (run: PayrollRunSummary) => {
    setPeriodId(run.periodId ?? null)
    setGroupId(run.groupId ?? null)
    setEditing(run)
  }

  const saveEdit = async () => {
    if (!editing || !periodId || !groupId) return
    setBusy(true)
    try {
      await updateRecord('hr/payroll-runs', editing.id, { periodId, groupId })
      toast({ tone: 'success', title: `${editing.no} updated` })
      setEditing(null)
      refresh()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not change the run.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteRecord('hr/payroll-runs', removing.id, forcing)
      toast({
        tone: 'success',
        title: forcing ? `${removing.no} force-deleted` : `${removing.no} deleted`,
        description: forcing
          ? 'Its payslips went with it. This bypassed the safety guard and is in the audit log.'
          : 'Its payslips went with it. The cut-off is free to be run again.',
      })
      setRemoving(null)
      setForcing(false)
      refresh()
    } catch (err) {
      // The server's refusal explains what is in the way — show it verbatim
      // rather than replacing it with a generic failure.
      toast({ tone: 'error', title: 'Could not delete the run.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Payroll" description="Semi-monthly runs, statutory contributions and the bank file." />
        <div className="card">
          <EmptyState icon={Banknote} title="Payroll needs the live API" description="Runs are computed from attendance and the statutory tables." />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Runs computed from the punch clock and the current SSS, PhilHealth, Pag-IBIG and BIR schedules."
        actions={
          <>
            <Button variant="ghost" onClick={() => void generate()} disabled={busy}>
              <CalendarPlus className="size-4" />
              Generate cut-offs
            </Button>
            <Button onClick={() => setCreating(true)} disabled={periods.length === 0}>
              <Play className="size-4" />
              New run
            </Button>
          </>
        }
      />

      {periods.length === 0 && (
        <p className="card mb-4 p-4 text-[13px] text-ink-2">
          No cut-offs exist yet. <strong className="text-ink">Generate cut-offs</strong> creates the twenty-four
          semi-monthly periods for this year — the 1st–15th and 16th–end pattern payroll runs on.
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[48rem] border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
              <th className="px-3 py-2 text-left">Run</th>
              <th className="px-3 py-2 text-left">Cut-off</th>
              <th className="px-3 py-2 text-left">Group</th>
              <th className="px-3 py-2 text-right">Headcount</th>
              <th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Net pay</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="w-20 px-3 py-2 text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <EmptyState
                    icon={Banknote}
                    title="No payroll runs yet"
                    description="Start one against a cut-off and a payroll group, then compute it."
                  />
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpenRun(r.id)}
                  className="cursor-pointer border-b border-line last:border-0 transition-colors hover:bg-surface-2"
                >
                  <td className="px-3 py-2 text-[13px] font-medium text-ink">{r.no}</td>
                  <td className="px-3 py-2 text-[13px] text-ink-2">{r.periodLabel ?? r.period ?? '—'}</td>
                  <td className="px-3 py-2 text-[13px] text-ink-2">{r.group ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{num(r.headcount)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.grossPay)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px] font-semibold">{money(r.netPay)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                    {r.releasedAt && <span className="ml-1.5 text-[10px] text-ink-3">{fmtDate(r.releasedAt)}</span>}
                  </td>
                  {/* The row opens the register; these two must not, so they
                      stop the click before it reaches the row. */}
                  <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {canEditRun(r.status) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Change the cut-off or group on ${r.no}`}
                        onClick={() => startEdit(r)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    )}
                    {canDeleteRun(r.status) && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${r.no}`}
                        onClick={() => setRemoving(r)}
                      >
                        <Trash2 className="size-3.5 text-critical" />
                      </Button>
                    )}
                    {!canEditRun(r.status) && !canDeleteRun(r.status) && (
                      isSuperAdmin ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Force delete ${r.no}`}
                          title="Force delete — bypasses the safety guard, super-admin only"
                          onClick={() => {
                            setForcing(true)
                            setRemoving(r)
                          }}
                        >
                          <ShieldAlert className="size-3.5 text-critical" />
                        </Button>
                      ) : (
                        <span className="text-[10px] text-ink-3">Locked</span>
                      )
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        title={editing ? `Change ${editing.no}` : 'New payroll run'}
        description={
          editing
            ? 'A draft has no payslips yet, so it can still be pointed somewhere else.'
            : 'One payroll group over one cut-off.'
        }
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false)
                setEditing(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void (editing ? saveEdit() : create())}
              disabled={!periodId || !groupId || busy}
            >
              {editing ? 'Save changes' : 'Start run'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Cut-off" required composite>
            <Combobox
              value={periodId}
              options={periods.map((p) => ({
                value: Number(p.id),
                label: String(p.label ?? p.code ?? ''),
                sublabel: String(p.code ?? ''),
              }))}
              onChange={(v) => setPeriodId(v === null ? null : Number(v))}
              placeholder="Choose a cut-off…"
            />
          </Field>
          <Field label="Payroll group" required composite>
            <Combobox
              value={groupId}
              options={groups.map((g) => ({ value: Number(g.id), label: String(g.name ?? '') }))}
              onChange={(v) => setGroupId(v === null ? null : Number(v))}
              placeholder="Choose a group…"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={removing !== null}
        onClose={() => {
          setRemoving(null)
          setForcing(false)
        }}
        title={removing ? (forcing ? `Force delete ${removing.no}?` : `Delete ${removing.no}?`) : ''}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setRemoving(null); setForcing(false) }}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              {forcing ? 'Force delete it' : 'Delete the run'}
            </Button>
          </>
        }
      >
        {removing && (
          <div className="space-y-2 text-[13px] text-ink-2">
            <p>
              {removing.periodLabel ?? removing.period} · {removing.group ?? 'no group'}
            </p>
            {forcing ? (
              <p className="rounded-lg bg-critical/10 p-3 text-critical">
                This run is {removing.status} — its wages have already been {removing.status === 'Released' ? 'paid' : 'signed off'}.
                Deleting it removes that record from the statutory filing history and the audit trail permanently,
                along with the {num(removing.headcount)} payslip{removing.headcount === 1 ? '' : 's'} it produced.
                This bypasses the normal safety guard and is recorded against your account in the audit log.
              </p>
            ) : removing.status === 'Computed' ? (
              <p className="rounded-lg bg-warning/10 p-3 text-warning">
                This run has been computed. Deleting it removes the {num(removing.headcount)} payslip
                {removing.headcount === 1 ? '' : 's'} it produced — {money(removing.netPay)} of net pay. Nothing has
                been paid, so nothing is lost that recomputing cannot rebuild.
              </p>
            ) : (
              <p>Nothing has been computed against it yet, so there is nothing to lose.</p>
            )}
          </div>
        )}
      </Modal>

      {openRun && (
        <RegisterDialog runId={openRun} open onClose={() => setOpenRun(null)} onChanged={refresh} />
      )}
    </>
  )
}

/** What each agency is owed, summed from the payslips actually computed. */
export function Remittances() {
  const [data, setData] = React.useState<RemittanceSummary | null>(null)
  const [periodId, setPeriodId] = React.useState<number | null>(null)
  const { data: periods = [] } = useResource<Record<string, unknown>[]>('hr/payroll-periods', () => [])
  const printRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!liveApi()) return
    void getRemittances(periodId ?? undefined)
      .then(setData)
      .catch(() => setData(null))
  }, [periodId])

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Statutory Remittances" description="What each agency is owed per cut-off." />
        <div className="card">
          <EmptyState icon={Banknote} title="Remittances need the live API" description="They are summed from computed payslips." />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Statutory Remittances"
        description="Summed from the payslips actually computed, so the remittance and the register cannot disagree."
        actions={
          data && (
            <Button
              variant="secondary"
              onClick={() =>
                printRegion(printRef.current, {
                  title: 'Statutory Remittances',
                  subtitle: `${data.runs} run(s) · ${data.headcount} employees`,
                  preparedBy: currentUser().name,
                })
              }
            >
              <Printer className="size-4" />
              Print
            </Button>
          )
        }
      />

      <div className="card mb-4 p-3" data-print="hide">
        <Field label="Cut-off" hint="Leave blank for every computed run." composite className="max-w-sm">
          <Combobox
            value={periodId}
            options={periods.map((p) => ({ value: Number(p.id), label: String(p.label ?? p.code ?? '') }))}
            onChange={(v) => setPeriodId(v === null ? null : Number(v))}
            placeholder="All cut-offs"
          />
        </Field>
      </div>

      {!data ? (
        <div className="card">
          <EmptyState icon={Banknote} title="Nothing computed yet" description="Compute a payroll run first." />
        </div>
      ) : (
        <div ref={printRef} className="card overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Agency</th>
                <th className="px-3 py-2 text-right">Employee share</th>
                <th className="px-3 py-2 text-right">Employer share</th>
                <th className="px-3 py-2 text-right">Total due</th>
                <th className="px-3 py-2 text-left">Basis</th>
              </tr>
            </thead>
            <tbody>
              {data.agencies.map((a) => (
                <tr key={a.agency} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-[13px] font-medium text-ink">{a.agency}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(a.employee)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(a.employer)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px] font-semibold text-ink">{money(a.total)}</td>
                  <td className="px-3 py-2 text-[11px] text-ink-3">{a.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
            From {data.runs} computed {data.runs === 1 ? 'run' : 'runs'} covering {num(data.headcount)} employees.
          </p>
        </div>
      )}
    </>
  )
}
