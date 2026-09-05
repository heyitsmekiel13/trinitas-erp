import { Rng, docNo, personName } from './seed'
import type { Employee } from './master'

const YEAR = new Date().getFullYear()

export type AttendanceRow = {
  id: string
  date: string
  employee: string
  employeeCode: string
  department: string
  shift: 'Day 8:00-17:00' | 'Mid 12:00-21:00' | 'Night 21:00-06:00'
  timeIn: string
  timeOut: string
  hoursWorked: number
  overtime: number
  lateMinutes: number
  undertimeMinutes: number
  status: 'Present' | 'Late' | 'Absent' | 'On Leave' | 'Rest Day' | 'Holiday'
  /* Added by the punch clock. Absent from the preview dataset, which predates
     self-service time keeping. */
  breakMinutes?: number
  source?: 'Biometric' | 'Manual' | 'Import' | 'Self Service'
}

export function buildAttendance(rng: Rng, employees: Employee[], days = 14): AttendanceRow[] {
  const rows: AttendanceRow[] = []
  const roster = employees.filter((e) => e.status !== 'Resigned').slice(0, 60)
  let n = 1

  for (let d = 0; d < days; d++) {
    const date = new Date()
    date.setDate(date.getDate() - d)
    const isWeekend = date.getDay() === 0 || date.getDay() === 6

    for (const e of roster) {
      const status = isWeekend
        ? 'Rest Day'
        : rng.weighted([
            ['Present', 74],
            ['Late', 12],
            ['On Leave', 6],
            ['Absent', 3],
          ] as const)

      const lateMinutes = status === 'Late' ? rng.int(5, 95) : 0
      const worked = status === 'Present' || status === 'Late'
      const overtime = worked && rng.bool(0.22) ? Number(rng.float(0.5, 4).toFixed(1)) : 0
      const inHour = 8 + Math.floor(lateMinutes / 60)
      const inMinute = lateMinutes % 60

      rows.push({
        id: `att-${n++}`,
        date: date.toISOString(),
        employee: e.name,
        employeeCode: e.code,
        department: e.department,
        shift: rng.weighted([
          ['Day 8:00-17:00', 8],
          ['Mid 12:00-21:00', 2],
          ['Night 21:00-06:00', 1],
        ] as const),
        timeIn: worked ? `${String(inHour).padStart(2, '0')}:${String(inMinute).padStart(2, '0')}` : '—',
        timeOut: worked ? `${String(17 + Math.floor(overtime)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}` : '—',
        hoursWorked: worked ? Number((8 - lateMinutes / 60 + overtime).toFixed(2)) : 0,
        overtime,
        lateMinutes,
        undertimeMinutes: worked && rng.bool(0.08) ? rng.int(10, 60) : 0,
        status,
      })
    }
  }
  return rows
}

export type LeaveRequest = {
  id: string
  no: string
  employee: string
  department: string
  type: 'Vacation' | 'Sick' | 'Emergency' | 'Maternity' | 'Paternity' | 'Bereavement' | 'Unpaid'
  from: string
  to: string
  days: number
  balanceBefore: number
  /** What the balance became once the request was decided. */
  balanceAfter?: number
  reason: string
  approver: string
  filed: string
  status: 'Draft' | 'For Approval' | 'Approved' | 'Rejected' | 'Cancelled'
}

