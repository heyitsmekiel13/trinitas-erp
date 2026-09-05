import {
  AlertTriangle,
  ArrowLeftRight,
  Activity,
  Award,
  Banknote,
  Barcode,
  Bell,
  BookOpen,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Car,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Contact,
  CreditCard,
  DatabaseBackup,
  DoorOpen,
  ShieldAlert,
  Sparkles,
  FileSignature,
  FileText,
  Fuel,
  Gauge,
  Goal,
  Gavel,
  Headset,
  GitBranch,
  GraduationCap,
  HandCoins,
  HardHat,
  History,
  IdCard,
  Landmark,
  LayoutDashboard,
  KanbanSquare,
  Layers,
  LifeBuoy,
  ListChecks,
  MapPinned,
  Megaphone,
  Network,
  MessagesSquare,
  Package,
  PackageCheck,
  Percent,
  PieChart,
  Receipt,
  Repeat,
  RotateCcw,
  Radar,
  Rows3,
  ScrollText,
  Settings,
  ShieldCheck,
  Shield,
  ShoppingCart,
  Star,
  Tag,
  Target,
  Timer,
  Truck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export type ModuleDef = {
  /** Route segment appended to the department path. */
  id: string
  label: string
  icon: LucideIcon
  /** Shown in the command palette and module landing grid. */
  blurb: string
  /** Marks the department's own analytics page. */
  kind?: 'dashboard'
}

export type DepartmentDef = {
  id: string
  label: string
  short: string
  icon: LucideIcon
  blurb: string
  /** Chart series slot (1-8) used for this department across the app. */
  slot: number
  modules: ModuleDef[]
}

/**
 * The ERP module map.
 *
 * Scoped for a distribution / trading business: goods are bought, stored,
 * and resold. Every module below exists because a real department process
 * needs it — not because it padded the list.
 */
export const DEPARTMENTS: DepartmentDef[] = [
  {
    id: 'sales',
    label: 'Sales & Marketing',
    short: 'Sales',
    icon: Target,
    slot: 1,
    blurb: 'Demand generation through to order fulfilment and commissions.',
    modules: [
      { id: '', label: 'Sales Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Revenue, pipeline health, target attainment.' },
      { id: 'customers', label: 'Customers', icon: Contact, blurb: 'Accounts, contacts, credit limits and terms.' },
      { id: 'pipeline', label: 'Leads & Pipeline', icon: GitBranch, blurb: 'Opportunity stages from lead to closed-won.' },
      { id: 'quotations', label: 'Quotations', icon: FileText, blurb: 'Priced offers with validity and approval routing.' },
      { id: 'orders', label: 'Sales Orders', icon: ShoppingCart, blurb: 'Confirmed orders, allocation and fulfilment status.' },
      { id: 'deliveries', label: 'Deliveries', icon: Truck, blurb: 'Dispatch schedule and proof of delivery.' },
      { id: 'returns', label: 'Returns (RMA)', icon: RotateCcw, blurb: 'Customer returns, credit notes and restocking.' },
      { id: 'pricing', label: 'Price Lists & Discounts', icon: Tag, blurb: 'Tiered pricing, promos and margin guardrails.' },
      { id: 'campaigns', label: 'Marketing Campaigns', icon: Megaphone, blurb: 'Campaign spend, reach and attributed revenue.' },
      { id: 'targets', label: 'Targets & Commissions', icon: Award, blurb: 'Quota tracking and payable commission runs.' },
    ],
  },
  {
    id: 'procurement',
    label: 'Procurement',
    short: 'Procurement',
    icon: ClipboardList,
    slot: 2,
    blurb: 'Sourcing, purchasing and supplier governance.',
    modules: [
      { id: '', label: 'Procurement Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Spend, cycle time, savings and supplier risk.' },
      { id: 'suppliers', label: 'Suppliers', icon: Building2, blurb: 'Vendor master, accreditation and payment terms.' },
      { id: 'requisitions', label: 'Purchase Requisitions', icon: ClipboardCheck, blurb: 'Internal requests with budget check and approval.' },
      { id: 'rfq', label: 'RFQ & Bid Analysis', icon: Layers, blurb: 'Quote solicitation and side-by-side bid comparison.' },
      { id: 'bids', label: 'Supplier Bids', icon: Gavel, blurb: 'Every quote received, ready to compare and award.' },
      { id: 'orders', label: 'Purchase Orders', icon: FileText, blurb: 'Committed POs, amendments and delivery schedule.' },
      { id: 'receipts', label: 'Goods Receipts', icon: Package, blurb: 'Receiving against PO with quantity and QC checks.' },
      { id: 'invoices', label: 'Supplier Invoices', icon: Receipt, blurb: 'Three-way match: PO, receipt and invoice.' },
      { id: 'contracts', label: 'Contracts', icon: FileSignature, blurb: 'Framework agreements, renewals and expiry alerts.' },
      { id: 'performance', label: 'Supplier Scorecards', icon: Star, blurb: 'On-time, in-full, quality and price competitiveness.' },
    ],
  },
  {
    id: 'warehouse',
    label: 'Warehouse',
    short: 'Warehouse',
    icon: Warehouse,
    slot: 3,
    blurb: 'Inventory accuracy, storage and movement of goods.',
    modules: [
      { id: '', label: 'Warehouse Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'OTIF, stock value, count accuracy and throughput.' },
      { id: 'items', label: 'Item Master', icon: Boxes, blurb: 'Structured SKUs, UoM, barcodes, costing and shelf life.' },
      { id: 'stock', label: 'Stock on Hand', icon: Package, blurb: 'Live balances by warehouse, bin, batch and expiry.' },
      { id: 'receiving', label: 'Inbound & Receiving', icon: PackageCheck, blurb: 'Dock entries with condition checks, witnesses and placement.' },
      { id: 'inbound', label: 'Expected Arrivals', icon: ClipboardCheck, blurb: 'Announced shipments still to reach the dock.' },
      { id: 'dispatch', label: 'Pick, Pack & Dispatch', icon: Truck, blurb: 'The dispatch board — one card, one next step, OTIF tracked.' },
      { id: 'outbound', label: 'Pick Lists', icon: ClipboardList, blurb: 'Released pick lists and their line-level progress.' },
      { id: 'transfers', label: 'Stock Transfers', icon: ArrowLeftRight, blurb: 'Inter-warehouse and inter-bin movements in transit.' },
      { id: 'counts', label: 'Cycle Counts & Adjustments', icon: CalendarCheck, blurb: 'The 10th and 25th count sheet, cross-checked against the system.' },
      { id: 'count-history', label: 'Count History', icon: History, blurb: 'Posted counts, their variances and the write-offs taken.' },
      { id: 'replenishment', label: 'Replenishment', icon: Repeat, blurb: 'Reorder points, coverage days and suggested buys.' },
      { id: 'locations', label: 'Warehouses', icon: Building2, blurb: 'Sites, capacity and the default despatch origin.' },
      { id: 'bins', label: 'Bins', icon: Boxes, blurb: 'Zone, aisle and bin locations inside each site.' },
      { id: 'labels', label: 'Barcodes & Labels', icon: Barcode, blurb: 'Label templates and print queue for SKUs and bins.' },
      { id: 'incidents', label: 'Safety Incidents', icon: ShieldAlert, blurb: 'Near-misses and incidents by hazard, severity and what was done.' },
      { id: 'kaizen', label: '5S & Kaizen', icon: Sparkles, blurb: 'Improvement suggestions and 5S audits, scored per zone.' },
      { id: 'docks', label: 'Dock Schedule', icon: CalendarClock, blurb: 'Booked dock appointments — what is expected, where and when.' },
    ],
  },
  {
    id: 'after-sales',
    label: 'After-Sales Service',
    short: 'After-Sales',
    icon: Headset,
    slot: 6,
    blurb: 'Repair requests, technician reports and what the service business earns.',
    modules: [
      { id: '', label: 'After-Sales Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Service revenue, the cost of getting there, technician load.' },
      { id: 'requests', label: 'Service Requests', icon: ClipboardList, blurb: 'Client repair requests, triaged by priority and equipment.' },
      { id: 'schedule', label: 'Service Schedule', icon: CalendarClock, blurb: 'A week of visits per technician, with travel time protected.' },
      { id: 'reports', label: 'Technician Reports', icon: FileSignature, blurb: 'The TSR pad as a form — findings, scope, parts and charges.' },
      { id: 'revenue', label: 'Revenue Report', icon: Receipt, blurb: 'What each job earned against what it cost to attend.' },
      { id: 'contracts', label: 'Service Agreements', icon: Repeat, blurb: 'Planned maintenance cover, renewals and recurring revenue.' },
      { id: 'availability', label: 'Availability & Roster', icon: UserCog, blurb: 'Working hours, days away and who may be booked.' },
    ],
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    short: 'Maintenance',
    icon: Wrench,
    slot: 4,
    blurb: 'Asset uptime for the fleet, facility and handling equipment.',
    modules: [
      { id: '', label: 'Maintenance Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Uptime, MTTR, PM compliance and cost per asset.' },
      { id: 'assets', label: 'Asset Register', icon: Gauge, blurb: 'Vehicles, forklifts, racking, HVAC and gensets.' },
      { id: 'work-orders', label: 'Work Orders', icon: Wrench, blurb: 'Corrective jobs with labour, parts and downtime.' },
      { id: 'preventive', label: 'Preventive Schedules', icon: CalendarDays, blurb: 'Time and meter based plans with auto-generated jobs.' },
      { id: 'fleet', label: 'Fleet & Vehicles', icon: Car, blurb: 'Trips, mileage, registration and roadworthiness.' },
      { id: 'fuel', label: 'Fuel & Consumption', icon: Fuel, blurb: 'Fuel issuance, efficiency and anomaly detection.' },
      { id: 'fuel-approvals-log', label: 'Fuel Approvals Log', icon: ClipboardCheck, blurb: 'Every decided trip request — who approved it, and when.' },
      { id: 'spare-parts', label: 'Spare Parts', icon: Boxes, blurb: 'Critical spares stock, linked to warehouse balances.' },
      { id: 'technicians', label: 'Technicians', icon: HardHat, blurb: 'Skills, availability and job assignment board.' },
      { id: 'downtime', label: 'Breakdown & Downtime', icon: AlertTriangle, blurb: 'Failure log, root cause and repeat-offender analysis.' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Accounting',
    short: 'Finance',
    icon: Landmark,
    slot: 7,
    blurb: 'The single book of record for every transaction in the ERP.',
    modules: [
      { id: '', label: 'Finance Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Cash position, margin, receivables and payables.' },
      { id: 'coa', label: 'Chart of Accounts', icon: BookOpen, blurb: 'Account tree, types and posting rules.' },
      { id: 'journals', label: 'Journal Entries', icon: ScrollText, blurb: 'Manual and system-generated postings to the ledger.' },
      { id: 'receivables', label: 'Accounts Receivable', icon: Banknote, blurb: 'Customer invoices, ageing and collection follow-up.' },
      { id: 'receipts', label: 'Customer Receipts', icon: Receipt, blurb: 'Money in, and which invoices each receipt settled.' },
      { id: 'payables', label: 'Accounts Payable', icon: CreditCard, blurb: 'Supplier bills, payment runs and cash forecast.' },
      { id: 'payments', label: 'Supplier Payments', icon: HandCoins, blurb: 'Money out, allocated across the bills it cleared.' },
      { id: 'banking', label: 'Banking & Cash', icon: Wallet, blurb: 'Bank accounts, transfers and reconciliation.' },
      { id: 'bank-transactions', label: 'Statement Lines', icon: ScrollText, blurb: 'Every bank movement, with what has been reconciled.' },
      { id: 'expenses', label: 'Expenses & Petty Cash', icon: Coins, blurb: 'Claims, liquidation and revolving fund control.' },
      { id: 'reimbursements', label: 'Reimbursement Claims', icon: Banknote, blurb: 'An employee’s own money, paid back — mileage, travel, meals.' },
      { id: 'fixed-assets', label: 'Fixed Assets', icon: Building2, blurb: 'Capitalisation, depreciation runs and disposal.' },
      { id: 'tax', label: 'Tax Management', icon: Percent, blurb: 'VAT, withholding and statutory filing schedules.' },
      { id: 'budgets', label: 'Budgets vs Actuals', icon: Target, blurb: 'Departmental budgets with variance and commitments.' },
      { id: 'statements', label: 'Financial Statements', icon: PieChart, blurb: 'P&L, balance sheet and cash flow by period.' },
    ],
  },
  {
    id: 'hr',
    label: 'Human Resources',
    short: 'HR',
    icon: Users,
    slot: 5,
    blurb: 'The people record from hiring through payroll and development.',
    modules: [
      { id: '', label: 'HR Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'Headcount, attendance, discipline and hiring on live figures.' },
      { id: 'employees', label: 'Employees', icon: Contact, blurb: 'The 201 file in AUB masterfile format, with import and export.' },
      { id: 'id-cards', label: 'ID Cards', icon: IdCard, blurb: 'Printable badges with a QR code anyone can scan to verify employment.' },
      { id: 'documents', label: '201 Files & Documents', icon: ListChecks, blurb: 'The actual paperwork behind the 201 file — checklist, uploads and verification.' },
      { id: 'org', label: 'Org & Positions', icon: GitBranch, blurb: 'Structure, reporting lines and approved plantilla.' },
      { id: 'timekeeping', label: 'Time & Attendance', icon: History, blurb: 'Shifts, the daily log, per-employee DTRs and punch integrity.' },
      { id: 'leave', label: 'Leave Management', icon: CalendarDays, blurb: 'Balances, filing, approval and leave calendar.' },
      { id: 'payroll', label: 'Payroll', icon: HandCoins, blurb: 'Semi-monthly runs, statutory contributions, deductions and the AUB bank file.' },
      { id: 'payslips', label: 'Payslips', icon: Receipt, blurb: 'Per-employee computation of earnings, deductions and net pay.' },
      { id: 'statutory-reports', label: 'Statutory Reports', icon: Landmark, blurb: 'Amounts due, and per-employee SSS, PhilHealth, Pag-IBIG, 13th month pay and BIR 2316 filing schedules.' },
      { id: 'compensation-benefits', label: 'Compensation & Benefits', icon: HandCoins, blurb: 'Salary bands per position, the benefits catalog, and who is enrolled.' },
      { id: 'talent-succession', label: 'Talent & Succession', icon: GraduationCap, blurb: 'The competency matrix, and a 9-box read of who is ready for what.' },
      { id: 'recruitment', label: 'Recruitment', icon: UserPlus, blurb: 'The careers site, manpower requests, the applicant pipeline and hiring.' },
      { id: 'training', label: 'Training & Certifications', icon: GraduationCap, blurb: 'Run a session, mark the room, issue and track certificates.' },
      { id: 'cases', label: 'Employee Relations', icon: Gavel, blurb: 'Incidents, DOLE due process, and the infraction watchlist.' },
      { id: 'offboarding', label: 'Offboarding', icon: DoorOpen, blurb: 'Clearance, property turnover and final pay for every separation.' },
      { id: 'wage-orders', label: 'Wage Orders', icon: Landmark, blurb: 'DOLE regional wage orders, and the minimum-wage earners they raise automatically.' },
      { id: 'announcements', label: 'Announcements & Events', icon: Megaphone, blurb: 'Company notices, plus birthdays, hire anniversaries and holidays coming up.' },
    ],
  },
  {
    /*
     * Process & Performance.
     *
     * Two audiences behind one department, which is unusual here and
     * deliberate. The project management screens are the company's work tool
     * and every employee reaches them — through this department if they have
     * access to it, and through /tasks if they do not. The compliance screens
     * belong to this office alone: they hold assessments of the people using
     * the tool, and the API answers 404 to anybody else who asks for them.
     */
    id: 'process',
    label: 'Process & Performance',
    short: 'Process',
    icon: Radar,
    slot: 8,
    blurb: 'Project delivery for the whole company, and the office that checks it lands on time.',
    modules: [
      { id: '', label: 'Delivery Dashboard', icon: LayoutDashboard, kind: 'dashboard', blurb: 'On-time rate, overdue ageing and the projects carrying risk.' },
      { id: 'projects', label: 'Projects', icon: Layers, blurb: 'Every project, its progress and what is running late inside it.' },
      { id: 'board', label: 'Work Board', icon: KanbanSquare, blurb: 'Kanban, list, timeline and calendar over the same tasks.' },
      { id: 'all-tasks', label: 'All Tasks', icon: Rows3, blurb: 'Every open task across every project, filterable in one list.' },
      { id: 'my-tasks', label: 'My Tasks', icon: ListChecks, blurb: 'Your own queue, bucketed by how urgent it is.' },
      { id: 'workload', label: 'Workload', icon: Timer, blurb: 'Who is carrying what, capacity and who is carrying too much.' },
      { id: 'goals', label: 'Goals', icon: Target, blurb: 'The outcomes the projects are pursuing.' },
      { id: 'metrics', label: 'Flow & Throughput', icon: Activity, blurb: 'Cycle time, capacity and where work piles up. Office only.' },
      { id: 'compliance', label: 'Compliance Register', icon: ShieldCheck, blurb: 'Observations on late, stalled and undated work. Office only.' },
      { id: 'evaluations', label: 'Evaluations', icon: ClipboardCheck, blurb: 'Verdicts on delivered work, performance review cycles, and the scorecards behind both. Office only.' },
      { id: 'automations', label: 'Rules & Reminders', icon: Goal, blurb: 'What the system chases, when it escalates, and to whom.' },
    ],
  },
]

/** Cross-cutting administration — every serious ERP needs these to be usable. */
export const ADMIN_MODULES: ModuleDef[] = [
  { id: 'users', label: 'Users & Roles', icon: UserCog, blurb: 'Accounts, role assignment and permission matrix.' },
  { id: 'approvals', label: 'Approval Workflows', icon: ClipboardCheck, blurb: 'Thresholds and routing for every document type.' },
  { id: 'fuel-approvers', label: 'Fuel Approvers', icon: Fuel, blurb: 'Who may approve a fuel or trip request.' },
  { id: 'organization', label: 'Company & Branches', icon: Building2, blurb: 'Legal entity, branches, warehouses and cost centres.' },
  { id: 'tickets', label: 'Support Desk', icon: LifeBuoy, blurb: 'Concerns raised by staff, and what was done about them.' },
  { id: 'audit', label: 'Audit Trail', icon: Shield, blurb: 'Immutable log of who changed what, and when.' },
  { id: 'login-activity', label: 'Login Activity', icon: MapPinned, blurb: 'Every sign-in, its IP address, and the device’s own reported location.' },
  { id: 'department-access', label: 'Department Access', icon: Network, blurb: 'Which business departments each org-chart department may see.' },
  { id: 'notification-rules', label: 'Notification Rules', icon: Bell, blurb: 'Which roles hear about which automated event, by email.' },
  { id: 'impersonate', label: 'Log In As', icon: UserCog, blurb: 'See the application exactly as one real person sees it.' },
  { id: 'operations', label: 'Operating Rules', icon: Gauge, blurb: 'Numbering series, fiscal calendar and posting guardrails.' },
  { id: 'backup', label: 'Backup & Restore', icon: DatabaseBackup, blurb: 'Snapshot the database, restore one, or clear test data.' },
  { id: 'settings', label: 'System Settings', icon: Settings, blurb: 'Company identity, email, security and Geo-IP.' },
]

export const DEPARTMENT_BY_ID = Object.fromEntries(DEPARTMENTS.map((d) => [d.id, d])) as Record<string, DepartmentDef>

/** Absolute route for a department module. */
export function modulePath(deptId: string, moduleId: string) {
  return moduleId ? `/${deptId}/${moduleId}` : `/${deptId}`
}

export type FlatModule = {
  path: string
  label: string
  icon: LucideIcon
  blurb: string
  department: string
  departmentId: string
}

/** Flattened list powering the command palette and global search. */
export const ALL_MODULES: FlatModule[] = [
  {
    path: '/',
    label: 'Command Center',
    icon: LayoutDashboard,
    blurb: 'Company-wide executive overview across all departments.',
    department: 'Executive',
    departmentId: 'executive',
  },
  {
    path: '/messages',
    label: 'Messages',
    icon: MessagesSquare,
    blurb: 'Direct messages, group chats and a room for every department.',
    department: 'Workspace',
    departmentId: 'messages',
  },
  ...DEPARTMENTS.flatMap((d) =>
    d.modules.map((m) => ({
      path: modulePath(d.id, m.id),
      label: m.label,
      icon: m.icon,
      blurb: m.blurb,
      department: d.label,
      departmentId: d.id,
    })),
  ),
  ...ADMIN_MODULES.map((m) => ({
    path: `/admin/${m.id}`,
    label: m.label,
    icon: m.icon,
    blurb: m.blurb,
    department: 'Administration',
    departmentId: 'admin',
  })),
]
