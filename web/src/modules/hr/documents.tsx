import * as React from 'react'
import {
  AlertTriangle, CalendarClock, CheckCircle2, Download, FileWarning, ShieldCheck, Trash2, Upload, X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, num } from '@/lib/format'
import {
  deleteDocument, downloadEmployeeDocument, getDocumentsOutstanding, getEmployeeChecklist,
  liveApi, rejectDocument, uploadEmployeeDocument, verifyDocument,
  type DocumentChecklistItem, type DocumentOutstandingRow, type EmployeeChecklist,
} from '@/lib/adminApi'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { PendingCoeRequests } from './coeRequests'

/**
 * The 201 file as paper.
 *
 * `hr/employees` (Masterfile) already shows whether a record's *fields* are
 * complete. This is the same question about the *documents* — the NBI
 * clearance, the signed contract, the government IDs — that a 201-file audit
 * actually checks for. Nothing before this could answer "is employee X's file
 * complete" without a walk to the cabinet; this makes it a percentage.
 */

const ITEM_TONE: Record<DocumentChecklistItem['status'], 'neutral' | 'warning' | 'good' | 'critical'> = {
  Missing: 'neutral',
  Pending: 'warning',
  Verified: 'good',
  Rejected: 'critical',
  Expired: 'critical',
}

function completionTone(percent: number): 'critical' | 'warning' | 'good' {
  if (percent >= 100) return 'good'
  if (percent >= 60) return 'warning'
  return 'critical'
}

/* -------------------------------------------------------------------------- */
/* One employee's checklist, in a dialog                                      */
/* -------------------------------------------------------------------------- */