export function buildLeaves(rng: Rng, employees: Employee[], count = 92): LeaveRequest[] {
  return Array.from({ length: count }, (_, i) => {
    const e = rng.pick(employees)
    const from = rng.daysAhead(-60, 60)
    const days = rng.weighted([
      [1, 6],
      [2, 3],
      [3, 2],
      [5, 2],
      [10, 1],
    ] as const)
    return {
      id: `lv-${i + 1}`,
      no: docNo('LV', YEAR, i + 1),
      employee: e.name,
      department: e.department,
      type: rng.weighted([
        ['Vacation', 6],
        ['Sick', 5],
        ['Emergency', 2],
        ['Maternity', 1],
        ['Paternity', 1],
        ['Bereavement', 1],
        ['Unpaid', 1],
      ] as const),
      from: from.toISOString(),
      to: new Date(from.getTime() + (days - 1) * 86_400_000).toISOString(),
      days,
      balanceBefore: e.leaveBalance,
      reason: rng.pick(['Family matters', 'Medical consultation', 'Personal errand', 'Out of town', 'Child care', 'Recovery from illness']),
      approver: e.manager,
      filed: rng.daysAgo(1, 60).toISOString(),
      status: rng.weighted([
        ['Approved', 8],
        ['For Approval', 4],
        ['Rejected', 1],
        ['Cancelled', 1],
      ] as const),
    }
  })
}

export type PayrollRun = {
  id: string
  no: string
  period: string
  cutoff: string
  releaseDate: string
  headcount: number
  grossPay: number
  deductions: number
  statutory: number
  netPay: number
  preparedBy: string
  status: 'Draft' | 'For Review' | 'Approved' | 'Released' | 'Posted'
}

export function buildPayrollRuns(rng: Rng, employees: Employee[], preparers: string[], count = 12): PayrollRun[] {
  const active = employees.filter((e) => e.status !== 'Resigned')
  const baseGross = active.reduce((s, e) => s + e.monthlyRate / 2, 0)

  return Array.from({ length: count }, (_, i) => {
    const date = new Date()
    date.setDate(date.getDate() - i * 15)
    const gross = Math.round(baseGross * rng.float(0.96, 1.09))
    const statutory = Math.round(gross * rng.float(0.075, 0.095))
    const deductions = statutory + Math.round(gross * rng.float(0.03, 0.07))
    const half = date.getDate() > 15 ? '16-30' : '1-15'

    return {
      id: `pay-${i + 1}`,
      no: docNo('PR', YEAR, count - i, 3),
      period: `${date.toLocaleString('en-PH', { month: 'long' })} ${half}, ${date.getFullYear()}`,
      cutoff: date.toISOString(),
      releaseDate: new Date(date.getTime() + 3 * 86_400_000).toISOString(),
      headcount: active.length - rng.int(0, 4),
      grossPay: gross,
      deductions,
      statutory,
      netPay: gross - deductions,
      preparedBy: rng.pick(preparers),
      status: i === 0 ? 'For Review' : i === 1 ? 'Approved' : 'Posted',
    }
  })
}

export type Applicant = {
  id: string
  code: string
  name: string
  position: string
  department: string
  source: 'Referral' | 'Job Board' | 'Walk-in' | 'Agency' | 'Social Media' | 'University'
  applied: string
  stage: 'Applied' | 'Screening' | 'Interview' | 'Assessment' | 'Final Interview' | 'Offer' | 'Hired' | 'Rejected'
  rating: number
  expectedSalary: number
  recruiter: string
}

export const RECRUITMENT_STAGES = ['Applied', 'Screening', 'Interview', 'Assessment', 'Final Interview', 'Offer', 'Hired', 'Rejected'] as const

export function buildApplicants(rng: Rng, recruiters: string[], count = 78): Applicant[] {
  const openings: [string, string][] = [
    ['Account Executive', 'Sales & Marketing'],
    ['Warehouse Clerk', 'Warehouse'],
    ['Forklift Operator', 'Warehouse'],
    ['Buyer', 'Procurement'],
    ['Maintenance Technician', 'Maintenance'],
    ['AR Specialist', 'Finance & Accounting'],
    ['HR Assistant', 'Human Resources'],
    ['Delivery Driver', 'Warehouse'],
    ['Inventory Analyst', 'Warehouse'],
  ]
  return Array.from({ length: count }, (_, i) => {
    const [position, department] = rng.pick(openings)
    return {
      id: `app-${i + 1}`,
      code: docNo('APP', YEAR, i + 1),
      name: personName(rng),
      position,
      department,
      source: rng.pick(['Referral', 'Job Board', 'Walk-in', 'Agency', 'Social Media', 'University'] as const),
      applied: rng.daysAgo(1, 90).toISOString(),
      stage: rng.weighted([
        ['Applied', 6],
        ['Screening', 4],
        ['Interview', 3],
        ['Assessment', 2],
        ['Final Interview', 2],
        ['Offer', 1],
        ['Hired', 2],
        ['Rejected', 4],
      ] as const),
      rating: Number(rng.float(2, 5).toFixed(1)),
      expectedSalary: Math.round(rng.gaussian(29_000, 12_000, 15_000, 92_000) / 500) * 500,
      recruiter: rng.pick(recruiters),
    }
  })
}

