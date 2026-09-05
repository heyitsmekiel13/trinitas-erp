import * as React from 'react'
import { Cake, Gift, Megaphone, PartyPopper, Pin } from 'lucide-react'
import { getUpcomingEvents, liveApi, type UpcomingEvent } from '@/lib/adminApi'
import { fmtDate, num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * The company calendar — notices HR posts, and the birthdays, hire
 * anniversaries and holidays nobody should have to remember by hand.
 *
 * Birthdays and anniversaries are never a data-entry screen here: they are
 * read straight from the 201 file's birth date and hire date (see
 * `HrEvents::upcoming` on the server), so there is nothing to keep in sync.
 * Announcements and Holidays are the two things that genuinely are their
 * own records, and both already had a working CRUD backend before this
 * screen existed — Holidays fed payroll's holiday-pay computation but had
 * no UI of its own until now.
 */

type Announcement = {
  id: number
  title: string
  body: string
  hrDepartmentId: number | null
  department: string | null
  pinned: boolean
  publishedAt: string
  expiresAt: string | null
  createdBy: string | null
}

type Holiday = {
  id: number
  holidayDate: string
  name: string
  type: string
  branch: string | null
  branchUnitId: number | null
}

const HOLIDAY_TONE: Record<string, 'critical' | 'warning' | 'neutral'> = {
  Regular: 'critical',
  'Special Non-Working': 'warning',
  Local: 'neutral',
}

const EVENT_META: Record<UpcomingEvent['type'], { icon: typeof Cake; label: string; tone: 'brand' | 'good' | 'warning' }> = {
  birthday: { icon: Cake, label: 'Birthday', tone: 'brand' },
  anniversary: { icon: Gift, label: 'Anniversary', tone: 'good' },
  holiday: { icon: PartyPopper, label: 'Holiday', tone: 'warning' },
}

function Announcements() {
  const c = cols<Announcement>()

  if (!liveApi()) {
    return (
      <div className="card">
        <EmptyState icon={Megaphone} title="Needs the live API" description="Announcements are read and written on the server." />
      </div>
    )
  }

  return (
    <ResourcePage<Announcement>
      title="Announcements"
      description="Company-wide (or one-department) notices. A pinned one stays at the top; an expired one stops showing on its own."
      endpoint="hr/announcements"
      loader={() => []}
      exportName="announcements"
      createLabel="New announcement"
      formFields={forms.announcementFields}
      formDefaults={forms.announcementDefaults}
      formTitle="announcement"
      stats={(list) => (
        <StatGrid>
          <StatTile label="Total" value={num(list.length)} icon={Megaphone} />
          <StatTile label="Pinned" value={num(list.filter((a) => a.pinned).length)} icon={Pin} />
          <StatTile
            label="Company-wide"
            value={num(list.filter((a) => !a.hrDepartmentId).length)}
            icon={Megaphone}
            hint="No department set"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.title}
      detailSubtitle={(row) => row.department ?? 'Company-wide'}
      columns={[
        c.primary('title', 'Title', (row) => (row.pinned ? 'Pinned' : '')),
        c.text('department', 'Audience', { secondary: true }),
        c.date('publishedAt', 'Published'),
        c.date('expiresAt', 'Expires', { secondary: true }),
        c.text('createdBy', 'Posted by', { secondary: true }),
      ]}
    />
  )
}

function Holidays() {
  const c = cols<Holiday>()

  if (!liveApi()) {
    return (
      <div className="card">
        <EmptyState icon={PartyPopper} title="Needs the live API" description="Holidays are read and written on the server." />
      </div>
    )
  }

  return (
    <ResourcePage<Holiday>
      title="Holidays"
      description="The calendar payroll's holiday pay is computed against. A branch left blank means nationwide."
      endpoint="hr/holidays"
      loader={() => []}
      exportName="holidays"
      createLabel="New holiday"
      formFields={forms.holidayFields}
      formDefaults={forms.holidayDefaults}
      formTitle="holiday"
      stats={(list) => (
        <StatGrid>
          <StatTile label="This year" value={num(list.filter((h) => h.holidayDate.startsWith(String(new Date().getFullYear()))).length)} icon={PartyPopper} />
          <StatTile label="Regular" value={num(list.filter((h) => h.type === 'Regular').length)} icon={PartyPopper} />
          <StatTile label="Special Non-Working" value={num(list.filter((h) => h.type === 'Special Non-Working').length)} icon={PartyPopper} />
        </StatGrid>
      )}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => fmtDate(row.holidayDate)}
      columns={[
        c.date('holidayDate', 'Date'),
        c.primary('name', 'Holiday'),
        c.level('type', 'Type', HOLIDAY_TONE),
        c.text('branch', 'Branch', { secondary: true }),
      ]}
    />
  )
}

function UpcomingEvents() {
  const [events, setEvents] = React.useState<UpcomingEvent[] | undefined>(undefined)
  const [days, setDays] = React.useState(30)

  React.useEffect(() => {
    if (!liveApi()) return
    setEvents(undefined)
    getUpcomingEvents(days)
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [days])

  if (!liveApi()) {
    return (
      <div className="card">
        <EmptyState icon={Cake} title="Needs the live API" description="Read from the 201 file and the holiday calendar." />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[14, 30, 60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
              days === d ? 'bg-brand-500 text-white' : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
            }`}
          >
            Next {d} days
          </button>
        ))}
      </div>

      {events === undefined ? (
        <div className="card h-64 shimmer" />
      ) : events.length === 0 ? (
        <div className="card">
          <EmptyState icon={Cake} title="Nothing coming up" description={`No birthdays, anniversaries or holidays in the next ${days} days.`} />
        </div>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {events.map((e, i) => {
            const meta = EVENT_META[e.type]
            const Icon = meta.icon
            return (
              <div key={`${e.type}-${e.employeeId ?? 'holiday'}-${e.date}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon className="size-4 text-ink-2" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {e.name}
                    {e.detail && <span className="ml-1.5 text-[11px] font-normal text-ink-3">· {e.detail}</span>}
                  </p>
                  <p className="text-[11px] text-ink-3">
                    {fmtDate(e.date)}
                    {e.department && ` · ${e.department}`}
                    {e.employeeNo && ` · ${e.employeeNo}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="w-14 text-right text-[11px] text-ink-3">
                    {e.daysUntil === 0 ? 'Today' : e.daysUntil === 1 ? 'Tomorrow' : `in ${e.daysUntil}d`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function AnnouncementsAndEvents() {
  return (
    <div>
      <PageHeader
        title="Announcements & Events"
        description="Company notices, plus the birthdays, hire anniversaries and holidays coming up — read from the 201 file and the holiday calendar, not typed in twice."
      />

      <TabbedArea
        storageKey="announcements"
        tabs={[
          { id: 'upcoming', label: 'Upcoming', hint: 'Birthdays, anniversaries and holidays coming up.', render: () => <UpcomingEvents /> },
          { id: 'announcements', label: 'Announcements', hint: 'Company or department notices.', render: () => <Announcements /> },
          { id: 'holidays', label: 'Holidays', hint: 'The calendar holiday pay is computed against.', render: () => <Holidays /> },
        ]}
      />
    </div>
  )
}
