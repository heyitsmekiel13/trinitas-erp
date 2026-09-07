import type { FormField } from '@/components/data/RecordForm'

/**
 * Form definitions for Human Resources.
 *
 * Nothing here asks for a figure the clock or the ledger already knows. There
 * is no field for hours worked, late minutes, a leave balance or an infraction's
 * severity — each of those is derived from punches, approvals or accumulated
 * points, and offering them as inputs is how a timesheet stops matching the
 * clock behind it.
 */

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

const EMPLOYEES = { endpoint: 'hr/employees', label: 'fullName', sublabel: 'employeeNo' } as const
const DEPARTMENTS = { endpoint: 'hr/departments', label: 'name', sublabel: 'code' } as const

/* -------------------------------------------------------------------------- */

/**
 * The 201 file.
 *
 * Long, so it is grouped: who they are, where they sit, what the government
 * needs, what they are paid, and how to reach them. Nothing here is a figure
 * the system derives — daily rate and monthly equivalent come from the salary
 * and the payroll calendar, so neither is asked for.
 */
export const employeeFields: FormField[] = [
  {
    name: 'employeeNo',
    label: 'Employee number',
    required: true,
    placeholder: 'UNI1450',
    hint: 'Their sign-in name is the digits from this — UNI1450 signs in as 1450.',
  },
  { name: 'firstName', label: 'First name', required: true },
  { name: 'middleName', label: 'Middle name' },
  { name: 'lastName', label: 'Last name', required: true },
  { name: 'suffix', label: 'Suffix', placeholder: 'Jr.' },
  { name: 'birthDate', label: 'Birth date', type: 'date' },
  {
    name: 'sex',
    label: 'Sex',
    type: 'select',
    options: [
      { value: 'Male', label: 'Male' },
      { value: 'Female', label: 'Female' },
    ],
    hint: 'As it needs to appear on the SSS E-1, PhilHealth PMRF and BIR forms.',
  },
  {
    name: 'civilStatus',
    label: 'Civil status',
    type: 'select',
    required: true,
    options: [
      { value: 'S', label: 'Single' },
      { value: 'M', label: 'Married' },
      { value: 'D', label: 'Divorced / Separated' },
      { value: 'W', label: 'Widowed' },
    ],
  },

  {
    section: 'Placement',
    name: 'businessGroupId',
    label: 'Business group',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'hr/business-groups', label: 'name', sublabel: 'code' },
  },
  {
    section: 'Placement',
    name: 'legalEntityId',
    label: 'Legal entity',
    type: 'select',
    optionsFrom: { endpoint: 'hr/legal-entities', label: 'name' },
    hint: 'Which registered employer files this person\'s SSS/PhilHealth/Pag-IBIG — not the same as their business group. Leave blank until it is confirmed.',
  },
  {
    section: 'Placement',
    name: 'departmentId',
    label: 'Department',
    type: 'select',
    required: true,
    optionsFrom: DEPARTMENTS,
  },
  {
    section: 'Placement',
    name: 'branchUnitId',
    label: 'Branch',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'hr/branch-units', label: 'name', sublabel: 'code' },
  },
  {
    section: 'Placement',
    name: 'positionId',
    label: 'Position',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'hr/positions', label: 'title', sublabel: 'level' },
  },
  { section: 'Placement', name: 'reportsToId', label: 'Reports to', type: 'select', optionsFrom: EMPLOYEES },
  {
    section: 'Placement',
    name: 'shiftId',
    label: 'Shift',
    type: 'select',
    optionsFrom: { endpoint: 'hr/shifts', label: 'name', sublabel: 'window' },
    hint: 'What their punches are measured against. Blank uses the default shift.',
  },
  { section: 'Placement', name: 'level', label: 'Level', type: 'number', min: 1, max: 20 },
  { section: 'Placement', name: 'costCenter', label: 'Cost centre', placeholder: 'CC-120' },
  {
    section: 'Placement',
    name: 'employmentStatus',
    label: 'Employment status',
    type: 'select',
    required: true,
    options: [
      { value: 'PROBATION', label: 'Probationary' },
      { value: 'REGULAR', label: 'Regular' },
      { value: 'RESIGNED', label: 'Resigned' },
      { value: 'TERMINATED', label: 'Terminated' },
    ],
  },
  { section: 'Placement', name: 'dateHired', label: 'Date hired', type: 'date', required: true },
  {
    section: 'Placement',
    name: 'dateSeparated',
    label: 'Date separated',
    type: 'date',
    visibleWhen: (v) => v.employmentStatus === 'RESIGNED' || v.employmentStatus === 'TERMINATED',
  },

  {
    section: 'Statutory',
    name: 'tin',
    label: 'TIN',
    placeholder: '123-456-789-000',
    hint: 'Each exemption is granted by its own agency, which is why they are separate switches.',
  },
  { section: 'Statutory', name: 'taxExempted', label: 'Exempt from withholding tax', type: 'switch' },
  { section: 'Statutory', name: 'sss', label: 'SSS number' },
  { section: 'Statutory', name: 'sssExempted', label: 'Exempt from SSS', type: 'switch' },
  { section: 'Statutory', name: 'phic', label: 'PhilHealth number' },
  { section: 'Statutory', name: 'phicExempted', label: 'Exempt from PhilHealth', type: 'switch' },
  { section: 'Statutory', name: 'pagibig', label: 'Pag-IBIG number' },
  { section: 'Statutory', name: 'pagibigExempted', label: 'Exempt from Pag-IBIG', type: 'switch' },

  {
    section: 'Compensation',
    name: 'perHour',
    label: 'Paid hourly',
    type: 'switch',
    full: true,
    hint: 'Off means the rate below is monthly.',
  },
  {
    section: 'Compensation',
    name: 'salary',
    label: 'Rate',
    type: 'money',
    required: true,
    min: 0,
    hint: 'Daily rate and monthly equivalent are worked out from this — neither is entered.',
  },
  { section: 'Compensation', name: 'minimumWageEarner', label: 'Minimum wage earner', type: 'switch' },
  {
    section: 'Compensation',
    name: 'confidential',
    label: 'Confidential record',
    type: 'switch',
    hint: 'Keeps the pay rate out of general listings.',
  },
  {
    section: 'Compensation',
    name: 'paymentMode',
    label: 'Paid by',
    type: 'select',
    required: true,
    options: [
      { value: 'ATM', label: 'ATM — bank transfer' },
      { value: 'CASH', label: 'Cash' },
      { value: 'CHEQUE', label: 'Cheque' },
    ],
  },
  {
    section: 'Compensation',
    name: 'atmAccount',
    label: 'ATM account',
    placeholder: '001234567890',
    visibleWhen: (v) => v.paymentMode === 'ATM',
    hint: 'Goes into the AUB bank file, so it has to match the bank exactly.',
  },
  {
    section: 'Compensation',
    name: 'bankCode',
    label: 'Bank code',
    placeholder: 'Leave blank for AUB',
    visibleWhen: (v) => v.paymentMode === 'ATM',
    hint: 'Blank means an AUB account, credited same-bank. Set this only for an interbank (PESONet) transfer.',
  },
  {
    section: 'Compensation',
    name: 'allowanceRate',
    label: 'Allowance rate',
    type: 'money',
    min: 0,
    hint: 'A standing allowance, shown on the AUB masterfile. Does not itself change gross or net pay.',
  },

  { section: 'Contact', name: 'emailAddress', label: 'Email', type: 'email' },
  { section: 'Contact', name: 'mobile', label: 'Mobile', type: 'tel', placeholder: '0917 000 0000' },
  { section: 'Contact', name: 'address', label: 'Address', type: 'textarea', full: true },

  { section: 'Emergency Contact', name: 'emergencyContactName', label: 'Name' },
  {
    section: 'Emergency Contact',
    name: 'emergencyContactRelationship',
    label: 'Relationship',
    placeholder: 'Spouse, parent, sibling…',
  },
  {
    section: 'Emergency Contact',
    name: 'emergencyContactPhone',
    label: 'Phone',
    type: 'tel',
    placeholder: '0917 000 0000',
  },
]

