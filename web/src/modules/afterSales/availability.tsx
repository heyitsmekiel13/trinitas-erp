import * as React from 'react'
import { CalendarOff, ExternalLink, Plus, ShieldCheck, Trash2, UserCog, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { num } from '@/lib/format'
import {
  DEFAULT_WEEK,
  WEEKDAYS,
  dateKey,
  formatClock,
  toClock,
  toMinutes,
  type Technician,
  type Window,
} from '@/data/scheduling'
import { EQUIPMENT_TYPES, PRIORITIES, type EquipmentType } from '@/data/afterSales'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, CardHeader, Input, Select, Switch } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { useSchedule } from './schedule'

/**
 * Availability — the supervisor's controls.
 *
 * Everything the booking page offers is derived from this screen, so it is
 * written as a set of decisions rather than a settings dump: which days the
 * shop works, how long a visit takes, how much travel to leave between them,
 * who is on the roster, and when each of them is away.
 *
 * Nothing here can double-book anybody. Narrowing availability leaves existing
 * commitments alone — a visit already promised to a client is not something a
 * settings change should silently cancel — but it does stop new ones landing
 * there, and the conflicts it creates are listed so they can be moved.
 */

function WindowRow({
  window,
  onChange,
  onRemove,
}: {
  window: Window
  onChange: (next: Window) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="time"
        value={toClock(window.start)}
        onChange={(e) => onChange({ ...window, start: toMinutes(e.target.value) })}
        className="h-8 w-28 text-[12px]"
      />
      <span className="text-[11px] text-ink-3">to</span>
      <Input
        type="time"
        value={toClock(window.end)}
        onChange={(e) => onChange({ ...window, end: toMinutes(e.target.value) })}
        className="h-8 w-28 text-[12px]"
      />
      <Button variant="ghost" size="icon-sm" aria-label="Remove this window" onClick={onRemove}>
        <X className="size-3.5 text-ink-3" />
      </Button>
    </div>
  )
}

