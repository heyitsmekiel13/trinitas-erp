import { Banknote, Landmark, Wallet } from 'lucide-react'
import { liveApi } from '@/lib/adminApi'
import { money, num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import { TabbedArea } from '@/components/layout/TabbedArea'
import * as forms from './forms'

/**
 * Deductions that are not statutory: loans, advances, and the rest.
 *
 * The balance shown here is never stored. It is the principal less what the
 * payslips have actually collected, which is what makes recomputing a payroll
 * run safe — the collections vanish with the payslips and the balance comes
 * back on its own, rather than a counter drifting further out of step every
 * time somebody corrects an attendance record and runs payroll again.
 *
 * Collection order is the type's priority, and it matters when a cut-off will
 * not stretch to everything owed: government loans are remitted on the
 * employee's behalf and go first, company money follows, and a canteen tab is
 * what waits.
 */

type Arrangement = {
  id: number
  employee: string
  employeeNo: string
  employeeId: number
  type: string
  typeCode: string
  isLoan: boolean
  reference: string | null
  principal: number | null
  amountPerCutoff: number
  collected: number
  outstanding: number | null
  cutoffsLeft: number | null
  startsOn: string
  endsOn: string | null
  status: string
  notes: string | null
}

type DeductionType = {
  id: number
  code: string
  name: string
  isLoan: boolean
  priority: number
  isActive: boolean
  arrangements: number
  notes: string | null
}

const STATUS_TONE: Record<string, 'good' | 'warning' | 'neutral'> = {
  Active: 'good',
  Suspended: 'warning',
  Cancelled: 'neutral',
}

function Arrangements() {
  const c = cols<Arrangement>()

  return (
    <ResourcePage<Arrangement>
      title="Employee deductions"
      description="Loans, advances and recurring deductions, collected each cut-off after statutory contributions and tax."
      endpoint="hr/deductions"
      loader={() => []}
      exportName="employee-deductions"
      pageSize={25}
      searchPlaceholder="Search employee, reference…"
      filters={[
        { columnId: 'type', label: 'Type' },
        { columnId: 'status', label: 'Status' },
      ]}
      stats={(list) => {
        const active = list.filter((d) => d.status === 'Active')
        const owed = active.reduce((s, d) => s + (d.outstanding ?? 0), 0)
        const perCutoff = active.reduce((s, d) => s + d.amountPerCutoff, 0)
        return (
          <StatGrid>
            <StatTile label="Active arrangements" value={num(active.length)} icon={Wallet} />
            <StatTile
              label="Outstanding"
              value={money(owed)}
              icon={Landmark}
              hint="Loans only — recurring deductions have no end"
            />
            <StatTile
              label="Due each cut-off"
              value={money(perCutoff)}
              icon={Banknote}
              hint="If every arrangement collects in full"
            />
            <StatTile
              label="Collected to date"
              value={money(list.reduce((s, d) => s + d.collected, 0))}
              icon={Banknote}
            />
          </StatGrid>
        )
      }}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => `${row.type}${row.reference ? ` · ${row.reference}` : ''}`}
      renderDetail={(row) => (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Employee</p>
              <p className="text-[13px] font-medium text-ink">{row.employee}</p>
              <p className="text-[11px] text-ink-3">{row.employeeNo}</p>
            </div>
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Arrangement</p>
              <p className="text-[13px] font-medium text-ink">{row.type}</p>
              <p className="text-[11px] text-ink-3">
                {row.reference ?? 'No reference'} · <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
              </p>
            </div>
          </div>

          <div className="card p-3">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Balance</p>
            {row.principal == null ? (
              <p className="text-[13px] text-ink-2">
                Open-ended — {money(row.amountPerCutoff)} every cut-off until it is stopped.{' '}
                <span className="text-ink-3">{money(row.collected)} collected so far.</span>
              </p>
            ) : (
              <div className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-ink-2">Principal</span>
                  <span className="tabular text-[13px] text-ink">{money(row.principal)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-ink-2">Collected</span>
                  <span className="tabular text-[13px] text-ink">{money(row.collected)}</span>
                </div>
                <div className="flex items-baseline justify-between border-t border-line pt-1 font-semibold">
                  <span className="text-[13px] text-ink">Outstanding</span>
                  <span className="tabular text-[13px] text-ink">{money(row.outstanding ?? 0)}</span>
                </div>
                <p className="pt-1 text-[11px] text-ink-3">
                  {money(row.amountPerCutoff)} per cut-off
                  {row.cutoffsLeft != null &&
                    ` · about ${row.cutoffsLeft} more cut-off${row.cutoffsLeft === 1 ? '' : 's'} to clear`}
                </p>
              </div>
            )}
          </div>

          <p className="text-[11px] text-ink-3">
            Collected after statutory contributions and withholding tax, never below zero net pay. If a cut-off
            cannot cover the instalment, what fits is taken and the rest stays on the balance.
          </p>

          {row.notes && <p className="card p-3 text-[12px] text-ink-2">{row.notes}</p>}
        </div>
      )}
      formFields={forms.employeeDeductionFields}
      formTitle="deduction"
      formDefaults={{ ...forms.employeeDeductionDefaults, startsOn: new Date().toISOString().slice(0, 10) }}
      columns={[
        c.primary('employee', 'Employee', (row) => `${row.employeeNo} · ${row.type}`),
        c.text('reference', 'Reference'),
        c.money('amountPerCutoff', 'Per cut-off'),
        c.money('collected', 'Collected'),
        c.money('outstanding', 'Outstanding', { bold: true }),
        c.status(),
      ]}
    />
  )
}

function Types() {
  const c = cols<DeductionType>()

  return (
    <ResourcePage<DeductionType>
      title="Deduction types"
      description="What may be deducted, and the order it is collected in when a cut-off will not cover everything."
      endpoint="hr/deduction-types"
      loader={() => []}
      exportName="deduction-types"
      pageSize={25}
      formFields={forms.deductionTypeFields}
      formTitle="deduction type"
      formDefaults={forms.deductionTypeDefaults}
      columns={[
        c.primary('name', 'Type', (row) => row.code),
        c.bool('isLoan', 'Loan'),
        c.number('priority', 'Collects at'),
        c.number('arrangements', 'In use'),
      ]}
    />
  )
}

export function Deductions() {
  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Deductions" description="Loans, advances and recurring deductions." />
        <div className="card">
          <EmptyState
            icon={Wallet}
            title="Deductions need the live API"
            description="Balances are derived from what payroll has actually collected."
          />
        </div>
      </>
    )
  }

  return (
    <TabbedArea
      storageKey="deductions"
      tabs={[
        {
          id: 'arrangements',
          label: 'Employee deductions',
          hint: 'One arrangement per employee per debt, with its running balance.',
          render: () => <Arrangements />,
        },
        {
          id: 'types',
          label: 'Types',
          hint: 'What may be deducted, and what gets collected first.',
          render: () => <Types />,
        },
      ]}
    />
  )
}
