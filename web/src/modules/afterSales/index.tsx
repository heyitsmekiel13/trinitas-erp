import * as React from 'react'
import {
  CalendarPlus,
  ClipboardList,
  ExternalLink,
  FileSignature,
  PhoneCall,
  Plus,
  Search,
  Timer,
  User,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, fmtDateTime, money, num } from '@/lib/format'
import { exportCsv } from '@/lib/export'
import {
  REQUEST_STATUSES,
  priorityOf,
  sumMoney,
  type ServiceJob,
  type ServiceReport,
  type ServiceRequest,
} from '@/data/afterSales'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, Input, Segmented, Select } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, ErrorState, SkeletonTable, useToast } from '@/components/ui/feedback'
import { Dashboard } from './dashboard'
import { ServiceReportForm, ReportSummary, blankReport } from './ServiceReportForm'
import { useAfterSales } from './useAfterSales'
import { AvailabilitySettings } from './availability'
import { ScheduleBoard } from './board'
import { Scheduler } from './Scheduler'
import { VISIT_TONE, useSchedule } from './schedule'
import { dateKey, formatClock, slaState, type Visit } from '@/data/scheduling'
import { ServiceContracts } from './contracts'

/* ========================================================================== */
/* Service requests — the intake queue                                        */
/* ========================================================================== */

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'good' | 'warning' | 'critical'> = {
  Pending: 'warning',
  'For Scheduling': 'info',
  Scheduled: 'info',
  Done: 'good',
  Cancelled: 'neutral',
}

/**
 * The response clock, on the calls that still owe one.
 *
 * The SLA table has been printed on the dashboard since the module was built,
 * and nothing anywhere measured against it. A promise nobody can see running
 * out is a promise the business finds out about from the client, so the two
 * states worth acting on — breached, and about to be — sit at the top of the
 * queue with the one action that stops the clock.
 */
