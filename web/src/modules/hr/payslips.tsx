import * as React from 'react'
import { Banknote, Download, HandCoins, Pencil, Printer, Scale, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { liveApi } from '@/lib/adminApi'
import { downloadRegionAsPng, printRegion } from '@/lib/export'
import { money, moneyCompact, num } from '@/lib/format'
import { currentUser } from '@/app/auth'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Button } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import { PayslipAdjustDialog } from './payslipAdjust'
import { invalidateResource } from '@/lib/api'

/**
 * Adjusting a payslip from the list, rather than only from inside a run.
 *
 * The same dialog and the same server rules: five amounts and an account, and
 * everything derived recomputed from them. It is offered here because this is
 * where somebody lands when an employee queries their payslip — and having to
 * find the run it belongs to before you can correct it is a step that exists
 * for no reason.
 *
 * A payslip on an approved or released run refuses on the server. The button
 * is still shown, and the refusal explains what to do, because hiding it would
 * leave "why can I not fix this" unanswered.
 */
function AdjustPayslip({ row, done }: { row: LivePayslip; done: () => void }) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
        Adjust
      </Button>

      <PayslipAdjustDialog
        payslip={{
          id: row.id,
          employee: row.employee,
          employeeNo: row.employeeNo,
          restDayPay: row.restDayPay,
          holidayPay: row.holidayPay,
          leavePay: row.leavePay,
          taxableAllowances: row.taxableAllowances,
          nonTaxableAllowances: row.nonTaxableAllowances,
          holdAmount: row.holdAmount,
          retroAdjustment: row.retroAdjustment,
          atmAccount: row.atmAccount,
          grossPay: row.grossPay,
          netPay: row.netPay,
          earningLines: row.earningLines ?? [],
          deductionLines: row.deductionLines ?? [],
        }}
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          void invalidateResource('hr/payslips')
          done()
        }}
      />
    </>
  )
}

/**
 * Payslips, read back from what payroll actually computed.
 *
 * Every figure here is a snapshot taken at compute time — the rate, the salary
 * credit the SSS contribution was looked up against, the tax withheld. A rate
 * change tomorrow must not silently rewrite what somebody was already paid, so
 * nothing on this page is recalculated in the browser: it renders the stored
 * payslip row and nothing else.
 */
type PayslipLineRow = {
  id: number
  code: string
  label: string
  amount: number
  taxable?: boolean
  locked: boolean
}

export type LivePayslip = {
  id: number
  employeeId: number
  employeeNo: string
  employee: string
  payrollGroup: string
  branchUnit: string
  positionTitle: string
  atmAccount: string | null
  period: string | null
  periodLabel: string | null
  runNo: string | null
  status: string
  hourlyRate: number
  dailyRate: number
  monthlyEquivalent: number
  basicPay: number
  overtimePay: number
  nightDiffPay: number
  restDayPay: number
  holidayPay: number
  leavePay: number
  taxableAllowances: number
  nonTaxableAllowances: number
  holdAmount: number
  retroAdjustment: number
  lateDeduction: number
  undertimeDeduction: number
  absenceDeduction: number
  sssSalaryCredit: number
  sssEmployee: number
  sssEmployer: number
  philhealthEmployee: number
  philhealthEmployer: number
  pagibigEmployee: number
  pagibigEmployer: number
  taxableIncome: number
  withholdingTax: number
  otherDeductions: number
  /** Loans, advances and the rest, itemised. Statutory has its own columns. */
  deductionLines: PayslipLineRow[]
  /** One-off earnings, itemised for the same reason. */
  earningLines: PayslipLineRow[]
  /** The run this belongs to, and whether it is still open to changes. */
  runId: number | null
  thirteenthMonthAccrual: number
  employerCost: number
  grossPay: number
  totalDeductions: number
  netPay: number
}

function LineRow({
  label,
  amount,
  hideZero,
  strong,
}: {
  label: string
  amount: number
  hideZero?: boolean
  strong?: boolean
}) {
  if (!amount && hideZero) return null
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1',
        strong && 'border-t border-line pt-2 font-semibold',
      )}
    >
      <span className={cn('text-[13px]', strong ? 'text-ink' : 'text-ink-2')}>{label}</span>
      <span className={cn('tabular text-[13px]', strong ? 'text-ink' : 'text-ink-2')}>{money(amount)}</span>
    </div>
  )
}