function WeekEditor({
  week,
  onChange,
}: {
  week: Window[][]
  onChange: (weekday: number, windows: Window[]) => void
}) {
  return (
    <div className="divide-y divide-line">
      {WEEKDAYS.map((label, weekday) => {
        const windows = week[weekday] ?? []
        return (
          <div key={label} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:px-5">
            <div className="w-24 shrink-0">
              <p className="text-[13px] font-medium text-ink">{label}</p>
              <p className="text-[11px] text-ink-3">{windows.length ? `${windows.length} window${windows.length === 1 ? '' : 's'}` : 'Closed'}</p>
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              {windows.map((window, i) => (
                <WindowRow
                  key={i}
                  window={window}
                  onChange={(next) => onChange(weekday, windows.map((w, j) => (j === i ? next : w)))}
                  onRemove={() => onChange(weekday, windows.filter((_, j) => j !== i))}
                />
              ))}

              <div className="flex gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    onChange(weekday, [...windows, windows.length ? { start: 780, end: 1020 } : { start: 480, end: 720 }])
                  }
                >
                  <Plus className="size-3" />
                  Add window
                </Button>
                {windows.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={() => onChange(weekday, [])}>
                    Close this day
                  </Button>
                )}
                {windows.length === 0 && (
                  <Button variant="ghost" size="xs" onClick={() => onChange(weekday, DEFAULT_WEEK[1]!)}>
                    Use standard hours
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function TechnicianEditor({
  technician,
  onClose,
}: {
  technician: Technician | null
  onClose: () => void
}) {
  const upsert = useSchedule((s) => s.upsertTechnician)
  const [draft, setDraft] = React.useState<Technician | null>(technician)

  React.useEffect(() => setDraft(technician), [technician])
  if (!draft) return null

  const set = <K extends keyof Technician>(key: K, value: Technician[K]) => setDraft({ ...draft, [key]: value })
  const overriding = draft.week !== null

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={draft.name || 'New technician'}
      description="Their own hours, days away and what they are trusted to work on."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!draft.name.trim()}
            onClick={() => {
              upsert(draft)
              onClose()
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Name</span>
            <Input value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Maximum visits per day
            </span>
            <Input
              type="number"
              min={1}
              max={12}
              value={draft.maxPerDay}
              onChange={(e) => set('maxPerDay', Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>

        <label className="flex items-start gap-3">
          <Switch checked={draft.active} onChange={(v) => set('active', v)} label="On duty" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">On duty</span>
            <span className="text-[11px] text-ink-3">
              Turning this off stops new bookings without touching visits already promised.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3">
          <Switch
            checked={overriding}
            onChange={(v) => set('week', v ? DEFAULT_WEEK.map((d) => [...d]) : null)}
            label="Own working hours"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">Works different hours from the shop</span>
            <span className="text-[11px] text-ink-3">
              Off by default — they follow the shop week, so changing it once changes everyone.
            </span>
          </span>
        </label>

        {overriding && draft.week && (
          <Card className="overflow-hidden">
            <WeekEditor
              week={draft.week}
              onChange={(weekday, windows) =>
                set('week', draft.week!.map((d, i) => (i === weekday ? windows : d)))
              }
            />
          </Card>
        )}

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
            Trusted to work on
          </span>
          <p className="mb-2 text-[11px] text-ink-3">
            Leave every box clear for a generalist — an empty list means anything. Ticking some means the booking page
            will only offer this person for those units.
          </p>
          <div className="flex flex-wrap gap-1">
            {EQUIPMENT_TYPES.map((type) => {
              const on = draft.skills.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    set('skills', on ? draft.skills.filter((s) => s !== type) : [...draft.skills, type as EquipmentType])
                  }
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[11px] transition-colors',
                    on
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'border-line bg-surface text-ink-3 hover:border-brand-300',
                  )}
                >
                  {type}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
            Days away
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {draft.blackouts.map((day) => (
              <Badge key={day} tone="warning">
                {day}
                <button type="button" onClick={() => set('blackouts', draft.blackouts.filter((d) => d !== day))}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Input
              type="date"
              className="h-8 w-40 text-[12px]"
              onChange={(e) => {
                if (e.target.value && !draft.blackouts.includes(e.target.value)) {
                  set('blackouts', [...draft.blackouts, e.target.value].sort())
                }
                e.target.value = ''
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */

export function AvailabilitySettings() {
  const toast = useToast()
  const availability = useSchedule((s) => s.availability)
  const technicians = useSchedule((s) => s.technicians)
  const visits = useSchedule((s) => s.visits)
  const setAvailability = useSchedule((s) => s.setAvailability)
  const setShopWeek = useSchedule((s) => s.setShopWeek)
  const toggleBlackout = useSchedule((s) => s.toggleBlackout)
  const removeTechnician = useSchedule((s) => s.removeTechnician)

  const [editing, setEditing] = React.useState<Technician | null>(null)

  const bookingUrl = `${window.location.origin}/book/service`
  const activeCount = technicians.filter((t) => t.active).length

  // Commitments that no longer sit inside the hours now allowed. Listed rather
  // than auto-cancelled — the client was promised a time.
  const stranded = React.useMemo(() => {
    return visits.filter((visit) => {
      if (visit.status === 'Cancelled' || visit.status === 'No show') return false
      const day = dateKey(new Date(visit.start))
      const technician = technicians.find((t) => t.id === visit.technicianId)
      if (!technician) return true
      if (availability.blackouts.includes(day) || technician.blackouts.includes(day)) return true
      if (!technician.active) return true

      const start = new Date(visit.start)
      const minutes = start.getHours() * 60 + start.getMinutes()
      const length = Math.round((new Date(visit.end).getTime() - start.getTime()) / 60_000)
      const week = technician.week ?? availability.week
      const windows = week[start.getDay()] ?? []
      return !windows.some((w) => minutes >= w.start && minutes + length <= w.end)
    })
  }, [visits, technicians, availability])

  return (
    <div>
      <PageHeader
        title="Availability & Roster"
        description="What the booking page is allowed to offer. Every slot a client can pick is this, minus what is already committed, minus travel time."
        meta={
          <>
            <Badge tone={availability.publicBookingOpen ? 'good' : 'warning'} dot>
              {availability.publicBookingOpen ? 'Online booking open' : 'Online booking closed'}
            </Badge>
            <Badge tone="neutral">
              {num(activeCount)} of {num(technicians.length)} on duty
            </Badge>
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => window.open('/book/service', '_blank', 'noopener')}>
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Open booking page</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                setEditing({
                  id: `tech-${Date.now()}`,
                  name: '',
                  active: true,
                  week: null,
                  blackouts: [],
                  maxPerDay: 3,
                  skills: [],
                })
              }
            >
              <Plus className="size-3.5" />
              Add technician
            </Button>
          </>
        }
      />

      <StatGrid className="mb-4">
        <StatTile label="On duty" value={num(activeCount)} icon={UserCog} hint="Bookable technicians" />
        <StatTile
          label="Visit length"
          value={`${availability.slotMinutes} min`}
          icon={ShieldCheck}
          hint={`plus ${availability.travelBufferMinutes} min travel either side`}
        />
        <StatTile
          label="Shop closures"
          value={num(availability.blackouts.length)}
          icon={CalendarOff}
          hint="Days nobody is bookable"
        />
        <StatTile
          label="Clashing commitments"
          value={num(stranded.length)}
          icon={CalendarOff}
          hint={stranded.length ? 'Booked outside the hours now allowed' : 'Every visit fits the roster'}
        />
      </StatGrid>

      {stranded.length > 0 && (
        <Card className="mb-4 border-warning/40">
          <CardHeader
            title="Visits that no longer fit the roster"
            subtitle="Narrowing availability never cancels a promise — move these instead."
            action={<Badge tone="warning">{num(stranded.length)}</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {stranded.slice(0, 6).map((visit) => (
              <p key={visit.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px] sm:px-5">
                <span className="font-mono text-[12px] text-ink-2">{visit.id}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{visit.client}</span>
                <span className="text-[11px] text-ink-3">
                  {new Date(visit.start).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                  {visit.technicianName}
                </span>
              </p>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader title="Shop working week" subtitle="Everyone follows this unless they have their own hours." />
            <div className="border-t border-line">
              <WeekEditor week={availability.week} onChange={setShopWeek} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Technicians"
              subtitle="Who can be booked, and what each is trusted to work on."
              action={<Badge tone="neutral">{num(technicians.length)}</Badge>}
            />
            <div className="divide-y divide-line border-t border-line">
              {technicians.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-ink-3 sm:px-5">
                  No technicians yet — the roster seeds itself from the revenue history the first time the dashboard
                  loads, or add them by hand.
                </p>
              )}
              {technicians.map((technician) => (
                <div key={technician.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <button type="button" onClick={() => setEditing(technician)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] font-medium text-ink">{technician.name}</p>
                    <p className="truncate text-[11px] text-ink-3">
                      {technician.active ? 'On duty' : 'Off duty'} · up to {technician.maxPerDay}/day ·{' '}
                      {technician.week ? 'own hours' : 'shop hours'} ·{' '}
                      {technician.skills.length ? `${technician.skills.length} skills` : 'any equipment'}
                      {technician.blackouts.length ? ` · ${technician.blackouts.length} days away` : ''}
                    </p>
                  </button>
                  {!technician.active && <Badge tone="neutral">Off duty</Badge>}
                  <Button variant="secondary" size="xs" onClick={() => setEditing(technician)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${technician.name}`}
                    onClick={() => {
                      const theirs = visits.filter(
                        (v) => v.technicianId === technician.id && v.status === 'Scheduled',
                      ).length
                      if (theirs) {
                        toast({
                          tone: 'warning',
                          title: 'Still has visits booked',
                          description: `${technician.name} has ${theirs} scheduled visit${theirs === 1 ? '' : 's'}. Move those first, or set them off duty instead.`,
                        })
                        return
                      }
                      removeTechnician(technician.id)
                    }}
                  >
                    <Trash2 className="size-3.5 text-critical" />
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Booking rules" subtitle="How the slot grid is built." />
            <div className="space-y-3.5 px-4 pb-4 sm:px-5">
              <label className="flex items-start gap-3">
                <Switch
                  checked={availability.publicBookingOpen}
                  onChange={(v) => setAvailability({ publicBookingOpen: v })}
                  label="Online booking open"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">Accept bookings online</span>
                  <span className="text-[11px] text-ink-3">
                    Turning this off shows a "please call us" message instead of the calendar.
                  </span>
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Visit length (minutes)
                </span>
                <Select
                  value={String(availability.slotMinutes)}
                  onChange={(e) => setAvailability({ slotMinutes: Number(e.target.value) })}
                >
                  {[60, 90, 120, 180, 240].map((n) => (
                    <option key={n} value={n}>
                      {n} minutes
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Travel buffer (minutes)
                </span>
                <Input
                  type="number"
                  min={0}
                  max={240}
                  value={availability.travelBufferMinutes}
                  onChange={(e) => setAvailability({ travelBufferMinutes: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="mt-1 block text-[11px] text-ink-3">
                  Held either side of every visit. This is what stops two jobs across town being booked back to back.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Minimum notice (hours)
                </span>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  value={availability.leadTimeHours}
                  onChange={(e) => setAvailability({ leadTimeHours: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>

              {/*
                  The emergency lead time.

                  Without it the two promises on the booking page contradicted
                  each other: Priority 1 undertakes a response in four hours,
                  and the calendar refused anything inside twelve. A client
                  whose fryer was smoking could not book the visit the SLA
                  promised them, which is the sort of gap that is invisible
                  until somebody complains with the page open in front of them.
              */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Priority 1 notice (hours)
                </span>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  value={availability.emergencyLeadTimeHours}
                  onChange={(e) =>
                    setAvailability({ emergencyLeadTimeHours: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
                <span className="mt-1 block text-[11px] text-ink-3">
                  A non-operational or unsafe unit is promised a response in {PRIORITIES[0].respondHours} hours. Keep
                  this at or below that, or the calendar cannot honour the promise beside it.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Book up to (days ahead)
                </span>
                <Input
                  type="number"
                  min={1}
                  max={180}
                  value={availability.horizonDays}
                  onChange={(e) => setAvailability({ horizonDays: Math.max(1, Number(e.target.value) || 1) })}
                />
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="After the booking"
              subtitle="What the client can do for themselves, and what a technician-hour costs."
            />
            <div className="space-y-3.5 px-4 pb-4 sm:px-5">
              <label className="flex items-start gap-3">
                <Switch
                  checked={availability.allowClientReschedule}
                  onChange={(v) => setAvailability({ allowClientReschedule: v })}
                  label="Clients may reschedule"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">Let clients move their own visit</span>
                  <span className="text-[11px] text-ink-3">
                    With the code from their confirmation. A reschedule that costs a phone call and a wait tends to
                    arrive as a no-show instead.
                  </span>
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Changes close (hours before)
                </span>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  value={availability.rescheduleCutoffHours}
                  onChange={(e) =>
                    setAvailability({ rescheduleCutoffHours: Math.max(0, Number(e.target.value) || 0) })
                  }
                />
                <span className="mt-1 block text-[11px] text-ink-3">
                  Inside this window the technician may already be on their way, so changes go through the desk.
                </span>
              </label>

              <label className="flex items-start gap-3">
                <Switch
                  checked={availability.collectCsat}
                  onChange={(v) => setAvailability({ collectCsat: v })}
                  label="Ask for a rating"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">Ask how the visit went</span>
                  <span className="text-[11px] text-ink-3">
                    Offered on the tracking page once the visit is completed. It is the only client-side quality
                    measure the module has.
                  </span>
                </span>
              </label>

              {/*
                  Not a wage. Salary, statutory contributions, the van, the
                  tools and the idle hours between jobs — otherwise the margin
                  figure flatters every long job and the business quietly stops
                  believing the column.
              */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Loaded cost per technician-hour
                </span>
                <Input
                  type="number"
                  min={0}
                  value={availability.labourRatePerHour}
                  onChange={(e) => setAvailability({ labourRatePerHour: Math.max(0, Number(e.target.value) || 0) })}
                />
                <span className="mt-1 block text-[11px] text-ink-3">
                  Used for job margin and for costing rework. Include the van, the tools and the hours between jobs,
                  not just the wage.
                </span>
              </label>
            </div>
          </Card>

          <Card>
            <CardHeader title="Shop closures" subtitle="Holidays and days nobody attends." />
            <div className="px-4 pb-4 sm:px-5">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {availability.blackouts.length === 0 && (
                  <p className="text-[12px] text-ink-3">None set.</p>
                )}
                {availability.blackouts.map((day) => (
                  <Badge key={day} tone="warning">
                    {day}
                    <button type="button" onClick={() => toggleBlackout(day)} aria-label={`Remove ${day}`}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <Input
                type="date"
                onChange={(e) => {
                  if (e.target.value) toggleBlackout(e.target.value)
                  e.target.value = ''
                }}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Client booking link" subtitle="Share this; it needs no sign-in." />
            <div className="px-4 pb-4 sm:px-5">
              <div className="flex gap-1.5">
                <Input readOnly value={bookingUrl} className="font-mono text-[11px]" />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(bookingUrl)
                    toast({ tone: 'success', title: 'Link copied' })
                  }}
                >
                  Copy
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-ink-3">
                Opens on its own, with your letterhead. The hours above are the only thing it will offer.
              </p>
            </div>
          </Card>
        </div>
      </div>

      <TechnicianEditor technician={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

/** Shared by the schedule board's day header. */
export function windowLabel(windows: Window[]) {
  return windows.length ? windows.map((w) => `${formatClock(w.start)}–${formatClock(w.end)}`).join(', ') : 'Closed'
}