export const employeeDefaults = {
  civilStatus: 'S',
  employmentStatus: 'PROBATION',
  paymentMode: 'ATM',
  level: 1,
  salary: 0,
  perHour: false,
  minimumWageEarner: false,
  confidential: false,
  taxExempted: false,
  sssExempted: false,
  phicExempted: false,
  pagibigExempted: false,
  dateHired: today(),
}

/* -------------------------------------------------------------------------- */

export const attendanceFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'date', label: 'Work date', type: 'date', required: true },
  {
    name: 'shiftId',
    label: 'Shift',
    type: 'select',
    optionsFrom: { endpoint: 'hr/shifts', label: 'name', sublabel: 'window' },
    hint: 'What lateness and undertime are measured against.',
  },
  {
    name: 'clockIn',
    label: 'Time in',
    type: 'time-stepper',
    hint: 'Click the arrows to adjust — hours, lateness and overtime are all worked out from these punches.',
  },
  { name: 'breakOut', label: 'Break out', type: 'time-stepper' },
  { name: 'breakIn', label: 'Break in', type: 'time-stepper' },
  { name: 'clockOut', label: 'Time out', type: 'time-stepper' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Present', 'Late', 'Absent', 'On Leave', 'Rest Day', 'Holiday'),
  },
  { name: 'remarks', label: 'Remarks', full: true, placeholder: 'Corrected — biometric device offline' },
]