export function PayslipView({ slip }: { slip: LivePayslip }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = React.useState(false)
  const cutoff = slip.periodLabel ?? slip.period ?? '—'
  const statutory = slip.sssEmployee + slip.philhealthEmployee + slip.pagibigEmployee

  const downloadPng = async () => {
    setDownloading(true)
    try {
      await downloadRegionAsPng(ref.current, `payslip-${slip.employeeNo}-${slip.period ?? slip.id}`)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div data-print="hide" className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" loading={downloading} onClick={downloadPng}>
          <Download className="size-4" />
          Download PNG
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            printRegion(ref.current, {
              title: 'Payslip',
              subtitle: `${slip.employee} — ${cutoff}`,
              preparedBy: currentUser().name,
              confidential: true,
            })
          }
        >
          <Printer className="size-4" />
          Print / Save as PDF
        </Button>
      </div>

      <div ref={ref} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-3">
            <p className="text-[11px] text-ink-3">Employee</p>
            <p className="text-[13px] font-medium text-ink">{slip.employee}</p>
            <p className="text-[11px] text-ink-3">
              {slip.employeeNo} · {slip.positionTitle} · {slip.branchUnit}
            </p>
          </div>
          <div className="card p-3">
            <p className="text-[11px] text-ink-3">Cut-off</p>
            <p className="text-[13px] font-medium text-ink">{cutoff}</p>
            <p className="text-[11px] text-ink-3">
              {slip.runNo ?? '—'} · {slip.payrollGroup} · {slip.status}
            </p>
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Earnings</p>
            <LineRow label="Basic pay" amount={slip.basicPay} />
            <LineRow label="Overtime" amount={slip.overtimePay} hideZero />
            <LineRow label="Night differential" amount={slip.nightDiffPay} hideZero />
            <LineRow label="Rest day" amount={slip.restDayPay} hideZero />
            <LineRow label="Holiday pay" amount={slip.holidayPay} hideZero />
            <LineRow label="Leave pay" amount={slip.leavePay} hideZero />
            <LineRow label="Taxable allowances" amount={slip.taxableAllowances} hideZero />
            <LineRow label="Non-taxable allowances" amount={slip.nonTaxableAllowances} hideZero />
            <LineRow label="Gross pay" amount={slip.grossPay} strong />
          </div>

          <div>
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Deductions</p>
            <LineRow label="Late" amount={slip.lateDeduction} hideZero />
            <LineRow label="Undertime" amount={slip.undertimeDeduction} hideZero />
            <LineRow label="Absences" amount={slip.absenceDeduction} hideZero />
            <LineRow label="SSS" amount={slip.sssEmployee} />
            <LineRow label="PhilHealth" amount={slip.philhealthEmployee} />
            <LineRow label="Pag-IBIG" amount={slip.pagibigEmployee} />
            <LineRow label="Withholding tax" amount={slip.withholdingTax} />
            {/* Itemised rather than a single "other deductions" figure —
                somebody querying their payslip is asking which loan it was. */}
            {(slip.deductionLines ?? []).map((line) => (
              <LineRow key={line.id} label={line.label} amount={line.amount} />
            ))}
            {(slip.deductionLines ?? []).length === 0 && (
              <LineRow label="Other deductions" amount={slip.otherDeductions} hideZero />
            )}
            <LineRow label="Total deductions" amount={slip.totalDeductions} strong />
          </div>
        </div>

        <div className="card flex items-baseline justify-between p-3">
          <span className="text-[13px] font-semibold text-ink">Net pay</span>
          <span className="tabular text-[15px] font-semibold text-ink">{money(slip.netPay)}</span>
        </div>

        <div className="grid gap-3 text-[11px] text-ink-3 sm:grid-cols-3">
          <p>
            Daily rate <span className="tabular text-ink-2">{money(slip.dailyRate)}</span> · hourly{' '}
            <span className="tabular text-ink-2">{money(slip.hourlyRate)}</span>
          </p>
          <p>
            SSS salary credit <span className="tabular text-ink-2">{money(slip.sssSalaryCredit)}</span> · taxable
            income <span className="tabular text-ink-2">{money(slip.taxableIncome)}</span>
          </p>
          <p>
            13th month accrual <span className="tabular text-ink-2">{money(slip.thirteenthMonthAccrual)}</span> ·
            employer cost <span className="tabular text-ink-2">{money(slip.employerCost)}</span>
          </p>
        </div>

        <p className="text-[11px] text-ink-3">
          Employee statutory share {money(statutory)}. Credited to {slip.atmAccount ?? 'no account on file'}.
        </p>
      </div>
    </div>
  )
}

export function Payslips() {
  const c = cols<LivePayslip>()

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Payslips" description="Every employee's computed pay for a cut-off." />
        <div className="card">
          <EmptyState
            icon={Banknote}
            title="Payslips need the live API"
            description="They are produced by computing a payroll run, not stored ahead of time."
          />
        </div>
      </>
    )
  }

  return (
    <ResourcePage<LivePayslip>
      title="Payslips"
      description="Every employee's computed pay — earnings, statutory contributions, tax and net pay. Produced by a payroll run."
      endpoint="hr/payslips"
      loader={() => []}
      exportName="payslips"
      pageSize={25}
      searchPlaceholder="Search employee or number…"
      filters={[
        { columnId: 'periodLabel', label: 'Cut-off' },
        { columnId: 'payrollGroup', label: 'Payroll group' },
        { columnId: 'branchUnit', label: 'Branch' },
      ]}
      stats={(list) => (
        <StatGrid>
          <StatTile label="Payslips" value={num(list.length)} icon={Users} />
          <StatTile label="Gross pay" value={moneyCompact(list.reduce((s, p) => s + p.grossPay, 0))} icon={HandCoins} />
          <StatTile
            label="Total deductions"
            value={moneyCompact(list.reduce((s, p) => s + p.totalDeductions, 0))}
            icon={Scale}
          />
          <StatTile label="Net pay" value={moneyCompact(list.reduce((s, p) => s + p.netPay, 0))} icon={Banknote} />
        </StatGrid>
      )}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => `${row.employeeNo} · ${row.periodLabel ?? row.period ?? ''}`}
      detailSize="xl"
      renderDetail={(row) => <PayslipView slip={row} />}
      detailActions={(row, done) => <AdjustPayslip row={row} done={done} />}
      columns={[
        c.primary('employee', 'Employee', (row) => `${row.employeeNo} · ${row.positionTitle}`),
        c.text('periodLabel', 'Cut-off'),
        c.text('branchUnit', 'Branch'),
        c.tag('payrollGroup', 'Group', 'brand', true),
        c.money('grossPay', 'Gross pay', { bold: true }),
        c.money('totalDeductions', 'Deductions'),
        c.money('netPay', 'Net pay', { bold: true }),
        c.status(),
      ]}
    />
  )
}
