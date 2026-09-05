import * as React from 'react'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  addPayslipLine, adjustPayslip, deletePayslip, deletePayslipLine,
  type PayslipLine,
} from '@/lib/adminApi'
import { money } from '@/lib/format'
import { Button, Field, Input, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'

/**
 * Editing a payslip, within the narrow limits that keep it a payslip.
 *
 * The dialog offers six inputs and no others, and that is the design rather
 * than an omission. The payroll engine computes basic pay, the statutory
 * contributions and the tax, and every one of those is derived from something
 * — attendance, a salary band, the BIR table. Making them typeable would mean
 * a register whose figures cannot be traced back to anything.
 *
 * What the engine *cannot* know is exactly what is editable here: whether
 * somebody worked a holiday, whether a rest day was paid, whether leave was
 * paid, and what allowances apply. The engine writes zero into all five and
 * always has; until now nothing could put a figure in them.
 *
 * Everything else on the payslip is recomputed by the server the moment one of
 * these changes — including the withholding tax, through the same BIR table
 * the run used. So an allowance added here moves the tax the way it would have
 * if the run had known about it, and the screen never has to do arithmetic it
 * could get wrong.
 */

export type AdjustablePayslip = {
  id: number
  employee: string
  employeeNo?: string | null
  restDayPay: number
  holidayPay: number
  leavePay: number
  taxableAllowances: number
  nonTaxableAllowances: number
  holdAmount: number
  retroAdjustment: number
  atmAccount: string | null
  grossPay: number
  netPay: number
  earningLines?: PayslipLine[]
  deductionLines?: PayslipLine[]
}

const AMOUNTS = [
  { key: 'holidayPay', label: 'Holiday pay', hint: 'Worked or paid holidays for this cut-off.' },
  { key: 'restDayPay', label: 'Rest day pay', hint: 'Premium for work on a scheduled rest day.' },
  { key: 'leavePay', label: 'Leave pay', hint: 'Paid leave taken within the cut-off.' },
  {
    key: 'taxableAllowances',
    label: 'Taxable allowances',
    hint: 'Adds to gross and to the tax base.',
  },
  {
    key: 'nonTaxableAllowances',
    label: 'Non-taxable allowances',
    hint: 'De minimis benefits. Adds to gross, not to the tax base.',
  },
  {
    key: 'holdAmount',
    label: 'Hold payroll',
    hint: "Held back from this cut-off's release — pending clearance, a dispute. Does not change what was earned.",
  },
  {
    key: 'retroAdjustment',
    label: 'Retro adjustment',
    hint: 'A correction owed from a past cut-off, settled in this one. Can be negative.',
  },
] as const

type AmountKey = (typeof AMOUNTS)[number]['key']

export function PayslipAdjustDialog({
  payslip,
  open,
  onClose,
  onSaved,
}: {
  payslip: AdjustablePayslip | null
  open: boolean
  onClose: () => void
  /** Called after any change. The parent re-reads whatever it is showing. */
  onSaved: () => void
}) {
  const toast = useToast()

  const [values, setValues] = React.useState<Record<AmountKey, string>>({
    holidayPay: '', restDayPay: '', leavePay: '', taxableAllowances: '', nonTaxableAllowances: '',
    holdAmount: '', retroAdjustment: '',
  })
  const [account, setAccount] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const [lineKind, setLineKind] = React.useState<'earning' | 'deduction'>('earning')
  const [lineLabel, setLineLabel] = React.useState('')
  const [lineAmount, setLineAmount] = React.useState('')
  const [lineTaxable, setLineTaxable] = React.useState(false)

  // Re-seeded whenever the dialog opens on a different payslip, so one
  // employee's allowance never appears under another's name.
  React.useEffect(() => {
    if (!open || !payslip) return

    setValues({
      holidayPay: payslip.holidayPay ? String(payslip.holidayPay) : '',
      restDayPay: payslip.restDayPay ? String(payslip.restDayPay) : '',
      leavePay: payslip.leavePay ? String(payslip.leavePay) : '',
      taxableAllowances: payslip.taxableAllowances ? String(payslip.taxableAllowances) : '',
      nonTaxableAllowances: payslip.nonTaxableAllowances ? String(payslip.nonTaxableAllowances) : '',
      holdAmount: payslip.holdAmount ? String(payslip.holdAmount) : '',
      retroAdjustment: payslip.retroAdjustment ? String(payslip.retroAdjustment) : '',
    })
    setAccount(payslip.atmAccount ?? '')
    setProblem('')
    setConfirmDelete(false)
    setLineLabel('')
    setLineAmount('')
  }, [open, payslip])

  if (!payslip) return null

  const run = async (action: () => Promise<unknown>, title: string, then?: () => void) => {
    setBusy(true)
    setProblem('')
    try {
      await action()
      toast({ tone: 'success', title })
      onSaved()
      then?.()
    } catch (err) {
      // The server's refusal explains itself — a negative net pay, an approved
      // run, a locked loan line. Shown verbatim rather than replaced.
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(
      () =>
        adjustPayslip(payslip.id, {
          holidayPay: Number(values.holidayPay || 0),
          restDayPay: Number(values.restDayPay || 0),
          leavePay: Number(values.leavePay || 0),
          taxableAllowances: Number(values.taxableAllowances || 0),
          nonTaxableAllowances: Number(values.nonTaxableAllowances || 0),
          holdAmount: Number(values.holdAmount || 0),
          retroAdjustment: Number(values.retroAdjustment || 0),
          atmAccount: account.trim(),
        }),
      'Payslip recomputed',
      onClose,
    )

  const addLine = () =>
    run(
      () =>
        addPayslipLine(payslip.id, {
          kind: lineKind,
          label: lineLabel.trim(),
          amount: Number(lineAmount),
          taxable: lineKind === 'earning' && lineTaxable,
        }),
      'Line added',
      () => {
        setLineLabel('')
        setLineAmount('')
        setLineTaxable(false)
      },
    )

  const lines = [...(payslip.earningLines ?? []), ...(payslip.deductionLines ?? [])]
  const hasLineSection = payslip.earningLines !== undefined || payslip.deductionLines !== undefined

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust ${payslip.employee}`}
      description="Only the amounts the run could not work out for itself. Everything else — gross, tax, deductions and net — is recomputed from these."
      size="lg"
      dirty={!busy}
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto text-critical"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash2 className="size-4" />
            Remove from run
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy} loading={busy}>
            Save and recompute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-surface-2 p-2.5 text-[12px] text-ink-2">
          Currently gross <span className="tabular font-semibold text-ink">{money(payslip.grossPay)}</span>, net{' '}
          <span className="tabular font-semibold text-ink">{money(payslip.netPay)}</span>. Saving re-derives both,
          and the withholding tax with them.
        </p>

        <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {AMOUNTS.map((amount) => (
            <Field key={amount.key} label={amount.label} hint={amount.hint} composite>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3">
                  ₱
                </span>
                <Input
                  type="number"
                  // Every amount here is a payment or a hold, never negative
                  // — except retro, which corrects a past cut-off and can go
                  // either way.
                  min={amount.key === 'retroAdjustment' ? undefined : 0}
                  step="0.01"
                  className="tabular pl-7 text-right"
                  value={values[amount.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [amount.key]: e.target.value }))}
                />
              </div>
            </Field>
          ))}

          <Field label="Bank account" hint="Where the net pay is credited on the bank file.">
            <Input value={account} onChange={(e) => setAccount(e.target.value)} />
          </Field>
        </div>

        {/* ---------------------------------------------------------------- */}
        {hasLineSection && (
          <div className="border-t border-line pt-3">
            <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              Itemised one-offs
            </p>

            {lines.length > 0 && (
              <div className="mb-2 space-y-1">
                {lines.map((line) => {
                  const isEarning = (payslip.earningLines ?? []).some((l) => l.id === line.id)

                  return (
                    <div key={line.id} className="flex items-center gap-2 text-[12px]">
                      <span
                        className={cn(
                          'w-16 shrink-0 text-[10px] font-semibold tracking-wide uppercase',
                          isEarning ? 'text-good' : 'text-critical',
                        )}
                      >
                        {isEarning ? 'Earning' : 'Deduction'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{line.label}</span>
                      <span className="tabular shrink-0 text-ink">{money(line.amount)}</span>
                      {line.locked ? (
                        <span
                          className="shrink-0 p-1 text-ink-3"
                          title="A loan collection. The outstanding balance is worked out from this line, so removing it here would quietly un-collect the instalment."
                        >
                          <Lock className="size-3.5" />
                        </span>
                      ) : (
                        <button
                          onClick={() => void run(() => deletePayslipLine(line.id), 'Line removed')}
                          disabled={busy}
                          className="shrink-0 rounded p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-critical"
                          aria-label={`Remove ${line.label}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <Field label="Kind" className="w-28">
                <Select
                  value={lineKind}
                  onChange={(e) => setLineKind(e.target.value as 'earning' | 'deduction')}
                >
                  <option value="earning">Earning</option>
                  <option value="deduction">Deduction</option>
                </Select>
              </Field>
              <Field label="What it is" className="min-w-[10rem] flex-1">
                <Input
                  value={lineLabel}
                  onChange={(e) => setLineLabel(e.target.value)}
                  placeholder={lineKind === 'earning' ? 'Rice subsidy' : 'Uniform charge'}
                />
              </Field>
              <Field label="Amount" className="w-28">
                <Input
                  type="number"
                  min={0.01}
                  step="0.01"
                  className="tabular text-right"
                  value={lineAmount}
                  onChange={(e) => setLineAmount(e.target.value)}
                />
              </Field>
              <Button
                variant="secondary"
                onClick={() => void addLine()}
                disabled={busy || lineLabel.trim() === '' || !Number(lineAmount)}
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {lineKind === 'earning' && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] text-ink-2">
                <input
                  type="checkbox"
                  checked={lineTaxable}
                  onChange={(e) => setLineTaxable(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-[var(--brand-500,#2563eb)]"
                />
                Taxable — include it in the tax base. Leave off for de minimis benefits.
              </label>
            )}
          </div>
        )}

        {problem && (
          <p role="alert" className="text-[12px] text-critical">
            {problem}
          </p>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${payslip.employee} from this run?`}
        description="For somebody who should not be paid on this cut-off at all. Any loan instalment this payslip collected goes back onto the balance."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              loading={busy}
              onClick={() =>
                void run(() => deletePayslip(payslip.id), 'Payslip removed', () => {
                  setConfirmDelete(false)
                  onClose()
                })
              }
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          </>
        }
      >
        <p className="tabular text-[13px] text-ink-2">
          Net {money(payslip.netPay)} would come off the run total.
        </p>
      </Modal>
    </Modal>
  )
}
