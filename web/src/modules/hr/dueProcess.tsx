import * as React from 'react'
import { BookOpen, Check, Download, Scale, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { downloadCaseNod, downloadCaseNte, getDueProcess, recordDueProcess, type DueProcessState } from '@/lib/adminApi'
import { fmtDate } from '@/lib/format'
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Due process on a disciplinary case.
 *
 * A dismissal in the Philippines is tested on two things: whether there was a
 * valid cause, and whether the employee got due process. The first is a
 * judgement no system can make. The second is a sequence of dated steps, and
 * that is exactly what this records.
 *
 * The panel reports and never blocks. Somebody who has skipped a step needs to
 * see it stated plainly so it can be put right — being prevented from
 * recording what actually happened would only produce a tidier file that is
 * further from the truth.
 *
 * The guidance is a process aid, not legal advice. The periods shown are the
 * statutory minimums; a CBA or company policy may require more, and a real
 * case should go past counsel.
 */

/* -------------------------------------------------------------------------- */
/* The guide                                                                   */
/* -------------------------------------------------------------------------- */

const JUST_CAUSE_GUIDE = [
  {
    title: 'Serve the first notice (NTE)',
    body:
      'A written Notice to Explain, stating the specific acts or omissions complained of — not just the rule ' +
      'broken. Vague notices are the commonest reason a dismissal is later set aside. Give the employee at ' +
      'least five calendar days to answer, and get their receipt of it.',
  },
  {
    title: 'Let them answer',
    body:
      'Take the written explanation. If nothing comes by the deadline, record that it was not received and ' +
      'proceed — proceeding without an answer is allowed; proceeding without having asked is not.',
  },
  {
    title: 'Hold a hearing where one is due',
    body:
      'Required when the employee asks for one, when company rules or a CBA require it, or when the facts are ' +
      'genuinely in dispute. Let them bring a representative. Minute what was said.',
  },
  {
    title: 'Serve the decision',
    body:
      'A second written notice setting out the findings, the rule relied on, and the penalty. It has to show ' +
      'the explanation was actually considered.',
  },
]

const AUTHORISED_CAUSE_GUIDE = [
  {
    title: 'Establish the business ground',
    body:
      'Redundancy, retrenchment, closure or disease. Each has its own evidence — a redundancy needs the ' +
      'position genuinely superfluous and fair criteria for who goes; a retrenchment needs proven losses.',
  },
  {
    title: 'Serve both notices, 30 days ahead',
    body:
      'Written notice to the employee AND to the DOLE regional office, at least thirty calendar days before ' +
      'the separation takes effect. Both are required — serving only one does not satisfy the rule.',
  },
  {
    title: 'Pay separation pay',
    body:
      'The rate depends on the cause. Redundancy and closure not due to losses are the higher rate; ' +
      'retrenchment and disease the lower. Compute it with payroll before the effective date.',
  },
]

const PRINCIPLES = [
  'Twin notices are the rule for misconduct: tell them what they are accused of, then tell them the decision.',
  'Five calendar days is the minimum to answer the first notice — not working days.',
  'Preventive suspension removes somebody from the floor while a case is investigated. It is not a penalty, ' +
    'and beyond 30 days they must be reinstated or paid.',
  'The burden of proving a dismissal was valid sits with the employer, which is why the dates matter.',
]

function Guide({ track }: { track: DueProcessState['track'] }) {
  const steps = track === 'just-cause' ? JUST_CAUSE_GUIDE : AUTHORISED_CAUSE_GUIDE

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-surface-2 p-3">
        <p className="text-[12px] leading-relaxed text-ink-2">
          {track === 'just-cause' ? (
            <>
              This case is a <strong>just cause</strong> — the employee is alleged to have done something wrong.
              It runs on the twin-notice rule.
            </>
          ) : (
            <>
              This case is an <strong>authorised cause</strong> — the separation is for a business reason, not a
              fault. Twin notices do not apply; thirty days’ notice to the employee and to DOLE does.
            </>
          )}
        </p>
      </div>

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grad-brand flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white">
              {i + 1}
            </span>
            <div>
              <p className="text-[13px] font-medium text-ink">{s.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div>
        <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Worth remembering</h4>
        <ul className="space-y-1.5">
          {PRINCIPLES.map((p) => (
            <li key={p} className="flex gap-2 text-[12px] leading-relaxed text-ink-2">
              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-ink-3" />
              {p}
            </li>
          ))}
        </ul>
      </div>

      <p className="rounded-lg bg-warning/10 p-3 text-[11px] leading-relaxed text-warning">
        A process aid, not legal advice. The periods here are the statutory minimums under the Labour Code and
        DOLE Department Order 147-15; a CBA or company policy may require more. Take a real dismissal past
        counsel before it is served.
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

export function DueProcessPanel({ caseId, onChanged }: { caseId: number; onChanged?: () => void }) {
  const toast = useToast()
  const [state, setState] = React.useState<DueProcessState | null>(null)
  const [guiding, setGuiding] = React.useState(false)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [downloading, setDownloading] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setState(await getDueProcess(caseId))
    } catch (err) {
      toast({ tone: 'error', title: 'Could not load the case file.', description: (err as Error).message })
    }
  }, [caseId, toast])

  React.useEffect(() => {
    void load()
  }, [load])

  const save = async (body: Record<string, string>) => {
    setBusy(true)
    try {
      setState(await recordDueProcess(caseId, body))
      setEditing(null)
      setDraft({})
      onChanged?.()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not record that.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const downloadNotice = async (kind: 'nte' | 'decision') => {
    setDownloading(kind)
    try {
      await (kind === 'nte' ? downloadCaseNte(caseId) : downloadCaseNod(caseId))
      await load()
      onChanged?.()
    } catch (err) {
      toast({ tone: 'error', title: 'Could not generate that notice.', description: (err as Error).message })
    } finally {
      setDownloading(null)
    }
  }

  if (!state) return <div className="h-40 shimmer rounded-xl" />

  /** Which fields each step writes, and what to call them. */
  const FORMS: Record<string, { label: string; fields: { key: string; label: string; type: 'date' | 'text' }[] }> = {
    nte: {
      label: 'Record the first notice',
      fields: [
        { key: 'nteIssuedOn', label: 'Notice issued on', type: 'date' },
        { key: 'nteResponseDueOn', label: 'Answer due by', type: 'date' },
        { key: 'nteDetails', label: 'Acts or omissions complained of', type: 'text' },
      ],
    },
    'employee-notice': {
      label: 'Record the notice to the employee',
      fields: [{ key: 'nteIssuedOn', label: 'Served on', type: 'date' }],
    },
    'dole-notice': {
      label: 'Record the DOLE notice',
      fields: [{ key: 'doleNotifiedOn', label: 'Filed with the regional office on', type: 'date' }],
    },
    explanation: {
      label: 'Record the explanation',
      fields: [
        { key: 'explanationReceivedOn', label: 'Received on', type: 'date' },
        { key: 'explanation', label: 'What they said', type: 'text' },
      ],
    },
    hearing: {
      label: 'Record the hearing',
      fields: [
        { key: 'hearingHeldOn', label: 'Held on', type: 'date' },
        { key: 'hearingNotes', label: 'Minutes', type: 'text' },
      ],
    },
    decision: {
      label: 'Record the decision',
      fields: [
        { key: 'decisionOn', label: 'Decided on', type: 'date' },
        { key: 'penalty', label: 'Penalty', type: 'text' },
        { key: 'decisionFindings', label: 'Findings', type: 'text' },
      ],
    },
  }

  const form = editing ? FORMS[editing] : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-ink-3" />
          <h3 className="text-[13px] font-semibold text-ink">Due process</h3>
          <Badge tone={state.track === 'just-cause' ? 'info' : 'neutral'}>
            {state.track === 'just-cause' ? 'Just cause' : 'Authorised cause'}
          </Badge>
          {state.complete && <Badge tone="good">Complete</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setGuiding(true)}>
          <BookOpen className="size-3.5" />
          How this works
        </Button>
      </div>

      {state.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {state.warnings.map((w) => (
            <li
              key={w.message}
              className={cn(
                'flex items-start gap-2 rounded-lg p-2.5 text-[12px]',
                w.level === 'critical' ? 'bg-critical/10 text-critical' : 'bg-warning/10 text-warning',
              )}
            >
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}

      <ol className="space-y-2">
        {state.steps.map((step, i) => (
          <li
            key={step.key}
            className={cn(
              'flex gap-3 rounded-xl border p-3',
              step.done ? 'border-good/30 bg-good/5' : 'border-line',
            )}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                step.done ? 'bg-good text-white' : 'bg-surface-3 text-ink-3',
              )}
            >
              {step.done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13px] font-medium text-ink">{step.title}</p>
                {step.on ? (
                  <span className="text-[11px] text-good">{fmtDate(step.on)}</span>
                ) : (
                  FORMS[step.key] && (
                    <button
                      onClick={() => {
                        setEditing(step.key)
                        setDraft({})
                      }}
                      className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      Record it
                    </button>
                  )
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{step.detail}</p>
              {step.note && <p className="mt-1 text-[11px] font-medium text-ink-2">{step.note}</p>}

              {(step.key === 'nte' || step.key === 'decision') && (() => {
                const kind = step.key as 'nte' | 'decision'
                return (
                  <button
                    onClick={() => void downloadNotice(kind)}
                    disabled={downloading === kind}
                    className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
                  >
                    <Download className="size-3" />
                    {downloading === kind
                      ? 'Preparing…'
                      : step.done
                        ? `${kind === 'nte' ? 'Re-download the NTE' : 'Re-download the NOD'} letter`
                        : `Generate the ${kind === 'nte' ? 'NTE' : 'NOD'} letter`}
                  </button>
                )
              })()}
            </div>
          </li>
        ))}
      </ol>

      {/* ------------------------------------------------------- the guide */}
      <Modal
        open={guiding}
        onClose={() => setGuiding(false)}
        title="Discipline and separation under Philippine law"
        description="What the process requires, in the order it has to happen."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setGuiding(false)}>
            Close
          </Button>
        }
      >
        <Guide track={state.track} />
      </Modal>

      {/* ------------------------------------------------ record a step */}
      <Modal
        open={Boolean(form)}
        onClose={() => setEditing(null)}
        title={form?.label ?? ''}
        size="md"
        dirty={Object.keys(draft).length > 0}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void save(draft)}
              disabled={Object.keys(draft).length === 0 || busy}
              loading={busy}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {form?.fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              hint={
                f.key === 'nteResponseDueOn'
                  ? 'At least five calendar days after the notice. Left blank, it is set to five.'
                  : undefined
              }
            >
              {f.type === 'date' ? (
                <Input
                  type="date"
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              ) : (
                <Textarea
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        </div>
      </Modal>
    </div>
  )
}
