import { AlertTriangle, MessageSquareWarning, ScrollText } from 'lucide-react'
import { liveApi } from '@/lib/adminApi'
import { money, num } from '@/lib/format'
import { ResourcePage, AutoDetail } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { EmptyState } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * Payroll complaints, replacing the spreadsheet these used to live in.
 *
 * A resolved dispute is a decision on record, not a payroll action by
 * itself — applying the deduction or retro to an actual payslip still goes
 * through the payroll run's own "add line" control (Payroll → Runs), the
 * same as any other one-off adjustment. Keeping the two separate means a
 * dispute can be logged and reasoned about before anyone commits it to a
 * live run.
 */

type PayrollDispute = {
  id: number
  employeeId: number
  employee: string
  employeeNo: string | null
  department: string | null
  payrollPeriodId: number | null
  period: string | null
  complaint: string
  hrFeedback: string | null
  liable: string | null
  actionPlan: string | null
  deductAmount: number | null
  retroAmount: number | null
  status: string
  raisedOn: string
  resolvedOn: string | null
  resolvedBy: string | null
}

const STATUS_TONE: Record<string, 'critical' | 'warning' | 'good' | 'neutral'> = {
  Open: 'critical',
  'Under Review': 'warning',
  Resolved: 'good',
  'Applied to Payroll': 'neutral',
}

export function PayrollDisputes() {
  const c = cols<PayrollDispute>()

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Payroll Disputes" description="Complaints, HR's response, and any retro or deduction they resolved to." />
        <div className="card">
          <EmptyState icon={MessageSquareWarning} title="Needs the live API" description="Disputes are read and written on the server." />
        </div>
      </>
    )
  }

  return (
    <ResourcePage<PayrollDispute>
      title="Payroll Disputes"
      description="A payroll complaint, what HR found, and any deduction or retro it resolved to. Applying the amount to an actual payslip is still done from the payroll run itself."
      endpoint="hr/payroll-disputes"
      loader={() => []}
      exportName="payroll-disputes"
      createLabel="Log complaint"
      formFields={forms.payrollDisputeFields}
      formDefaults={forms.payrollDisputeDefaults}
      formTitle="payroll dispute"
      searchPlaceholder="Search employee, complaint…"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'department', label: 'Department' },
      ]}
      stats={(list) => (
        <StatGrid>
          <StatTile label="Open" value={num(list.filter((d) => d.status === 'Open').length)} icon={AlertTriangle} />
          <StatTile label="Under review" value={num(list.filter((d) => d.status === 'Under Review').length)} icon={ScrollText} />
          <StatTile
            label="Retro pending"
            value={money(list.filter((d) => d.status !== 'Applied to Payroll').reduce((s, d) => s + (d.retroAmount ?? 0), 0))}
            icon={MessageSquareWarning}
            hint="Not yet applied to a payslip"
          />
          <StatTile
            label="Deductions pending"
            value={money(list.filter((d) => d.status !== 'Applied to Payroll').reduce((s, d) => s + (d.deductAmount ?? 0), 0))}
            icon={MessageSquareWarning}
            hint="Not yet applied to a payslip"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => row.period ?? 'No cut-off linked'}
      detailSize="lg"
      renderDetail={(row) => (
        <div className="space-y-4">
          <AutoDetail row={row} />
          {(row.deductAmount || row.retroAmount) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {row.deductAmount != null && row.deductAmount > 0 && (
                <div className="card p-3">
                  <p className="text-[11px] text-ink-3">To deduct from employee</p>
                  <p className="text-[15px] font-semibold text-critical">{money(row.deductAmount)}</p>
                </div>
              )}
              {row.retroAmount != null && row.retroAmount > 0 && (
                <div className="card p-3">
                  <p className="text-[11px] text-ink-3">Retro owed to employee</p>
                  <p className="text-[15px] font-semibold text-good">{money(row.retroAmount)}</p>
                </div>
              )}
            </div>
          )}
          {row.status !== 'Applied to Payroll' && (row.deductAmount || row.retroAmount) && (
            <p className="rounded-lg bg-warning/10 p-2.5 text-xs text-ink-2 ring-1 ring-warning/25 ring-inset">
              Not yet applied to a payslip. Add it as a line on {row.employee}'s next payroll run, then mark this
              dispute "Applied to Payroll".
            </p>
          )}
        </div>
      )}
      columns={[
        c.primary('employee', 'Employee', (row) => row.employeeNo ?? ''),
        c.text('department', 'Department', { secondary: true }),
        c.date('raisedOn', 'Raised'),
        c.text('liable', 'Liable', { secondary: true }),
        c.money('deductAmount', 'Deduct'),
        c.money('retroAmount', 'Retro'),
        c.level('status', 'Status', STATUS_TONE),
      ]}
    />
  )
}