export const attendanceDefaults = { date: today(), status: 'Present' }

/* -------------------------------------------------------------------------- */

export const leaveFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  {
    name: 'leaveTypeId',
    label: 'Leave type',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'hr/leave-types', label: 'name', sublabel: 'code' },
  },
  { name: 'filedOn', label: 'Filed on', type: 'date', required: true },
  { name: 'startDate', label: 'From', type: 'date', required: true },
  { name: 'endDate', label: 'To', type: 'date', required: true },
  { name: 'days', label: 'Days', type: 'number', required: true, min: 0.5, step: 0.5 },
  { name: 'reason', label: 'Reason', full: true, placeholder: 'Family matter' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'For Approval'),
    hint: 'Approving is a separate action — it is what moves the balance.',
  },
]

export const leaveDefaults = { filedOn: today(), status: 'For Approval', days: 1 }

/* -------------------------------------------------------------------------- */

export const caseFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices(
      'Tardiness',
      'Absence Without Leave',
      'Policy Violation',
      'Safety Incident',
      'Performance',
      'Grievance',
    ),
    hint: 'Decides the points the case carries, and points decide the action.',
  },
  { name: 'reportedOn', label: 'Reported on', type: 'date', required: true },
  { name: 'handledById', label: 'Handled by', type: 'select', optionsFrom: EMPLOYEES },
  { name: 'hearingOn', label: 'Hearing on', type: 'date' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Open', 'Notice Issued', 'Hearing Scheduled', 'Resolved', 'Closed'),
    hint: 'Closed cases stop counting toward the running total.',
  },
  {
    name: 'details',
    label: 'Details',
    type: 'textarea',
    full: true,
    placeholder: 'What happened, when, and who witnessed it.',
  },
]

export const caseDefaults = { reportedOn: today(), status: 'Open', type: 'Policy Violation' }

/* -------------------------------------------------------------------------- */

export const shiftFields: FormField[] = [
  { name: 'name', label: 'Shift name', required: true, placeholder: 'Day 8:00 — 17:00', full: true },
  { name: 'startsAt', label: 'Starts at', type: 'text', required: true, placeholder: '08:00' },
  { name: 'endsAt', label: 'Ends at', type: 'text', required: true, placeholder: '17:00' },
  {
    name: 'breakMinutes',
    label: 'Break (minutes)',
    type: 'number',
    min: 0,
    max: 240,
    hint: 'The unpaid break the shift allows for.',
  },
  {
    name: 'graceMinutes',
    label: 'Grace (minutes)',
    type: 'number',
    min: 0,
    max: 120,
    hint: 'Arrive within this and the day is not late.',
  },
  {
    name: 'isNightShift',
    label: 'Night shift',
    type: 'switch',
    hint: 'Turn on when the shift ends on the following day.',
  },
  { name: 'isActive', label: 'Active', type: 'switch' },
]

export const shiftDefaults = { breakMinutes: 60, graceMinutes: 15, isNightShift: false, isActive: true }

/* -------------------------------------------------------------------------- */

export const positionFields: FormField[] = [
  { name: 'title', label: 'Position title', required: true, placeholder: 'Warehouse Supervisor', full: true },
  { name: 'level', label: 'Level', type: 'number', min: 1, max: 10 },
  { name: 'isManagerial', label: 'Managerial position', type: 'switch' },
  {
    name: 'managementTier',
    label: 'Access tier',
    type: 'select',
    required: true,
    hint: 'What this position can do and see, independent of which department it works in.',
    options: [
      { value: 'rank_and_file', label: 'Rank and file' },
      { value: 'supervisory', label: 'Supervisory' },
      { value: 'top_management', label: 'Top management' },
    ],
  },
]

export const positionDefaults = { level: 1, isManagerial: false, managementTier: 'rank_and_file' }

