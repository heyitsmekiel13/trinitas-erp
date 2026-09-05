import * as React from 'react'
import { CalendarPlus } from 'lucide-react'
import { useToast } from '@/components/ui/feedback'
import { Button } from '@/components/ui/primitives'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { generatePayrollPeriods } from '@/lib/adminApi'
import { invalidateResource } from '@/lib/api'
import type { FormField } from '@/components/data/RecordForm'

/**
 * The two reference tables payroll is built on.
 *
 * Both existed in the database and neither could be maintained from the app.
 * Cut-offs could be bulk-generated for a year and never afterwards corrected —
 * so a pay date that landed on a holiday stayed wrong. Payroll groups were
 * read-only altogether, which meant the only groups that could ever exist were
 * the ones the seeder happened to create: a business opening a second branch,
 * or moving its drivers onto a weekly cycle, had nowhere to say so.
 *
 * Deleting either is guarded on the server rather than here, because a rule
 * enforced only in the browser is not a rule. The messages that come back name
 * what is in the way — "3 employees assigned", not "constraint violation".
 */

/* -------------------------------------------------------------------------- */
/* Cut-offs                                                                   */
/* -------------------------------------------------------------------------- */

type PayrollPeriod = {
  id: number
  code: string
  label: string
  year: number
  month: number
  half: number
  periodStart: string
  periodEnd: string
  payDate: string
  status: string
  runs: number
}

/**
 * The status list is the database's enum, not a friendlier subset.
 *
 * The previous rules offered "Locked", which the column has never accepted —
 * saving it produced a 500 from the driver rather than a message anybody could
 * act on.
 */
const PERIOD_STATUSES = ['Open', 'Processing', 'For Approval', 'Approved', 'Released', 'Closed']

export const periodFields: FormField[] = [
  {
    name: 'code',
    label: 'Code',
    required: true,
    hint: 'How the cut-off is referred to everywhere else. The generator uses 2026-07-2.',
    placeholder: '2026-07-2',
  },
  {
    name: 'label',
    label: 'Shown as',
    required: true,
    hint: 'What a person reads on a payslip.',
    placeholder: '16–31 Jul 2026',
  },
  { name: 'year', label: 'Year', type: 'number', required: true, min: 2000, max: 2100, section: 'The period' },
  { name: 'month', label: 'Month', type: 'number', required: true, min: 1, max: 12, section: 'The period' },
  {
    name: 'half',
    label: 'Half',
    type: 'select',
    required: true,
    section: 'The period',
    hint: 'Which half of the month this covers.',
    options: [
      { value: 1, label: 'First — 1st to 15th' },
      { value: 2, label: 'Second — 16th to month end' },
    ],
  },
  { name: 'periodStart', label: 'Covers from', type: 'date', required: true, section: 'The period' },
  { name: 'periodEnd', label: 'Covers to', type: 'date', required: true, section: 'The period' },
  {
    name: 'payDate',
    label: 'Paid on',
    type: 'date',
    required: true,
    section: 'The period',
    hint: 'Must be on or after the last day covered.',
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    section: 'The period',
    options: PERIOD_STATUSES.map((s) => ({ value: s, label: s })),
  },
]

