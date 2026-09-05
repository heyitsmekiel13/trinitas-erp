import * as React from 'react'
import { Award, CalendarDays, GraduationCap, Scale } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { num } from '@/lib/format'
import type {
  AttendanceRow,
  EmployeeCase,
  LeaveRequest,
  OrgPosition,
  TrainingRecord,
} from '@/data/hr'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { AutoDetail, ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { DueProcessPanel } from './dueProcess'
import { TrainingSessions } from './training'
import { DtrSummary } from './dtr'
import { Dashboard } from './dashboard'
import { RecruitmentBoard } from './recruitment'
import { JobPostings } from './jobPostings'
import * as forms from './forms'
import * as actions from './actions'
import { Infractions } from './infractions'
import { Shifts } from './shifts'
import { PunchIntegrityPage } from './punchIntegrity'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { Masterfile } from './payroll'
import { PayrollRuns } from './payrollRuns'
import { PayrollGroups, PayrollPeriods } from './payrollSetup'
import { Payslips } from './payslips'
import { Deductions } from './deductions'
import { DocumentsChecklist } from './documents'
import { OffboardingBoard } from './offboardingBoard'
import { WageOrders } from './wageOrders'
import { IdCards } from './idCards'
import { OrgChart } from './orgChart'
import { StatutoryReports } from './statutoryReports'
import { CompensationAndBenefits } from './benefits'
import { TalentAndSuccession } from './talent'
import { PayrollDisputes } from './payrollDisputes'
import { PendingOvertimeRequests } from './overtimeRequests'
import { AnnouncementsAndEvents } from './announcements'

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

/** The org chart alongside the plantilla table it is drawn from. */
function OrgAndPositions() {
  return (
    <TabbedArea
      storageKey="org"
      tabs={[
        {
          id: 'chart',
          label: 'Org Chart',
          hint: 'Who reports to whom, built from the same reporting line the masterfile carries.',
          render: () => <OrgChart />,
        },
        {
          id: 'positions',
          label: 'Positions',
          hint: 'Approved plantilla by position, with filled and vacant counts driving recruitment.',
          render: () => <Positions />,
        },
      ]}
    />
  )
}

function Positions() {
  const c = cols<OrgPosition>()
  return (
    <ResourcePage
      title="Org & Positions"
      description="Approved plantilla by position, with filled and vacant counts driving recruitment."
      endpoint="hr/positions"
      loader={() => dataset().positions}
      exportName="positions"
      createLabel="New position"
      pageSize={25}
      filters={[
        // No Department filter: the hr/positions endpoint's map returns only
        // id/title/level, so department is never populated from the API.
        { columnId: 'level', label: 'Level' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.title}
      detailSubtitle={(row) => row.department}
      columns={[
        c.primary('title', 'Position', (row) => row.department),
        c.tag('level', 'Level', 'info'),
        c.text('reportsTo', 'Reports to', { secondary: true }),
        c.number('approved', 'Approved'),
        c.number('filled', 'Filled'),
        c.number('vacant', 'Vacant'),
        c.level('status', 'Status', { 'Fully Staffed': 'good', Hiring: 'warning', 'Over-staffed': 'serious' }),
      ]}
    />
  )
}

function Attendance() {
  const c = cols<AttendanceRow>()
  return (
    <ResourcePage
      title="Attendance & Time"
      description="Daily time records from the punch clock. Hours, lateness, undertime and overtime are all derived from the four presses — none of them is typed."
      endpoint="hr/attendance"
      loader={() => dataset().attendance}
      exportName="attendance"
      createLabel="Record entry"
      formFields={forms.attendanceFields}
      formDefaults={forms.attendanceDefaults}
      formTitle="attendance record"
      actions={<actions.ScanInfractions />}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'department', label: 'Department' },
        { columnId: 'shift', label: 'Shift' },
        { columnId: 'source', label: 'Source' },
      ]}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => new Date(row.date).toLocaleDateString('en-PH')}
      columns={[
        c.primary('employee', 'Employee', (row) => `${row.employeeCode} · ${row.department}`),
        c.date('date', 'Date'),
        c.text('department', 'Department', { secondary: true }),
        c.text('shift', 'Shift', { secondary: true }),
        c.text('timeIn', 'Time in'),
        c.text('timeOut', 'Time out'),
        c.number('breakMinutes', 'Break (min)', { secondary: true }),
        c.number('hoursWorked', 'Hours', { decimals: 2 }),
        c.number('overtime', 'Overtime', { decimals: 1 }),
        c.number('lateMinutes', 'Late (min)'),
        c.number('undertimeMinutes', 'Undertime (min)', { secondary: true }),
        c.tag('source', 'Source', 'neutral'),
        c.level('status', 'Status', {
          Present: 'good',
          Late: 'warning',
          Absent: 'critical',
          'On Leave': 'info',
          'Rest Day': 'neutral',
          Holiday: 'neutral',
        }),
      ]}
    />
  )
}

