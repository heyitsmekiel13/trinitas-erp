import * as React from 'react'
import { Ban, Banknote, CheckCircle2, ExternalLink, Fuel, Pencil, Printer, Route, Trash2, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { invalidateResource, useResource } from '@/lib/api'
import {
  cancelFuelRequest,
  decideFuelRequest,
  deleteFuelRequest,
  liveApi,
  recordFuelInvoice,
  reimburseFuelRequest,
  type FuelRequestRecord,
} from '@/lib/adminApi'
import { fmtDateTime, money, num } from '@/lib/format'
import { printRegion } from '@/lib/export'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, Field, Input, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { RouteMap } from '@/components/data/RouteMap'
import { FuelRequestSheet } from './FuelRequestSheet'

/**
 * The approval queue for trip tickets.
 *
 * Who may decide is settled on the server — a supervisor, a manager or an
 * administrator — and this screen only mirrors that so a button is never
 * offered for something the API will refuse. Mirroring it is not enforcing it:
 * a rule that lives only in the browser is a suggestion.
 */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'good' | 'warning' | 'critical'> = {
  Draft: 'neutral',
  Submitted: 'info',
  Approved: 'good',
  Rejected: 'critical',
  Issued: 'good',
  Cancelled: 'neutral',
}

/**
 * Whether the signed-in account can decide.
 *
 * Asked of the server rather than guessed from the role name: who may
 * approve is now a named list the superadmin maintains (Admin → Fuel
 * Approvers), not a pattern match against a role's code, so the browser has
 * no way to derive it locally any more. This only decides whether to offer
 * the buttons at all — `decide()` on the server is the actual check.
 */
function useCanApprove() {
  const { data } = useResource<{ canApprove: boolean }>('maintenance/fuel-requests/can-approve', () => ({
    canApprove: false,
  }))
  return data?.canApprove ?? false
}

/**
 * Which actions a request is still open to.
 *
 * Mirrors the server so a button is never offered for something the API will
 * refuse. The reasoning lives in FuelRequestController: an approved request is
 * a commitment somebody signed, and an issued one is attached to an invoice —
 * so the first can be cancelled but not deleted, and the second neither.
 */
const canEdit = (status: string) => status === 'Draft' || status === 'Submitted'
const canCancel = (status: string) => status !== 'Issued' && status !== 'Cancelled'
const canDelete = (status: string) => status !== 'Approved' && status !== 'Issued'

/**
 * The bridge from a personally-owned vehicle's decided trip to a
 * reimbursement claim — the company doesn't dispense fuel for a car it
 * doesn't own, so this is where that trip's payout actually gets raised.
 * The server refuses a second claim on the same request, which reads here as
 * "already claimed" rather than an error.
 */
function ReimburseAction({ request }: { request: FuelRequestRecord }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [claimed, setClaimed] = React.useState(false)

  if (claimed) {
    return (
      <Badge tone="good" dot>
        Reimbursement claimed
      </Badge>
    )
  }

  const submit = async () => {
    setBusy(true)
    try {
      const claim = await reimburseFuelRequest(request.id)
      setClaimed(true)
      toast({
        tone: 'success',
        title: `${claim.claimNo} raised`,
        description: `${money(claim.amount, { decimals: false })} for ${claim.employee ?? 'the vehicle owner'} — find it under Finance → Reimbursement Claims.`,
      })
    } catch (err) {
      const message = (err as Error).message
      if (message.includes('already has a reimbursement claim')) setClaimed(true)
      toast({ tone: 'error', title: 'Could not raise the claim', description: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="xs" loading={busy} onClick={() => void submit()}>
      <Banknote className="size-3" />
      Request reimbursement
    </Button>
  )
}

/* -------------------------------------------------------------------------- */

function DecisionDialog({
  request,
  onClose,
  onDone,
}: {
  request: FuelRequestRecord | null
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [litres, setLitres] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!request) return
    setLitres(String(request.suggestedLitres))
    setNote('')
  }, [request])

  if (!request) return null

  const decide = async (decision: 'Approved' | 'Rejected') => {
    setBusy(true)
    try {
      const result = await decideFuelRequest(request.id, {
        decision,
        approvedLitres: decision === 'Approved' ? Number(litres) || request.suggestedLitres : null,
        note: note.trim() || undefined,
      })

      const sent = result.emailed.recipients.filter((r) => r.sent).length
      const failed = result.emailed.recipients.filter((r) => !r.sent).length

      toast({
        tone: failed || result.emailed.missing.length ? 'warning' : 'success',
        title: `${request.reference} ${decision.toLowerCase()}`,
        // The delivery outcome is reported honestly. "Approved" while the email
        // silently failed is how a driver ends up at the pump with nothing.
        description:
          sent > 0
            ? `Emailed ${sent} recipient${sent === 1 ? '' : 's'}.${
                failed ? ` ${failed} could not be sent — check Admin → Email.` : ''
              }${result.emailed.missing.length ? ` No address on file for ${result.emailed.missing.join(' or ')}.` : ''}`
            : result.emailed.missing.length
              ? `Nobody was emailed — no address on file for ${result.emailed.missing.join(' or ')}.`
              : 'Nobody was emailed. Check that SMTP is switched on in Admin → Email.',
      })

      onDone()
      onClose()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not record the decision', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const trimmed = Number(litres) + 0.01 < request.suggestedLitres

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Decide ${request.reference}`}
      description={`${request.purpose} · ${request.vehicle ?? 'no vehicle'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void decide('Rejected')} disabled={busy}>
            <XCircle className="size-4" />
            Reject
          </Button>
          <Button variant="primary" onClick={() => void decide('Approved')} disabled={busy}>
            <CheckCircle2 className="size-4" />
            Approve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2 p-3 sm:grid-cols-4">
          {[
            ['Distance', `${num(request.distanceKm, 1)} km`],
            ['Travel time', `${Math.floor(request.durationMinutes / 60)}h ${request.durationMinutes % 60}m`],
            ['Asked for', `${num(request.suggestedLitres, 2)} L`],
            ['Est. cost', money(request.estimatedCost, { decimals: false })],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
              <p className="tabular text-[15px] font-semibold text-ink">{value}</p>
            </div>
          ))}
        </div>

        <RouteMap
          origin={{ lat: request.originLat, lng: request.originLng }}
          destination={{ lat: request.destinationLat, lng: request.destinationLng }}
          height={220}
        />

        <Field label="Litres to authorise" hint="Approve less than asked for where the trip does not justify it.">
          <Input type="number" min={0} step={0.5} value={litres} onChange={(e) => setLitres(e.target.value)} />
        </Field>

        {trimmed && (
          <p className="rounded-lg bg-warning/10 p-2.5 text-[12px] text-warning">
            The driver will be emailed the trimmed figure and told to plan on it, not on the {num(request.suggestedLitres, 2)} L
            requested.
          </p>
        )}

        <Field label="Note" hint="Goes into the email and onto the printed form.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-16" />
        </Field>
      </div>
    </Modal>
  )
}

/**
 * The charge sales invoice, written on after the station bills it.
 *
 * The one field on the form filled in after the trip rather than before. It is
 * open to anybody who can see the request, not just approvers — a custodian
 * copying a number off an invoice is doing data entry, not making a decision,
 * and putting it behind the approval gate is how it ends up on a sticky note
 * instead.
 */
function InvoiceCapture({ request, onSaved }: { request: FuelRequestRecord; onSaved: () => void }) {
  const toast = useToast()
  const [value, setValue] = React.useState(request.chargeInvoiceNo ?? '')
  const [busy, setBusy] = React.useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await recordFuelInvoice(request.id, value.trim())
      toast({
        tone: 'success',
        title: value.trim() ? `Invoice ${value.trim()} recorded` : 'Invoice number cleared',
        description: value.trim() ? `${request.reference} is now marked issued.` : undefined,
      })
      onSaved()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save it', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">To custodian</p>
      <p className="mb-2 text-[11px] text-ink-3">
        Indicate the Charge Sales Invoice number once the station has billed it.
      </p>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Charge sales invoice no."
          className="h-9"
        />
        <Button variant="secondary" size="sm" onClick={() => void save()} disabled={busy}>
          Save
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function FuelRequests() {
  const canApprove = useCanApprove()
  const sheetRef = React.useRef<HTMLDivElement>(null)

  const { data: requests = [], isLoading } = useResource<FuelRequestRecord[]>(
    'maintenance/fuel-requests',
    () => [],
  )

  const toast = useToast()
  const [deciding, setDeciding] = React.useState<FuelRequestRecord | null>(null)
  const [viewing, setViewing] = React.useState<FuelRequestRecord | null>(null)
  const [confirming, setConfirming] = React.useState<{ row: FuelRequestRecord; act: 'cancel' | 'delete' } | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const refresh = () => invalidateResource('maintenance/fuel-requests')

  const runConfirmed = async () => {
    if (!confirming) return
    const { row, act } = confirming
    setBusy(true)
    try {
      if (act === 'cancel') {
        await cancelFuelRequest(row.id, reason.trim() || undefined)
        toast({ tone: 'success', title: `${row.reference} cancelled`, description: 'The record stays on file.' })
      } else {
        await deleteFuelRequest(row.id)
        toast({ tone: 'success', title: `${row.reference} deleted` })
      }
      setConfirming(null)
      setReason('')
      refresh()
    } catch (err) {
      // The server's refusal names what is in the way — show it verbatim.
      toast({ tone: 'error', title: 'Could not do that', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const waiting = requests.filter((r) => r.status === 'Submitted')

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Trip requests" description="Fuel authorised against a measured route." />
        <Card>
          <EmptyState
            icon={Fuel}
            title="Trip requests need the live API"
            description="The route, the distance and the suggested litres are worked out on the server."
          />
        </Card>
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="Trip requests"
        description="Fuel asked for against a measured route, and the supervisor, manager or administrator who signed it off."
        meta={
          <>
            <Badge tone="neutral">{num(requests.length)} on file</Badge>
            {waiting.length > 0 && (
              <Badge tone="info" dot>
                {num(waiting.length)} waiting on a decision
              </Badge>
            )}
            {!canApprove && <Badge tone="warning">You cannot approve these</Badge>}
          </>
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.open('/fuel-request', '_blank', 'noopener')}
          >
            <ExternalLink className="size-3.5" />
            New request
          </Button>
        }
      />

      <StatGrid className="mb-4">
        <StatTile label="Waiting" value={num(waiting.length)} icon={Route} hint="Submitted, not yet decided" />
        <StatTile
          label="Approved this list"
          value={num(requests.filter((r) => r.status === 'Approved' || r.status === 'Issued').length)}
          icon={CheckCircle2}
        />
        <StatTile
          label="Litres authorised"
          value={num(
            requests.reduce((s, r) => s + (r.approvedLitres ?? 0), 0),
            1,
          )}
          icon={Fuel}
          hint="Across every approved request"
        />
        <StatTile
          label="Distance planned"
          value={`${num(requests.reduce((s, r) => s + r.distanceKm, 0), 0)} km`}
          icon={Route}
        />
      </StatGrid>

      {requests.length === 0 && !isLoading ? (
        <Card>
          <EmptyState
            icon={Fuel}
            title="No trip requests yet"
            description="A request pins the route on a map and works out the litres from the vehicle's own economy — so the amount can actually be checked before it is issued."
            action={
              <Button variant="primary" size="sm" onClick={() => window.open('/fuel-request', '_blank', 'noopener')}>
                <ExternalLink className="size-3.5" />
                Raise one
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={r.id} className="p-3">
              <button type="button" onClick={() => setViewing(r)} className="w-full text-left">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-mono text-[13px] font-semibold text-ink">{r.reference}</span>
                  <Badge tone={STATUS_TONE[r.status] ?? 'neutral'} dot>
                    {r.status}
                  </Badge>
                  {r.routeSource === 'straight-line' && <Badge tone="warning">Estimated distance</Badge>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{r.purpose}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {r.originLabel} → {r.destinationLabel} · {num(r.distanceKm, 0)} km ·{' '}
                      {r.vehicle ?? 'no vehicle'}
                      {r.driver ? ` · ${r.driver}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tabular block text-[13px] font-semibold text-ink">
                      {num(r.approvedLitres ?? r.suggestedLitres, 1)} L
                    </span>
                    <span className="block text-[10px] text-ink-3">
                      {r.approvedLitres !== null ? 'authorised' : 'requested'}
                    </span>
                  </span>
                </div>
              </button>

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                {r.approvedBy ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
                    <CheckCircle2 className={cn('size-3.5', r.status === 'Rejected' ? 'text-critical' : 'text-good')} />
                    {r.status === 'Rejected' ? 'Declined' : 'Approved'} by{' '}
                    <strong className="text-ink">{r.approvedBy}</strong>
                    {r.approvedByRole && <span className="text-ink-3">({r.approvedByRole})</span>}
                    {r.decidedAt && <span className="text-ink-3">· {fmtDateTime(r.decidedAt)}</span>}
                  </span>
                ) : (
                  <span className="flex-1 text-[11px] text-ink-3">Waiting on a supervisor, manager or administrator.</span>
                )}

                {r.chargeInvoiceNo && (
                  <span className="text-[11px] text-ink-3">
                    Invoice <strong className="text-ink-2">{r.chargeInvoiceNo}</strong>
                  </span>
                )}

                <span className="ml-auto flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => setViewing(r)}>
                    <Printer className="size-3" />
                    Form
                  </Button>
                  {canEdit(r.status) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => window.open(`/fuel-request?edit=${r.id}`, '_blank', 'noopener')}
                    >
                      <Pencil className="size-3" />
                      Edit
                    </Button>
                  )}
                  {canCancel(r.status) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setReason('')
                        setConfirming({ row: r, act: 'cancel' })
                      }}
                    >
                      <Ban className="size-3" />
                      Cancel
                    </Button>
                  )}
                  {canDelete(r.status) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={`Delete ${r.reference}`}
                      onClick={() => setConfirming({ row: r, act: 'delete' })}
                    >
                      <Trash2 className="size-3 text-critical" />
                    </Button>
                  )}
                  {r.status === 'Submitted' && canApprove && (
                    <Button variant="primary" size="xs" onClick={() => setDeciding(r)}>
                      Decide
                    </Button>
                  )}
                  {r.vehicleOwnership === 'PO' && (r.status === 'Approved' || r.status === 'Issued') && (
                    <ReimburseAction request={r} />
                  )}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <DecisionDialog request={deciding} onClose={() => setDeciding(null)} onDone={refresh} />

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        size="sm"
        title={
          confirming
            ? `${confirming.act === 'cancel' ? 'Cancel' : 'Delete'} ${confirming.row.reference}?`
            : ''
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void runConfirmed()} disabled={busy}>
              {confirming?.act === 'cancel' ? 'Cancel the request' : 'Delete it'}
            </Button>
          </>
        }
      >
        {confirming && (
          <div className="space-y-3 text-[13px] text-ink-2">
            <p>
              {confirming.row.purpose} · {confirming.row.vehicle ?? 'no vehicle'}
            </p>
            {confirming.act === 'cancel' ? (
              <>
                <p>
                  The authorisation is voided and the record stays on file, which is what anybody reconciling the
                  fuel bill later needs.
                </p>
                <Field label="Reason" hint="Goes onto the form beside the decision.">
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Trip called off" />
                </Field>
              </>
            ) : (
              <p>
                Nothing has been authorised against it, so there is nothing to lose. Once a request is approved it can
                only be cancelled, not deleted.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="2xl"
        title={viewing ? `Trip ticket ${viewing.reference}` : ''}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                printRegion(sheetRef.current, { title: `Trip ticket ${viewing?.reference ?? ''}`, bare: true })
              }
            >
              <Printer className="size-4" />
              Print the form
            </Button>
            {viewing?.status === 'Submitted' && canApprove && (
              <Button
                variant="primary"
                onClick={() => {
                  setDeciding(viewing)
                  setViewing(null)
                }}
              >
                Decide
              </Button>
            )}
            <Button variant="ghost" onClick={() => setViewing(null)}>
              Close
            </Button>
          </>
        }
      >
        {viewing && (
          <div className="space-y-3">
            {(viewing.status === 'Approved' || viewing.status === 'Issued') && (
              <div data-print="hide">
                <InvoiceCapture request={viewing} onSaved={() => {
                  refresh()
                  setViewing(null)
                }} />
              </div>
            )}
            <div ref={sheetRef}>
              <FuelRequestSheet request={viewing} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
