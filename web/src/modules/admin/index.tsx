import * as React from 'react'
import { Building2, Check, MapPin, Minus, Shield, ShieldCheck, UserCog } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { Rng } from '@/data/seed'
import { DEPARTMENTS } from '@/app/registry'
import { fmtDateTime, num } from '@/lib/format'
import { useCompany } from '@/lib/company'
import { ResourcePage } from '@/components/data/ResourcePage'
import { SendCredentialsAction, SendCredentialsBulk } from './SendCredentials'
import { AccountLifecycleAction } from './AccountLifecycle'
import type { FormField } from '@/components/data/RecordForm'
import { cols } from '@/components/data/columns'
import { PageHeader, SectionHeading } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, CardHeader, Field, Input, Select, Switch } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import * as api from '@/lib/adminApi'
import { liveApi } from '@/lib/adminApi'
import { SystemSettings } from './settings'
import { BackupRestore } from './backup'
import { DepartmentAccess } from './departmentAccess'
import { NotificationRules } from './notificationRules'
import { Impersonate } from './impersonate'
import { SupportDesk } from '@/modules/support'

/* -------------------------------------------------------------------------- */
/* Users & roles                                                               */
/* -------------------------------------------------------------------------- */

const ROLES = [
  'System Administrator',
  'Executive',
  'Sales Manager',
  'Sales Representative',
  'Procurement Officer',
  'Warehouse Supervisor',
  'Warehouse Staff',
  'Maintenance Planner',
  'Accountant',
  'HR Officer',
  'Read Only',
] as const

type UserRow = {
  id: string
  name: string
  email: string
  role: string
  department: string
  branch: string
  mfa: boolean
  lastLogin: string
  status: string
  deactivateAt?: string | null
}