export type PerformanceReview = {
  id: string
  employee: string
  department: string
  position: string
  period: string
  reviewer: string
  score: number
  rating: 'Outstanding' | 'Exceeds Expectations' | 'Meets Expectations' | 'Needs Improvement' | 'Unsatisfactory'
  dueDate: string
  status: 'Not Started' | 'Self-Assessment' | 'Manager Review' | 'Calibration' | 'Completed'
}

export function buildReviews(rng: Rng, employees: Employee[], count = 84): PerformanceReview[] {
  return rng.sample(employees, Math.min(count, employees.length)).map((e, i) => {
    const score = Number(rng.gaussian(3.6, 0.72, 1.4, 5).toFixed(2))
    return {
      id: `rev-${i + 1}`,
      employee: e.name,
      department: e.department,
      position: e.position,
      period: `${YEAR} — ${rng.pick(['H1', 'H2', 'Q1', 'Q2'])}`,
      reviewer: e.manager,
      score,
      rating:
        score >= 4.5 ? 'Outstanding' : score >= 3.9 ? 'Exceeds Expectations' : score >= 3 ? 'Meets Expectations' : score >= 2.2 ? 'Needs Improvement' : 'Unsatisfactory',
      dueDate: rng.daysAhead(-25, 55).toISOString(),
      status: rng.weighted([
        ['Completed', 5],
        ['Manager Review', 3],
        ['Self-Assessment', 3],
        ['Calibration', 2],
        ['Not Started', 2],
      ] as const),
    }
  })
}

export type TrainingRecord = {
  id: string
  course: string
  type: 'Safety' | 'Technical' | 'Compliance' | 'Leadership' | 'Systems' | 'Certification'
  employee: string
  department: string
  provider: string
  completedOn: string | null
  expiresOn: string | null
  score: number | null
  status: 'Enrolled' | 'In Progress' | 'Completed' | 'Expired' | 'Expiring Soon'
}

export function buildTraining(rng: Rng, employees: Employee[], count = 96): TrainingRecord[] {
  const courses: [string, TrainingRecord['type']][] = [
    ['Forklift Operator Certification', 'Certification'],
    ['Basic Occupational Safety & Health', 'Safety'],
    ['Fire Safety & Evacuation Drill', 'Safety'],
    ['Data Privacy Act Compliance', 'Compliance'],
    ['Defensive Driving', 'Certification'],
    ['ERP Systems Fundamentals', 'Systems'],
    ['Supervisory Leadership Program', 'Leadership'],
    ['Cold Chain Handling', 'Technical'],
    ['Anti-Sexual Harassment Orientation', 'Compliance'],
    ['First Aid & CPR', 'Certification'],
  ]
  return Array.from({ length: count }, (_, i) => {
    const [course, type] = rng.pick(courses)
    const e = rng.pick(employees)
    const status = rng.weighted([
      ['Completed', 8],
      ['In Progress', 3],
      ['Enrolled', 3],
      ['Expired', 1],
      ['Expiring Soon', 2],
    ] as const)
    const done = status === 'Completed' || status === 'Expired' || status === 'Expiring Soon'
    const expires = status === 'Expired' ? rng.daysAhead(-220, -5) : status === 'Expiring Soon' ? rng.daysAhead(5, 55) : rng.daysAhead(90, 900)

    return {
      id: `trn-${i + 1}`,
      course,
      type,
      employee: e.name,
      department: e.department,
      provider: rng.pick(['TESDA Accredited Center', 'In-house Training Team', 'DOLE Partner', 'Safety Org PH', 'Vendor-led Session']),
      completedOn: done ? rng.daysAgo(20, 700).toISOString() : null,
      expiresOn: done ? expires.toISOString() : null,
      score: done ? rng.int(72, 100) : null,
      status,
    }
  })
}

