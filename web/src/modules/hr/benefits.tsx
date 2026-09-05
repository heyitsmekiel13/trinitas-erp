import { HeartHandshake, Landmark, ShieldCheck, Wallet } from 'lucide-react'
import { liveApi } from '@/lib/adminApi'
import { money, num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { EmptyState } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * Pay bands and the benefits catalog.
 *
 * A salary band is a range a position's pay is judged against — it never
 * touches `employees.salary` itself, so setting one has no side effect on
 * anyone's pay. A benefit plan is company-paid and outside payroll entirely
 * (see the migration's docblock): an HMO premium is a cost of employing
 * someone, not a payslip line.
 */

type SalaryBand = {
  id: number
  positionId: number
  position: string
  minMonthly: number
  midMonthly: number
  maxMonthly: number
  currency: string
  notes: string | null
}

type BenefitPlan = {
  id: number
  code: string
  name: string
  type: string
  provider: string | null
  description: string | null
  employerCost: number
  employeeCost: number
  active: boolean
  enrolled: number
}

type Enrollment = {
  id: number
  employeeId: number
  employee: string
  employeeNo: string
  department: string | null
  benefitPlanId: number
  plan: string
  planType: string
  enrolledOn: string
  endedOn: string | null
  dependents: number
  status: string
  notes: string | null
}

function SalaryBands() {
  const c = cols<SalaryBand>()
  return (
    <ResourcePage<SalaryBand>
      title="Salary Bands"
      description="The monthly range each position's pay is judged against — set once, checked against as offers and adjustments happen."
      endpoint="hr/salary-bands"
      loader={() => []}
      exportName="salary-bands"
      createLabel="New band"
      formFields={forms.salaryBandFields}
      formDefaults={forms.salaryBandDefaults}
      formTitle="salary band"
      detailTitle={(row) => row.position}
      detailSubtitle={(row) => `${money(row.minMonthly)} – ${money(row.maxMonthly)} monthly`}
      columns={[
        c.primary('position', 'Position'),
        c.money('minMonthly', 'Minimum'),
        c.money('midMonthly', 'Midpoint'),
        c.money('maxMonthly', 'Maximum'),
        c.text('notes', 'Notes', { secondary: true }),
      ]}
    />
  )
}

function BenefitPlans() {
  const c = cols<BenefitPlan>()
  return (
    <ResourcePage<BenefitPlan>
      title="Benefits Catalog"
      description="What the company offers — an HMO line, life insurance, an allowance — and what enrolling one employee costs."
      endpoint="hr/benefit-plans"
      loader={() => []}
      exportName="benefit-plans"
      createLabel="New plan"
      formFields={forms.benefitPlanFields}
      formDefaults={forms.benefitPlanDefaults}
      formTitle="benefit plan"
      filters={[{ columnId: 'type', label: 'Type' }]}
      stats={(list) => (
        <StatGrid>
          <StatTile label="Plans" value={num(list.length)} icon={HeartHandshake} />
          <StatTile label="Active" value={num(list.filter((p) => p.active).length)} icon={ShieldCheck} />
          <StatTile label="Total enrolled" value={num(list.reduce((s, p) => s + p.enrolled, 0))} icon={Wallet} />
          <StatTile
            label="Monthly cost if fully enrolled"
            value={money(list.reduce((s, p) => s + p.employerCost * p.enrolled, 0))}
            icon={Landmark}
            hint="Employer share × current enrollment"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.type}${row.provider ? ` · ${row.provider}` : ''}`}
      columns={[
        c.primary('name', 'Plan', (row) => row.provider ?? ''),
        c.tag('type', 'Type', 'info'),
        c.money('employerCost', 'Employer cost'),
        c.money('employeeCost', 'Employee cost'),
        c.number('enrolled', 'Enrolled'),
        c.bool('active', 'Active', { yes: 'Active', no: 'Inactive', falseTone: 'neutral' }),
      ]}
    />
  )
}

function Enrollments() {
  const c = cols<Enrollment>()
  return (
    <ResourcePage<Enrollment>
      title="Enrollments"
      description="Who is enrolled in what, and since when."
      endpoint="hr/employee-benefits"
      loader={() => []}
      exportName="benefit-enrollments"
      createLabel="Enrol employee"
      formFields={forms.employeeBenefitFields}
      formDefaults={forms.employeeBenefitDefaults}
      formTitle="enrollment"
      filters={[
        { columnId: 'plan', label: 'Plan' },
        { columnId: 'department', label: 'Department' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => row.plan}
      columns={[
        c.primary('employee', 'Employee', (row) => row.employeeNo ?? ''),
        c.text('department', 'Department', { secondary: true }),
        c.text('plan', 'Plan'),
        c.date('enrolledOn', 'Enrolled'),
        c.date('endedOn', 'Ended', { secondary: true }),
        c.number('dependents', 'Dependents', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

export function CompensationAndBenefits() {
  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Compensation & Benefits" description="Salary bands, the benefits catalog and who is enrolled." />
        <div className="card">
          <EmptyState icon={HeartHandshake} title="Needs the live API" description="Bands and benefits are read and written on the server." />
        </div>
      </>
    )
  }

  return (
    <TabbedArea
      storageKey="compensation-benefits"
      tabs={[
        {
          id: 'bands',
          label: 'Salary Bands',
          hint: 'The monthly range each position is expected to pay.',
          render: () => <SalaryBands />,
        },
        {
          id: 'catalog',
          label: 'Benefits Catalog',
          hint: 'What the company offers, and what each plan costs.',
          render: () => <BenefitPlans />,
        },
        {
          id: 'enrollments',
          label: 'Enrollments',
          hint: 'Who is enrolled in what.',
          render: () => <Enrollments />,
        },
      ]}
    />
  )
}