function buildUsers(): UserRow[] {
  const rng = new Rng(88231)
  return dataset()
    .employees.filter((e) => e.status !== 'Resigned')
    .slice(0, 64)
    .map((e) => {
      const role = /Chief/.test(e.position)
        ? 'Executive'
        : /Manager|Director|Comptroller/.test(e.position)
          ? rng.pick(['Sales Manager', 'Warehouse Supervisor', 'Accountant', 'HR Officer'])
          : e.department === 'Sales & Marketing'
            ? 'Sales Representative'
            : e.department === 'Procurement'
              ? 'Procurement Officer'
              : e.department === 'Warehouse'
                ? 'Warehouse Staff'
                : e.department === 'Maintenance'
                  ? 'Maintenance Planner'
                  : e.department === 'Finance & Accounting'
                    ? 'Accountant'
                    : e.department === 'Human Resources'
                      ? 'HR Officer'
                      : 'Read Only'

      return {
        id: e.id,
        name: e.name,
        email: e.email,
        role,
        department: e.department,
        branch: e.branch,
        mfa: rng.bool(0.62),
        lastLogin: rng.daysAgo(0, 30).toISOString(),
        status: rng.weighted([
          ['Active', 12],
          ['Inactive', 1],
          ['On Hold', 1],
        ] as const),
      }
    })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Which departments each role can reach. The backend enforces the same map. */
const PERMISSION_MATRIX: Record<string, string[]> = {
  'System Administrator': DEPARTMENTS.map((d) => d.id),
  Executive: DEPARTMENTS.map((d) => d.id),
  'Sales Manager': ['sales', 'warehouse', 'finance'],
  'Sales Representative': ['sales'],
  'Procurement Officer': ['procurement', 'warehouse'],
  'Warehouse Supervisor': ['warehouse', 'procurement', 'maintenance'],
  'Warehouse Staff': ['warehouse'],
  'Maintenance Planner': ['maintenance', 'warehouse'],
  Accountant: ['finance', 'sales', 'procurement'],
  'HR Officer': ['hr'],
  'Read Only': [],
}

function Users() {
  const c = cols<UserRow>()
  const users = React.useMemo(buildUsers, [])

  return (
    <div>
      <ResourcePage
        title="Users & Roles"
        description="Who can sign in, what role they hold, and which departments that role opens. Sign-in details are emailed as a temporary password the person must change on first use."
        endpoint="admin/users"
        loader={() => users}
        exportName="users"
        createLabel="Invite user"
        actions={<SendCredentialsBulk />}
        detailActions={(row, done) => (
          <>
            <SendCredentialsAction
              // The preview row carries a string id; the live API a numeric one.
              // The action ignores anything that is not a real database id.
              user={row as unknown as { id?: number; name?: string; email?: string | null }}
              done={done}
            />
            <AccountLifecycleAction
              user={row as unknown as { id?: number; name?: string; status?: string; deactivateAt?: string | null }}
              done={done}
            />
          </>
        )}
        pageSize={15}
        filters={[
          { columnId: 'role', label: 'Role' },
          { columnId: 'department', label: 'Department' },
          { columnId: 'status', label: 'Status' },
        ]}
        detailTitle={(row) => row.name}
        detailSubtitle={(row) =>
          `${row.role} · ${row.email}`
          + (row.status === 'Active' && row.deactivateAt ? ` · deactivates ${row.deactivateAt.slice(0, 10)}` : '')
        }
        stats={(rows) => (
          <StatGrid>
            <StatTile label="User accounts" value={num(rows.length)} icon={UserCog} />
            <StatTile label="Active" value={num(rows.filter((r) => r.status === 'Active').length)} icon={ShieldCheck} />
            <StatTile
              label="Two-factor enabled"
              value={num(rows.filter((r) => r.mfa).length)}
              icon={Shield}
              hint={`${((rows.filter((r) => r.mfa).length / Math.max(1, rows.length)) * 100).toFixed(0)}% of accounts`}
            />
            <StatTile label="Distinct roles" value={num(new Set(rows.map((r) => r.role)).size)} icon={UserCog} />
          </StatGrid>
        )}
        columns={[
          c.primary('name', 'User', (row) => row.email),
          c.tag('role', 'Role', 'brand'),
          c.text('department', 'Department', { secondary: true }),
          c.text('branch', 'Branch', { secondary: true }),
          c.level('mfa', 'Two-factor', { true: 'good', false: 'warning' }),
          c.date('lastLogin', 'Last sign-in'),
          c.status(),
        ]}
      />

      <div className="mt-6">
        <SectionHeading
          title="Permission matrix"
          description="Department access granted by each role. Module-level rights are configured per role in the backend phase."
        />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="sticky left-0 z-10 bg-surface-2 px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                    Role
                  </th>
                  {DEPARTMENTS.map((d) => (
                    <th key={d.id} className="px-3 py-2.5 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      {d.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLES.map((role) => (
                  <tr key={role} className="border-b border-line/60 last:border-0">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2.5 font-medium text-ink">{role}</td>
                    {DEPARTMENTS.map((d) => {
                      const allowed = PERMISSION_MATRIX[role]?.includes(d.id)
                      return (
                        <td key={d.id} className="px-3 py-2.5 text-center">
                          {/* Icon + label, never colour alone. */}
                          {allowed ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--delta-up)]">
                              <Check className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">Allowed</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                              <Minus className="size-3.5" />
                              <span className="sr-only sm:not-sr-only">None</span>
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Approval workflows                                                          */
/* -------------------------------------------------------------------------- */



/** A rule as the API returns it. */
type ApprovalRuleRow = {
  id: number
  documentType: string
  name: string
  minAmount: number
  maxAmount: number | null
  step: number
  approverRole: string | null
  approverUser: string | null
  approver: string
  condition: string
  isActive: boolean
  status: string
}

const DOCUMENT_TYPES = [
  'purchase_requisition',
  'purchase_order',
  'sales_order',
  'stock_transfer',
  'cycle_count',
  'work_order',
  'journal_entry',
  'expense_claim',
  'leave_request',
  'payroll_run',
]

const approvalFields: FormField[] = [
  {
    name: 'documentType',
    label: 'Document',
    type: 'select',
    required: true,
    options: DOCUMENT_TYPES.map((value) => ({
      value,
      label: value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
    })),
    full: true,
  },
  { name: 'name', label: 'Rule name', required: true, placeholder: 'Over 50k needs the finance manager', full: true },
  {
    name: 'step',
    label: 'Step',
    type: 'number',
    required: true,
    min: 1,
    max: 10,
    hint: 'Steps run in order. Two rules on the same step both have to sign.',
  },
  {
    name: 'minAmount',
    label: 'From amount',
    type: 'money',
    min: 0,
    hint: 'The rule applies at or above this figure.',
  },
  {
    name: 'maxAmount',
    label: 'Up to amount',
    type: 'money',
    min: 0,
    hint: 'Leave blank for no ceiling — the top of the chain.',
  },
  {
    name: 'approverRoleId',
    label: 'Approver role',
    type: 'select',
    optionsFrom: { endpoint: 'admin/roles', label: 'name', sublabel: 'code' },
    hint: 'Anybody holding this role may sign. Use this rather than a person where you can.',
  },
  {
    name: 'approverUserId',
    label: 'or a named person',
    type: 'select',
    optionsFrom: { endpoint: 'admin/users', label: 'name', sublabel: 'username' },
  },
  { name: 'isActive', label: 'Active', type: 'switch' },
]

const approvalDefaults = { step: 1, minAmount: 0, isActive: true }

function Approvals() {
  const c = cols<ApprovalRuleRow>()
  return (
    <ResourcePage
      title="Approval Workflows"
      description="Who must sign off on each document, and at what value. Steps run in order; a rule routed to a role can be signed by anyone holding it."
      endpoint="admin/approval-rules"
      loader={() => []}
      exportName="approval-rules"
      createLabel="New rule"
      formFields={approvalFields}
      formDefaults={approvalDefaults}
      formTitle="approval rule"
      pageSize={25}
      filters={[
        { columnId: 'documentType', label: 'Document' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.documentType} · ${row.condition}`}
      columns={[
        c.primary('name', 'Rule', (row) => row.documentType),
        c.tag('documentType', 'Document', 'info'),
        c.number('step', 'Step'),
        c.text('condition', 'Applies when'),
        c.text('approver', 'Approver'),
        c.level('status', 'Status', { Active: 'good', Inactive: 'neutral' }),
      ]}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Fuel approvers                                                              */
/* -------------------------------------------------------------------------- */

type FuelApproverRow = {
  id: number
  userId: number | null
  user: string | null
  roleId: number | null
  role: string | null
  active: boolean
}

const fuelApproverFields: FormField[] = [
  {
    name: 'userId',
    label: 'A named person',
    type: 'select',
    optionsFrom: { endpoint: 'admin/users', label: 'name', sublabel: 'username' },
    hint: 'Approves in their own right, whatever role they hold.',
  },
  {
    name: 'roleId',
    label: 'or a whole role',
    type: 'select',
    optionsFrom: { endpoint: 'admin/roles', label: 'name', sublabel: 'code' },
    hint: 'Anybody holding this role may approve. Use one or the other, not both.',
  },
  { name: 'active', label: 'Active', type: 'switch' },
]

const fuelApproverDefaults = { active: true }

function FuelApprovers() {
  const c = cols<FuelApproverRow>()
  return (
    <ResourcePage
      title="Fuel Approvers"
      description="Who may approve a fuel or trip request — a superadmin can always approve regardless of what's set here."
      endpoint="admin/fuel-approvers"
      loader={() => []}
      exportName="fuel-approvers"
      createLabel="Add an approver"
      formFields={fuelApproverFields}
      formDefaults={fuelApproverDefaults}
      formTitle="fuel approver"
      detailTitle={(row) => row.user ?? row.role ?? 'Approver'}
      detailSubtitle={(row) => (row.user ? 'Named person' : 'Whole role')}
      columns={[
        c.primary('id', 'Approver', (row) => row.user ?? row.role ?? '—'),
        c.text('user', 'Person', { secondary: true }),
        c.text('role', 'Role', { secondary: true }),
        c.bool('active', 'Active'),
      ]}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Company & branches                                                          */
/* -------------------------------------------------------------------------- */

function Organization() {
  const companyProfile = useCompany()
  const sites = React.useMemo(() => dataset().sites, [])
  const employees = React.useMemo(() => dataset().employees, [])

  const costCentres = React.useMemo(
    () =>
      DEPARTMENTS.map((d, i) => ({
        code: `CC-${String(100 + i * 10)}`,
        name: d.label,
        headcount: employees.filter((e) => e.department === d.label && e.status !== 'Resigned').length,
      })),
    [employees],
  )

  return (
    <div>
      <PageHeader
        title="Company & Branches"
        description="The legal entity, its operating sites, and the cost centres every transaction is coded against."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Company profile" subtitle="Used on every printed document and statutory filing" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-line p-4 sm:grid-cols-2 sm:p-5">
            {[
              ['Registered name', companyProfile.legalName],
              ['Trading name', companyProfile.name],
              ['Registered address', companyProfile.address || 'Not set — add it in System Settings'],
              ['Tax identification number', companyProfile.tin || 'Not set'],
              ['Functional currency', companyProfile.currency],
              ['Fiscal year', `${MONTH_NAMES[companyProfile.fiscalYearStart - 1]} onwards`],
              ['Operating sites', `${sites.length} warehouses and hubs`],
              ['Total headcount', `${employees.filter((e) => e.status !== 'Resigned').length} employees`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
                <dd className="mt-1 text-[13px] text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Cost centres" subtitle="Departmental coding for budgets and postings" />
          <div className="divide-y divide-line border-t border-line">
            {costCentres.map((cc) => (
              <div key={cc.code} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="font-mono text-[12px] text-ink-3">{cc.code}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{cc.name}</span>
                <Badge tone="neutral">{cc.headcount} staff</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionHeading title="Operating sites" description="Warehouses, branches and hubs across the network." />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  {['Code', 'Site', 'Type', 'City', 'Region', 'Capacity', 'Bins', 'Manager'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink">{s.code}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{s.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone="info">{s.type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{s.city}</td>
                    <td className="px-4 py-2.5 text-ink-2">{s.region}</td>
                    <td className="num px-4 py-2.5 text-ink-2">{num(s.capacityPallets)} pallets</td>
                    <td className="num px-4 py-2.5 text-ink-2">{num(s.bins)}</td>
                    <td className="px-4 py-2.5 text-ink-2">{s.manager}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Audit trail                                                                 */
/* -------------------------------------------------------------------------- */

type AuditEntry = {
  id: number
  occurred: string
  user: string
  actorType: 'user' | 'console' | 'system'
  action: string
  module: string | null
  entity: string | null
  entityLabel: string | null
  outcome: 'success' | 'denied' | 'failure'
  changes: Record<string, { from: unknown; to: unknown }> | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

const OUTCOME_TONE: Record<string, 'good' | 'critical' | 'warning'> = {
  success: 'good',
  denied: 'critical',
  failure: 'warning',
}

function buildAudit(): AuditEntry[] {
  const rng = new Rng(50521)
  const d = dataset()
  const users = d.employees.filter((e) => e.status !== 'Resigned').map((e) => e.name)
  const actions: [string, string][] = [
    ['created a record', 'created'],
    ['updated a record', 'updated'],
    ['approved a document', 'approvals'],
    ['rejected a document', 'approvals'],
    ['deleted a record', 'deleted'],
    ['posted an entry to the ledger', 'finance'],
    ['exported data to file', 'export'],
    ['signed in', 'auth'],
    ['sign-in failed', 'auth'],
    ['changed a role assignment', 'admin'],
  ]
  const modules = ['sales', 'procurement', 'warehouse', 'maintenance', 'finance', 'hr', 'admin']

  return Array.from({ length: 220 }, (_, i) => {
    const [action, entity] = rng.pick(actions)
    const outcome = rng.weighted([
      ['success', 18],
      ['denied', 1],
      ['failure', 1],
    ] as const)
    return {
      id: i + 1,
      occurred: rng.daysAgo(0, 45).toISOString(),
      user: outcome === 'success' ? rng.pick(users) : 'System',
      actorType: outcome === 'success' ? 'user' : 'system',
      action,
      module: rng.pick(modules),
      entity: entity === 'created' || entity === 'updated' || entity === 'deleted' ? 'Record' : null,
      entityLabel: `${rng.pick(['SO', 'PO', 'GRN', 'JV', 'WO', 'LV', 'INV'])}-${new Date().getFullYear()}-${String(rng.int(1, 999)).padStart(4, '0')}`,
      outcome,
      changes: null,
      ip: `10.${rng.int(0, 20)}.${rng.int(0, 255)}.${rng.int(2, 254)}`,
      userAgent: null,
      requestId: null,
    } satisfies AuditEntry
  }).sort((a, b) => b.occurred.localeCompare(a.occurred))
}

/** The before/after a row's `changes` diff carries — nothing to show when it's null (a sign-in, a denial, anything without a field-level diff). */
function ChangesDiff({ changes }: { changes: AuditEntry['changes'] }) {
  if (!changes || Object.keys(changes).length === 0) {
    return <p className="text-[12px] text-ink-3">No field-level changes recorded for this entry.</p>
  }

  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {Object.entries(changes).map(([field, diff]) => (
        <div key={field} className="grid grid-cols-[8rem_1fr] gap-2 px-3 py-2 text-[12px]">
          <span className="font-medium text-ink-2">{field}</span>
          <span className="min-w-0">
            <span className="text-critical line-through">{String(diff.from ?? '—')}</span>
            <span className="mx-1.5 text-ink-3">→</span>
            <span className="text-ink">{String(diff.to ?? '—')}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function AuditIntegrityCheck() {
  const toast = useToast()
  const [checking, setChecking] = React.useState(false)
  const [result, setResult] = React.useState<api.AuditIntegrityResult | null>(null)

  const run = async () => {
    setChecking(true)
    try {
      const data = await api.verifyAuditIntegrity()
      setResult(data)
      toast({
        tone: data.valid ? 'success' : 'error',
        title: data.valid
          ? `Chain intact — ${data.checked} entries verified`
          : `Integrity check failed at entry #${data.brokenAt}`,
      })
    } catch (e) {
      toast({ tone: 'error', title: (e as Error).message || 'Could not run the integrity check.' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Button variant="secondary" onClick={() => void run()} loading={checking} disabled={!liveApi()}>
      <ShieldCheck className="size-4" />
      {result ? (result.valid ? 'Chain intact — verify again' : 'Chain broken — verify again') : 'Verify integrity'}
    </Button>
  )
}

function Audit() {
  const c = cols<AuditEntry>()
  const entries = React.useMemo(buildAudit, [])

  return (
    <ResourcePage<AuditEntry>
      title="Audit Trail"
      description="Every recorded action — successful, denied, or failed — chained by a running hash so tampering after the fact is detectable. Entries cannot be edited or removed through this screen; see Settings → Security for the retention window."
      endpoint="admin/audit-log"
      loader={() => entries}
      exportName="audit-trail"
      createLabel="Export archive"
      actions={<AuditIntegrityCheck />}
      pageSize={25}
      searchPlaceholder="Search user, action, record…"
      filters={[
        { columnId: 'module', label: 'Module' },
        { columnId: 'action', label: 'Action' },
        { columnId: 'outcome', label: 'Outcome' },
        { columnId: 'actorType', label: 'Actor type' },
      ]}
      detailTitle={(row) => `${row.action} — ${row.entityLabel ?? row.module ?? 'no record'}`}
      detailSubtitle={(row) => `${row.user} · ${fmtDateTime(row.occurred)}`}
      detailSize="lg"
      renderDetail={(row) => (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Actor</p>
              <p className="text-[13px] font-medium text-ink">{row.user}</p>
              <p className="text-[11px] text-ink-3">{row.actorType}</p>
            </div>
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Outcome</p>
              <Badge tone={OUTCOME_TONE[row.outcome] ?? 'neutral'} dot>
                {row.outcome}
              </Badge>
            </div>
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Where from</p>
              <p className="text-[13px] font-mono text-ink">{row.ip ?? '—'}</p>
              {row.userAgent && <p className="mt-1 truncate text-[11px] text-ink-3">{row.userAgent}</p>}
            </div>
            <div className="card p-3">
              <p className="text-[11px] text-ink-3">Request</p>
              <p className="truncate text-[13px] font-mono text-ink">{row.requestId ?? '—'}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Field changes</p>
            <ChangesDiff changes={row.changes} />
          </div>
        </div>
      )}
      columns={[
        {
          id: 'occurred',
          accessorKey: 'occurred',
          header: 'When',
          meta: { width: '11rem' },
          cell: ({ getValue }) => (
            <span className="whitespace-nowrap tabular">{fmtDateTime(String(getValue() ?? ''))}</span>
          ),
        },
        c.primary('user', 'User'),
        c.tag('actorType', 'Actor type', 'neutral'),
        c.text('action', 'Action'),
        c.text('module', 'Module', { secondary: true }),
        c.text('entityLabel', 'Record', { mono: true, secondary: true }),
        c.text('ip', 'IP address', { secondary: true, mono: true }),
        c.level('outcome', 'Outcome', OUTCOME_TONE),
      ]}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Login activity                                                             */
/* -------------------------------------------------------------------------- */

type LoginActivityRow = {
  id: number
  username: string
  userId: number | null
  userName: string | null
  ip: string | null
  countryCode: string | null
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  userAgent: string | null
  succeeded: boolean
  failureReason: string | null
  attemptedAt: string
}

/** Google Maps needs no API key for a plain viewer link — unlike its JS/Directions APIs, which is why the map itself elsewhere in this app is OpenStreetMap tiles instead. */
const mapLinkFor = (row: LoginActivityRow) =>
  row.latitude != null && row.longitude != null
    ? `https://www.google.com/maps?q=${row.latitude},${row.longitude}`
    : null

function buildLoginActivityPreview(): LoginActivityRow[] {
  const d = dataset()
  const admin = d.employees[0]?.name ?? 'Super Administrator'
  return [
    {
      id: 1,
      username: 'superadmin',
      userId: 1,
      userName: admin,
      ip: '127.0.0.1',
      countryCode: 'PH',
      latitude: 7.0731,
      longitude: 125.6128,
      accuracyM: 24,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      succeeded: true,
      failureReason: null,
      attemptedAt: new Date().toISOString(),
    },
  ]
}

/**
 * Where every sign-in actually came from — the IP address every attempt
 * already carried, plus the device's own GPS/Wi-Fi location when the
 * browser was asked for it and said yes.
 *
 * A location column is not the same claim an IP address makes. The IP
 * resolves to a city or an ISP's exchange at best (see Settings → Sign-in
 * Locations, which uses exactly that for Geo-IP fencing); this is what the
 * device itself reported, to within metres when granted — volunteered once
 * right after a successful sign-in (`useAuth`'s `login`/`verifyCode`),
 * never re-asked, and attributed only to that same account's own token, so
 * there is no way for one person's location to land on another's row.
 *
 * Read-only and superadmin-gated by the same `admin/{resource}` route every
 * other screen in this file sits behind — see `admin/login-activity` in
 * the registry for the actual restriction.
 */
function LoginActivity() {
  const c = cols<LoginActivityRow>()
  const rows = React.useMemo(buildLoginActivityPreview, [])

  return (
    <ResourcePage<LoginActivityRow>
      title="Login Activity"
      description="Every sign-in attempt, successful or not, with the IP address it came from and the device's own reported location when it volunteered one. Read-only — nothing here can be edited or removed."
      endpoint="admin/login-activity"
      loader={() => rows}
      exportName="login-activity"
      pageSize={25}
      searchPlaceholder="Search username, IP…"
      filters={[{ columnId: 'succeeded', label: 'Result' }]}
      detailTitle={(row) => row.userName ?? row.username}
      detailSubtitle={(row) => fmtDateTime(row.attemptedAt)}
      renderDetail={(row) => {
        const mapLink = mapLinkFor(row)
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="card p-3">
                <p className="text-[11px] text-ink-3">Account</p>
                <p className="text-[13px] font-medium text-ink">{row.userName ?? row.username}</p>
                <p className="text-[11px] text-ink-3">@{row.username}</p>
              </div>
              <div className="card p-3">
                <p className="text-[11px] text-ink-3">Result</p>
                <Badge tone={row.succeeded ? 'good' : 'critical'} dot>
                  {row.succeeded ? 'Signed in' : (row.failureReason ?? 'Failed')}
                </Badge>
              </div>
              <div className="card p-3">
                <p className="text-[11px] text-ink-3">IP address</p>
                <p className="text-[13px] font-mono text-ink">{row.ip ?? '—'}</p>
                {row.countryCode && <p className="mt-1 text-[11px] text-ink-3">{row.countryCode}</p>}
              </div>
              <div className="card p-3">
                <p className="text-[11px] text-ink-3">Device location</p>
                {row.latitude != null ? (
                  <>
                    <p className="text-[13px] font-mono text-ink">
                      {row.latitude.toFixed(5)}, {row.longitude!.toFixed(5)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-3">
                      {row.accuracyM != null ? `± ${row.accuracyM} m` : 'accuracy unknown'}
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-ink-3">Not reported</p>
                )}
              </div>
            </div>

            {mapLink && (
              <a
                href={mapLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline"
              >
                <MapPin className="size-3.5" />
                Open in Google Maps
              </a>
            )}

            {row.userAgent && (
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Device</p>
                <p className="text-[12px] text-ink-2">{row.userAgent}</p>
              </div>
            )}
          </div>
        )
      }}
      columns={[
        {
          id: 'attemptedAt',
          accessorKey: 'attemptedAt',
          header: 'When',
          meta: { width: '11rem' },
          cell: ({ getValue }) => (
            <span className="whitespace-nowrap tabular">{fmtDateTime(String(getValue() ?? ''))}</span>
          ),
        },
        c.primary('username', 'Account', (row) => row.userName ?? ''),
        c.text('ip', 'IP address', { mono: true }),
        c.text('countryCode', 'Country', { secondary: true }),
        {
          id: 'location',
          header: 'Device location',
          cell: ({ row }) => {
            const r = row.original
            return r.latitude != null ? (
              <span className="font-mono text-[12px] text-ink">
                {r.latitude.toFixed(4)}, {r.longitude!.toFixed(4)}
              </span>
            ) : (
              <span className="text-ink-3">—</span>
            )
          },
        },
        c.bool('succeeded', 'Result', { yes: 'Signed in', no: 'Failed', tone: 'good', falseTone: 'critical' }),
      ]}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* System settings                                                             */
/* -------------------------------------------------------------------------- */

const NUMBERING = [
  ['Sales Order', 'SO-{YYYY}-{0000}', 'SO-2026-0461'],
  ['Sales Quotation', 'QT-{YYYY}-{0000}', 'QT-2026-0073'],
  ['Delivery Receipt', 'DR-{YYYY}-{0000}', 'DR-2026-0121'],
  ['Purchase Requisition', 'PR-{YYYY}-{0000}', 'PR-2026-0069'],
  ['Purchase Order', 'PO-{YYYY}-{0000}', 'PO-2026-0321'],
  ['Goods Receipt', 'GRN-{YYYY}-{0000}', 'GRN-2026-0133'],
  ['Journal Voucher', 'JV-{YYYY}-{0000}', 'JV-2026-0169'],
  ['Work Order', 'WO-{YYYY}-{0000}', 'WO-2026-0281'],
  ['Leave Request', 'LV-{YYYY}-{0000}', 'LV-2026-0093'],
]

/**
 * Operating rules and document numbering.
 *
 * Separate from System Settings, which holds the database-backed company,
 * email and security configuration.
 */
function Operations() {
  const toast = useToast()
  const [values, setValues] = React.useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)

  React.useEffect(() => {
    if (!liveApi()) return
    api
      .getOperatingRules()
      .then(setValues)
      .catch((e: Error) => toast({ tone: 'error', title: 'Could not load operating rules', description: (e as Error).message }))
  }, [toast])

  const set = (key: string, value: unknown) => {
    setValues((v) => (v ? { ...v, [key]: value } : v))
    setDirty(true)
  }

  const save = async () => {
    if (!values) return
    setSaving(true)
    try {
      const saved = await api.saveOperatingRules(values)
      setValues(saved)
      setDirty(false)
      toast({ tone: 'success', title: 'Operating rules saved', description: 'They apply from the next document posted.' })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  /* Each guardrail, with what turning it off actually costs. */
  const toggles: [string, string, string][] = [
    ['auto_post_inventory', 'Auto-post inventory movements', 'Goods receipts and dispatches post to the ledger without a manual journal.'],
    ['allow_negative_stock', 'Allow negative stock', 'Permits dispatch when the balance is already zero. Off is strongly recommended — a negative balance is not a state anyone can act on.'],
    ['enforce_credit_limits', 'Enforce customer credit limits', 'Blocks order confirmation when a customer is over their limit until somebody approves it.'],
    ['batch_expiry_tracking', 'Batch and expiry tracking', 'Requires a batch on receipt and picking for perishable categories.'],
    ['lock_posted_periods', 'Lock posted periods', 'Refuses a journal dated into a period that has been closed.'],
    ['require_two_factor_for_approvers', 'Require two-factor for approvers', 'Applies to every account that can sign off a document.'],
  ]

  return (
    <div>
      <PageHeader
        title="Operating Rules"
        description="The guardrails the whole ERP obeys. These are stored settings — changing one here changes what the system will accept."
        actions={
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty || !values} onClick={save}>
            Save changes
          </Button>
        }
      />

      {!liveApi() && (
        <Card className="mb-4">
          <p className="p-4 text-[13px] text-ink-2">
            Operating rules are stored on the server. Connect the API to change them.
          </p>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Fiscal & locale" subtitle="Drives period close, reporting and formatting" />
          <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 sm:p-5">
            <Field label="Base currency">
              <Select
                value={String(values?.base_currency ?? 'PHP')}
                onChange={(e) => set('base_currency', e.target.value)}
                disabled={!values}
              >
                <option value="PHP">PHP — Philippine Peso</option>
                <option value="USD">USD — US Dollar</option>
              </Select>
            </Field>
            <Field label="Date format">
              <Select
                value={String(values?.date_format ?? 'dmy')}
                onChange={(e) => set('date_format', e.target.value)}
                disabled={!values}
              >
                <option value="dmy">DD MMM YYYY</option>
                <option value="mdy">MMM DD, YYYY</option>
                <option value="iso">YYYY-MM-DD</option>
              </Select>
            </Field>
            <Field label="Default VAT rate" hint="Applied to new items unless overridden.">
              <Input
                type="number"
                min={0}
                max={100}
                value={String(values?.default_vat_rate ?? 12)}
                onChange={(e) => set('default_vat_rate', Number(e.target.value))}
                disabled={!values}
              />
            </Field>
            <Field label="Fiscal year start" hint="Set under Company so the statements and this agree.">
              <Input value="January" disabled />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Posting guardrails" subtitle="What the system will and will not accept" />
          <div className="divide-y divide-line border-t border-line">
            {toggles.map(([key, label, description]) => (
              <div key={key} className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">{label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{description}</p>
                </div>
                <Switch checked={Boolean(values?.[key])} onChange={(on) => set(key, on)} label={label} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionHeading title="Document numbering" description="Series applied when a document is first saved." />
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  {['Document', 'Format', 'Last issued'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NUMBERING.map(([doc, format, last]) => (
                  <tr key={doc} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{doc}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-2">{format}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-ink-2">{last}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionHeading title="Integrations" description="External systems the ERP will exchange data with." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ['Laravel API', 'Core backend — REST, Sanctum auth', 'Planned'],
            ['MySQL 8', 'Primary transactional database', 'Planned'],
            ['BIR eFPS', 'Electronic tax filing', 'Not connected'],
            ['Bank file exchange', 'Payment file upload and statement import', 'Not connected'],
            ['SMS gateway', 'Delivery and approval notifications', 'Not connected'],
            ['Barcode printers', 'Zebra ZPL label queue', 'Not connected'],
          ].map(([name, description, status]) => (
            <Card key={name} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="grad-brand-soft flex size-8 items-center justify-center rounded-lg">
                  <Building2 className="size-4 text-brand-500" />
                </span>
                <Badge tone={status === 'Planned' ? 'info' : 'neutral'}>{status}</Badge>
              </div>
              <p className="mt-3 text-[13px] font-medium text-ink">{name}</p>
              <p className="mt-0.5 text-xs text-ink-3">{description}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

export { SystemSettings }

export const PAGES: Record<string, React.ComponentType> = {
  // The same screen employees use; the API returns the whole queue to an
  // administrator instead of just their own tickets.
  tickets: SupportDesk,
  users: Users,
  approvals: Approvals,
  'fuel-approvers': FuelApprovers,
  organization: Organization,
  audit: Audit,
  'login-activity': LoginActivity,
  'department-access': DepartmentAccess,
  'notification-rules': NotificationRules,
  impersonate: Impersonate,
  operations: Operations,
  backup: BackupRestore,
  settings: SystemSettings,
}