export type EmployeeCase = {
  id: string
  no: string
  employee: string
  department: string
  type: 'Tardiness' | 'Absence Without Leave' | 'Policy Violation' | 'Safety Incident' | 'Performance' | 'Grievance'
  reported: string
  severity: 'Minor' | 'Moderate' | 'Major' | 'Grave'
  action: 'Verbal Warning' | 'Written Warning' | 'Final Warning' | 'Suspension' | 'Coaching' | 'Under Review'
  handler: string
  status: 'Open' | 'Notice Issued' | 'Hearing Scheduled' | 'Resolved' | 'Closed'
  /* Infraction monitoring. Points drive the escalation ladder; `raisedBy` says
     whether the attendance scan or a person opened the case. */
  points?: number
  raisedBy?: 'Attendance scan' | 'Reported'
  acknowledged?: 'Acknowledged' | 'Not acknowledged'
}

export function buildCases(rng: Rng, employees: Employee[], handlers: string[], count = 34): EmployeeCase[] {
  return Array.from({ length: count }, (_, i) => {
    const e = rng.pick(employees)
    return {
      id: `case-${i + 1}`,
      no: docNo('ER', YEAR, i + 1, 3),
      employee: e.name,
      department: e.department,
      type: rng.pick(['Tardiness', 'Absence Without Leave', 'Policy Violation', 'Safety Incident', 'Performance', 'Grievance'] as const),
      reported: rng.daysAgo(2, 180).toISOString(),
      severity: rng.weighted([
        ['Minor', 5],
        ['Moderate', 4],
        ['Major', 2],
        ['Grave', 1],
      ] as const),
      action: rng.pick(['Verbal Warning', 'Written Warning', 'Final Warning', 'Suspension', 'Coaching', 'Under Review'] as const),
      handler: rng.pick(handlers),
      status: rng.weighted([
        ['Resolved', 5],
        ['Closed', 3],
        ['Notice Issued', 2],
        ['Hearing Scheduled', 2],
        ['Open', 2],
      ] as const),
    }
  })
}

export type OrgPosition = {
  id: string
  title: string
  department: string
  reportsTo: string
  approved: number
  filled: number
  vacant: number
  level: 'Executive' | 'Management' | 'Supervisory' | 'Rank & File'
  status: 'Fully Staffed' | 'Hiring' | 'Over-staffed'
}

export function buildPositions(employees: Employee[]): OrgPosition[] {
  const byTitle = new Map<string, Employee[]>()
  for (const e of employees) {
    if (e.status === 'Resigned') continue
    const key = `${e.department}|${e.position}`
    byTitle.set(key, [...(byTitle.get(key) ?? []), e])
  }

  return [...byTitle.entries()].map(([key, staff], i) => {
    const [department, title] = key.split('|') as [string, string]
    const filled = staff.length
    // Approved headcount runs slightly ahead of filled for most roles.
    const approved = filled + (i % 4 === 0 ? 0 : i % 3 === 0 ? 2 : 1)
    const level: OrgPosition['level'] = /Chief/.test(title)
      ? 'Executive'
      : /Manager|Director|Comptroller/.test(title)
        ? 'Management'
        : /Supervisor|Coordinator/.test(title)
          ? 'Supervisory'
          : 'Rank & File'

    return {
      id: `pos-${i + 1}`,
      title,
      department,
      reportsTo: staff[0]!.manager,
      approved,
      filled,
      vacant: Math.max(0, approved - filled),
      level,
      status: approved > filled ? 'Hiring' : approved === filled ? 'Fully Staffed' : 'Over-staffed',
    }
  })
}