function ResponseQueue() {
  const availability = useSchedule((s) => s.availability)
  const visits = useSchedule((s) => s.visits)
  const recordResponse = useSchedule((s) => s.recordResponse)

  const owing = React.useMemo(() => {
    const now = new Date()
    return visits
      .filter((v) => v.respondBy && !v.respondedAt && v.status === 'Scheduled')
      .map((v) => ({ visit: v, sla: slaState(v, availability, now) }))
      .filter((row): row is { visit: Visit; sla: NonNullable<ReturnType<typeof slaState>> } => row.sla !== null)
      .filter((row) => row.sla.breached || row.sla.atRisk)
      .sort((a, b) => a.sla.minutesLeft - b.sla.minutesLeft)
  }, [visits, availability])

  if (!owing.length) return null

  const breached = owing.filter((r) => r.sla.breached).length

  return (
    <Card className={cn('mb-4', breached ? 'border-critical/40' : 'border-warning/40')}>
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
        <div>
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
            <Timer className="size-4 text-warning" />
            Response promises running out
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            Measured in working hours against the priority the client chose. Ringing them stops the clock.
          </p>
        </div>
        <Badge tone={breached ? 'critical' : 'warning'} dot>
          {num(owing.length)}
        </Badge>
      </div>

      <div className="divide-y divide-line border-t border-line">
        {owing.slice(0, 6).map(({ visit, sla }) => {
          const priority = priorityOf(visit.priority)
          const hours = Math.abs(sla.minutesLeft) / 60
          return (
            <div key={visit.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
              <Badge tone={sla.breached ? 'critical' : 'warning'} dot>
                {sla.breached ? 'Breached' : 'At risk'}
              </Badge>
              {priority && <Badge tone={priority.tone as 'critical'}>{priority.label}</Badge>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{visit.client || 'Unnamed'}</span>
                <span className="block truncate text-[11px] text-ink-3">
                  {visit.equipment} · booked {fmtDateTime(visit.createdAt)}
                </span>
              </span>
              <span
                className={cn(
                  'tabular shrink-0 text-[12px] font-medium',
                  sla.breached ? 'text-critical' : 'text-warning',
                )}
              >
                {sla.breached ? `${num(hours, 1)} h over` : `${num(hours, 1)} h left`}
              </span>
              <Button variant="primary" size="xs" onClick={() => recordResponse(visit.id, 'Contacted from the queue')}>
                <PhoneCall className="size-3" />
                Mark contacted
              </Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function ServiceRequests() {
  const { isLoading, error, refetch, requests, summary } = useAfterSales()
  const visits = useSchedule((s) => s.visits)
  const technicians = useSchedule((s) => s.technicians)
  const seedTechnicians = useSchedule((s) => s.seedTechnicians)

  const [status, setStatus] = React.useState<string>('open')
  const [query, setQuery] = React.useState('')
  const [opened, setOpened] = React.useState<ServiceRequest | null>(null)
  const [scheduling, setScheduling] = React.useState<ServiceRequest | null>(null)

  // The roster comes from the technicians the revenue history already names.
  React.useEffect(() => {
    if (!technicians.length && summary.technicians.length) {
      seedTechnicians(summary.technicians.slice(0, 8).map((t) => t.name))
    }
  }, [technicians.length, summary.technicians, seedTechnicians])

  /**
   * The visit booked against a request.
   *
   * Keyed on ticket *and* client, because the intake issues ticket numbers by
   * hand and 95 of them are used twice — RT 00646 belongs to three different
   * businesses. Keying on the number alone would show one client's appointment
   * on another client's row.
   */
  const requestKey = (ticket: string, client: string) =>
    `${ticket.trim()}|${client.trim().toLowerCase()}`

  const visitByTicket = React.useMemo(() => {
    const map = new Map<string, Visit>()
    for (const visit of visits) {
      if (visit.ticket && visit.status !== 'Cancelled') {
        map.set(requestKey(visit.ticket, visit.client), visit)
      }
    }
    return map
  }, [visits])

  /** Ticket numbers the intake reused across different clients. */
  const duplicateTickets = React.useMemo(() => {
    const seen = new Map<string, number>()
    for (const request of requests) seen.set(request.ticket, (seen.get(request.ticket) ?? 0) + 1)
    return [...seen.values()].filter((n) => n > 1).length
  }, [requests])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return requests
      .filter((r) => {
        if (q && !`${r.ticket} ${r.client} ${r.branch} ${r.equipment} ${r.issue}`.toLowerCase().includes(q)) {
          return false
        }
        if (status === 'open') return r.status !== 'Done' && r.status !== 'Cancelled'
        if (status === 'unscheduled') {
          return r.status !== 'Done' && r.status !== 'Cancelled' && !visitByTicket.has(requestKey(r.ticket, r.client))
        }
        if (status === 'booked') return visitByTicket.has(requestKey(r.ticket, r.client))
        if (status === 'all') return true
        return r.status === status
      })
      .sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
  }, [requests, query, status, visitByTicket])

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const open = requests.filter((r) => r.status !== 'Done' && r.status !== 'Cancelled')
  const p1 = open.filter((r) => r.priority === 1)

  return (
    <div>
      <PageHeader
        title="Service Requests"
        description="Every repair request a client has raised. Imported from the intake form so the whole history is in one place, and new ones arrive here from the booking page."
        meta={
          <>
            <Badge tone="neutral">{num(requests.length)} on file</Badge>
            {p1.length > 0 && (
              <Badge tone="critical" dot>
                {num(p1.length)} critical open
              </Badge>
            )}
            {duplicateTickets > 0 && (
              <Badge tone="warning">
                {num(duplicateTickets)} ticket numbers reused
              </Badge>
            )}
          </>
        }
        actions={
          <>
          <Button variant="secondary" size="sm" onClick={() => window.open('/book/service', '_blank', 'noopener')}>
            <ExternalLink className="size-3.5" />
            <span className="hidden sm:inline">Client booking page</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportCsv(
                'service-requests',
                [
                  { header: 'Ticket', value: (r: ServiceRequest) => r.ticket },
                  { header: 'Requested', value: (r: ServiceRequest) => (r.requestedAt ? fmtDateTime(r.requestedAt) : '') },
                  { header: 'Status', value: (r: ServiceRequest) => r.status },
                  { header: 'Client', value: (r: ServiceRequest) => r.client },
                  { header: 'Branch', value: (r: ServiceRequest) => r.branch },
                  { header: 'Segment', value: (r: ServiceRequest) => r.clientType },
                  { header: 'Equipment', value: (r: ServiceRequest) => r.equipment },
                  { header: 'Priority', value: (r: ServiceRequest) => r.priority ?? '' },
                  { header: 'Issue', value: (r: ServiceRequest) => r.issue },
                ],
                visible,
              )
            }
          >
            Export
          </Button>
          </>
        }
      />

      <ResponseQueue />

      <StatGrid className="mb-4">
        <StatTile label="Open" value={num(open.length)} hint="Not done, not cancelled" />
        <StatTile label="Critical" value={num(p1.length)} hint="Non-operational or a safety risk" />
        <StatTile
          label="Awaiting triage"
          value={num(requests.filter((r) => r.status === 'Pending').length)}
          hint="No schedule set yet"
        />
        <StatTile
          label="Completed"
          value={num(requests.filter((r) => r.status === 'Done').length)}
          hint="Across the whole history"
        />
      </StatGrid>

      <Card className="mb-4 p-3" data-print="hide">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a ticket, client, branch or fault…"
              className="h-9 pl-8"
            />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto min-w-[11rem]">
            <option value="open">Open requests</option>
            <option value="unscheduled">Open, not yet booked</option>
            <option value="booked">Has a visit booked</option>
            <option value="all">All requests</option>
            {REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <SkeletonTable rows={8} cols={5} />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={ClipboardList} title="Nothing here" description="No request matches this view." />
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.slice(0, 200).map((request, index) => {
            const priority = priorityOf(request.priority)
            return (
              // The ticket number is not unique in the imported data, so the
              // row's position completes the key.
              <Card key={`${request.ticket}-${index}`} className="p-3">
                <button type="button" onClick={() => setOpened(request)} className="w-full text-left">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-mono text-[13px] font-semibold text-ink">RT {request.ticket}</span>
                    <Badge tone={STATUS_TONE[request.status] ?? 'neutral'} dot>
                      {request.status}
                    </Badge>
                    {priority && <Badge tone={priority.tone as 'critical'}>{priority.label}</Badge>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{request.client}</span>
                      <span className="block truncate text-[11px] text-ink-3">
                        {request.equipment}
                        {request.branch ? ` · ${request.branch}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {request.requestedAt ? fmtDate(request.requestedAt) : '—'}
                    </span>
                  </div>
                </button>

                {/* The booking, if this ticket already has one — otherwise the
                    one action that moves it forward. */}
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  {visitByTicket.get(requestKey(request.ticket, request.client)) ? (
                    (() => {
                      const visit = visitByTicket.get(requestKey(request.ticket, request.client))!
                      const start = new Date(visit.start)
                      return (
                        <>
                          <Badge tone={VISIT_TONE[visit.status]} dot>
                            {visit.status}
                          </Badge>
                          <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
                            <CalendarPlus className="size-3.5 text-ink-3" />
                            {start.toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
                            {formatClock(start.getHours() * 60 + start.getMinutes())}
                          </span>
                          <span className="flex items-center gap-1 text-[12px] text-ink-3">
                            <User className="size-3" />
                            {visit.technicianName}
                          </span>
                          <span className="font-mono text-[11px] text-ink-3">{visit.id}</span>
                          {visit.reportId && (
                            <Badge tone="good">
                              <FileSignature className="size-3" />
                              TSR written
                            </Badge>
                          )}
                        </>
                      )
                    })()
                  ) : (
                    <>
                      <span className="flex-1 text-[11px] text-ink-3">No visit booked yet.</span>
                      <Button variant="primary" size="xs" onClick={() => setScheduling(request)}>
                        <CalendarPlus className="size-3" />
                        Schedule a visit
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            )
          })}
          {visible.length > 200 && (
            <p className="py-2 text-center text-[12px] text-ink-3">
              Showing the 200 most recent of {num(visible.length)}. Narrow the search to see older ones.
            </p>
          )}
        </div>
      )}

      <Modal
        open={opened !== null}
        onClose={() => setOpened(null)}
        size="lg"
        title={opened ? `Repair ticket ${opened.ticket}` : ''}
        description={opened ? `${opened.client} · ${opened.clientType}` : undefined}
        footer={
          <Button variant="primary" size="sm" onClick={() => setOpened(null)}>
            Close
          </Button>
        }
      >
        {opened && (
          <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            {[
              ['Requested', opened.requestedAt ? fmtDateTime(opened.requestedAt) : '—'],
              ['Status', opened.status],
              ['Priority', priorityOf(opened.priority)?.detail ?? 'Not stated'],
              ['Request type', opened.requestType],
              ['Equipment', `${opened.equipment}${opened.equipmentRaw && opened.equipmentRaw !== opened.equipment ? ` (as written: ${opened.equipmentRaw})` : ''}`],
              ['Branch / address', opened.branch || '—'],
              ['Contact', [opened.contact, opened.phone, opened.email].filter(Boolean).join(' · ') || '—'],
              ['Preferred time', opened.preferredTime || '—'],
              ['Segment', `${opened.clientType}${opened.clientTypeRaw && opened.clientTypeRaw !== opened.clientType ? ` (as written: ${opened.clientTypeRaw})` : ''}`],
              ['Remarks', opened.remarks || '—'],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
                <dd className="mt-1 text-[13px] break-words text-ink">{value}</dd>
              </div>
            ))}
            <div className="col-span-full">
              <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Reported fault</dt>
              <dd className="mt-1 text-[13px] text-ink">{opened.issue || '—'}</dd>
            </div>
            {opened.attachment && (
              <div className="col-span-full">
                <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">Attachment</dt>
                <dd className="mt-1 text-[13px]">
                  <a
                    href={opened.attachment}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand-600 underline underline-offset-2 dark:text-brand-400"
                  >
                    Photo or video supplied by the client
                  </a>
                </dd>
              </div>
            )}
          </dl>
        )}
      </Modal>

      {/* Booking straight from the queue — the request's own details are
          carried across, so nobody retypes a client name that is already on
          screen. */}
      <Modal
        open={scheduling !== null}
        onClose={() => setScheduling(null)}
        size="2xl"
        title={scheduling ? `Schedule ticket ${scheduling.ticket}` : ''}
        description={scheduling ? `${scheduling.client} · ${scheduling.equipment}` : undefined}
        footer={
          <Button variant="secondary" size="sm" onClick={() => setScheduling(null)}>
            Close
          </Button>
        }
      >
        {scheduling && (
          <Scheduler
            mode="dispatch"
            prefill={{
              ticket: scheduling.ticket,
              client: scheduling.client,
              address: scheduling.branch,
              clientType: scheduling.clientType,
              contact: scheduling.contact,
              phone: scheduling.phone,
              email: scheduling.email,
              equipment: scheduling.equipment,
              issue: scheduling.issue,
              priority: scheduling.priority,
            }}
            onBooked={() => setScheduling(null)}
          />
        )}
      </Modal>
    </div>
  )
}

/* ========================================================================== */
/* Technician Service Reports                                                 */
/* ========================================================================== */

function ServiceReports() {
  const toast = useToast()
  const reports = useSchedule((s) => s.reports)
  const saveReport = useSchedule((s) => s.saveReport)
  const visits = useSchedule((s) => s.visits)
  const attachReport = useSchedule((s) => s.attachReport)

  const [draft, setDraft] = React.useState<ServiceReport | null>(null)
  // The visit this draft answers, so saving can close it out.
  const [fromVisit, setFromVisit] = React.useState<string | null>(null)

  /** Visits that happened but have no report — the paperwork backlog. */
  const awaiting = React.useMemo(
    () =>
      visits
        .filter((v) => !v.reportId && (v.status === 'Completed' || v.status === 'On site' || new Date(v.end) < new Date()))
        .filter((v) => v.status !== 'Cancelled' && v.status !== 'No show')
        .sort((a, b) => b.start.localeCompare(a.start)),
    [visits],
  )

  /**
   * Starts a report already knowing what the visit knows.
   *
   * The whole point of the chain: the client, the address, the equipment and
   * the times are on the booking, so the technician writes findings and scope
   * rather than re-copying a header from a job card.
   */
  const startFromVisit = (visit: Visit) => {
    const base = blankReport(reports[0]?.series)
    setFromVisit(visit.id)
    setDraft({
      ...base,
      ticket: visit.ticket,
      client: visit.client,
      clientAddress: visit.address,
      clientType: visit.clientType,
      reportDate: dateKey(new Date(visit.start)),
      timeIn: visit.start,
      timeOut: visit.end,
      equipment: [{ type: visit.equipment, description: '' }],
      findings: visit.issue,
      leadTechnician: visit.technicianName,
    })
  }

  const save = () => {
    if (!draft) return
    saveReport(draft)
    if (fromVisit) attachReport(fromVisit, draft.id)

    const total = sumMoney(draft.revenue) + sumMoney(draft.costs)
    toast({
      tone: 'success',
      title: `TSR ${draft.series} saved`,
      description: total
        ? `${money(total, { decimals: false })} charged — it appears on the Revenue Report straight away.`
        : 'No charge recorded yet — add one and it flows into the Revenue Report.',
    })
    setDraft(null)
    setFromVisit(null)
  }

  return (
    <div>
      <PageHeader
        title="Technician Service Reports"
        description="The TSR pad, as a form. Every field of the printed sheet, with the time on site and the charge worked out for you — and it still prints for the client to sign."
        meta={
          <>
            <Badge tone="neutral">{num(reports.length)} written</Badge>
            {awaiting.length > 0 && (
              <Badge tone="warning" dot>
                {num(awaiting.length)} visit{awaiting.length === 1 ? '' : 's'} awaiting paperwork
              </Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setFromVisit(null)
              setDraft(blankReport(reports[0]?.series))
            }}
          >
            <Plus className="size-3.5" />
            New TSR
          </Button>
        }
      />

      {/* The backlog, first — a report written from its visit needs almost no
          typing, so this is the fastest way in. */}
      {awaiting.length > 0 && (
        <Card className="mb-4">
          <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3 sm:px-5">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Visits awaiting a report</h3>
              <p className="mt-0.5 text-xs text-ink-3">
                Start from the visit and the header fills itself in — client, address, equipment and the times on site.
              </p>
            </div>
            <Badge tone="warning">{num(awaiting.length)}</Badge>
          </div>
          <div className="divide-y divide-line border-t border-line">
            {awaiting.slice(0, 8).map((visit) => (
              <div key={visit.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                <span className="font-mono text-[12px] text-ink-2">{visit.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{visit.client}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {visit.equipment} · {visit.technicianName} ·{' '}
                    {new Date(visit.start).toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })}
                  </span>
                </span>
                <Badge tone={VISIT_TONE[visit.status]}>{visit.status}</Badge>
                <Button variant="primary" size="xs" onClick={() => startFromVisit(visit)}>
                  <FileSignature className="size-3" />
                  Write the TSR
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {reports.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="No service report yet"
            description="Write one after a repair and it lists here, with its charge flowing into the Revenue Report."
            action={
              <Button variant="primary" size="sm" onClick={() => setDraft(blankReport())}>
                <Plus className="size-3.5" />
                New TSR
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {reports.map((report) => (
            <button
              key={report.id}
              type="button"
              onClick={() => {
                setFromVisit(visits.find((v) => v.reportId === report.id)?.id ?? null)
                setDraft(report)
              }}
              className="block w-full text-left"
            >
              <ReportSummary report={report} />
            </button>
          ))}
        </div>
      )}

      <Modal
        open={draft !== null}
        onClose={() => {
          setDraft(null)
          setFromVisit(null)
        }}
        size="2xl"
        dirty
        title={draft ? `Technician Service Report ${draft.series}` : ''}
        description="Fill it as you would the pad — the totals and the time on site work themselves out."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft(null)
                setFromVisit(null)
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              Save report
            </Button>
          </>
        }
      >
        {draft && <ServiceReportForm report={draft} onChange={setDraft} />}
      </Modal>
    </div>
  )
}

/* ========================================================================== */
/* Revenue report                                                             */
/* ========================================================================== */

function RevenueReport() {
  const { isLoading, error, refetch, jobs: imported, summary } = useAfterSales()
  const reports = useSchedule((s) => s.reports)
  const visits = useSchedule((s) => s.visits)

  const [month, setMonth] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [view, setView] = React.useState<'billed' | 'unbilled' | 'all'>('billed')

  /**
   * Reports written here become revenue lines directly.
   *
   * This is the join the spreadsheet never had: on paper the charge is re-keyed
   * from a photo of the TSR days later, which is why 61 imported jobs carry no
   * revenue at all. A report saved in the app is already a revenue row.
   */
  const jobs: ServiceJob[] = React.useMemo(() => {
    const fromReports: ServiceJob[] = reports.map((report) => {
      const visit = visits.find((v) => v.reportId === report.id)
      const revenue = Object.fromEntries(
        Object.entries(report.revenue).filter(([, v]) => Number(v) > 0),
      ) as Record<string, number>
      const costs = Object.fromEntries(
        Object.entries(report.costs).filter(([, v]) => Number(v) > 0),
      ) as Record<string, number>

      return {
        sheet: 'Written in the ERP',
        tsr: `TSR ${report.series}`,
        ticket: report.ticket,
        repairedOn: report.reportDate ? `${report.reportDate}T00:00:00` : null,
        submittedOn: null,
        clientType: report.clientType,
        client: report.client,
        address: report.clientAddress,
        equipment: report.equipment[0]?.type ?? 'Others',
        equipmentRaw: report.equipment.map((e) => e.type).join(', '),
        srNo: report.series,
        drNo: '',
        requestedWork: report.status.join(', '),
        repairType: report.status.includes('Major Repair')
          ? 'Major Repair'
          : report.status.includes('Minor Repair')
            ? 'Minor Repair'
            : report.status.includes('PMS')
              ? 'PMS'
              : 'Others',
        technicians: [report.leadTechnician, report.assistantTechnician, visit?.technicianName]
          .filter((n): n is string => Boolean(n))
          .filter((n, i, all) => all.indexOf(n) === i),
        costs,
        revenue,
        costTotal: sumMoney(report.costs),
        revenueTotal: sumMoney(report.revenue),
        statedTotal: sumMoney(report.revenue) + sumMoney(report.costs),
      }
    })

    return [...fromReports, ...imported]
  }, [reports, visits, imported])

  const months = React.useMemo(
    () => [...new Set(jobs.map((j) => j.sheet))],
    [jobs],
  )

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return jobs.filter((j) => {
      if (month !== 'all' && j.sheet !== month) return false
      if (q && !`${j.tsr} ${j.client} ${j.equipment} ${j.technicians.join(' ')}`.toLowerCase().includes(q)) return false
      if (view === 'billed') return j.revenueTotal > 0
      if (view === 'unbilled') return j.revenueTotal === 0
      return true
    })
  }, [jobs, month, query, view])

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />

  const shown = {
    revenue: visible.reduce((s, j) => s + j.revenueTotal, 0),
    costs: visible.reduce((s, j) => s + j.costTotal, 0),
  }
  const unbilled = jobs.filter((j) => j.revenueTotal === 0).length

  return (
    <div>
      <PageHeader
        title="Maintenance Revenue Report"
        description="What each service call earned and what it cost to get there — every month of the workbook in one list, with the reimbursables beside the fee instead of in a column nobody totals."
        meta={
          <>
            <Badge tone="neutral">{num(jobs.length)} jobs</Badge>
            {reports.length > 0 && (
              <Badge tone="good" dot>
                {num(reports.length)} from reports written here
              </Badge>
            )}
            {unbilled > 0 && (
              <Badge tone="warning" dot>
                {num(unbilled)} with no revenue recorded
              </Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportCsv(
                'maintenance-revenue',
                [
                  { header: 'Month', value: (j: ServiceJob) => j.sheet },
                  { header: 'TSR', value: (j: ServiceJob) => j.tsr },
                  { header: 'Ticket', value: (j: ServiceJob) => j.ticket },
                  { header: 'Repaired', value: (j: ServiceJob) => (j.repairedOn ? fmtDate(j.repairedOn) : '') },
                  { header: 'Client', value: (j: ServiceJob) => j.client },
                  { header: 'Segment', value: (j: ServiceJob) => j.clientType },
                  { header: 'Equipment', value: (j: ServiceJob) => j.equipment },
                  { header: 'Work type', value: (j: ServiceJob) => j.repairType },
                  { header: 'Technicians', value: (j: ServiceJob) => j.technicians.join(' | ') },
                  { header: 'Revenue', value: (j: ServiceJob) => j.revenueTotal },
                  { header: 'Costs', value: (j: ServiceJob) => j.costTotal },
                  { header: 'Billed', value: (j: ServiceJob) => j.revenueTotal + j.costTotal },
                ],
                visible,
              )
            }
          >
            Export
          </Button>
        }
      />

      <StatGrid className="mb-4">
        <StatTile label="Revenue shown" value={money(shown.revenue, { decimals: false })} hint={`${num(visible.length)} jobs`} />
        <StatTile label="Costs shown" value={money(shown.costs, { decimals: false })} hint="Recovered from the client" />
        <StatTile
          label="Net of expenses"
          value={money(shown.revenue - shown.costs, { decimals: false })}
          hint="Service fee less what it cost to attend"
        />
        <StatTile
          label="All-time revenue"
          value={money(summary.revenue, { decimals: false })}
          hint={`${num(summary.billedJobs)} billed of ${num(summary.jobs)}`}
        />
      </StatGrid>

      <Card className="mb-4 p-3" data-print="hide">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a TSR, client, equipment or technician…"
              className="h-9 pl-8"
            />
          </div>
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-auto min-w-[11rem]">
            <option value="all">Every month</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'billed', label: 'Billed' },
              { value: 'unbilled', label: `No revenue (${num(unbilled)})` },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <SkeletonTable rows={10} cols={7} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] tracking-wider text-ink-3 uppercase">
                  <th className="px-3 py-2.5 text-left">Job</th>
                  <th className="px-3 py-2.5 text-left">Client</th>
                  <th className="px-3 py-2.5 text-left">Work</th>
                  <th className="px-3 py-2.5 text-left">Technicians</th>
                  <th className="px-3 py-2.5 text-right">Revenue</th>
                  <th className="px-3 py-2.5 text-right">Costs</th>
                  <th className="px-3 py-2.5 text-right">Billed</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 300).map((job, i) => (
                  <tr key={`${job.sheet}-${job.tsr}-${i}`} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2">
                      <span className="block truncate font-mono text-[12px] text-ink">{job.tsr || '—'}</span>
                      <span className="block text-[11px] text-ink-3">
                        {job.repairedOn ? fmtDate(job.repairedOn) : job.sheet}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate text-ink">{job.client || '—'}</span>
                      <span className="block truncate text-[11px] text-ink-3">{job.clientType}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="block truncate text-ink-2">{job.repairType}</span>
                      <span className="block truncate text-[11px] text-ink-3">{job.equipment}</span>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-3">
                      {job.technicians.length ? job.technicians.join(', ') : '—'}
                    </td>
                    <td className={cn('tabular px-3 py-2 text-right', job.revenueTotal ? 'text-ink' : 'text-ink-3')}>
                      {job.revenueTotal ? money(job.revenueTotal, { decimals: false }) : '—'}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-ink-3">
                      {job.costTotal ? money(job.costTotal, { decimals: false }) : '—'}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium text-ink">
                      {money(job.revenueTotal + job.costTotal, { decimals: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length > 300 && (
            <p className="border-t border-line py-2 text-center text-[12px] text-ink-3">
              Showing 300 of {num(visible.length)} — narrow by month or search.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  requests: ServiceRequests,
  schedule: ScheduleBoard,
  reports: ServiceReports,
  revenue: RevenueReport,
  contracts: ServiceContracts,
  availability: AvailabilitySettings,
}