export const departmentFields: FormField[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'WAREHOUSE' },
  { name: 'name', label: 'Department name', required: true, placeholder: 'Warehouse Operations' },
]

export const departmentDefaults = {}

/* -------------------------------------------------------------------------- */

const POSITIONS = { endpoint: 'hr/positions', label: 'title' } as const
const BENEFIT_PLANS = { endpoint: 'hr/benefit-plans', label: 'name', sublabel: 'type' } as const

export const salaryBandFields: FormField[] = [
  { name: 'positionId', label: 'Position', type: 'select', required: true, optionsFrom: POSITIONS, full: true },
  { name: 'minMonthly', label: 'Minimum (monthly)', type: 'number', required: true, min: 0 },
  { name: 'midMonthly', label: 'Midpoint (monthly)', type: 'number', required: true, min: 0 },
  { name: 'maxMonthly', label: 'Maximum (monthly)', type: 'number', required: true, min: 0 },
  { name: 'notes', label: 'Notes', full: true },
]

export const salaryBandDefaults = { currency: 'PHP' }

export const benefitPlanFields: FormField[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'HMO-STD' },
  { name: 'name', label: 'Plan name', required: true, placeholder: 'Standard HMO', full: true },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('HMO', 'Life Insurance', 'Retirement', 'Allowance', 'Other'),
  },
  { name: 'provider', label: 'Provider', placeholder: 'Maxicare' },
  {
    name: 'employerCost',
    label: 'Employer cost',
    type: 'number',
    min: 0,
    hint: 'Monthly, per enrolled employee. Company-paid — not run through payroll.',
  },
  { name: 'employeeCost', label: 'Employee cost', type: 'number', min: 0, hint: 'Monthly, if the employee shares the premium.' },
  { name: 'description', label: 'Description', type: 'textarea', full: true },
  { name: 'active', label: 'Active', type: 'switch' },
]

export const benefitPlanDefaults = { type: 'HMO', employerCost: 0, employeeCost: 0, active: true }

export const employeeBenefitFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'benefitPlanId', label: 'Plan', type: 'select', required: true, optionsFrom: BENEFIT_PLANS, full: true },
  { name: 'enrolledOn', label: 'Enrolled on', type: 'date', required: true },
  { name: 'endedOn', label: 'Ended on', type: 'date' },
  { name: 'dependents', label: 'Dependents', type: 'number', min: 0, max: 20 },
  { name: 'status', label: 'Status', type: 'select', required: true, options: choices('Active', 'Ended') },
  { name: 'notes', label: 'Notes', full: true },
]

export const employeeBenefitDefaults = { enrolledOn: today(), dependents: 0, status: 'Active' }

/* -------------------------------------------------------------------------- */

const COMPETENCIES = { endpoint: 'hr/competencies', label: 'name', sublabel: 'category' } as const
const LEVELS = [
  { value: '1', label: '1 — Novice' },
  { value: '2', label: '2 — Developing' },
  { value: '3', label: '3 — Proficient' },
  { value: '4', label: '4 — Advanced' },
  { value: '5', label: '5 — Expert' },
]
const RATINGS_1_5 = ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))

export const competencyFields: FormField[] = [
  { name: 'name', label: 'Competency', required: true, placeholder: 'Forklift Operation', full: true },
  { name: 'category', label: 'Category', placeholder: 'Technical, Leadership, Safety…' },
  { name: 'description', label: 'Description', type: 'textarea', full: true },
]

export const competencyDefaults = {}

export const employeeCompetencyFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'competencyId', label: 'Competency', type: 'select', required: true, optionsFrom: COMPETENCIES, full: true },
  { name: 'level', label: 'Level', type: 'select', required: true, options: LEVELS },
  { name: 'assessedOn', label: 'Assessed on', type: 'date', required: true },
  { name: 'notes', label: 'Notes', full: true },
]

export const employeeCompetencyDefaults = { level: '3', assessedOn: today() }

export const successionPlanFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'targetPositionId', label: 'Grooming for', type: 'select', optionsFrom: POSITIONS, full: true, hint: 'Leave blank if this is a general potential rating, not a named successor track.' },
  {
    name: 'performanceRating',
    label: 'Performance',
    type: 'select',
    required: true,
    options: RATINGS_1_5,
    hint: '1 low — 5 high. Align with the latest review score where one exists.',
  },
  { name: 'potentialRating', label: 'Potential', type: 'select', required: true, options: RATINGS_1_5, hint: '1 low — 5 high.' },
  {
    name: 'readiness',
    label: 'Readiness',
    type: 'select',
    required: true,
    options: choices('Ready Now', '1-2 Years', '3-5 Years', 'Not Ready'),
  },
  { name: 'assessedOn', label: 'Assessed on', type: 'date', required: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]

