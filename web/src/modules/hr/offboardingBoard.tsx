import * as React from 'react'
import {
  Check, CheckCircle2, Circle, ClipboardList, DoorOpen, Lock, UserMinus, Wallet, X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import {
  cancelOffboardingCase, closeOffboardingCase, completeOffboardingTask, decideResignation, getOffboardingCase, getOffboardingCases,
  getOffboardingHistory, getPendingResignations, liveApi, reopenOffboardingTask, updateOffboardingCase,
  type OffboardingCaseDetail, type OffboardingCaseRow, type OffboardingHistoryRow, type OffboardingTaskItem,
  type ResignationRequestDetail,
} from '@/lib/adminApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * The clearance process a separation starts.
 *
 * Recruitment turns an applicant into an employee, stage by stage; this is
 * its mirror image on the way out — property turnover, access revocation,
 * per-department clearance, the final-pay handoff to Payroll, and the COE.
 * Cases are opened automatically the moment employment_status becomes
 * RESIGNED or TERMINATED (see `EmployeeObserver`), or ahead of that by HR
 * from the employee record, for the two-week-notice case where the paper
 * process should start before the status does.
 */

const CATEGORY_ORDER: OffboardingTaskItem['category'][] = [
  'Documentation', 'Property Turnover', 'Access Revocation', 'Clearance', 'Finance',
]

const CLEARANCE_TONE: Record<OffboardingCaseDetail['clearanceStatus'], 'neutral' | 'warning' | 'good'> = {
  Pending: 'neutral', 'In Progress': 'warning', Cleared: 'good',
}

const PAY_TONE: Record<OffboardingCaseDetail['finalPayStatus'], 'neutral' | 'warning' | 'good'> = {
  Pending: 'neutral', Processing: 'warning', Released: 'good',
}

/* -------------------------------------------------------------------------- */
/* One case, in a dialog                                                      */
/* -------------------------------------------------------------------------- */

function CaseModal({ caseId, onClose, onChanged }: { caseId: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [item, setItem] = React.useState<OffboardingCaseDetail | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [cancelReason, setCancelReason] = React.useState('')

  const load = React.useCallback(() => {
    getOffboardingCase(caseId).then(setItem).catch(() => setItem(null))
  }, [caseId])

  React.useEffect(() => {
    load()
  }, [load])

  const byCategory = React.useMemo(() => {
    const groups = new Map<string, OffboardingTaskItem[]>()
    for (const task of item?.items ?? []) {
      const list = groups.get(task.category) ?? []
      list.push(task)
      groups.set(task.category, list)
    }
    return groups
  }, [item])

  const toggleTask = async (task: OffboardingTaskItem) => {
    setBusy(true)
    try {
      await (task.status === 'Done' ? reopenOffboardingTask(task.id) : completeOffboardingTask(task.id))
      load()
      onChanged()
    } catch (error) {
      toast({ tone: 'error', title: 'Could not update that task.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const patch = async (values: Record<string, unknown>, label: string) => {
    setBusy(true)
    try {
      setItem(await updateOffboardingCase(caseId, values))
      onChanged()
      toast({ tone: 'success', title: `${label} updated` })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not update that.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    setBusy(true)
    try {
      setItem(await closeOffboardingCase(caseId))
      onChanged()
      toast({ tone: 'success', title: 'Case closed' })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not close this case.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const cancelCase = async () => {
    if (!cancelReason.trim()) return
    setBusy(true)
    try {
      setItem(await cancelOffboardingCase(caseId, cancelReason.trim()))
      onChanged()
      setCancelling(false)
      setCancelReason('')
      toast({ tone: 'success', title: 'Case cancelled' })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not cancel this case.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item ? `${item.name} — Offboarding` : 'Loading…'}
      description={item ? `${item.employeeNo} · ${item.reason}${item.lastWorkingDay ? ` · last day ${item.lastWorkingDay}` : ''}` : undefined}
      headerAside={
        item?.closedAt ? (
          <Badge tone={item.outcome === 'Cancelled' ? 'neutral' : 'good'}>
            {item.outcome === 'Cancelled' ? 'Cancelled' : 'Closed'}
          </Badge>
        ) : item ? (
          <Badge tone="warning">Open</Badge>
        ) : undefined
      }
    >
      {!item ? (
        <p className="p-4 text-[13px] text-ink-3">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-line p-2.5">
              <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Clearance</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(['Pending', 'In Progress', 'Cleared'] as const).map((s) => (
                  <button
                    key={s}
                    disabled={busy || !!item.closedAt}
                    onClick={() => void patch({ clearance_status: s }, 'Clearance status')}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset transition-colors',
                      item.clearanceStatus === s ? '' : 'opacity-50 hover:opacity-100',
                    )}
                  >
                    <Badge tone={CLEARANCE_TONE[s]}>{s}</Badge>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line p-2.5">
              <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Final pay</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(['Pending', 'Processing', 'Released'] as const).map((s) => (
                  <button
                    key={s}
                    disabled={busy || !!item.closedAt}
                    onClick={() => void patch({ final_pay_status: s }, 'Final pay status')}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset transition-colors',
                      item.finalPayStatus === s ? '' : 'opacity-50 hover:opacity-100',
                    )}
                  >
                    <Badge tone={PAY_TONE[s]}>{s}</Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-ink-2">
            <input
              type="checkbox"
              checked={item.exitInterviewCompleted}
              disabled={busy || !!item.closedAt}
              onChange={(e) => void patch({ exit_interview_completed: e.target.checked }, 'Exit interview')}
            />
            Exit interview completed
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Checklist</p>
              <span className="text-[11px] text-ink-3">{item.completion.done}/{item.completion.total} done</span>
            </div>
            <div className="space-y-3">
              {CATEGORY_ORDER.map((category) => {
                const tasks = byCategory.get(category)
                if (!tasks || tasks.length === 0) return null

                return (
                  <div key={category}>
                    <p className="mb-1 text-[10px] font-medium tracking-wide text-ink-3 uppercase">{category}</p>
                    <div className="space-y-1">
                      {tasks.map((task) => (
                        <button
                          key={task.id}
                          disabled={busy || !!item.closedAt}
                          onClick={() => void toggleTask(task)}
                          className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
                        >
                          {task.status === 'Done' ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
                          ) : (
                            <Circle className="mt-0.5 size-4 shrink-0 text-ink-3" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className={cn('block text-[12px] font-medium', task.status === 'Done' ? 'text-ink-3 line-through' : 'text-ink')}>
                              {task.title}
                            </span>
                            {task.description && <span className="text-[10px] text-ink-3">{task.description}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {item.closedAt && item.outcome === 'Cancelled' && item.cancelReason && (
            <p className="rounded-lg bg-surface-2 p-2.5 text-[12px] text-ink-2">
              <span className="font-medium text-ink">Cancelled:</span> {item.cancelReason}
            </p>
          )}

          {!item.closedAt && (
            <div className="space-y-2.5 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-ink-3">
                  Closing requires clearance <strong>Cleared</strong> and final pay <strong>Released</strong>.
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" variant="ghost" className="text-critical" disabled={busy} onClick={() => setCancelling(true)}>
                    <X className="size-3.5" />
                    Cancel case
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || item.clearanceStatus !== 'Cleared' || item.finalPayStatus !== 'Released'}
                    onClick={() => void close()}
                  >
                    <Lock className="size-3.5" />
                    Close case
                  </Button>
                </div>
              </div>

              {cancelling && (
                <div className="flex items-center gap-2 rounded-lg border border-line p-2.5">
                  <input
                    autoFocus
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Why is this case being called off? e.g. employee rescinded"
                    className="flex-1 rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink"
                  />
                  <Button size="xs" variant="danger" disabled={busy || !cancelReason.trim()} onClick={() => void cancelCase()}>
                    Confirm
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => { setCancelling(false); setCancelReason('') }}>
                    Back
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Resignation requests awaiting a decision                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where a self-service submission actually becomes a separation.
 *
 * Approving is what calls `OffboardingOperations::initiate()` on the server
 * — nothing before this point has touched the 201 file or the sign-in.
 * Deliberately not folded into the cases table below: a request is not yet a
 * case, and showing it in the same list would make "submitted" and "clearance
 * in progress" look like the same kind of row when they are not.
 */
function PendingResignations({ onDecided }: { onDecided: () => void }) {
  const toast = useToast()
  const [rows, setRows] = React.useState<ResignationRequestDetail[]>([])
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const [declining, setDeclining] = React.useState<ResignationRequestDetail | null>(null)
  const [note, setNote] = React.useState('')

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getPendingResignations().then(setRows).catch(() => setRows([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const approve = async (r: ResignationRequestDetail) => {
    setBusyId(r.id)
    try {
      await decideResignation(r.id, 'Approved')
      toast({ tone: 'success', title: `${r.name}'s resignation approved`, description: 'A clearance checklist has been started.' })
      load()
      onDecided()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not approve', description: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  const decline = async () => {
    if (!declining) return
    setBusyId(declining.id)
    try {
      await decideResignation(declining.id, 'Declined', note || undefined)
      toast({ tone: 'success', title: `${declining.name}'s request declined` })
      setDeclining(null)
      setNote('')
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not decline', description: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  if (rows.length === 0) return null

  return (
    <div className="card mb-4 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <DoorOpen className="size-4" />
        Resignation requests awaiting a decision
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{r.name}</p>
              <p className="text-[11px] text-ink-3">
                {r.employeeNo} · intended last day {r.intendedLastDay ? fmtDate(r.intendedLastDay) : '—'}
                {r.reason && ` · ${r.reason}`}
              </p>
            </div>
            <Button size="sm" variant="primary" disabled={busyId === r.id} onClick={() => void approve(r)}>
              <Check className="size-3.5" />
              Approve
            </Button>
            <Button size="sm" variant="ghost" className="text-critical" disabled={busyId === r.id} onClick={() => setDeclining(r)}>
              <X className="size-3.5" />
              Decline
            </Button>
          </div>
        ))}
      </div>

      <Modal
        open={declining !== null}
        onClose={() => setDeclining(null)}
        size="sm"
        title={declining ? `Decline ${declining.name}'s request?` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(null)}>Cancel</Button>
            <Button variant="danger" disabled={busyId !== null} onClick={() => void decline()}>Decline it</Button>
          </>
        }
      >
        <div className="p-4">
          <label className="mb-1.5 block text-[11px] font-medium text-ink-3 uppercase">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink"
            rows={3}
            placeholder="Why this wasn't approved as filed"
          />
        </div>
      </Modal>
    </div>
  )
}

function OpenCases() {
  const [rows, setRows] = React.useState<OffboardingCaseRow[] | null>(null)
  const [counts, setCounts] = React.useState<{ total: number; pendingClearance: number; pendingFinalPay: number } | null>(null)
  const [openCase, setOpenCase] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getOffboardingCases()
      .then((r) => {
        setRows(r.cases)
        setCounts(r.counts)
      })
      .catch(() => {
        setRows([])
        setCounts(null)
      })
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div>
      <PendingResignations onDecided={load} />

      <StatGrid className="mb-4">
        <StatTile label="Open cases" value={num(counts?.total ?? 0)} icon={DoorOpen} />
        <StatTile label="Clearance pending" value={num(counts?.pendingClearance ?? 0)} icon={UserMinus} hint="Not yet marked Cleared" />
        <StatTile label="Final pay pending" value={num(counts?.pendingFinalPay ?? 0)} icon={Wallet} hint="Not yet marked Released" />
      </StatGrid>

      {!liveApi() ? (
        <div className="card p-4 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to use Offboarding.</div>
      ) : rows === null ? (
        <div className="card p-4 text-[13px] text-ink-3">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card flex items-center gap-2 p-4 text-[13px] text-good">
          <CheckCircle2 className="size-4" />
          Nothing open — every recorded separation has been cleared.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
                <th className="px-4 py-2.5 font-medium">Last working day</th>
                <th className="px-4 py-2.5 font-medium">Checklist</th>
                <th className="px-4 py-2.5 font-medium">Clearance</th>
                <th className="px-4 py-2.5 font-medium">Final pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpenCase(row.id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{row.name}</div>
                    <div className="text-[11px] text-ink-3">{row.employeeNo} · {row.department ?? '—'}</div>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone="neutral">{row.reason}</Badge></td>
                  <td className="px-4 py-2.5 text-ink-2">{row.lastWorkingDay ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="size-3.5 text-ink-3" />
                      <span className="text-[12px] text-ink-2">{row.done}/{row.total}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone={CLEARANCE_TONE[row.clearanceStatus]}>{row.clearanceStatus}</Badge></td>
                  <td className="px-4 py-2.5"><Badge tone={PAY_TONE[row.finalPayStatus]}>{row.finalPayStatus}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openCase !== null && (
        <CaseModal
          caseId={openCase}
          onClose={() => setOpenCase(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}

/**
 * Where a closed case actually goes.
 *
 * `outstanding()` on the server only ever reads open cases — the moment one
 * closes it simply stopped appearing anywhere, with no route or screen able
 * to look it up again. This is that lookup.
 */
function ClosedCases() {
  const [rows, setRows] = React.useState<OffboardingHistoryRow[] | null>(null)
  const [openCase, setOpenCase] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getOffboardingHistory().then(setRows).catch(() => setRows([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  if (!liveApi()) return null

  return (
    <div>
      {rows === null ? (
        <div className="card p-4 text-[13px] text-ink-3">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card p-4 text-[13px] text-ink-3">No closed cases yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
                <th className="px-4 py-2.5 font-medium">Outcome</th>
                <th className="px-4 py-2.5 font-medium">Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpenCase(row.id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{row.name}</div>
                    <div className="text-[11px] text-ink-3">{row.employeeNo} · {row.department ?? '—'}</div>
                  </td>
                  <td className="px-4 py-2.5"><Badge tone="neutral">{row.reason}</Badge></td>
                  <td className="px-4 py-2.5">
                    <Badge tone={row.outcome === 'Cancelled' ? 'neutral' : 'good'}>{row.outcome}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{row.closedAt ? fmtDate(row.closedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openCase !== null && (
        <CaseModal caseId={openCase} onClose={() => setOpenCase(null)} onChanged={load} />
      )}
    </div>
  )
}

export function OffboardingBoard() {
  return (
    <div>
      <PageHeader
        title="Offboarding"
        description="Every separation — property turnover, access revocation, department clearance and the final-pay handoff to Payroll, tracked from the day notice is given to the day the case closes."
      />

      <TabbedArea
        storageKey="offboarding"
        tabs={[
          { id: 'open', label: 'Open Cases', hint: 'Separations still in progress.', render: () => <OpenCases /> },
          { id: 'closed', label: 'Closed Cases', hint: 'Every case that has been fully cleared.', render: () => <ClosedCases /> },
        ]}
      />
    </div>
  )
}
