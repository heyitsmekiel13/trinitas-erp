import * as React from 'react'
import { CheckCircle2, FileText, Mail, Send, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  openOfferDocument, previewOffer, recordOfferResponse, sendOffer,
  type ApplicantDetail, type OfferPreview,
} from '@/lib/adminApi'
import { fmtDate, money } from '@/lib/format'
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Making an offer, and hearing back about it.
 *
 * The offer was the one step of recruitment that happened entirely outside
 * this system: a recruiter moved a card to Offer, opened their mail client and
 * typed the terms from memory. So the figure that was actually put in writing
 * lived in a sent-items folder, the answer came back as "he said yes on the
 * phone", and at hire the salary was keyed again from whatever anybody
 * remembered.
 *
 * Two decisions worth naming.
 *
 * Sending is not automatic on reaching the Offer stage. This is the most
 * consequential email the system sends, the terms are normally settled in a
 * conversation first, and firing one on a stage change would email somebody
 * the wrong salary at least once. It is a deliberate act with a preview in
 * front of it.
 *
 * The preview is built by the same server code that builds the email — asked
 * for on every keystroke pause rather than assembled here — because a preview
 * composed separately from the message is a preview that eventually lies.
 */

const today = () => new Date().toISOString().slice(0, 10)

const plusDays = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function OfferPanel({
  applicant,
  onChanged,
  composing,
  onCompose,
}: {
  applicant: ApplicantDetail
  onChanged: (next: ApplicantDetail) => void
  /* Lifted, because the guided step above opens this dialog too — "Send the
     job offer" is the one obvious act at the Offer stage, and it should not
     matter which of the two places somebody presses it from. */
  composing: boolean
  onCompose: (open: boolean) => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  const offer = applicant.offer

  /* Offered before hired. The stage gate matches the server's, so a button is
     never shown for something that would be refused. */
  const canOffer = !['Hired', 'Rejected'].includes(applicant.stage)

  const record = async (decision: 'Accepted' | 'Declined') => {
    setBusy(true)
    try {
      onChanged(await recordOfferResponse(applicant.id, decision))
      toast({ tone: 'success', title: `Offer marked ${decision.toLowerCase()}` })
    } catch (error) {
      toast({ tone: 'error', title: 'Could not record that.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Offer</p>
        {canOffer && (
          <Button size="sm" variant={offer ? 'ghost' : 'secondary'} onClick={() => onCompose(true)}>
            <Mail className="size-3.5" />
            {offer ? 'Send again' : 'Send job offer'}
          </Button>
        )}
      </div>

      {!offer ? (
        <p className="text-[12px] text-ink-3">
          No offer has gone out. Sending one records the terms and moves them to the Offer stage.
        </p>
      ) : (
        <div className="rounded-lg border border-line p-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">
                {offer.salary ? money(offer.salary) : 'No figure'}
                {offer.position && <span className="ml-1.5 text-[12px] font-normal text-ink-2">{offer.position}</span>}
              </p>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Sent {offer.sentAt ? fmtDate(offer.sentAt.slice(0, 10)) : '—'}
                {offer.startDate && ` · starting ${fmtDate(offer.startDate)}`}
                {offer.expiresOn && ` · reply by ${fmtDate(offer.expiresOn)}`}
              </p>
            </div>

            {offer.response ? (
              <Badge tone={offer.response === 'Accepted' ? 'good' : 'critical'}>{offer.response}</Badge>
            ) : (
              <Badge tone="warning">Awaiting reply</Badge>
            )}
          </div>

          {offer.notes && (
            <p className="mt-1.5 text-[11px] leading-relaxed whitespace-pre-line text-ink-2">{offer.notes}</p>
          )}

          {offer.response === 'Declined' && offer.declineReason && (
            <p className="mt-1.5 text-[11px] text-ink-2">Reason given: {offer.declineReason}</p>
          )}

          {offer.response ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
              <CheckCircle2 className="size-3.5" />
              Answered {offer.respondedAt ? fmtDate(offer.respondedAt.slice(0, 10)) : ''}
              {offer.response === 'Accepted' && ' — hire them when the paperwork is ready.'}
            </p>
          ) : (
            <>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                They can answer from the links in the email or from the careers site. Record it here instead if
                they told you directly.
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void record('Accepted')}>
                  <ThumbsUp className="size-3.5" />
                  They accepted
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-critical"
                  disabled={busy}
                  onClick={() => void record('Declined')}
                >
                  <ThumbsDown className="size-3.5" />
                  They declined
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <OfferComposer
        applicant={applicant}
        open={composing}
        onClose={() => onCompose(false)}
        onSent={onChanged}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function OfferComposer({
  applicant,
  open,
  onClose,
  onSent,
}: {
  applicant: ApplicantDetail
  open: boolean
  onClose: () => void
  onSent: (next: ApplicantDetail) => void
}) {
  const toast = useToast()

  const [salary, setSalary] = React.useState('')
  const [dailyRate, setDailyRate] = React.useState('')
  const [deMinimis, setDeMinimis] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [expiresOn, setExpiresOn] = React.useState('')
  const [orientationAt, setOrientationAt] = React.useState('')
  const [orientationVenue, setOrientationVenue] = React.useState('')
  const [notes, setNotes] = React.useState('')

  const [preview, setPreview] = React.useState<OfferPreview | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')

  React.useEffect(() => {
    if (!open) return

    /* Seeded from what is already known: a previous offer, or what they asked
       for. Neither is a commitment — it is the number the conversation
       started from, and it saves retyping it. */
    setSalary(String(applicant.offer?.salary ?? applicant.expectedSalary ?? ''))
    setDailyRate(applicant.offer?.dailyRate ? String(applicant.offer.dailyRate) : '')
    setDeMinimis(applicant.offer?.deMinimis ? String(applicant.offer.deMinimis) : '')
    setStartDate(applicant.offer?.startDate ?? plusDays(14))
    setExpiresOn(applicant.offer?.expiresOn ?? plusDays(7))
    setOrientationAt(applicant.offer?.orientationAt?.slice(0, 16) ?? '')
    setOrientationVenue(applicant.offer?.orientationVenue ?? '')
    setNotes(applicant.offer?.notes ?? '')
    setProblem('')
  }, [open, applicant])

  // The preview comes from the server, so what is read here and what is sent
  // are built by one piece of code. Debounced so typing a salary does not fire
  // a request per digit.
  React.useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => {
      previewOffer(applicant.id, {
        ...(salary ? { salary: Number(salary) } : {}),
        ...(dailyRate ? { dailyRate: Number(dailyRate) } : {}),
        ...(deMinimis ? { deMinimis: Number(deMinimis) } : {}),
        ...(startDate ? { startDate } : {}),
        ...(expiresOn ? { expiresOn } : {}),
        ...(orientationAt ? { orientationAt } : {}),
        ...(orientationVenue.trim() ? { orientationVenue: orientationVenue.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 350)

    return () => clearTimeout(timer)
  }, [open, applicant.id, salary, dailyRate, deMinimis, startDate, expiresOn, orientationAt, orientationVenue, notes])

  const send = async () => {
    setBusy(true)
    setProblem('')

    try {
      const result = await sendOffer(applicant.id, {
        salary: Number(salary),
        ...(dailyRate ? { dailyRate: Number(dailyRate) } : {}),
        ...(deMinimis ? { deMinimis: Number(deMinimis) } : {}),
        ...(startDate ? { startDate } : {}),
        ...(expiresOn ? { expiresOn } : {}),
        ...(orientationAt ? { orientationAt } : {}),
        ...(orientationVenue.trim() ? { orientationVenue: orientationVenue.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })

      onSent(result)
      toast({
        tone: result.offerSent ? 'success' : 'warning',
        title: result.offerSent ? 'Offer sent' : 'Offer recorded, email not sent',
        description: result.offerMessage,
      })
      onClose()
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const noEmail = !applicant.email

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Offer ${applicant.name} the role`}
      description="The terms go in writing and onto the record. The salary here is what their 201 file starts on when you hire them."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void send()} disabled={busy || !Number(salary) || noEmail} loading={busy}>
            <Send className="size-4" />
            Send the offer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {noEmail && (
          <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-2.5 text-[12px] leading-relaxed text-warning">
            <TriangleAlert className="mt-px size-4 shrink-0" />
            There is no email address on this application, so nothing can be sent. Add one to their details
            first.
          </p>
        )}

        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
          <Field label="Monthly salary" required hint="Before deductions." composite>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">
                ₱
              </span>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="tabular pl-7 text-right"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Proposed start" hint="When you would like them.">
            <Input type="date" min={today()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Reply by" hint="After this the offer will not accept an answer.">
            <Input type="date" min={today()} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          <Field
            label="Basic daily rate"
            hint="What the letter states. Left blank, it is worked out from the monthly salary."
            composite
          >
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">
                ₱
              </span>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="tabular pl-7 text-right"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Daily de minimis" hint="Non-taxable allowance, stated separately in the letter." composite>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">
                ₱
              </span>
              <Input
                type="number"
                min={0}
                step="0.01"
                className="tabular pl-7 text-right"
                value={deMinimis}
                onChange={(e) => setDeMinimis(e.target.value)}
              />
            </div>
          </Field>

          <Field label="New hire orientation" hint="Date and time they should turn up.">
            <Input
              type="datetime-local"
              value={orientationAt}
              onChange={(e) => setOrientationAt(e.target.value)}
            />
          </Field>
          <Field label="Orientation venue" hint="Left blank, the branch address is used.">
            <Input value={orientationVenue} onChange={(e) => setOrientationVenue(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Anything else in the offer"
          hint="Probation terms, what to bring on the first day, who to report to."
          composite
        >
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>

        {/* The paperwork, openable before it goes anywhere. Both are built by
            the same code that attaches them, so reading one here is reading
            what the candidate gets. */}
        <div className="rounded-xl border border-line p-3">
          <p className="text-[12px] font-semibold text-ink">Attached to the email</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
            An employment offer letter and a clinic referral slip, both as Word files so HR can amend them.
            The letter carries the 180-day probationary term and the pre-employment requirements.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void openOfferDocument(applicant.id, 'letter').catch((error) =>
                  toast({ tone: 'error', title: 'Could not build it.', description: (error as Error).message }),
                )
              }}
            >
              <FileText className="size-3.5" />
              Offer letter
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void openOfferDocument(applicant.id, 'referral').catch((error) =>
                  toast({ tone: 'error', title: 'Could not build it.', description: (error as Error).message }),
                )
              }}
            >
              <FileText className="size-3.5" />
              Referral slip
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
            These preview the terms as they stand on the record. Save the offer first to see edits reflected.
          </p>
        </div>

        {/* What they will actually receive. Rendered from the server's own
            values so the two can never drift. */}
        {preview && (
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-2 text-[10px] font-medium tracking-wide text-ink-3 uppercase">
              What {applicant.email} receives
            </p>
            <p className="text-[12px] font-semibold text-ink">{preview.subject}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
              Hello {preview.firstName} — thank you for the time you have given us. We would like to offer you
              the position below, and we hope you will take it.
            </p>

            <dl className="mt-2 grid gap-x-5 gap-y-1 text-[12px] sm:grid-cols-2">
              {[
                ['Position', preview.position],
                ['Where', [preview.department, preview.branch].filter(Boolean).join(' · ')],
                ['Basic daily rate', preview.dailyRate],
                ['Daily de minimis', preview.deMinimis],
                ['Monthly salary', preview.salary],
                ['Proposed start', preview.startDate],
                ['Orientation', [preview.orientationDate, preview.orientationTime].filter(Boolean).join(' · ')],
                ['Reply by', preview.expiresOn],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-[10px] tracking-wide text-ink-3 uppercase">{label}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
            </dl>

            {preview.notes && (
              <p className="mt-2 text-[12px] leading-relaxed whitespace-pre-line text-ink-2">{preview.notes}</p>
            )}

            <p className={cn('mt-2 text-[11px] leading-relaxed text-ink-3')}>
              With an <strong className="text-ink-2">Accept</strong> and a{' '}
              <strong className="text-ink-2">Decline</strong> button. Both need their reference code and this
              email address together, so a forwarded link is useless on its own.
            </p>
          </div>
        )}

        {problem && (
          <p role="alert" className="text-[12px] text-critical">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  )
}