export function PayrollPeriods() {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const c = cols<PayrollPeriod>()

  const generate = async () => {
    setBusy(true)
    try {
      const r = await generatePayrollPeriods(new Date().getFullYear())
      toast({
        tone: 'success',
        title: r.created ? `${r.created} cut-offs created for ${r.year}` : `${r.year} is already set up`,
        description: r.created
          ? 'The 1st–15th and 16th–end pattern, twice a month. Correct any individual one from the list.'
          : 'Nothing was duplicated — the generator leaves existing cut-offs alone.',
      })
      invalidateResource('hr/payroll-periods')
    } catch (err) {
      toast({ tone: 'error', title: 'Could not generate.', description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResourcePage<PayrollPeriod>
      title="Cut-offs"
      description="The semi-monthly periods payroll is run against. Generate a whole year in one go, then correct the individual ones a holiday moves."
      endpoint="hr/payroll-periods"
      loader={() => []}
      exportName="payroll-cut-offs"
      searchPlaceholder="Search a code or a month…"
      pageSize={24}
      formFields={periodFields}
      formTitle="cut-off"
      formDefaults={{ status: 'Open', year: new Date().getFullYear(), half: 1 }}
      createLabel="New cut-off"
      actions={
        <Button variant="ghost" onClick={() => void generate()} disabled={busy}>
          <CalendarPlus className="size-4" />
          Generate this year
        </Button>
      }
      filters={[{ columnId: 'status', label: 'Status', options: PERIOD_STATUSES }]}
      columns={[
        c.primary('label', 'Cut-off', (row) => row.code),
        c.date('periodStart', 'From'),
        c.date('periodEnd', 'To'),
        c.date('payDate', 'Paid on'),
        c.number('runs', 'Runs'),
        c.status('status', 'Status'),
      ]}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Payroll groups                                                             */
/* -------------------------------------------------------------------------- */

type PayrollGroup = {
  id: number
  code: string
  name: string
  frequency: string
  statutorySchedule: string
  isConfidential: boolean
  isActive: boolean
  headcount: number
}

/**
 * Frequency is stored as a single letter and shown as a word.
 *
 * The column is an enum of S/M/W/MM. Offering the words while sending the
 * letters is the only arrangement where both the person and the database get
 * what they expect.
 */
const FREQUENCIES = [
  { value: 'S', label: 'Semi-monthly — twice a month' },
  { value: 'M', label: 'Monthly' },
  { value: 'W', label: 'Weekly' },
  { value: 'MM', label: 'Bi-monthly' },
]

const FREQUENCY_WORD: Record<string, string> = {
  S: 'Semi-monthly',
  M: 'Monthly',
  W: 'Weekly',
  MM: 'Bi-monthly',
}

export const payrollGroupFields: FormField[] = [
  {
    name: 'code',
    label: 'Code',
    required: true,
    hint: 'Short, and used on the masterfile import.',
    placeholder: 'RANK-GS',
  },
  { name: 'name', label: 'Name', required: true, placeholder: 'Rank and file — General Santos' },
  {
    name: 'frequency',
    label: 'Paid',
    type: 'select',
    required: true,
    options: FREQUENCIES,
  },
  {
    name: 'statutorySchedule',
    label: 'Statutory deductions taken',
    type: 'select',
    required: true,
    hint: 'SSS, PhilHealth and Pag-IBIG are monthly. This decides which cut-off carries them.',
    options: [
      { value: 'second', label: 'On the second cut-off' },
      { value: 'first', label: 'On the first cut-off' },
      { value: 'split', label: 'Split across both' },
    ],
  },
  {
    name: 'isConfidential',
    label: 'Confidential',
    type: 'switch',
    hint: 'Keeps the group off the shared registers. For payrolls only the officers should see.',
  },
  {
    name: 'isActive',
    label: 'Active',
    type: 'switch',
    hint: 'An inactive group keeps its history but is not offered when starting a run.',
  },
]

export function PayrollGroups() {
  const c = cols<PayrollGroup>()

  return (
    <ResourcePage<PayrollGroup>
      title="Payroll groups"
      description="Who is paid together and how often. A run is always one group over one cut-off, so this is the list that decides what a payroll can be run for."
      endpoint="hr/payroll-groups"
      loader={() => []}
      exportName="payroll-groups"
      searchPlaceholder="Search a group…"
      formFields={payrollGroupFields}
      formTitle="payroll group"
      formDefaults={{ frequency: 'S', statutorySchedule: 'second', isActive: true, isConfidential: false }}
      createLabel="New group"
      columns={[
        c.primary('name', 'Group', (row) => row.code),
        {
          id: 'frequency',
          header: 'Paid',
          accessorFn: (row: PayrollGroup) => FREQUENCY_WORD[row.frequency] ?? row.frequency,
          cell: ({ getValue }) => <span className="text-[13px] text-ink-2">{String(getValue())}</span>,
        },
        c.number('headcount', 'Employees'),
        c.bool('isActive', 'Active'),
        c.bool('isConfidential', 'Confidential'),
      ]}
    />
  )
}
