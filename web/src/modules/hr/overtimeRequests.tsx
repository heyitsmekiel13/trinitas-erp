import * as React from 'react'
import { Check, Timer, X } from 'lucide-react'
import { decideOvertimeRequest, getPendingOvertimeRequests, liveApi, type OvertimeRequestDetail } from '@/lib/adminApi'
import { fmtDate } from '@/lib/format'
import { Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

const otTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

/**
 * HR/a supervisor's side of overtime pre-approval requests.
 *
 * Deciding here never touches `overtime_hours` — that stays computed from
 * the punch, exactly as before this existed. This is the record of what
 * was actually authorized in advance, read alongside the worked figure
 * rather than in place of it.
 */
export function PendingOvertimeRequests() {
  const toast = useToast()
  const [rows, setRows] = React.useState<OvertimeRequestDetail[]>([])
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const [declining, setDeclining] = React.useState<OvertimeRequestDetail | null>(null)
  const [note, setNote] = React.useState('')

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getPendingOvertimeRequests().then(setRows).catch(() => setRows([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const approve = async (r: OvertimeRequestDetail) => {
    setBusyId(r.id)
    try {
      await decideOvertimeRequest(r.id, 'Approved')
      toast({ tone: 'success', title: `${r.name}'s overtime approved` })
      load()
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
      await decideOvertimeRequest(declining.id, 'Declined', note || undefined)
      toast({ tone: 'success', title: `${declining.name}'s overtime declined` })
      setDeclining(null)
      setNote('')
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not decline', description: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  if (!liveApi()) {
    return <div className="card p-4 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to use overtime pre-approvals.</div>
  }

  if (rows.length === 0) {
    return (
      <div className="card flex items-center gap-2 p-4 text-[13px] text-good">
        <Timer className="size-4" />
        Nothing waiting — every overtime request has been decided.
      </div>
    )
  }

  return (
    <div className="card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Timer className="size-4" />
        Overtime requests awaiting a decision
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{r.name}</p>
              <p className="text-[11px] text-ink-3">
                {r.employeeNo} · {r.department ?? '—'} · {r.workDate ? fmtDate(r.workDate) : '—'} ·{' '}
                {otTime(r.expectedStartAt)}–{otTime(r.expectedEndAt)}
                {r.expectedHours != null && ` (${r.expectedHours}h)`}
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
        title={declining ? `Decline ${declining.name}'s overtime request?` : ''}
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
            placeholder="Why this wasn't approved"
          />
        </div>
      </Modal>
    </div>
  )
}