function UploadRow({ item, employeeId, onChanged }: { item: DocumentChecklistItem; employeeId: number; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [expiry, setExpiry] = React.useState('')
  const [rejecting, setRejecting] = React.useState(false)
  const [rejectNote, setRejectNote] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const pickFile = () => {
    if (item.expires && !expiry) {
      toast({ tone: 'error', title: 'Set the expiry date first', description: `${item.name} lapses — pick when this copy expires.` })
      return
    }
    inputRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      await uploadEmployeeDocument(employeeId, item.documentTypeId, file, expiry || undefined)
      toast({ tone: 'success', title: `${item.name} uploaded`, description: 'Awaiting verification.' })
      onChanged()
    } catch (error) {
      toast({ tone: 'error', title: 'Upload failed', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!item.documentId) return
    setBusy(true)
    try {
      await verifyDocument(item.documentId)
      toast({ tone: 'success', title: `${item.name} verified` })
      onChanged()
    } catch (error) {
      toast({ tone: 'error', title: 'Could not verify', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!item.documentId || !rejectNote.trim()) return
    setBusy(true)
    try {
      await rejectDocument(item.documentId, rejectNote.trim())
      toast({ tone: 'success', title: `${item.name} sent back` })
      setRejecting(false)
      setRejectNote('')
      onChanged()
    } catch (error) {
      toast({ tone: 'error', title: 'Could not reject', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!item.documentId) return
    setBusy(true)
    try {
      await deleteDocument(item.documentId)
      toast({ tone: 'success', title: `${item.name} removed` })
      onChanged()
    } catch (error) {
      toast({ tone: 'error', title: 'Could not remove', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
            {item.name}
            {!item.required && <span className="text-[10px] font-normal text-ink-3">(optional)</span>}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
            <Badge tone={ITEM_TONE[item.status]}>{item.status}</Badge>
            {item.originalName && <span className="truncate">{item.originalName}</span>}
            {item.expiryDate && (
              <span className={item.status === 'Expired' ? 'font-medium text-critical' : undefined}>
                · expires {fmtDate(item.expiryDate)}
              </span>
            )}
            {item.verifiedBy && item.status === 'Verified' && <span>· verified by {item.verifiedBy}</span>}
          </p>
          {item.notes && item.status === 'Rejected' && (
            <p className="mt-1 flex items-start gap-1.5 rounded bg-critical/10 p-1.5 text-[11px] text-critical">
              <FileWarning className="mt-px size-3.5 shrink-0" />
              {item.notes}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {item.expires && (item.status === 'Missing' || item.status === 'Rejected' || item.status === 'Expired') && (
            <label
              className={cn(
                'flex items-center gap-1.5 rounded border px-2 py-1',
                expiry ? 'border-line bg-surface' : 'border-warning/40 bg-warning/5',
              )}
              title="This document expires — required before it can be uploaded"
            >
              <CalendarClock className="size-3.5 shrink-0 text-ink-3" />
              <span className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Expires</span>
              <input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                aria-label="Expiry date"
                className="bg-transparent text-[11px] text-ink outline-none"
              />
            </label>
          )}

          {item.status !== 'Verified' && (
            <>
              <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={onFile} />
              <Button size="xs" variant="secondary" disabled={busy} onClick={pickFile}>
                <Upload className="size-3.5" />
                {item.documentId ? 'Replace' : 'Upload'}
              </Button>
            </>
          )}

          {item.documentId && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void downloadEmployeeDocument(item.documentId!, item.originalName ?? item.name)}>
              <Download className="size-3.5" />
            </Button>
          )}

          {item.documentId && item.status === 'Pending' && (
            <>
              <Button size="xs" variant="primary" disabled={busy} onClick={() => void verify()}>
                <CheckCircle2 className="size-3.5" />
                Verify
              </Button>
              <Button size="xs" variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
                <X className="size-3.5" />
                Reject
              </Button>
            </>
          )}

          {item.documentId && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="size-3.5 text-critical" />
            </Button>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
          <input
            autoFocus
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Why is this being sent back?"
            className="flex-1 rounded border border-line bg-surface px-2 py-1 text-[12px] text-ink"
          />
          <Button size="xs" variant="danger" disabled={busy || !rejectNote.trim()} onClick={() => void reject()}>
            Confirm
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function ChecklistModal({ employeeId, onClose }: { employeeId: number; onClose: () => void }) {
  const [file, setFile] = React.useState<EmployeeChecklist | null>(null)

  const load = React.useCallback(() => {
    getEmployeeChecklist(employeeId).then(setFile).catch(() => setFile(null))
  }, [employeeId])

  React.useEffect(() => {
    load()
  }, [load])

  const byCategory = React.useMemo(() => {
    const groups = new Map<string, DocumentChecklistItem[]>()
    for (const item of file?.items ?? []) {
      const list = groups.get(item.category) ?? []
      list.push(item)
      groups.set(item.category, list)
    }
    return groups
  }, [file])

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={file ? `${file.name} — 201 File` : 'Loading…'}
      description={file ? `${file.employeeNo} · ${file.completion.verified}/${file.completion.required} required documents verified` : undefined}
      headerAside={file && (
        <Badge tone={completionTone(file.completion.percent)}>{file.completion.percent}% complete</Badge>
      )}
    >
      {!file ? (
        <p className="p-4 text-[13px] text-ink-3">Loading checklist…</p>
      ) : (
        <div className="space-y-5">
          {[...byCategory.entries()].map(([category, items]) => (
            <div key={category}>
              <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{category}</h4>
              <div className="space-y-2">
                {items.map((item) => (
                  <UploadRow key={item.documentTypeId} item={item} employeeId={employeeId} onChanged={load} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

function DocumentsList() {
  const [rows, setRows] = React.useState<DocumentOutstandingRow[] | null>(null)
  const [counts, setCounts] = React.useState<{ total: number; missing: number; expiringSoon: number } | null>(null)
  const [openEmployee, setOpenEmployee] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getDocumentsOutstanding()
      .then((r) => {
        setRows(r.employees)
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
      <StatGrid className="mb-4">
        <StatTile label="Employees tracked" value={num(counts?.total ?? 0)} icon={ShieldCheck} />
        <StatTile label="With something missing" value={num(counts?.missing ?? 0)} icon={AlertTriangle} hint="Required document not yet verified" />
        <StatTile label="Expiring within 30 days" value={num(counts?.expiringSoon ?? 0)} icon={FileWarning} />
      </StatGrid>

      {!liveApi() ? (
        <div className="card p-4 text-[13px] text-ink-3">
          Connect the live API (VITE_API_URL) to use the 201-file document vault.
        </div>
      ) : rows === null ? (
        <div className="card p-4 text-[13px] text-ink-3">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card flex items-center gap-2 p-4 text-[13px] text-good">
          <CheckCircle2 className="size-4" />
          Every tracked employee has their required documents verified.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Employee</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Completion</th>
                <th className="px-4 py-2.5 font-medium">Missing</th>
                <th className="px-4 py-2.5 font-medium">Expiring soon</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpenEmployee(row.id)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{row.name}</div>
                    <div className="text-[11px] text-ink-3">{row.employeeNo}</div>
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{row.department ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            completionTone(row.percent) === 'good' ? 'bg-good' : completionTone(row.percent) === 'warning' ? 'bg-warning' : 'bg-critical',
                          )}
                          style={{ width: `${row.percent}%` }}
                        />
                      </div>
                      <span className="text-[12px] text-ink-2">{row.percent}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {row.missing > 0 ? <Badge tone="critical">{row.missing}</Badge> : <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.expiringSoon > 0 ? <Badge tone="warning">{row.expiringSoon}</Badge> : <span className="text-ink-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openEmployee !== null && (
        <ChecklistModal
          employeeId={openEmployee}
          onClose={() => {
            setOpenEmployee(null)
            load()
          }}
        />
      )}
    </div>
  )
}

export function DocumentsChecklist() {
  return (
    <div>
      <PageHeader
        title="201 Files & Documents"
        description="The paperwork every 201 file is supposed to contain — checklist, upload and verification, so completeness is a number rather than a walk to the cabinet."
      />

      <TabbedArea
        storageKey="documents"
        tabs={[
          { id: 'checklist', label: 'Checklist', hint: 'Who is missing what, and what is about to expire.', render: () => <DocumentsList /> },
          { id: 'certificates', label: 'Certificates', hint: "Self-service Certificate of Employment requests waiting on HR.", render: () => <PendingCoeRequests /> },
        ]}
      />
    </div>
  )
}
