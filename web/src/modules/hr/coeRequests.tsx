import * as React from 'react'
import { Download, FileText, X } from 'lucide-react'
import {
  decideCoeRequest, downloadHrCoeDocument, getPendingCoeRequests, liveApi,
  type CoeRequestDetail,
} from '@/lib/adminApi'
import { Badge, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * HR's side of self-service COE requests.
 *
 * Issuing is what generates the certificate — there is no separate "approve
 * then generate" step, because a COE has no follow-on process the way a
 * resignation opens offboarding. The moment HR issues one, the employee's
 * own Self-Service card gets a download button; this panel gets one too, so
 * HR can hand over a printed copy without asking the employee to fetch it
 * themselves.
 */
export function PendingCoeRequests() {
  const toast = useToast()
  const [rows, setRows] = React.useState<CoeRequestDetail[]>([])
  const [busyId, setBusyId] = React.useState<number | null>(null)
  const [declining, setDeclining] = React.useState<CoeRequestDetail | null>(null)
  const [note, setNote] = React.useState('')

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getPendingCoeRequests().then(setRows).catch(() => setRows([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const issue = async (r: CoeRequestDetail) => {
    setBusyId(r.id)
    try {
      const updated = await decideCoeRequest(r.id, 'Issued')
      toast({ tone: 'success', title: `${r.name}'s certificate issued` })
      await downloadHrCoeDocument(updated.id, `Certificate of ${updated.type} - ${updated.name ?? updated.id}.docx`)
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not issue', description: (e as Error).message })
    } finally {
      setBusyId(null)
    }
  }

  const decline = async () => {
    if (!declining) return
    setBusyId(declining.id)
    try {
      await decideCoeRequest(declining.id, 'Declined', note || undefined)
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

  if (!liveApi()) {
    return <div className="card p-4 text-[13px] text-ink-3">Connect the live API (VITE_API_URL) to use Certificates.</div>
  }

  if (rows.length === 0) {
    return (
      <div className="card flex items-center gap-2 p-4 text-[13px] text-good">
        <FileText className="size-4" />
        Nothing waiting — every COE request has been decided.
      </div>
    )
  }

  return (
    <div className="card p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <FileText className="size-4" />
        Certificate requests awaiting a decision
      </p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                {r.name}
                <Badge tone={r.type === 'No Derogatory Record' ? 'info' : 'neutral'}>{r.type}</Badge>
              </p>
              <p className="text-[11px] text-ink-3">
                {r.employeeNo} · {r.department ?? '—'} · {r.purpose || 'General purpose'}
                {r.includeSalary && <Badge tone="warning" className="ml-1.5">with salary</Badge>}
              </p>
            </div>
            <Button size="sm" variant="primary" disabled={busyId === r.id} onClick={() => void issue(r)}>
              <Download className="size-3.5" />
              Issue &amp; download
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
            placeholder="Why this wasn't issued"
          />
        </div>
      </Modal>
    </div>
  )
}
