/**
 * Formatting helpers. Every number, date and currency in the app goes through
 * here so a single change restyles the whole ERP consistently.
 */

import { company } from './company'

/**
 * Intl formatters are expensive to construct, so they are cached. The cache is
 * keyed by locale and currency because both are administrable settings — the
 * formatters must follow a currency change without a page reload.
 */
const formatterCache = new Map<string, Intl.NumberFormat>()

function numberFormat(options: Intl.NumberFormatOptions & { decimals?: number } = {}) {
  const { locale, currency } = company()
  const key = `${locale}|${currency}|${JSON.stringify(options)}`

  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { currency, ...options })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/** Currency symbol on its own, for the compact formatters. */
function currencySymbol() {
  const parts = numberFormat({ style: 'currency', maximumFractionDigits: 0 }).formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? ''
}

export function money(value: number, opts?: { decimals?: boolean }) {
  const digits = opts?.decimals === false ? 0 : 2
  return numberFormat({
    style: 'currency',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Compact money for KPI tiles and axis ticks: ₱1.2M, ₱840K. */
export function moneyCompact(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  const unit = currencySymbol()
  if (abs >= 1_000_000_000) return `${sign}${unit}${(abs / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)}B`
  if (abs >= 1_000_000) return `${sign}${unit}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${sign}${unit}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${sign}${unit}${abs.toFixed(0)}`
}

export function num(value: number, decimals = 0) {
  return numberFormat({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
}

export function numCompact(value: number) {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return `${sign}${numberFormat().format(abs)}`
}

export function percent(value: number, decimals = 1) {
  return `${value >= 0 ? '' : ''}${value.toFixed(decimals)}%`
}

export function signedPercent(value: number, decimals = 1) {
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()

function dateFormat(options: Intl.DateTimeFormatOptions) {
  const { locale } = company()
  const key = `${locale}|${JSON.stringify(options)}`

  let formatter = dateFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    dateFormatterCache.set(key, formatter)
  }
  return formatter
}

export function toDate(value: string | number | Date) {
  return value instanceof Date ? value : new Date(value)
}

export function fmtDate(value: string | number | Date) {
  return dateFormat({ year: 'numeric', month: 'short', day: '2-digit' }).format(toDate(value))
}

export function fmtDateTime(value: string | number | Date) {
  return dateFormat({
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(toDate(value))
}

/** ISO yyyy-mm-dd — the wire format the Laravel API will speak. */
export function isoDate(value: string | number | Date) {
  const d = toDate(value)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fmtRelative(value: string | number | Date) {
  const then = toDate(value).getTime()
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (Math.abs(mins) < 1) return 'just now'
  if (Math.abs(mins) < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (Math.abs(hours) < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return `${days}d ago`
  return fmtDate(then)
}

/** Days between a due date and today. Negative means overdue. */
export function daysUntil(value: string | number | Date) {
  const target = toDate(value)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/**
 * Initials for an avatar. Tolerates a missing name: an unassigned record is a
 * normal state — a lead with no owner, a delivery with no driver — and the API
 * sends null for those, so this must not be the thing that blanks the screen.
 */
export function initials(name: string | null | undefined) {
  if (!name?.trim()) return '?'

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/**
 * Turns a field name into a label. Handles snake_case, kebab-case and the
 * camelCase the API speaks — `validUntil` has to read "Valid Until", not
 * "Validuntil".
 */
export function titleCase(value: string) {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * ISO instant → the value a `datetime-local` input expects.
 *
 * That input is unzoned: it shows exactly the characters given to it. Slicing
 * an ISO string hands it UTC, so a visit booked for 10:00 in Manila renders as
 * 02:00 and any technician reading the form is eight hours out. The parts are
 * taken from the local getters instead.
 */
export function toLocalInput(value: string | number | Date | null | undefined) {
  if (!value) return ''
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The inverse: a `datetime-local` value read back as an ISO instant. */
export function fromLocalInput(value: string) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