export const successionPlanDefaults = { performanceRating: '3', potentialRating: '3', readiness: '3-5 Years', assessedOn: today() }

/* -------------------------------------------------------------------------- */

export const legalEntityFields: FormField[] = [
  { name: 'name', label: 'Short name', required: true, placeholder: 'TRINITAS', full: true, hint: 'What shows on schedules and selectors — keep it short.' },
  { name: 'legalName', label: 'Registered legal name', placeholder: 'Trinitas Food Corp', full: true },
  { name: 'tin', label: 'TIN' },
  { name: 'sssEmployerNo', label: 'SSS employer no.' },
  { name: 'philhealthEmployerNo', label: 'PhilHealth employer no.' },
  { name: 'pagibigEmployerNo', label: 'Pag-IBIG employer no.' },
  { name: 'pagibigBranchCode', label: 'Pag-IBIG branch code', placeholder: '88 - Davao', hint: 'As it appears on the HDMF branch list, e.g. "88 - Davao".' },
  { name: 'address', label: 'Registered address', full: true },
  { name: 'zipCode', label: 'ZIP code' },
  { name: 'phone', label: 'Telephone' },
  { name: 'active', label: 'Active', type: 'switch' },
]

export const legalEntityDefaults = { active: true }

/* -------------------------------------------------------------------------- */

export const announcementFields: FormField[] = [
  { name: 'title', label: 'Title', required: true, full: true },
  { name: 'body', label: 'Message', type: 'textarea', required: true, full: true },
  {
    name: 'hrDepartmentId',
    label: 'Audience',
    type: 'select',
    optionsFrom: DEPARTMENTS,
    hint: 'Leave blank for everyone. Set a department and only that department sees it in Self-Service.',
  },
  { name: 'pinned', label: 'Pin to top', type: 'switch' },
  { name: 'publishedAt', label: 'Published', type: 'date', required: true, hint: 'Held from view until this date.' },
  { name: 'expiresAt', label: 'Expires', type: 'date', hint: 'Leave blank to show indefinitely.' },
]

export const announcementDefaults = { pinned: false, publishedAt: today() }

export const LEGAL_ENTITIES = { endpoint: 'hr/legal-entities', label: 'name' } as const

export const payrollDisputeFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'payrollPeriodId', label: 'Cut-off', type: 'select', optionsFrom: { endpoint: 'hr/payroll-periods', label: 'label' }, full: true },
  { name: 'complaint', label: 'Complaint', type: 'textarea', required: true, full: true },
  { name: 'hrFeedback', label: 'HR feedback', type: 'textarea', full: true },
  { name: 'liable', label: 'Liable party', placeholder: 'Payroll, Timekeeping, Employee…' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Open', 'Under Review', 'Resolved', 'Applied to Payroll'),
  },
  { name: 'actionPlan', label: 'Action plan / recommendation', type: 'textarea', full: true },
  { name: 'deductAmount', label: 'Amount to deduct from employee', type: 'money', hint: 'An overpayment being recovered.' },
  { name: 'retroAmount', label: 'Retro amount owed to employee', type: 'money', hint: 'Underpayment being made up.' },
  { name: 'raisedOn', label: 'Raised on', type: 'date', required: true },
  { name: 'resolvedOn', label: 'Resolved on', type: 'date' },
]

export const payrollDisputeDefaults = { status: 'Open', raisedOn: today() }

/* -------------------------------------------------------------------------- */

export const reviewFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  { name: 'reviewerId', label: 'Reviewer', type: 'select', optionsFrom: EMPLOYEES },
  { name: 'period', label: 'Period', required: true, placeholder: 'H1 2026' },
  { name: 'dueDate', label: 'Due date', type: 'date', required: true },
  { name: 'score', label: 'Score', type: 'number', min: 0, max: 100, step: 0.1 },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Not Started', 'In Progress', 'For Calibration', 'Completed'),
  },
]

export const reviewDefaults = { status: 'Not Started', score: 0 }

/* -------------------------------------------------------------------------- */

