import * as React from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Clock,
  DoorOpen,
  Download,
  FileText,
  Gavel,
  GraduationCap,
  Pin,
  Timer,
  IdCard,
  Pencil,
  Receipt,
  TrendingUp,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource, queryClient } from '@/lib/api'
import {
  acknowledgeCase,
  fileOwnLeave,
  getMyAttendance,
  getMyPayslip,
  getMyAnnouncements,
  getMyCoeRequests,
  getMyOvertimeRequests,
  cancelMyResignation,
  getMyResignation,
  liveApi,
  listMyPayrollPeriods,
  downloadMyCoeDocument,
  submitCoeRequest,
  submitOvertimeRequest,
  submitResignation,
  updateMyProfile,
  type ClockState,
  type CoeRequestDetail,
  type CoeRequestType,
  type DtrPeriod,
  type MyAnnouncement,
  type OvertimeRequestDetail,
  type ResignationRequestDetail,
  type SelfService,
} from '@/lib/adminApi'
import { PayslipView, type LivePayslip } from '@/modules/hr/payslips'
import { fmtDate, money, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, ErrorState, SkeletonDashboard, useToast } from '@/components/ui/feedback'
import { DetailField, DetailGrid } from '@/components/data/ResourcePage'
import { MyReviews } from './MyReviews'
import { PunchClock } from './PunchClock'
import { MyTraining } from './MyTraining'

/**
 * The employee's own view.
 *
 * Everything here is about the person signed in and nothing else — the API
 * resolves the employee from the account rather than taking an id, so there is
 * no parameter anybody could change to read somebody else's pay.
 */

const TABS = [
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'attendance', label: 'My Attendance', icon: CalendarDays },
  { id: 'leave', label: 'My Leave', icon: CalendarPlus },
  { id: 'payslips', label: 'My Payslips', icon: Receipt },
  { id: 'profile', label: 'My Information', icon: IdCard },
  { id: 'training', label: 'My Training', icon: GraduationCap },
  { id: 'record', label: 'My Record', icon: Gavel },
] as const

type TabId = (typeof TABS)[number]['id']

const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

const STATUS_TONE: Record<string, 'good' | 'warning' | 'critical' | 'neutral' | 'info'> = {
  Present: 'good',
  Late: 'warning',
  Absent: 'critical',
  'On Leave': 'info',
  'Rest Day': 'neutral',
  Holiday: 'info',
  Approved: 'good',
  Rejected: 'critical',
  'For Approval': 'warning',
  Draft: 'neutral',
  Cancelled: 'neutral',
  Open: 'warning',
  Resolved: 'good',
  Closed: 'neutral',
}

/**
 * My Attendance, with a cut-off filter.
 *
 * Starts showing exactly what the portal loaded with (the last 30 days, no
 * extra request) and only calls out to `me/attendance` once a specific
 * payroll period is picked — so opening the tab costs nothing beyond what
 * the page already fetched.
 */
