import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Inbox,
  LifeBuoy,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDateTime, fmtRelative, initials, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, Card, Input, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, ErrorState, useToast } from '@/components/ui/feedback'
import { Modal } from '@/components/ui/overlay'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { liveApi } from '@/lib/adminApi'
import {
  closeTicket,
  getTicket,
  getTickets,
  raiseTicket,
  reopenTicket,
  replyToTicket,
  resolveTicket,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  updateTicket,
  uploadTicketFiles,
  type TicketCard,
  type TicketDetail,
  type TicketFile,
  type TicketList,
} from '@/lib/supportApi'

/**
 * Support tickets, from both sides of the desk.
 *
 * One screen, not two. An employee opening it sees their own tickets and a
 * button to raise another; an administrator opening the same route sees every
 * ticket in the company plus the controls to work them. The API decides which,
 * and sends `isAdmin` back with the list — so there is one implementation of
 * the thread, the reply box and the attachment gallery rather than two that
 * slowly stop matching.
 *
 * The one thing the two sides genuinely do not share is an internal note. An
 * administrator can write one; it never reaches the person who raised the
 * ticket, and the API strips it rather than the client hiding it.
 */

/* -------------------------------------------------------------------------- */
/* Presentation                                                                */
/* -------------------------------------------------------------------------- */

const STATUS_TONE: Record<string, 'neutral' | 'brand' | 'warning' | 'good' | 'critical'> = {
  Open: 'critical',
  'In progress': 'brand',
  'Waiting on you': 'warning',
  Resolved: 'good',
  Closed: 'neutral',
}

const PRIORITY_TONE: Record<string, 'neutral' | 'warning' | 'critical'> = {
  Low: 'neutral',
  Normal: 'neutral',
  High: 'warning',
  Urgent: 'critical',
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function Person({ name }: { name: string | null | undefined }) {
  if (!name) {
    return <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-3 text-[10px] text-ink-3">?</span>
  }

  return (
    <span
      className="grad-brand inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-black/5"
      title={name}
    >
      {initials(name)}
    </span>
  )
}

/** Images shown, documents listed — a screenshot is the commonest attachment. */
function Attachments({ files, onOpen }: { files: TicketFile[]; onOpen: (f: TicketFile) => void }) {
  if (files.length === 0) return null

  const images = files.filter((f) => f.isImage)
  const documents = files.filter((f) => !f.isImage)

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => onOpen(file)}
              className="overflow-hidden rounded-lg border border-line transition-transform hover:scale-[1.02]"
            >
              <img
                src={file.url}
                alt={file.name}
                loading="lazy"
                width={file.width ?? undefined}
                height={file.height ?? undefined}
                className="h-24 w-32 object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {documents.map((file) => (
        <a
          key={file.id}
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 transition-colors hover:border-line-strong"
        >
          <FileText className="size-3.5 shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{file.name}</span>
          <span className="text-[10px] text-ink-3">{fileSize(file.size)}</span>
          <Download className="size-3.5 shrink-0 text-ink-3" />
        </a>
      ))}
    </div>
  )
}