export const applicantFields: FormField[] = [
  { name: 'firstName', label: 'First name', required: true },
  { name: 'lastName', label: 'Last name', required: true },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'phone', label: 'Contact number', type: 'tel' },
  {
    name: 'positionId',
    label: 'Position applied for',
    type: 'select',
    optionsFrom: { endpoint: 'hr/positions', label: 'title', sublabel: 'level' },
    full: true,
  },
  { name: 'appliedOn', label: 'Applied on', type: 'date', required: true },
  {
    name: 'source',
    label: 'Source',
    type: 'select',
    options: choices('Walk-in', 'Referral', 'Job Board', 'Social Media', 'Agency', 'Internal'),
  },
  { name: 'expectedSalary', label: 'Expected salary', type: 'money', min: 0 },
  {
    name: 'stage',
    label: 'Stage',
    type: 'select',
    required: true,
    options: choices('Applied', 'Screening', 'Interview', 'Assessment', 'Offer', 'Hired', 'Rejected', 'Withdrawn'),
  },
  { name: 'rating', label: 'Rating', type: 'number', min: 0, max: 5, step: 0.5 },
]

export const applicantDefaults = { appliedOn: today(), stage: 'Applied', source: 'Walk-in' }

/* -------------------------------------------------------------------------- */

export const holidayFields: FormField[] = [
  { name: 'holidayDate', label: 'Date', type: 'date', required: true },
  { name: 'name', label: 'Holiday', required: true, placeholder: 'Independence Day' },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('Regular', 'Special Non-Working', 'Local'),
  },
  {
    name: 'branchUnitId',
    label: 'Branch',
    type: 'select',
    optionsFrom: { endpoint: 'hr/branch-units', label: 'name', sublabel: 'code' },
    hint: 'Leave blank for a nationwide holiday.',
  },
]

export const holidayDefaults = { type: 'Regular' }

/* -------------------------------------------------------------------------- */

export const leaveTypeFields: FormField[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'VL' },
  { name: 'name', label: 'Name', required: true, placeholder: 'Vacation Leave' },
  {
    name: 'annualCredits',
    label: 'Days per year',
    type: 'number',
    min: 0,
    max: 365,
    hint: 'What each employee is credited at the start of the year.',
  },
  { name: 'isPaid', label: 'Paid', type: 'switch' },
  { name: 'requiresAttachment', label: 'Needs a document', type: 'switch' },
  { name: 'isActive', label: 'Active', type: 'switch' },
]

export const leaveTypeDefaults = { annualCredits: 0, isPaid: true, requiresAttachment: false, isActive: true }

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

export const deductionTypeFields: FormField[] = [
  { name: 'code', label: 'Code', required: true, placeholder: 'COMPANY-LOAN' },
  { name: 'name', label: 'Name', required: true, placeholder: 'Company Loan' },
  {
    name: 'isLoan',
    label: 'Has a principal',
    type: 'switch',
    hint: 'On for a loan that is collected until it is paid off; off for an open-ended deduction.',
  },
  {
    name: 'priority',
    label: 'Collects at',
    type: 'number',
    min: 1,
    max: 999,
    required: true,
    hint: 'Lower collects first when a cut-off will not cover everything owed.',
  },
  { name: 'isActive', label: 'Active', type: 'switch' },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]

export const deductionTypeDefaults = { isLoan: false, priority: 100, isActive: true }

/* -------------------------------------------------------------------------- */

export const employeeDeductionFields: FormField[] = [
  { name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: EMPLOYEES, full: true },
  {
    name: 'typeId',
    label: 'Deduction type',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'hr/deduction-types', label: 'name', sublabel: 'code' },
  },
  { name: 'reference', label: 'Reference', placeholder: 'Loan or voucher number' },
  {
    name: 'principal',
    label: 'Total amount',
    type: 'number',
    min: 0,
    hint: 'The whole debt. Leave empty for an open-ended deduction that runs until it is stopped.',
  },
  {
    name: 'amountPerCutoff',
    label: 'Amount per cut-off',
    type: 'number',
    min: 0.01,
    required: true,
    hint: 'Collected after statutory contributions and tax, and never below zero net pay.',
  },
  { name: 'startsOn', label: 'Starts on', type: 'date', required: true },
  { name: 'endsOn', label: 'Ends on', type: 'date', hint: 'Optional. Leave empty to run until settled or stopped.' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: [
      { value: 'Active', label: 'Active' },
      { value: 'Suspended', label: 'Suspended' },
      { value: 'Cancelled', label: 'Cancelled' },
    ],
  },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]

export const employeeDeductionDefaults = { status: 'Active' }

/* -------------------------------------------------------------------------- */

export const departmentPickers = { EMPLOYEES, DEPARTMENTS }