function Leave() {
  const c = cols<LeaveRequest>()
  return (
    <ResourcePage
      title="Leave Management"
      description="Leave filings with balance checks. Approving is what takes the days off the balance — filing alone does not."
      endpoint="hr/leaves"
      loader={() => dataset().leaves}
      exportName="leave-requests"
      createLabel="File leave"
      formFields={forms.leaveFields}
      formDefaults={forms.leaveDefaults}
      formTitle="leave request"
      detailActions={(row, done) => <actions.DecideLeave row={row} done={done} />}
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'type', label: 'Leave type' },
        { columnId: 'department', label: 'Department' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.employee} · ${row.type}`}
      columns={[
        c.primary('no', 'Request', (row) => row.employee),
        c.text('department', 'Department', { secondary: true }),
        c.tag('type', 'Type', 'info'),
        c.date('from', 'From'),
        c.date('to', 'To'),
        c.number('days', 'Days'),
        c.number('balanceBefore', 'Balance before', { secondary: true, suffix: ' d' }),
        c.number('balanceAfter', 'Balance after', { secondary: true, suffix: ' d' }),
        c.text('approver', 'Approver', { secondary: true }),
        c.date('filed', 'Filed', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Certifications() {
  const c = cols<TrainingRecord>()
  return (
    <ResourcePage
      title="Training & Certifications"
      description="Course completion and the certifications that must stay current for people to keep working."
      endpoint="hr/training"
      loader={() => dataset().training}
      exportName="training-records"
      createLabel="Enrol employee"
      pageSize={25}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'type', label: 'Type' },
        { columnId: 'department', label: 'Department' },
      ]}
      detailTitle={(row) => row.course}
      detailSubtitle={(row) => row.employee}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Records" value={num(rows.length)} icon={GraduationCap} />
          <StatTile label="Completed" value={num(rows.filter((r) => r.status === 'Completed').length)} icon={Award} />
          <StatTile
            label="Expiring soon"
            value={num(rows.filter((r) => r.status === 'Expiring Soon').length)}
            icon={CalendarDays}
            hint="Renew within 60 days"
          />
          <StatTile label="Expired" value={num(rows.filter((r) => r.status === 'Expired').length)} icon={Scale} />
        </StatGrid>
      )}
      columns={[
        c.primary('course', 'Course', (row) => row.employee),
        c.tag('type', 'Type', 'info'),
        c.text('department', 'Department', { secondary: true }),
        c.text('provider', 'Provider', { secondary: true }),
        c.date('completedOn', 'Completed'),
        c.date('expiresOn', 'Expires', { overdueWhenPast: true }),
        c.number('score', 'Score', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Cases() {
  const c = cols<EmployeeCase>()
  return (
    <ResourcePage
      title="Employee Relations"
      description="Incidents and disciplinary matters. Severity and the action taken follow from the points an employee has accumulated, so the same history produces the same outcome for everybody."
      endpoint="hr/cases"
      loader={() => dataset().cases}
      exportName="employee-cases"
      createLabel="Log case"
      formFields={forms.caseFields}
      formDefaults={forms.caseDefaults}
      formTitle="case"
      actions={<actions.ScanInfractions />}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'type', label: 'Type' },
        { columnId: 'severity', label: 'Severity' },
        { columnId: 'raisedBy', label: 'Raised by' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.employee} · ${row.type}`}
      detailSize="xl"
      // The record of the offence sits above; the record of the process that
      // was followed sits below it, because one is worthless without the other.
      renderDetail={(row) => (
        <div className="space-y-5">
          <AutoDetail row={row} />
          <div className="border-t border-line pt-4">
            <DueProcessPanel caseId={Number(row.id)} />
          </div>
        </div>
      )}
      columns={[
        c.primary('no', 'Case', (row) => row.employee),
        c.text('department', 'Department', { secondary: true }),
        c.text('type', 'Type'),
        c.date('reported', 'Reported'),
        c.level('severity', 'Severity', { Minor: 'neutral', Moderate: 'warning', Major: 'serious', Grave: 'critical' }),
        c.text('action', 'Action taken'),
        c.number('points', 'Points'),
        c.tag('raisedBy', 'Raised by', 'neutral'),
        c.level('acknowledged', 'Notice', { Acknowledged: 'good', 'Not acknowledged': 'warning' }),
        c.text('handler', 'Handled by', { secondary: true }),
        c.level('status', 'Status', {
          Resolved: 'good',
          Closed: 'neutral',
          'Notice Issued': 'warning',
          'Hearing Scheduled': 'warning',
          Open: 'critical',
        }),
      ]}
    />
  )
}

/* ========================================================================== */
/* Merged areas                                                               */
/* ========================================================================== */

/**
 * Everything about time, in one place.
 *
 * The daily log, the per-employee DTR and the integrity report all read the
 * same punches; the shift is what every one of those readings is measured
 * against, which is what earns it a tab here rather than a menu item of its
 * own — five views of one subject instead of two adjacent ones.
 */
