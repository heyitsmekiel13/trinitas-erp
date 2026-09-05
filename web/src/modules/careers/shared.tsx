import * as React from 'react'
import { Link } from 'react-router-dom'
import { Briefcase } from 'lucide-react'
import { useCompany } from '@/lib/company'
import type { JobSummary } from '@/lib/careersApi'

/**
 * The careers site's chrome and the small shared pieces.
 *
 * The letterhead is deliberately not the application's `AppShell`. Somebody
 * looking for a job is not an employee, has no sidebar of departments to be
 * shown, and should not be able to tell from this page how the company's
 * internal software is laid out.
 */

export function CareersLetterhead({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  const company = useCompany()

  return (
    <div className="min-h-dvh bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <Link to="/careers" className="flex items-center gap-3">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt="" className="size-10 rounded-lg object-contain" />
            ) : (
              <span className="grad-brand flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold tracking-tight text-ink uppercase">
                {company.name}
              </span>
              <span className="block text-[11px] font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-400">
                Careers
              </span>
            </span>
          </Link>

          {action}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>

      <footer className="mt-8 border-t border-line px-5 py-6 text-center text-[11px] leading-relaxed text-ink-3">
        <p>
          © {new Date().getFullYear()} {company.legalName || company.name}
          {company.address ? ` · ${company.address}` : ''}
        </p>
        {/* Said here rather than only in the consent tick-box, because this is
            where somebody looks when they want to know what happens to what
            they just sent. */}
        <p className="mx-auto mt-2 max-w-2xl">
          Applications and the documents attached to them are held only to consider you for work here,
          under the Data Privacy Act of 2012 (RA 10173). We do not sell them and we do not pass them on.
          Write to {company.email || 'the HR department'} to ask for a copy or have yours removed.
        </p>
      </footer>
    </div>
  )
}

/** Peso amounts as a band, the way an advert writes one. */
export function salaryBand(job: JobSummary): string | null {
  if (!job.salary) return null

  const { min, max } = job.salary
  const format = (value: number) =>
    `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`

  if (min && max) return `${format(min)} – ${format(max)} a month`
  if (min) return `From ${format(min)} a month`
  if (max) return `Up to ${format(max)} a month`

  return null
}

/** "Posted today" reads better than a date on a job board, and is what people scan for. */
export function postedLabel(job: JobSummary): string {
  const days = job.postedDaysAgo

  if (days === null) return ''
  if (days <= 0) return 'Posted today'
  if (days === 1) return 'Posted yesterday'
  if (days < 30) return `Posted ${days} days ago`

  return `Posted ${Math.floor(days / 30)} month${days >= 60 ? 's' : ''} ago`
}

export function JobIcon({ className }: { className?: string }) {
  return <Briefcase className={className} />
}

/**
 * The provinces, for the address the application cannot be filed without.
 *
 * A free-text box here produces "Rizal", "rizal", "Rizal Province" and
 * "Antipolo" in the same column, and then nobody can filter a shortlist by
 * where people live.
 */
export const PROVINCES = [
  'Metro Manila', 'Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique',
  'Apayao', 'Aurora', 'Basilan', 'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol',
  'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz',
  'Catanduanes', 'Cavite', 'Cebu', 'Cotabato', 'Davao de Oro', 'Davao del Norte', 'Davao del Sur',
  'Davao Occidental', 'Davao Oriental', 'Dinagat Islands', 'Eastern Samar', 'Guimaras', 'Ifugao',
  'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union', 'Laguna',
  'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao del Norte', 'Maguindanao del Sur',
  'Marinduque', 'Masbate', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province',
  'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya',
  'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan', 'Quezon',
  'Quirino', 'Rizal', 'Romblon', 'Samar', 'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato',
  'Southern Leyte', 'Sultan Kudarat', 'Sulu', 'Surigao del Norte', 'Surigao del Sur', 'Tarlac',
  'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay',
] as const

export const EDUCATION_LEVELS = [
  'High School', 'Vocational', 'Associate', 'Bachelor', 'Master', 'Doctorate',
] as const