function MyAttendanceCard({ initial }: { initial: SelfService['attendance'] }) {
  const toast = useToast()
  const [periods, setPeriods] = React.useState<DtrPeriod[]>([])
  const [periodId, setPeriodId] = React.useState<number | ''>('')
  const [rows, setRows] = React.useState<SelfService['attendance']>(initial)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    listMyPayrollPeriods().then(setPeriods).catch(() => setPeriods([]))
  }, [])

  const choosePeriod = async (value: string) => {
    const id = value === '' ? '' : Number(value)
    setPeriodId(id)
    if (id === '') {
      setRows(initial)
      return
    }
    setLoading(true)
    try {
      setRows(await getMyAttendance({ periodId: id }))
    } catch (e) {
      toast({ tone: 'error', title: 'Could not load that cut-off', description: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="My attendance"
        subtitle={periodId === '' ? 'The last 30 days, exactly as the clock recorded them' : 'Exactly as the clock recorded them for this cut-off'}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={String(periodId)}
              onChange={(e) => void choosePeriod(e.target.value)}
              className="w-48"
            >
              <option value="">Last 30 days</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Badge tone="neutral">{num(rows.length)}</Badge>
          </div>
        }
      />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px] tracking-wide text-ink-3 uppercase">
              <th className="px-4 py-2.5 text-left font-medium">Date</th>
              <th className="px-4 py-2.5 text-left font-medium">In</th>
              <th className="px-4 py-2.5 text-left font-medium">Break</th>
              <th className="px-4 py-2.5 text-left font-medium">Out</th>
              <th className="px-4 py-2.5 text-right font-medium">Hours</th>
              <th className="px-4 py-2.5 text-right font-medium">Late</th>
              <th className="px-4 py-2.5 text-right font-medium">OT</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-3">
                  {periodId === '' ? 'Nothing recorded yet — your first time-in will appear here.' : 'Nothing recorded for this cut-off.'}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => (
                <tr key={row.id} className="border-b border-line/50">
                  <td className="px-4 py-2.5 font-medium text-ink">{fmtDate(row.date)}</td>
                  <td className="tabular px-4 py-2.5 text-ink-2">{timeOf(row.clockIn)}</td>
                  <td className="tabular px-4 py-2.5 text-ink-3">
                    {row.breakMinutes > 0 ? `${row.breakMinutes} min` : '—'}
                  </td>
                  <td className="tabular px-4 py-2.5 text-ink-2">{timeOf(row.clockOut)}</td>
                  <td className="tabular px-4 py-2.5 text-right font-medium text-ink">{num(row.hoursWorked, 2)}</td>
                  <td className="tabular px-4 py-2.5 text-right">
                    {row.lateMinutes > 0 ? (
                      <span className="text-critical">{row.lateMinutes}m</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-2">
                    {row.overtimeHours > 0 ? `${num(row.overtimeHours, 1)}h` : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function SelfServicePortal() {
  const [tab, setTab] = React.useState<TabId>('today')
  const [leaveOpen, setLeaveOpen] = React.useState(false)
  const [openPayslip, setOpenPayslip] = React.useState<number | null>(null)

  const { data, isLoading, error, refetch } = useResource<SelfService>('me/hr', () => {
    throw new Error('Employee self service needs a live connection to the server.')
  })

  const setClock = (clock: ClockState) => {
    queryClient.setQueryData(['resource', 'me/hr'], (current: SelfService | undefined) =>
      current ? { ...current, clock } : current,
    )
    // The punch changes attendance and the month summary too.
    void refetch()
  }

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { profile, clock, attendance, attendanceSummary, leave, payslips, infractions, training } = data

  return (
    <div>
      <PageHeader
        title={`Hello, ${profile.firstName ?? profile.name}`}
        description={[profile.position, profile.department].filter(Boolean).join(' · ') || 'Employee self service'}
        meta={<Badge tone="neutral">{profile.employeeNo}</Badge>}
      />

      {/* Delivery reviews shared by the Process & Performance office.

          Above the tabs, not inside one, and that placement is deliberate: a
          verdict about somebody's work that they are being asked to answer
          should not be something they have to go looking for. It renders
          nothing at all when there is nothing shared, which for most people is
          always. */}
      <div className="mb-4">
        <MyReviews />
      </div>

      {/* Tabs rather than sidebar entries: this is one screen for people who
          do not otherwise use the system, and a nav tree would bury it. */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
              tab === id
                ? 'border-brand-500 text-ink'
                : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink-2',
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {id === 'record' && infractions.open > 0 && (
              <span className="ml-0.5 rounded-full bg-critical px-1.5 text-[10px] font-semibold text-white">
                {infractions.open}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div className="space-y-4">
          <AnnouncementsBanner />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <PunchClock
              state={clock}
              onPunched={setClock}
              onPinChanged={() => void refetch()}
              name={profile.firstName ?? profile.name}
              isManagerial={profile.isManagerial}
            />

            <div className="space-y-4">
              <StatGrid columns={3}>
                <StatTile
                  label="Hours this month"
                  value={num(attendanceSummary.hoursThisMonth, 1)}
                  icon={Clock}
                  hint={`${num(attendanceSummary.daysThisMonth)} day${attendanceSummary.daysThisMonth === 1 ? '' : 's'} recorded`}
                />
                <StatTile
                  label="Late this month"
                  value={num(attendanceSummary.lateThisMonth)}
                  icon={AlertTriangle}
                  hint={
                    attendanceSummary.lateMinutesThisMonth > 0
                      ? `${num(attendanceSummary.lateMinutesThisMonth)} minutes in total`
                      : 'On time every day'
                  }
                />
                <StatTile
                  label="Overtime this month"
                  value={`${num(attendanceSummary.overtimeThisMonth, 1)} h`}
                  icon={TrendingUp}
                />
              </StatGrid>

              <Card>
                <CardHeader title="Leave balances" subtitle="Days still available to you" />
                <div className="divide-y divide-line border-t border-line">
                  {leave.balances.length === 0 && (
                    <EmptyState title="No balances yet" description="HR opens these at the start of the year." />
                  )}
                  {leave.balances.map((b) => (
                    <div key={b.typeId} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0 truncate text-[13px] text-ink-2">{b.type}</span>
                      <span className="tabular shrink-0 text-[13px]">
                        <strong className="text-ink">{num(b.balance, 1)}</strong>
                        <span className="text-ink-3"> / {num(b.entitled, 1)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <OvertimeCard />
            </div>
          </div>
        </div>
      )}

      {tab === 'attendance' && <MyAttendanceCard initial={attendance} />}

      {tab === 'leave' && (
        <div className="space-y-4">
          <StatGrid>
            {leave.balances.slice(0, 4).map((b) => (
              <StatTile
                key={b.typeId}
                label={b.type ?? 'Leave'}
                value={num(b.balance, 1)}
                icon={CalendarDays}
                hint={`${num(b.used, 1)} used of ${num(b.entitled, 1)}`}
              />
            ))}
          </StatGrid>

          <Card>
            {/* Lives on this tab rather than the page header — it is a leave
                action, so it belongs where the leave records are, not
                floating over tabs (Today, Attendance, Payslips) it has
                nothing to do with. */}
            <CardHeader
              title="My leave requests"
              subtitle="What you have filed and where each one stands"
              action={
                <Button variant="primary" size="sm" onClick={() => setLeaveOpen(true)} disabled={!liveApi()}>
                  <CalendarPlus className="size-3.5" />
                  File leave
                </Button>
              }
            />
            <div className="divide-y divide-line border-t border-line">
              {leave.requests.length === 0 && (
                <EmptyState
                  icon={CalendarDays}
                  title="Nothing filed"
                  description="Request time off and it will show up here."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setLeaveOpen(true)} disabled={!liveApi()}>
                      <CalendarPlus className="size-3.5" />
                      File leave
                    </Button>
                  }
                />
              )}
              {leave.requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-baseline gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {r.type} · {num(r.days, 1)} day{r.days === 1 ? '' : 's'}
                    </p>
                    <p className="text-[11px] text-ink-3">
                      {r.no} · {r.from ? fmtDate(r.from) : '—'} to {r.to ? fmtDate(r.to) : '—'}
                      {r.reason ? ` · ${r.reason}` : ''}
                      {r.approver ? ` · ${r.approver}` : ''}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'payslips' && (
        <Card>
          <CardHeader title="My payslips" subtitle="Click one to see the full breakdown, print it, or download it" />
          <div className="divide-y divide-line border-t border-line">
            {payslips.length === 0 && (
              <EmptyState
                icon={Receipt}
                title="No payslips yet"
                description="They appear here once a payroll run covering you has been posted."
              />
            )}
            {payslips.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenPayslip(p.id)}
                className="flex w-full flex-wrap items-baseline gap-3 px-4 py-3 text-left hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{p.period}</p>
                  <p className="text-[11px] text-ink-3">
                    Gross {money(p.grossPay)} · Deductions {money(p.totalDeductions)}
                    {p.atmAccount ? ` · ${p.atmAccount}` : ''}
                  </p>
                </div>
                <span className="tabular shrink-0 text-[15px] font-semibold text-ink">{money(p.netPay)}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {openPayslip !== null && <MyPayslipModal id={openPayslip} onClose={() => setOpenPayslip(null)} />}

      {tab === 'profile' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Employment" subtitle="Your record as HR holds it" />
            <div className="border-t border-line p-4 sm:p-5">
              <DetailGrid>
                <DetailField label="Employee number">{profile.employeeNo}</DetailField>
                <DetailField label="Full name">{profile.name}</DetailField>
                <DetailField label="Position">{profile.position ?? '—'}</DetailField>
                <DetailField label="Department">{profile.department ?? '—'}</DetailField>
                <DetailField label="Branch">{profile.branch ?? '—'}</DetailField>
                <DetailField label="Group">{profile.group ?? '—'}</DetailField>
                <DetailField label="Date hired">{profile.dateHired ? fmtDate(profile.dateHired) : '—'}</DetailField>
                <DetailField label="Status">{profile.employmentStatus}</DetailField>
                <DetailField label="Shift">{profile.shift ?? '—'}</DetailField>
                <DetailField label="Payroll group">{profile.payrollGroup ?? '—'}</DetailField>
              </DetailGrid>
            </div>
          </Card>

          <PersonalStatutoryCard profile={profile} onSaved={() => void refetch()} />

          <ResignationCard />

          <CoeCard />
        </div>
      )}

      {tab === 'training' && <MyTraining certificates={training ?? []} />}

      {tab === 'record' && <MyRecord infractions={infractions} onChanged={() => void refetch()} />}

      <FileLeaveDialog
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        balances={leave.balances}
        leaveTypes={leave.leaveTypes}
        onFiled={() => void refetch()}
      />
    </div>
  )
}

/** Loads and shows one of the signed-in employee's own payslips, in full. */
function MyPayslipModal({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useToast()
  const [slip, setSlip] = React.useState<LivePayslip | null>(null)

  React.useEffect(() => {
    getMyPayslip(id)
      .then(setSlip)
      .catch((e: Error) => {
        toast({ tone: 'error', title: 'Could not load that payslip', description: e.message })
        onClose()
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <Modal open onClose={onClose} size="lg" title="Payslip" description={slip ? `${slip.periodLabel ?? slip.period} — ${slip.employee}` : undefined}>
      {slip ? <PayslipView slip={slip} /> : <p className="p-4 text-[13px] text-ink-3">Loading…</p>}
    </Modal>
  )
}

/**
 * "Personal and statutory" — editable, unlike the "Employment" card beside
 * it. Position, salary, department and every other field HR alone is
 * trusted with stay read-only; see HrController::updateProfile for why
 * splitting the boundary here is safe rather than just a UI convention.
 */
function PersonalStatutoryCard({ profile, onSaved }: { profile: SelfService['profile']; onSaved: () => void }) {
  const toast = useToast()
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [form, setForm] = React.useState({
    civilStatus: profile.civilStatus ?? '',
    email: profile.email ?? '',
    mobile: profile.mobile ?? '',
    address: profile.address ?? '',
    paymentMode: profile.paymentMode ?? '',
    tin: profile.tin ?? '',
    sss: profile.sss ?? '',
    philhealth: profile.philhealth ?? '',
    pagibig: profile.pagibig ?? '',
  })

  const startEditing = () => {
    setForm({
      civilStatus: profile.civilStatus ?? '',
      email: profile.email ?? '',
      mobile: profile.mobile ?? '',
      address: profile.address ?? '',
      paymentMode: profile.paymentMode ?? '',
      tin: profile.tin ?? '',
      sss: profile.sss ?? '',
      philhealth: profile.philhealth ?? '',
      pagibig: profile.pagibig ?? '',
    })
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    try {
      await updateMyProfile({
        civilStatus: form.civilStatus || null,
        email: form.email || null,
        mobile: form.mobile || null,
        address: form.address || null,
        paymentMode: form.paymentMode || null,
        tin: form.tin || null,
        sss: form.sss || null,
        philhealth: form.philhealth || null,
        pagibig: form.pagibig || null,
      })
      toast({ tone: 'success', title: 'Details updated' })
      setEditing(false)
      onSaved()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Personal and statutory"
        subtitle="The numbers you are most often asked to quote"
        action={
          editing ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(false)}>
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={busy} onClick={save}>
                Save
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={startEditing} disabled={!liveApi()}>
              <Pencil className="size-3.5" />
              Edit
            </Button>
          )
        }
      />
      <div className="border-t border-line p-4 sm:p-5">
        {!editing ? (
          <DetailGrid>
            <DetailField label="Birth date">{profile.birthDate ? fmtDate(profile.birthDate) : '—'}</DetailField>
            <DetailField label="Civil status">{CIVIL_STATUS_LABEL[profile.civilStatus ?? ''] ?? profile.civilStatus ?? '—'}</DetailField>
            <DetailField label="Email">{profile.email ?? '—'}</DetailField>
            <DetailField label="Mobile">{profile.mobile ?? '—'}</DetailField>
            <DetailField label="Address">{profile.address ?? '—'}</DetailField>
            <DetailField label="Payment mode">{profile.paymentMode ?? '—'}</DetailField>
            <DetailField label="TIN">{profile.tin ?? '—'}</DetailField>
            <DetailField label="SSS">{profile.sss ?? '—'}</DetailField>
            <DetailField label="PhilHealth">{profile.philhealth ?? '—'}</DetailField>
            <DetailField label="Pag-IBIG">{profile.pagibig ?? '—'}</DetailField>
          </DetailGrid>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Civil status">
              <Select value={form.civilStatus} onChange={(e) => setForm({ ...form, civilStatus: e.target.value })}>
                {Object.entries(CIVIL_STATUS_LABEL).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Payment mode">
              <Select value={form.paymentMode} onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}>
                <option value="ATM">ATM</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
              </Select>
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Mobile" hint="Also your default sign-in password, last 4 digits">
              <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="TIN">
              <Input value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} />
            </Field>
            <Field label="SSS">
              <Input value={form.sss} onChange={(e) => setForm({ ...form, sss: e.target.value })} />
            </Field>
            <Field label="PhilHealth">
              <Input value={form.philhealth} onChange={(e) => setForm({ ...form, philhealth: e.target.value })} />
            </Field>
            <Field label="Pag-IBIG">
              <Input value={form.pagibig} onChange={(e) => setForm({ ...form, pagibig: e.target.value })} />
            </Field>
          </div>
        )}
        <p className="mt-4 text-[11px] text-ink-3">
          {editing
            ? 'Birth date, name and everything on the Employment card are corrected by HR, not here — that keeps the 201 file the single record.'
            : 'Something wrong beyond this card? That is corrected by HR, not here — that keeps the 201 file the single record.'}
        </p>
      </div>
    </Card>
  )
}

const CIVIL_STATUS_LABEL: Record<string, string> = { S: 'Single', M: 'Married', D: 'Divorced', W: 'Widowed' }

/* -------------------------------------------------------------------------- */

/**
 * The employee's disciplinary record.
 *
 * Shown to the employee rather than kept from them: a notice they cannot see is
 * not due process, and acknowledging one is how the company evidences that it
 * was served.
 */
function MyRecord({
  infractions,
  onChanged,
}: {
  infractions: SelfService['infractions']
  onChanged: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState<number | null>(null)

  const acknowledge = async (id: number, no: string) => {
    setBusy(id)
    try {
      await acknowledgeCase(id)
      toast({ tone: 'success', title: `${no} acknowledged`, description: 'Recorded as received, not as an admission.' })
      onChanged()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not acknowledge', description: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <StatGrid columns={3}>
        <StatTile
          label="Standing"
          value={infractions.standing}
          icon={Gavel}
          hint={`Over the last ${infractions.windowDays} days`}
        />
        <StatTile label="Points" value={num(infractions.points)} icon={AlertTriangle} hint="Older cases drop out" />
        <StatTile label="Open cases" value={num(infractions.open)} icon={Gavel} />
      </StatGrid>

      <Card>
        <CardHeader title="My record" subtitle="Every notice raised against you, and the evidence behind it" />
        <div className="divide-y divide-line border-t border-line">
          {infractions.cases.length === 0 && (
            <EmptyState
              icon={Gavel}
              title="Nothing on your record"
              description="No infractions have been raised against you."
            />
          )}
          {infractions.cases.map((c) => (
            <div key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {c.type}
                    {c.automatic && <span className="ml-2 text-[11px] font-normal text-ink-3">raised automatically</span>}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {c.no} · {c.reported ? fmtDate(c.reported) : '—'} · {c.action}
                    {c.handler ? ` · handled by ${c.handler}` : ''}
                  </p>
                </div>
                <Badge
                  tone={
                    c.severity === 'Grave' ? 'critical' : c.severity === 'Major' ? 'serious' : c.severity === 'Moderate' ? 'warning' : 'neutral'
                  }
                >
                  {c.severity}
                </Badge>
                <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
              </div>

              {c.details && <p className="mt-1.5 text-[12px] text-ink-2">{c.details}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-3">
                {c.acknowledgedAt ? (
                  <span className="text-[11px] text-ink-3">
                    Acknowledged {fmtDate(c.acknowledgedAt)}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="xs"
                    loading={busy === c.id}
                    onClick={() => acknowledge(c.id, c.no)}
                  >
                    Acknowledge receipt
                  </Button>
                )}
                {c.hearingOn && (
                  <span className="text-[11px] text-warning">Hearing {fmtDate(c.hearingOn)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function FileLeaveDialog({
  open,
  onClose,
  balances,
  leaveTypes,
  onFiled,
}: {
  open: boolean
  onClose: () => void
  balances: SelfService['leave']['balances']
  leaveTypes: SelfService['leave']['leaveTypes']
  onFiled: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [typeId, setTypeId] = React.useState<number | null>(null)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [reason, setReason] = React.useState('')

  // Every configured leave type is offered, not only the ones with a balance
  // already opened — see HrOperations::selfService for why the dropdown used
  // to go empty for a type nobody had taken before.
  const options = React.useMemo(
    () => leaveTypes.map((t) => ({ typeId: t.id, name: t.name, balance: balances.find((b) => b.typeId === t.id)?.balance ?? null })),
    [leaveTypes, balances],
  )

  React.useEffect(() => {
    if (!open) return
    setTypeId(options[0]?.typeId ?? null)
    const today = new Date().toISOString().slice(0, 10)
    setFrom(today)
    setTo(today)
    setReason('')
  }, [open, options])

  const days = React.useMemo(() => {
    if (!from || !to) return 0
    const diff = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
    return diff < 0 ? 0 : diff + 1
  }, [from, to])

  const chosen = balances.find((b) => b.typeId === typeId)
  // No balance row yet reads as zero available, not "no limit" — a type
  // nobody has ever needed still has to be opened by HR before it pays out.
  const availableBalance = chosen?.balance ?? 0
  const short = days > availableBalance

  const submit = async () => {
    if (!typeId) return
    setBusy(true)
    try {
      const result = await fileOwnLeave({ leaveTypeId: typeId, startDate: from, endDate: to, days, reason: reason || undefined })
      toast({
        tone: 'success',
        title: `${result.no} filed`,
        description: `${num(result.days, 1)} day(s) of ${result.type} — waiting on approval.`,
      })
      onFiled()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not file leave', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="File leave"
      description="Your request goes to your approver. The balance moves when it is approved, not when it is filed."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!typeId || days <= 0} onClick={submit}>
            File request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Leave type" required>
          <Select
            value={String(typeId ?? '')}
            onChange={(e) => setTypeId(e.target.value === '' ? null : Number(e.target.value))}
          >
            {options.length === 0 && <option value="">No leave types configured — ask HR</option>}
            {options.map((o) => (
              <option key={o.typeId} value={o.typeId}>
                {o.name}{o.balance !== null ? ` — ${num(o.balance, 1)} day(s) left` : ' — no balance opened yet'}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" required>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {days > 0 && (
          <p
            className={cn(
              'rounded-lg p-2.5 text-[13px]',
              short ? 'bg-critical/10 text-critical' : 'bg-surface-2 text-ink-2',
            )}
          >
            {num(days, 1)} day{days === 1 ? '' : 's'} requested
            {typeId && ` · ${num(availableBalance, 1)} available`}
            {short && ' — more than your balance, so this will be refused on approval.'}
          </p>
        )}

        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Family matter" />
        </Field>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Resignation                                                                 */
/* -------------------------------------------------------------------------- */

const RESIGNATION_TONE: Record<ResignationRequestDetail['status'], 'warning' | 'good' | 'critical' | 'neutral'> = {
  Pending: 'warning',
  Approved: 'good',
  Declined: 'critical',
  Cancelled: 'neutral',
}

/**
 * Where an employee tells HR they intend to leave, instead of that only ever
 * happening as a conversation somebody in HR later types in after the fact.
 *
 * Submitting is not resigning — nothing on the 201 file moves until HR
 * approves it (see `ResignationRequests::decide` on the backend). This card
 * only ever shows the employee's own most recent request, so a declined one
 * does not linger looking like it is still in play.
 */
function ResignationCard() {
  const toast = useToast()
  const [request, setRequest] = React.useState<ResignationRequestDetail | null | undefined>(undefined)
  const [open, setOpen] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getMyResignation()
      .then(setRequest)
      .catch(() => setRequest(null))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const canSubmit = !request || request.status !== 'Pending'

  const withdraw = async () => {
    setCancelling(true)
    try {
      await cancelMyResignation()
      load()
      toast({ tone: 'success', title: 'Resignation withdrawn' })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not withdraw', description: (e as Error).message })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Resignation" subtitle="Tell HR your intended last day" />
      <div className="border-t border-line p-4 sm:p-5">
        {request === undefined ? (
          <p className="text-[13px] text-ink-3">Loading…</p>
        ) : request ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge tone={RESIGNATION_TONE[request.status]}>{request.status}</Badge>
              <span className="text-[12px] text-ink-2">
                Intended last day {request.intendedLastDay ? fmtDate(request.intendedLastDay) : '—'}
              </span>
            </div>
            {request.reason && <p className="text-[12px] text-ink-3">{request.reason}</p>}
            {request.status === 'Declined' && request.decisionNote && (
              <p className="rounded-lg bg-critical/10 p-2.5 text-[12px] text-critical">{request.decisionNote}</p>
            )}
            {request.status === 'Approved' && (
              <p className="rounded-lg bg-good/10 p-2.5 text-[12px] text-good">
                Approved — a clearance checklist has been started for you. Changed your mind? Ask HR to cancel it
                from Offboarding.
              </p>
            )}
            {request.status === 'Pending' && (
              <Button size="sm" variant="ghost" className="text-critical" loading={cancelling} onClick={() => void withdraw()}>
                <X className="size-3.5" />
                Withdraw request
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">You have not filed a resignation request.</p>
        )}

        {canSubmit && (
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
            <DoorOpen className="size-3.5" />
            Submit resignation
          </Button>
        )}
      </div>

      <SubmitResignationDialog
        open={open}
        onClose={() => setOpen(false)}
        onSubmitted={() => {
          load()
          toast({ tone: 'success', title: 'Resignation submitted', description: 'HR has been notified.' })
        }}
      />
    </Card>
  )
}

function SubmitResignationDialog({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [lastDay, setLastDay] = React.useState('')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    const d = new Date()
    d.setDate(d.getDate() + 30)
    setLastDay(d.toISOString().slice(0, 10))
    setReason('')
  }, [open])

  const submit = async () => {
    if (!lastDay) return
    setBusy(true)
    try {
      await submitResignation(lastDay, reason || undefined)
      onSubmitted()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not submit', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Submit resignation"
      description="This goes to HR as a request. Nothing on your record changes until they decide."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" loading={busy} disabled={!lastDay} onClick={() => void submit()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Intended last day" required>
          <Input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Certificate of Employment                                                  */
/* -------------------------------------------------------------------------- */

const COE_TONE: Record<CoeRequestDetail['status'], 'warning' | 'good' | 'critical'> = {
  Pending: 'warning',
  Issued: 'good',
  Declined: 'critical',
}

/**
 * Self-service COE requests. Most employees only ever want the certificate
 * as a plain letter — this asks for a purpose and whether to include salary,
 * files it with HR, and once HR issues it the download button appears here
 * with no separate trip to HR needed to hand over the paper.
 */
function CoeCard() {
  const toast = useToast()
  const [requests, setRequests] = React.useState<CoeRequestDetail[] | undefined>(undefined)
  const [open, setOpen] = React.useState(false)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getMyCoeRequests()
      .then(setRequests)
      .catch(() => setRequests([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const pendingTypes = new Set((requests ?? []).filter((r) => r.status === 'Pending').map((r) => r.type))

  return (
    <Card>
      <CardHeader title="Certificates" subtitle="Request one, download it once HR issues it" />
      <div className="border-t border-line p-4 sm:p-5">
        {requests === undefined ? (
          <p className="text-[13px] text-ink-3">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-[13px] text-ink-2">You have not requested a certificate.</p>
        ) : (
          <div className="space-y-2">
            {requests.slice(0, 5).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-canvas p-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={COE_TONE[r.status]}>{r.status}</Badge>
                    <span className="truncate text-[12px] text-ink-2">
                      {r.type} — {r.purpose || 'General purpose'}
                    </span>
                  </div>
                  {r.status === 'Declined' && r.decisionNote && (
                    <p className="mt-1 text-[11px] text-critical">{r.decisionNote}</p>
                  )}
                </div>
                {r.status === 'Issued' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void downloadMyCoeDocument(r.id, `Certificate of ${r.type} - ${r.name ?? r.id}.docx`).catch((e) =>
                        toast({ tone: 'error', title: 'Could not download', description: (e as Error).message }),
                      )
                    }
                  >
                    <Download className="size-3.5" />
                    Download
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
          <FileText className="size-3.5" />
          Request certificate
        </Button>
      </div>

      <SubmitCoeDialog
        open={open}
        onClose={() => setOpen(false)}
        pendingTypes={pendingTypes}
        onSubmitted={() => {
          load()
          toast({ tone: 'success', title: 'Request submitted', description: 'HR has been notified.' })
        }}
      />
    </Card>
  )
}

function SubmitCoeDialog({
  open,
  onClose,
  onSubmitted,
  pendingTypes,
}: {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
  pendingTypes: Set<CoeRequestType>
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [type, setType] = React.useState<CoeRequestType>('Employment')
  const [purpose, setPurpose] = React.useState('')
  const [includeSalary, setIncludeSalary] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setType('Employment')
    setPurpose('')
    setIncludeSalary(false)
  }, [open])

  const alreadyPending = pendingTypes.has(type)

  const submit = async () => {
    setBusy(true)
    try {
      await submitCoeRequest(purpose || undefined, type === 'Employment' ? includeSalary : false, type)
      onSubmitted()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not submit', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Request a certificate"
      description="HR will review and issue this — you'll be able to download it here once it's ready."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={alreadyPending} onClick={() => void submit()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Certificate" composite>
          <div className="flex gap-2">
            {(['Employment', 'No Derogatory Record'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'flex-1 rounded-lg border px-3 py-2 text-left text-[12.5px] font-medium transition-colors',
                  type === t
                    ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-line text-ink-2 hover:bg-surface-2',
                )}
              >
                {t === 'Employment' ? 'Certificate of Employment' : 'No Derogatory Record'}
              </button>
            ))}
          </div>
        </Field>

        {alreadyPending && (
          <p className="text-[12px] text-warning">
            You already have a {type} request awaiting HR — wait for that one before submitting another.
          </p>
        )}

        <Field label="Purpose">
          <Input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Bank loan application"
          />
        </Field>

        {type === 'Employment' && (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={includeSalary}
              onChange={(e) => setIncludeSalary(e.target.checked)}
              className="size-4 rounded border-line"
            />
            Include my monthly salary on the certificate
          </label>
        )}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Announcements                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Company (or department) notices, read-only here — filing one is HR's own
 * screen (HR → Announcements & Events). Shown at the top of Today, which is
 * the one tab everyone actually opens, rather than in a place an employee
 * has to know to go looking.
 */
function AnnouncementsBanner() {
  const [items, setItems] = React.useState<MyAnnouncement[]>([])

  React.useEffect(() => {
    if (!liveApi()) return
    getMyAnnouncements()
      .then(setItems)
      .catch(() => setItems([]))
  }, [])

  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader title="Announcements" subtitle="From HR" />
      <div className="divide-y divide-line border-t border-line">
        {items.map((a) => (
          <div key={a.id} className="px-4 py-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              {a.pinned && <Pin className="size-3.5 shrink-0 text-brand-500" />}
              {a.title}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{a.body}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Overtime pre-approval                                                      */
/* -------------------------------------------------------------------------- */

const OT_TONE: Record<OvertimeRequestDetail['status'], 'warning' | 'good' | 'critical'> = {
  Pending: 'warning',
  Approved: 'good',
  Declined: 'critical',
}

const otTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'

/**
 * Overtime, asked for in advance instead of only ever showing up as an
 * unexplained number on a timesheet. Filing here does not change what the
 * clock records — the punch is still what pays — this is the record of
 * whether a supervisor actually agreed to it beforehand.
 */
function OvertimeCard() {
  const toast = useToast()
  const [requests, setRequests] = React.useState<OvertimeRequestDetail[] | undefined>(undefined)
  const [open, setOpen] = React.useState(false)

  const load = React.useCallback(() => {
    if (!liveApi()) return
    getMyOvertimeRequests()
      .then(setRequests)
      .catch(() => setRequests([]))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <Card>
      <CardHeader title="Overtime pre-approval" subtitle="Ask before the shift, not after" />
      <div className="border-t border-line p-4 sm:p-5">
        {requests === undefined ? (
          <p className="text-[13px] text-ink-3">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-[13px] text-ink-2">You have not requested overtime pre-approval.</p>
        ) : (
          <div className="space-y-2">
            {requests.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-lg bg-canvas p-2.5">
                <div className="flex items-center gap-2">
                  <Badge tone={OT_TONE[r.status]}>{r.status}</Badge>
                  <span className="text-[12px] text-ink-2">
                    {r.workDate ? fmtDate(r.workDate) : '—'} · {otTime(r.expectedStartAt)}–{otTime(r.expectedEndAt)}
                  </span>
                </div>
                {r.status === 'Declined' && r.decisionNote && (
                  <p className="mt-1 text-[11px] text-critical">{r.decisionNote}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
          <Timer className="size-3.5" />
          Request overtime
        </Button>
      </div>

      <SubmitOvertimeDialog
        open={open}
        onClose={() => setOpen(false)}
        onSubmitted={() => {
          load()
          toast({ tone: 'success', title: 'Overtime request submitted' })
        }}
      />
    </Card>
  )
}

function SubmitOvertimeDialog({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  onSubmitted: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)
  const [workDate, setWorkDate] = React.useState('')
  const [start, setStart] = React.useState('')
  const [end, setEnd] = React.useState('')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setWorkDate(new Date().toISOString().slice(0, 10))
    setStart('')
    setEnd('')
    setReason('')
  }, [open])

  const submit = async () => {
    if (!workDate || !start || !end) return
    setBusy(true)
    try {
      await submitOvertimeRequest(workDate, `${workDate}T${start}`, `${workDate}T${end}`, reason || undefined)
      onSubmitted()
      onClose()
    } catch (e) {
      toast({ tone: 'error', title: 'Could not submit', description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Request overtime pre-approval"
      description="Filed with your supervisor before the shift — this doesn't change the punch record itself."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!workDate || !start || !end} onClick={() => void submit()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Work date" required>
          <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected start" required>
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Expected end" required>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': SelfServicePortal,
}
