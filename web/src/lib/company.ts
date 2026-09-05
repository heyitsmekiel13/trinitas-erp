import * as React from 'react'
import { API_BASE_URL } from './api'

/**
 * The company profile used across the app — screen chrome, printed
 * letterheads, exported files and outgoing documents.
 *
 * Values come from the database (Admin → System Settings → Company) when the
 * API is connected, and fall back to these defaults otherwise, so printing
 * never renders "undefined" on a fresh install.
 *
 * Deliberately framework-agnostic: `company()` works inside plain modules like
 * the export engine, while `useCompany()` re-renders React consumers when the
 * profile is loaded or changed.
 */

export type CompanyProfile = {
  /** Trading name — what people call the business. */
  name: string
  /** Registered name — what goes on statutory documents. */
  legalName: string
  address: string
  tin: string
  phone: string
  email: string
  currency: string
  locale: string
  /** 1-12. Drives period close and fiscal reporting. */
  fiscalYearStart: number
  /** Absolute URL, or null when no logo has been uploaded. */
  logoUrl: string | null
  /** Fewest characters any new password may have — set in Settings → Security. */
  minPasswordLength: number
}

export const DEFAULT_COMPANY: CompanyProfile = {
  name: 'Trinitas ERP',
  legalName: 'Premium Kitchen Equipment Inc.',
  address: '',
  tin: '',
  phone: '',
  email: '',
  currency: 'PHP',
  locale: 'en-PH',
  fiscalYearStart: 1,
  logoUrl: null,
  minPasswordLength: 4,
}

let current: CompanyProfile = DEFAULT_COMPANY
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

/** Reads the current profile. Safe to call from anywhere, including modules. */
export function company(): CompanyProfile {
  return current
}

export function setCompany(patch: Partial<CompanyProfile>) {
  current = { ...current, ...patch }
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React binding. Re-renders when the profile loads or an admin edits it. */
export function useCompany(): CompanyProfile {
  return React.useSyncExternalStore(subscribe, company, () => DEFAULT_COMPANY)
}

/**
 * Pulls the profile from the API. Called at start-up and again after the
 * company settings are saved.
 *
 * Reads the public `branding` endpoint rather than the authenticated settings
 * one, because the sign-in screen needs the name and logo before anybody has
 * a token. Failure is silent by design — a branding fetch that fails must
 * never stop someone signing in.
 */
export async function loadCompany(): Promise<void> {
  if (!import.meta.env.VITE_API_URL) return

  try {
    const response = await fetch(`${API_BASE_URL}/branding`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return

    const body = await response.json()
    const data = body?.data ?? body

    setCompany({
      name: data.trade_name || data.legal_name || DEFAULT_COMPANY.name,
      legalName: data.legal_name || DEFAULT_COMPANY.legalName,
      address: data.address ?? '',
      tin: data.tin ?? '',
      phone: data.phone ?? '',
      email: data.email ?? '',
      currency: data.currency || DEFAULT_COMPANY.currency,
      fiscalYearStart: Number(data.fiscal_year_start) || 1,
      logoUrl: data.logo_path ? `${API_BASE_URL}/public-files/${data.logo_path}` : null,
      minPasswordLength: Number(data.min_password_length) || DEFAULT_COMPANY.minPasswordLength,
    })
  } catch {
    // Offline or the API is down — the defaults already cover us.
  }
}