function Timekeeping() {
  return (
    <TabbedArea
      storageKey="timekeeping"
      tabs={[
        {
          id: 'shifts',
          label: 'Shifts & Schedules',
          hint: 'Start and end times every punch is measured against.',
          render: () => <Shifts />,
        },
        {
          id: 'log',
          label: 'Daily Log',
          hint: 'Every punch as recorded, across the whole workforce.',
          render: () => <Attendance />,
        },
        {
          id: 'dtr',
          label: 'DTR Summary',
          hint: 'One employee over one cut-off — the printable record.',
          render: () => <DtrSummary />,
        },
        {
          id: 'integrity',
          label: 'Punch Integrity',
          hint: 'Time records that look like somebody else pressed the button.',
          render: () => <PunchIntegrityPage />,
        },
        {
          id: 'overtime',
          label: 'Overtime Pre-Approval',
          hint: 'Requests filed before or during a shift, awaiting a decision.',
          render: () => <PendingOvertimeRequests />,
        },
      ]}
    />
  )
}

/**
 * Discipline. The watchlist is a scoreboard over the same case records, so it
 * is a view here rather than a destination of its own.
 */
function EmployeeRelations() {
  return (
    <TabbedArea
      storageKey="relations"
      tabs={[
        {
          id: 'cases',
          label: 'Cases',
          hint: 'Incidents and the due-process trail each one has to follow.',
          render: () => <Cases />,
        },
        {
          id: 'watchlist',
          label: 'Watchlist',
          hint: 'Who is accumulating points, and what their record warrants.',
          render: () => <Infractions />,
        },
      ]}
    />
  )
}

/**
 * Recruitment, with the adverts that feed it.
 *
 * The pipeline and the job postings are the inside and the outside of the same
 * process — a posting exists to put people into the pipeline, and the pipeline
 * is where you find out whether the posting was any good. Two menu items for
 * that would send a recruiter back to the sidebar every time they wanted to
 * know why nobody is applying.
 */
function Recruitment() {
  return (
    <TabbedArea
      storageKey="recruitment"
      tabs={[
        {
          id: 'pipeline',
          label: 'Pipeline',
          hint: 'Applicants against approved vacancies, moved a stage at a time and hired into the masterfile.',
          render: () => <RecruitmentBoard />,
        },
        {
          id: 'postings',
          label: 'Job Postings',
          hint: 'The adverts on the careers site. Publishing one is what lets the public apply.',
          render: () => <JobPostings />,
        },
      ]}
    />
  )
}

/** A session is what issues a certificate; the two belong together. */
function TrainingAndCertifications() {
  return (
    <TabbedArea
      storageKey="training"
      tabs={[
        {
          id: 'sessions',
          label: 'Sessions',
          hint: 'Schedule a run, mark who attended, issue the certificates.',
          render: () => <TrainingSessions />,
        },
        {
          id: 'certificates',
          label: 'Certificates',
          hint: 'Who holds what, and which licences are about to lapse.',
          render: () => <Certifications />,
        },
      ]}
    />
  )
}

/**
 * Payroll, with the two tables it stands on.
 *
 * The runs screen was the whole of payroll, and it could only ever run against
 * cut-offs and groups that already existed. Cut-offs could be bulk-generated
 * and never corrected; groups could not be created at all. Both are now
 * maintainable here rather than being a database job — one destination, three
 * views, in the order somebody sets payroll up.
 */
function Payroll() {
  return (
    <TabbedArea
      storageKey="payroll"
      tabs={[
        {
          id: 'runs',
          label: 'Runs',
          hint: 'Compute a group over a cut-off, review the register, approve it, release it.',
          render: () => <PayrollRuns />,
        },
        {
          id: 'cutoffs',
          label: 'Cut-offs',
          hint: 'The periods payroll is run against, and the date each one is paid.',
          render: () => <PayrollPeriods />,
        },
        {
          id: 'groups',
          label: 'Groups',
          hint: 'Who is paid together, how often, and which cut-off carries the statutory deductions.',
          render: () => <PayrollGroups />,
        },
        {
          id: 'disputes',
          label: 'Disputes',
          hint: 'Payroll complaints, HR\'s response, and any retro or deduction they resolved to.',
          render: () => <PayrollDisputes />,
        },
        {
          id: 'deductions',
          label: 'Deductions',
          hint: 'Loans, advances and recurring deductions, with running balances.',
          render: () => <Deductions />,
        },
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  employees: Masterfile,
  'id-cards': IdCards,
  documents: DocumentsChecklist,
  org: OrgAndPositions,
  timekeeping: Timekeeping,
  leave: Leave,
  payroll: Payroll,
  payslips: Payslips,
  'statutory-reports': StatutoryReports,
  'compensation-benefits': CompensationAndBenefits,
  'talent-succession': TalentAndSuccession,
  recruitment: Recruitment,
  training: TrainingAndCertifications,
  cases: EmployeeRelations,
  offboarding: OffboardingBoard,
  'wage-orders': WageOrders,
  announcements: AnnouncementsAndEvents,
}