function Lightbox({ file, onClose }: { file: TicketFile; onClose: () => void }) {
  React.useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', escape)

    return () => document.removeEventListener('keydown', escape)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6" onClick={onClose}>
      <img src={file.url} alt={file.name} className="max-h-full max-w-full rounded-lg object-contain" />
      <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 rounded-lg bg-white/10 p-2 text-white">
        <X className="size-5" />
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Raise                                                                       */
/* -------------------------------------------------------------------------- */

function RaiseTicket({ open, onClose, onRaised }: { open: boolean; onClose: () => void; onRaised: () => void }) {
  const toast = useToast()
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [category, setCategory] = React.useState<string>('Other')
  const [priority, setPriority] = React.useState<string>('Normal')
  const [files, setFiles] = React.useState<File[]>([])
  const [saving, setSaving] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  React.useEffect(() => {
    if (!open) return

    setSubject('')
    setBody('')
    setCategory('Other')
    setPriority('Normal')
    setFiles([])
  }, [open])

  const submit = async () => {
    setSaving(true)
    try {
      const ticket = await raiseTicket({ subject: subject.trim(), body: body.trim(), category, priority })

      if (files.length > 0) await uploadTicketFiles(ticket.id, files)

      toast({
        tone: 'success',
        title: `Ticket ${ticket.reference} raised`,
        description: 'The administrator has been emailed. You will get a reply on this ticket.',
      })
      onRaised()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not raise the ticket', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a ticket"
      description="Describe the problem. It goes to the system administrator with your name on it."
      size="lg"
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">What is it about? *</span>
          <Input
            autoFocus
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="One line — for example, &ldquo;Cannot clock in on the tablet&rdquo;"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">Category</span>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-2">How urgent?</span>
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
            <span className="mt-1 block text-[11px] text-ink-3">
              Urgent means you cannot do your job until it is fixed.
            </span>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-2">What happened? *</span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="What you were doing, what you expected, and what happened instead. Include the exact wording of any message you saw."
          />
        </label>

        {/* A screenshot answers most of the follow-up questions before they
            are asked, so attaching one is put in front of people rather than
            hidden behind a paperclip. */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            setFiles((c) => [...c, ...Array.from(e.dataTransfer.files)])
          }}
          className={cn(
            'rounded-xl border border-dashed p-3 transition-colors',
            dragging ? 'border-brand-400 bg-brand-50/40' : 'border-line',
          )}
        >
          <label className="flex cursor-pointer items-center justify-center gap-2 text-[12px] text-ink-3">
            <Upload className="size-3.5" />
            Drop a screenshot here, or browse
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setFiles((c) => [...c, ...Array.from(e.target.files ?? [])])}
            />
          </label>

          {files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((file, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-2">
                  <Paperclip className="size-3" />
                  <span className="max-w-[10rem] truncate">{file.name}</span>
                  <button type="button" onClick={() => setFiles((c) => c.filter((_, x) => x !== i))} aria-label="Remove">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || !subject.trim() || !body.trim()}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Raise the ticket
        </Button>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* The thread                                                                  */
/* -------------------------------------------------------------------------- */

function TicketThread({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: number | null
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [ticket, setTicket] = React.useState<TicketDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [internal, setInternal] = React.useState(false)
  const [files, setFiles] = React.useState<File[]>([])
  const [sending, setSending] = React.useState(false)
  const [lightbox, setLightbox] = React.useState<TicketFile | null>(null)
  const [resolving, setResolving] = React.useState(false)
  const [resolution, setResolution] = React.useState('')

  const load = React.useCallback(async () => {
    if (!ticketId) return

    setLoading(true)
    try {
      const detail = await getTicket(ticketId)
      setTicket(detail)
      setResolution(detail.resolution ?? '')
    } catch (e) {
      toast({ tone: 'error', title: 'Could not open the ticket', description: (e as Error).message })
      onClose()
    } finally {
      setLoading(false)
    }
  }, [ticketId, toast, onClose])

  React.useEffect(() => {
    setReply('')
    setInternal(false)
    setFiles([])
    void load()
  }, [load])

  if (!ticketId) return null

  const send = async () => {
    if (!ticket || (!reply.trim() && files.length === 0)) return

    setSending(true)
    try {
      const message = await replyToTicket(ticket.id, reply.trim() || '(attachment)', internal)
      if (files.length > 0) await uploadTicketFiles(ticket.id, files, message.id)

      setReply('')
      setFiles([])
      setInternal(false)
      await load()
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not send', description: (e as Error).message })
    } finally {
      setSending(false)
    }
  }

  const setField = async (patch: Record<string, unknown>) => {
    if (!ticket) return

    try {
      await updateTicket(ticket.id, patch)
      await load()
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update', description: (e as Error).message })
    }
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={ticket?.subject ?? 'Ticket'}
        description={ticket ? `${ticket.reference} · raised ${ticket.createdAt ? fmtRelative(ticket.createdAt) : ''}` : undefined}
        size="xl"
        headerAside={
          ticket && (
            <span className="flex items-center gap-1.5">
              <Badge tone={STATUS_TONE[ticket.status] ?? 'neutral'}>{ticket.status}</Badge>
              <Badge tone={PRIORITY_TONE[ticket.priority] ?? 'neutral'}>{ticket.priority}</Badge>
            </span>
          )
        }
      >
        {loading && !ticket && (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-ink-3" />
          </div>
        )}

        {ticket && (
          <div className="space-y-4">
            {/* Administrator controls. Absent entirely for the raiser rather
                than disabled — a greyed-out control invites a support ticket
                about the support ticket. */}
            {ticket.canAdminister && (
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Status</span>
                  <Select
                    value={ticket.status}
                    onChange={(e) => void setField({ status: e.target.value })}
                    className="h-8 w-40 text-[12px]"
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[10px] tracking-wide text-ink-3 uppercase">Priority</span>
                  <Select
                    value={ticket.priority}
                    onChange={(e) => void setField({ priority: e.target.value })}
                    className="h-8 w-32 text-[12px]"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </label>

                <div className="ml-auto text-right">
                  <p className="text-[10px] tracking-wide text-ink-3 uppercase">Raised by</p>
                  <p className="text-[12px] font-medium text-ink">{ticket.raisedBy}</p>
                  <p className="text-[10px] text-ink-3">
                    {[ticket.raiserEmployeeNo, ticket.raiserDepartment].filter(Boolean).join(' · ')}
                  </p>
                  {(ticket.raiserEmail || ticket.raiserMobile) && (
                    <p className="text-[10px] text-ink-3">{[ticket.raiserEmail, ticket.raiserMobile].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              </div>
            )}

            {/* The original request, always first and visually distinct from
                the replies that follow it. */}
            <article className="rounded-xl border border-line p-3">
              <header className="mb-1.5 flex items-center gap-2">
                <Person name={ticket.raisedBy} />
                <span className="text-[13px] font-medium text-ink">{ticket.raisedBy}</span>
                <span className="text-[10px] text-ink-3">{ticket.createdAt ? fmtDateTime(ticket.createdAt) : ''}</span>
                <Badge tone="neutral">{ticket.category}</Badge>
              </header>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{ticket.body}</p>
              <Attachments files={ticket.attachments} onOpen={setLightbox} />
            </article>

            {ticket.messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  'rounded-xl border p-3',
                  message.internal
                    ? 'border-dashed border-warning bg-[color-mix(in_srgb,var(--color-warning)_7%,transparent)]'
                    : message.fromStaff
                      ? 'border-line bg-surface-2'
                      : 'border-line',
                )}
              >
                <header className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Person name={message.author} />
                  <span className="text-[13px] font-medium text-ink">{message.author ?? 'Somebody'}</span>
                  <span className="text-[10px] text-ink-3">{message.createdAt ? fmtDateTime(message.createdAt) : ''}</span>
                  {message.internal && (
                    <Badge tone="warning">
                      <Lock className="size-3" />
                      Internal note — not visible to {ticket.raisedBy}
                    </Badge>
                  )}
                </header>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{message.body}</p>
                <Attachments files={message.attachments} onOpen={setLightbox} />
              </article>
            ))}

            {ticket.resolvedAt && (
              <div className="flex items-start gap-2.5 rounded-xl border border-good/40 bg-[color-mix(in_srgb,var(--color-good)_8%,transparent)] p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    Resolved by {ticket.resolvedBy} · {fmtDateTime(ticket.resolvedAt)}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    If this is not sorted, reopen the ticket and say what is still wrong.
                  </p>
                </div>
              </div>
            )}

            {/* Reply box */}
            {ticket.status !== 'Closed' && (
              <div className="rounded-xl border border-line p-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onPaste={(e) => {
                    const pasted = Array.from(e.clipboardData.files)
                    if (pasted.length > 0) {
                      e.preventDefault()
                      setFiles((c) => [...c, ...pasted])
                    }
                  }}
                  rows={3}
                  placeholder={ticket.canAdminister ? 'Reply to the person who raised this…' : 'Add anything else that might help…'}
                  className="resize-none border-0 bg-transparent text-[13px] focus:ring-0"
                />

                {files.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1.5 px-1.5">
                    {files.map((file, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 rounded-md bg-surface-3 px-2 py-1 text-[11px] text-ink-2">
                        <Paperclip className="size-3" />
                        <span className="max-w-[10rem] truncate">{file.name}</span>
                        <button type="button" onClick={() => setFiles((c) => c.filter((_, x) => x !== i))} aria-label="Remove">
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 px-1.5">
                  {ticket.canAdminister && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={internal}
                        onChange={(e) => setInternal(e.target.checked)}
                        className="accent-[var(--color-warning)]"
                      />
                      <Lock className="size-3" />
                      Internal note — {ticket.raisedBy} will not see it
                    </label>
                  )}

                  <label className="ml-auto cursor-pointer rounded-md p-1.5 text-ink-3 hover:bg-surface-3 hover:text-ink" title="Attach">
                    <Paperclip className="size-3.5" />
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => setFiles((c) => [...c, ...Array.from(e.target.files ?? [])])}
                    />
                  </label>

                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void send()}
                    disabled={sending || (!reply.trim() && files.length === 0)}
                  >
                    {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    {internal ? 'Save note' : 'Send reply'}
                  </Button>
                </div>
              </div>
            )}

            {/* Closing actions, different on each side of the desk. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="text-[11px] text-ink-3">
                {ticket.isOpen ? `Waiting ${ticket.idleHours}h since the last message` : `Closed ${ticket.closedAt ? fmtRelative(ticket.closedAt) : ''}`}
              </span>

              <div className="ml-auto flex gap-2">
                {!ticket.isOpen && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await reopenTicket(ticket.id)
                      await load()
                      onChanged()
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                    Reopen
                  </Button>
                )}

                {ticket.canAdminister && ticket.isOpen && (
                  <Button size="sm" variant="primary" onClick={() => setResolving(true)}>
                    <CheckCircle2 className="size-3.5" />
                    Mark resolved
                  </Button>
                )}

                {!ticket.canAdminister && ticket.status === 'Resolved' && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      await closeTicket(ticket.id)
                      await load()
                      onChanged()
                      toast({ tone: 'success', title: 'Ticket closed', description: 'Thanks — that tells us it is sorted.' })
                    }}
                  >
                    <CheckCircle2 className="size-3.5" />
                    That is sorted, close it
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Resolving asks what was done, because "Resolved" with no explanation
          is the reason people reopen tickets to ask what happened. */}
      {resolving && ticket && (
        <Modal open onClose={() => setResolving(false)} title="What did you do?" size="md">
          <Textarea
            autoFocus
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            rows={4}
            placeholder="What was wrong and what you changed. This is sent to the person who raised it."
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResolving(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!resolution.trim()}
              onClick={async () => {
                await resolveTicket(ticket.id, resolution.trim())
                setResolving(false)
                await load()
                onChanged()
                toast({ tone: 'success', title: 'Resolved', description: `${ticket.raisedBy} has been emailed.` })
              }}
            >
              Mark resolved
            </Button>
          </div>
        </Modal>
      )}

      {lightbox && <Lightbox file={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

export function SupportDesk() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = React.useState<TicketList | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<unknown>(null)
  const [raising, setRaising] = React.useState(false)
  const [filter, setFilter] = React.useState<string>('')

  const openTicket = params.get('ticket') ? Number(params.get('ticket')) : null

  const setOpenTicket = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('ticket', String(id))
    else next.delete('ticket')
    setParams(next, { replace: true })
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await getTickets(filter ? { status: filter } : {}))
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [filter])

  React.useEffect(() => {
    if (!liveApi()) {
      setLoading(false)

      return
    }

    void load()
  }, [load])

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Support" description="Raise a concern and track what happens to it." />
        <Card>
          <EmptyState icon={LifeBuoy} title="Support needs the live API" />
        </Card>
      </>
    )
  }

  const admin = data?.isAdmin ?? false
  const counts = data?.counts

  return (
    <>
      <PageHeader
        title={admin ? 'Support Desk' : 'Support'}
        description={
          admin
            ? 'Every ticket raised in the company, worst and quietest first. Resolving one emails the person who raised it.'
            : 'Raise a concern and track what happens to it. Everything you raise here is under your own name.'
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="primary" size="sm" onClick={() => setRaising(true)}>
              <Plus className="size-3.5" />
              Raise a ticket
            </Button>
          </>
        }
      />

      {counts && (
        <StatGrid className="mb-4">
          <StatTile
            label={admin ? 'Open' : 'Your open tickets'}
            value={num(counts.open + counts.inProgress + counts.waiting)}
            icon={Inbox}
            hint={`${num(counts.open)} not yet picked up`}
          />
          <StatTile
            label="Waiting on a reply"
            value={num(counts.waiting)}
            icon={Clock}
            hint={admin ? 'Blocked on the person who raised it' : 'They asked you something'}
          />
          <StatTile
            label="Urgent"
            value={num(counts.urgent)}
            icon={AlertTriangle}
            inverse
            hint={counts.urgent === 0 ? 'Nothing critical' : 'Somebody cannot work'}
          />
          <StatTile
            label="Gone quiet"
            value={num(counts.stale)}
            icon={AlertTriangle}
            inverse
            hint="Open, with nothing said for 48 hours"
          />
        </StatGrid>
      )}

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3" data-print="hide">
        <button
          type="button"
          onClick={() => setFilter('')}
          className={cn(
            'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
            filter === ''
              ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
              : 'border-line text-ink-2 hover:border-line-strong',
          )}
        >
          Everything
        </button>
        {TICKET_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors',
              filter === status
                ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'border-line text-ink-2 hover:border-line-strong',
            )}
          >
            {status}
          </button>
        ))}
      </div>

      {error && <ErrorState error={error} onRetry={() => void load()} />}

      {loading && !data && (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      )}

      {data && data.tickets.length === 0 && (
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title={filter ? `Nothing ${filter.toLowerCase()}` : admin ? 'No tickets raised' : 'You have not raised anything'}
            description={
              admin
                ? 'When somebody raises a concern it appears here, and you get an email.'
                : 'If something is not working or you need a record corrected, raise a ticket and it goes straight to the administrator.'
            }
            action={
              !filter && (
                <Button variant="primary" onClick={() => setRaising(true)}>
                  <Plus className="size-3.5" />
                  Raise a ticket
                </Button>
              )
            }
          />
        </Card>
      )}

      {data && data.tickets.length > 0 && (
        <Card className="divide-y divide-line p-0">
          {data.tickets.map((ticket: TicketCard) => (
            <button
              key={ticket.id}
              type="button"
              onClick={() => setOpenTicket(ticket.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <span className="w-1 shrink-0 self-stretch rounded-full" style={{
                background:
                  ticket.priority === 'Urgent'
                    ? 'var(--color-critical)'
                    : ticket.priority === 'High'
                      ? 'var(--color-warning)'
                      : 'transparent',
              }} />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[10px] text-ink-3">{ticket.reference}</span>
                  <span className="truncate text-[13px] font-medium text-ink">{ticket.subject}</span>
                  {ticket.isStale && (
                    <Badge tone="warning">
                      <Clock className="size-3" />
                      {ticket.idleHours}h quiet
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
                  <span>{ticket.category}</span>
                  {admin && ticket.raisedBy && <span>· {ticket.raisedBy}</span>}
                  {ticket.messageCount > 0 && <span>· {ticket.messageCount} repl{ticket.messageCount === 1 ? 'y' : 'ies'}</span>}
                  {ticket.attachmentCount > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      · <Paperclip className="size-3" />
                      {ticket.attachmentCount}
                    </span>
                  )}
                  {ticket.lastActivityAt && <span>· {fmtRelative(ticket.lastActivityAt)}</span>}
                </span>
              </span>

              <Badge tone={PRIORITY_TONE[ticket.priority] ?? 'neutral'}>{ticket.priority}</Badge>
              <Badge tone={STATUS_TONE[ticket.status] ?? 'neutral'}>{ticket.status}</Badge>
              {admin && <Person name={ticket.raisedBy} />}
            </button>
          ))}
        </Card>
      )}

      <RaiseTicket open={raising} onClose={() => setRaising(false)} onRaised={() => void load()} />
      <TicketThread ticketId={openTicket} onClose={() => setOpenTicket(null)} onChanged={() => void load()} />
    </>
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  tickets: SupportDesk,
}
