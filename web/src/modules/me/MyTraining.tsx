import { Award, GraduationCap, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { EmployeeCertificate } from '@/lib/adminApi'
import { fmtDate } from '@/lib/format'
import { Badge, Card } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'

/**
 * The employee's own certifications.
 *
 * Whoever holds a forklift licence that lapses next month is the person who
 * most needs to know, and the person most likely to be able to do something
 * about it. Keeping this only in HR's register is how people turn up to a
 * shift they are no longer certified to work.
 *
 * Expiry is worked out on the server at read time, so a card that was valid
 * when it was issued does not still claim to be.
 */

const STATE_TONE: Record<EmployeeCertificate['state'], 'good' | 'warning' | 'critical'> = {
  Valid: 'good',
  'Expiring soon': 'warning',
  Expired: 'critical',
}

/** "in 3 weeks", "2 months ago" — a date alone does not read as urgency. */
function expiryPhrase(cert: EmployeeCertificate): string | null {
  if (cert.daysUntilExpiry === null) return 'Does not expire'

  const days = cert.daysUntilExpiry

  if (days < 0) {
    const ago = Math.abs(days)
    return ago < 31 ? `Expired ${ago} ${ago === 1 ? 'day' : 'days'} ago` : `Expired ${Math.round(ago / 30)} months ago`
  }
  if (days === 0) return 'Expires today'
  if (days < 31) return `Expires in ${days} ${days === 1 ? 'day' : 'days'}`

  return `Expires in ${Math.round(days / 30)} months`
}

export function MyTraining({ certificates }: { certificates: EmployeeCertificate[] }) {
  if (certificates.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={GraduationCap}
          title="No training on record yet"
          description="Certificates appear here once HR closes a training you attended."
        />
      </Card>
    )
  }

  // Anything lapsed or lapsing leads — that is the part that needs acting on.
  const ordered = [...certificates].sort((a, b) => {
    const rank = { Expired: 0, 'Expiring soon': 1, Valid: 2 } as const
    return rank[a.state] - rank[b.state]
  })

  const needsAttention = ordered.filter((c) => c.state !== 'Valid')

  return (
    <div className="space-y-4">
      {needsAttention.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-[12px] text-warning">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          {needsAttention.length === 1
            ? 'One of your certifications needs renewing.'
            : `${needsAttention.length} of your certifications need renewing.`}{' '}
          Speak to HR about rebooking — some roles cannot be worked without them.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {ordered.map((cert) => (
          <Card key={cert.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink">{cert.course}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {cert.provider ?? 'In-house'}
                  {cert.type && ` · ${cert.type}`}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={STATE_TONE[cert.state]}>{cert.state}</Badge>
                {cert.mandatory && <Badge tone="neutral">Required</Badge>}
              </div>
            </div>

            {cert.certificateNo && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-good">
                <Award className="size-3.5" />
                {cert.certificateNo}
              </p>
            )}

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
              <div>
                <dt className="text-[10px] tracking-wide text-ink-3 uppercase">Completed</dt>
                <dd className="text-[12px] text-ink">{cert.completedOn ? fmtDate(cert.completedOn) : '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-wide text-ink-3 uppercase">Valid until</dt>
                <dd
                  className={cn(
                    'text-[12px]',
                    cert.state === 'Expired' ? 'font-medium text-critical' : cert.state === 'Expiring soon' ? 'font-medium text-warning' : 'text-ink',
                  )}
                >
                  {cert.expiresOn ? fmtDate(cert.expiresOn) : 'No expiry'}
                </dd>
              </div>
              {cert.score !== null && (
                <div>
                  <dt className="text-[10px] tracking-wide text-ink-3 uppercase">Score</dt>
                  <dd className="tabular text-[12px] text-ink">{cert.score}</dd>
                </div>
              )}
              {cert.trainer && (
                <div>
                  <dt className="text-[10px] tracking-wide text-ink-3 uppercase">Trainer</dt>
                  <dd className="truncate text-[12px] text-ink">{cert.trainer}</dd>
                </div>
              )}
            </dl>

            <p
              className={cn(
                'mt-2 text-[11px]',
                cert.state === 'Expired' ? 'text-critical' : cert.state === 'Expiring soon' ? 'text-warning' : 'text-ink-3',
              )}
            >
              {expiryPhrase(cert)}
            </p>
          </Card>
        ))}
      </div>
    </div>
  )
}
