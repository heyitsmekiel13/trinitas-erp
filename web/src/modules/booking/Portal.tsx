import * as React from 'react'
import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Printer,
  User,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate } from '@/lib/format'
import { useCompany } from '@/lib/company'
import { dataset } from '@/data/dataset'
import {
  SERVICE_TYPES,
  availableSlots,
  dateKey,
  formatSlot,
  isBookableDay,
  remainingCapacity,
  useBooking,
  type Booking,
} from '@/app/booking'
import { Badge, Button, Field, Input, Select, Textarea } from '@/components/ui/primitives'

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function monthMatrix(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

/**
 * Public booking portal.
 *
 * Deliberately outside the ERP shell: it opens in its own tab and needs no
 * sign-in, so a branch or a driver can request a technician visit directly.
 */
export function BookingPortal() {
  const company = useCompany()
  const settings = useBooking((s) => s.settings)
  const bookings = useBooking((s) => s.bookings)
  const addBooking = useBooking((s) => s.addBooking)

  const technicians = React.useMemo(
    () =>
      dataset()
        .employees.filter((e) => e.department === 'Maintenance' && e.status !== 'Resigned')
        .map((e) => ({ name: e.name, position: e.position })),
    [],
  )
  const sites = React.useMemo(() => dataset().sites.map((s) => s.name), [])

  const [serviceTypeId, setServiceTypeId] = React.useState(SERVICE_TYPES[0]!.id)
  const [technician, setTechnician] = React.useState(technicians[0]?.name ?? '')
  const [month, setMonth] = React.useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null)
  const [selectedTime, setSelectedTime] = React.useState<string | null>(null)
  const [confirmed, setConfirmed] = React.useState<Booking | null>(null)

  const [form, setForm] = React.useState({
    requesterName: '',
    requesterEmail: '',
    requesterPhone: '',
    site: sites[0] ?? '',
    assetCode: '',
    notes: '',
  })

  const service = SERVICE_TYPES.find((s) => s.id === serviceTypeId)!
  const days = React.useMemo(() => monthMatrix(month), [month])
  const slots = selectedDate ? availableSlots(bookings, settings, technician, selectedDate) : []

  const canSubmit =
    selectedDate && selectedTime && form.requesterName.trim() && form.requesterEmail.trim() && form.site

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    const booking = addBooking({
      technician,
      serviceTypeId,
      date: selectedDate!,
      time: selectedTime!,
      ...form,
    })
    setConfirmed(booking)
  }

  /* ------------------------------ Confirmation ---------------------------- */
  if (confirmed) {
    return (
      <div className="min-h-dvh bg-page px-5 py-10">
        <div className="mx-auto w-full max-w-lg">
          <div className="card overflow-hidden">
            <div className="grad-brand px-6 py-7 text-center text-white">
              <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                <Check className="size-6" />
              </span>
              <h1 className="text-[19px] font-semibold tracking-tight">Booking confirmed</h1>
              <p className="mt-1 text-[13px] text-white/80">
                A confirmation has been emailed to {confirmed.requesterEmail}.
              </p>
            </div>

            <dl className="divide-y divide-line">
              {[
                ['Reference', confirmed.reference],
                ['Service', SERVICE_TYPES.find((s) => s.id === confirmed.serviceTypeId)!.name],
                ['Technician', confirmed.technician],
                ['Date', fmtDate(`${confirmed.date}T00:00:00`)],
                ['Time', `${formatSlot(confirmed.time)} · ${service.durationMinutes} minutes`],
                ['Location', confirmed.site],
                ...(confirmed.assetCode ? [['Asset', confirmed.assetCode]] : []),
                ['Requested by', `${confirmed.requesterName} · ${confirmed.requesterPhone || 'no phone given'}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 px-5 py-3">
                  <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
                  <dd className="text-right text-[13px] font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap gap-2 border-t border-line bg-surface-2 px-5 py-4">
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer className="size-4" />
                Print
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmed(null)
                  setSelectedTime(null)
                }}
              >
                Book another visit
              </Button>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] text-ink-3">
            Need to reschedule? Reply to the confirmation email quoting {confirmed.reference}.
          </p>
        </div>
      </div>
    )
  }

  /* -------------------------------- Booking ------------------------------- */
  return (
    <div className="min-h-dvh bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-4">
          <span className="grad-brand flex size-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white">
            T
          </span>
          <div className="min-w-0">
            <p className="text-[15px] leading-tight font-semibold text-ink">Maintenance Booking</p>
            <p className="truncate text-[11px] text-ink-3">{company.name}</p>
          </div>
          <Badge tone="brand" className="ml-auto shrink-0">
            {settings.dailyCapPerTechnician} visits / technician / day
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Request a technician visit</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] text-ink-3">
          Choose the service, pick an available slot, and tell us where to go. Slots close automatically once a
          technician reaches the daily limit.
        </p>

        <div className="mt-6 grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)_20rem]">
          {/* ------------------------- Service & technician ------------------------ */}
          <section className="card h-fit p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-ink">1. What do you need?</h2>

            <div className="space-y-2">
              {SERVICE_TYPES.map((s) => {
                const active = s.id === serviceTypeId
                return (
                  <button
                    key={s.id}
                    onClick={() => setServiceTypeId(s.id)}
                    className={cn(
                      'w-full rounded-xl border p-3 text-left transition-colors',
                      active
                        ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950'
                        : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Wrench className={cn('size-3.5 shrink-0', active ? 'text-brand-500' : 'text-ink-3')} />
                      <span className="text-[13px] font-medium text-ink">{s.name}</span>
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-3">{s.description}</span>
                    <span className="mt-1.5 flex items-center gap-1 text-[11px] text-ink-3">
                      <Clock className="size-3" />
                      {s.durationMinutes} minutes
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 border-t border-line pt-4">
              <Field label="Technician" required>
                <Select
                  value={technician}
                  onChange={(e) => {
                    setTechnician(e.target.value)
                    setSelectedTime(null)
                  }}
                >
                  {technicians.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name} — {t.position}
                    </option>
                  ))}
                </Select>
              </Field>

              {selectedDate && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-3">
                  <User className="size-3" />
                  {remainingCapacity(bookings, settings, technician, selectedDate)} of{' '}
                  {settings.dailyCapPerTechnician} slots left on {fmtDate(`${selectedDate}T00:00:00`)}
                </p>
              )}
            </div>
          </section>

          {/* ------------------------------- Calendar ------------------------------ */}
          <section className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-ink">2. Pick a date and time</h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[8.5rem] text-center text-[13px] font-medium text-ink">
                  {month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next month"
                  onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-1">
              {WEEKDAY_LABELS.map((d) => (
                <span key={d} className="py-1 text-center text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                  {d}
                </span>
              ))}

              {days.map((day) => {
                const key = dateKey(day)
                const inMonth = day.getMonth() === month.getMonth()
                const bookable = isBookableDay(settings, day)
                const full = bookable && remainingCapacity(bookings, settings, technician, key) === 0
                const selected = key === selectedDate

                return (
                  <button
                    key={key}
                    disabled={!bookable || full}
                    onClick={() => {
                      setSelectedDate(key)
                      setSelectedTime(null)
                    }}
                    className={cn(
                      'relative aspect-square rounded-lg text-[13px] transition-colors',
                      !inMonth && 'opacity-35',
                      selected
                        ? 'grad-brand font-semibold text-white'
                        : bookable && !full
                          ? 'text-ink hover:bg-surface-3'
                          : 'cursor-not-allowed text-ink-3',
                    )}
                    title={full ? 'Fully booked' : bookable ? undefined : 'Not available'}
                  >
                    {day.getDate()}
                    {full && !selected && (
                      <span className="absolute inset-x-0 bottom-1 flex justify-center">
                        <span className="size-1 rounded-full bg-critical" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 border-t border-line pt-4">
              {!selectedDate ? (
                <p className="py-6 text-center text-xs text-ink-3">Select a date to see available times.</p>
              ) : (
                <>
                  <p className="mb-2.5 flex items-center gap-1.5 text-[12px] font-medium text-ink">
                    <CalendarDays className="size-3.5 text-ink-3" />
                    {fmtDate(`${selectedDate}T00:00:00`)}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {slots.map((slot) => (
                      <button
                        key={slot.time}
                        disabled={!slot.available}
                        onClick={() => setSelectedTime(slot.time)}
                        className={cn(
                          'rounded-lg border px-2 py-2.5 text-[13px] font-medium transition-colors',
                          selectedTime === slot.time
                            ? 'grad-brand border-transparent text-white'
                            : slot.available
                              ? 'border-line-strong text-ink hover:border-brand-400 hover:bg-surface-2'
                              : 'cursor-not-allowed border-line text-ink-3 line-through',
                        )}
                      >
                        {formatSlot(slot.time)}
                        {!slot.available && <span className="mt-0.5 block text-[10px] no-underline">{slot.reason}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>

          {/* -------------------------------- Details ------------------------------ */}
          <section className="card h-fit p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-ink">3. Your details</h2>

            <form onSubmit={submit} className="space-y-3">
              <Field label="Your name" required>
                <Input
                  value={form.requesterName}
                  onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
                  placeholder="Full name"
                  required
                />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={form.requesterEmail}
                  onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })}
                  placeholder="name@company.com"
                  required
                />
              </Field>
              <Field label="Mobile number">
                <Input
                  value={form.requesterPhone}
                  onChange={(e) => setForm({ ...form, requesterPhone: e.target.value })}
                  placeholder="+63 9XX XXX XXXX"
                />
              </Field>
              <Field label="Site" required>
                <Select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} required>
                  {sites.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Asset code" hint="Optional — e.g. TRK-004 or MHE-011.">
                <Input
                  value={form.assetCode}
                  onChange={(e) => setForm({ ...form, assetCode: e.target.value.toUpperCase() })}
                  placeholder="TRK-004"
                />
              </Field>
              <Field label="What is the issue?">
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Describe the fault or what needs doing…"
                />
              </Field>

              {selectedDate && selectedTime && (
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                    <CalendarCheck className="size-3.5" />
                    Your slot
                  </p>
                  <p className="mt-1.5 text-[13px] font-medium text-ink">
                    {fmtDate(`${selectedDate}T00:00:00`)} at {formatSlot(selectedTime)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
                    <MapPin className="size-3" />
                    {technician} · {form.site}
                  </p>
                </div>
              )}

              <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} className="w-full">
                Confirm booking
              </Button>

              {!canSubmit && (
                <p className="text-center text-[11px] text-ink-3">
                  Pick a date and time, then fill in your name, email and site.
                </p>
              )}
            </form>
          </section>
        </div>
      </main>
    </div>
  )
}
