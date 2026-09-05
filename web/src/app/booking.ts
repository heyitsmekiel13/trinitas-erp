import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Maintenance booking.
 *
 * Requesters book a technician visit from a public page; the daily cap stops
 * any one technician being over-committed. State persists locally until the
 * Laravel endpoints are wired, at which point only the two async calls at the
 * bottom change.
 */

export type ServiceType = {
  id: string
  name: string
  description: string
  durationMinutes: number
}

export const SERVICE_TYPES: ServiceType[] = [
  { id: 'preventive', name: 'Preventive service', description: 'Scheduled inspection and servicing of an asset.', durationMinutes: 90 },
  { id: 'repair', name: 'Corrective repair', description: 'Fix a reported fault or breakdown.', durationMinutes: 120 },
  { id: 'inspection', name: 'Safety inspection', description: 'Compliance check and certification.', durationMinutes: 60 },
  { id: 'installation', name: 'Installation / relocation', description: 'Install, move or commission equipment.', durationMinutes: 180 },
]

export type Booking = {
  id: string
  reference: string
  technician: string
  serviceTypeId: string
  /** yyyy-mm-dd */
  date: string
  /** HH:mm, 24-hour */
  time: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string
  site: string
  assetCode: string
  notes: string
  status: 'Confirmed' | 'Cancelled' | 'Completed'
  createdAt: string
}

export type BookingSettings = {
  /** Maximum bookings a single technician can take in one day. */
  dailyCapPerTechnician: number
  /** Slot start times offered, in 24-hour HH:mm. */
  slotTimes: string[]
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[]
  /** Bookings must be at least this many hours ahead. */
  minimumNoticeHours: number
  /** How far ahead the calendar opens. */
  bookingWindowDays: number
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  dailyCapPerTechnician: 4,
  slotTimes: ['08:00', '10:00', '13:00', '15:00'],
  workingDays: [1, 2, 3, 4, 5],
  minimumNoticeHours: 4,
  bookingWindowDays: 60,
}

type BookingState = {
  settings: BookingSettings
  bookings: Booking[]
  setSettings: (patch: Partial<BookingSettings>) => void
  addBooking: (booking: Omit<Booking, 'id' | 'reference' | 'status' | 'createdAt'>) => Booking
  cancelBooking: (id: string) => void
}

export const useBooking = create<BookingState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_BOOKING_SETTINGS,
      bookings: [],

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      addBooking: (input) => {
        const sequence = get().bookings.length + 1
        const booking: Booking = {
          ...input,
          id: `bk-${Date.now()}-${sequence}`,
          reference: `MB-${new Date().getFullYear()}-${String(sequence).padStart(4, '0')}`,
          status: 'Confirmed',
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ bookings: [...s.bookings, booking] }))
        return booking
      },

      cancelBooking: (id) =>
        set((s) => ({
          bookings: s.bookings.map((b) => (b.id === id ? { ...b, status: 'Cancelled' } : b)),
        })),
    }),
    { name: 'trinitas.bookings' },
  ),
)

/** yyyy-mm-dd for a Date, in local time (never UTC-shifted). */
export function dateKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Confirmed bookings a technician already holds on a given day. */
export function bookingsOnDate(bookings: Booking[], technician: string, date: string) {
  return bookings.filter((b) => b.technician === technician && b.date === date && b.status === 'Confirmed')
}

export function remainingCapacity(bookings: Booking[], settings: BookingSettings, technician: string, date: string) {
  return Math.max(0, settings.dailyCapPerTechnician - bookingsOnDate(bookings, technician, date).length)
}

/** Slots still open for a technician on a date, honouring cap and notice period. */
export function availableSlots(
  bookings: Booking[],
  settings: BookingSettings,
  technician: string,
  date: string,
): { time: string; available: boolean; reason?: string }[] {
  const taken = new Set(bookingsOnDate(bookings, technician, date).map((b) => b.time))
  const capacityLeft = remainingCapacity(bookings, settings, technician, date)
  const noticeCutoff = Date.now() + settings.minimumNoticeHours * 3_600_000

  return settings.slotTimes.map((time) => {
    if (taken.has(time)) return { time, available: false, reason: 'Booked' }
    if (capacityLeft <= 0) return { time, available: false, reason: 'Day full' }
    const [hours, minutes] = time.split(':').map(Number)
    const slotAt = new Date(`${date}T00:00:00`)
    slotAt.setHours(hours!, minutes!, 0, 0)
    if (slotAt.getTime() < noticeCutoff) return { time, available: false, reason: 'Too soon' }
    return { time, available: true }
  })
}

export function isBookableDay(settings: BookingSettings, date: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + settings.bookingWindowDays)
  return settings.workingDays.includes(date.getDay()) && date >= today && date <= horizon
}

export function formatSlot(time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours! >= 12 ? 'PM' : 'AM'
  const hour12 = hours! % 12 === 0 ? 12 : hours! % 12
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`
}
