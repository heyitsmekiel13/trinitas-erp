import { AlertTriangle, KeyRound, MonitorSmartphone, ShieldCheck } from 'lucide-react'
import { useResource } from '@/lib/api'
import { type PunchIntegrity } from '@/lib/adminApi'
import { fmtDateTime, num } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'

/**
 * Punch integrity — who might be clocking in for somebody else.
 *
 * Everything here was accepted at the time. Refusing a suspicious punch would
 * hand every employee a way to mark a colleague absent by borrowing their
 * device, so the system records and surfaces instead of blocking.
 */

const ACTION_LABEL: Record<string, string> = {
  in: 'Time in',
  'break-out': 'Break out',
  'break-in': 'Break in',
  out: 'Time out',
}

export function PunchIntegrityPage() {
  const { data, isLoading, error, refetch } = useResource<PunchIntegrity>('hr/punch-integrity', () => {
    throw new Error('Punch integrity needs a live connection to the server.')
  })

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (!data || isLoading) return <SkeletonDashboard />

  const { config, flagged, sharedDevices, employeesWithoutPin } = data

  return (
    <div>
      <PageHeader
        title="Punch Integrity"
        description="Time records that look like somebody else pressed the button. Everything listed was accepted — blocking it would let anyone mark a colleague absent."
      />

      <StatGrid>
        <StatTile
          label="Flagged punches"
          value={num(flagged.length)}
          icon={AlertTriangle}
          hint="Last 30 days"
        />
        <StatTile
          label="Shared devices"
          value={num(sharedDevices.length)}
          icon={MonitorSmartphone}
          hint="Used by more than one person"
        />
        <StatTile
          label="Without a PIN"
          value={num(employeesWithoutPin)}
          icon={KeyRound}
          hint={config.require_punch_pin ? 'These people cannot clock in yet' : 'PIN is currently switched off'}
        />
        <StatTile
          label="PIN enforcement"
          value={config.require_punch_pin ? 'On' : 'Off'}
          icon={ShieldCheck}
          hint={
            config.require_punch_pin
              ? `${config.pin_length} digits, asked at every punch`
              : 'Anybody with the shared password can punch'
          }
        />
      </StatGrid>

      {!config.require_punch_pin && (
        <Card className="mt-4 border-critical/40">
          <p className="p-4 text-[13px] text-ink-2">
            <strong className="text-ink">The PIN is switched off.</strong> Every employee signs in with the same
            password, so with no PIN a time record proves only that somebody knew that password — not who they were.
            Turn it back on under System Settings → Timekeeping.
          </p>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader
            title="Flagged punches"
            subtitle="What the system noticed, and why"
            action={<Badge tone={flagged.length > 0 ? 'warning' : 'good'}>{num(flagged.length)}</Badge>}
          />
          <div className="divide-y divide-line border-t border-line">
            {flagged.length === 0 && (
              <EmptyState
                icon={ShieldCheck}
                title="Nothing flagged"
                description="No punch in the last 30 days tripped a check."
              />
            )}
            {flagged.map((row) => (
              <div key={row.id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-baseline gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.employee}
                      <span className="ml-2 text-[11px] font-normal text-ink-3">{row.employeeNo}</span>
                    </p>
                    <p className="text-[11px] text-ink-3">
                      {ACTION_LABEL[row.action] ?? row.action}
                      {row.punchedAt ? ` · ${fmtDateTime(row.punchedAt)}` : ''}
                      {row.department ? ` · ${row.department}` : ''}
                    </p>
                  </div>
                  <Badge tone="warning">Flagged</Badge>
                </div>
                <p className="mt-1.5 text-[12px] text-ink-2">{row.reason}</p>
                <p className="mt-1 font-mono text-[11px] text-ink-3">
                  device {row.deviceId ?? '—'} · {row.ipAddress ?? 'no address'}
                </p>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Shared devices" subtitle="One browser, several people" />
            <div className="divide-y divide-line border-t border-line">
              {sharedDevices.length === 0 && (
                <EmptyState
                  icon={MonitorSmartphone}
                  title="None shared"
                  description="Every device has punched for one person only."
                />
              )}
              {sharedDevices.map((d) => (
                <div key={d.deviceId} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12px] text-ink">{d.deviceId}…</span>
                    <Badge tone={d.employees > config.shared_device_threshold ? 'critical' : 'warning'}>
                      {num(d.employees)} people
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {num(d.punches)} punch{d.punches === 1 ? '' : 'es'}
                    {d.lastSeen ? ` · last ${fmtDateTime(d.lastSeen)}` : ''}
                  </p>
                </div>
              ))}
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-3">
              A shared terminal in the lobby will legitimately appear here. What matters is several people punching
              within {config.burst_window_seconds} seconds of each other.
            </p>
          </Card>

          <Card>
            <CardHeader title="How this is decided" subtitle="Stated so it can be argued with" />
            <div className="space-y-2 px-4 py-3 text-[12px] leading-relaxed text-ink-2">
              <p>
                A punch is flagged when <strong className="text-ink">two or more other people</strong> punched from the
                same device inside {config.burst_window_seconds} seconds, or when a device has been used by more than{' '}
                <strong className="text-ink">{config.shared_device_threshold}</strong> people in one day.
              </p>
              <p className="text-ink-3">
                The device identifier lives in the browser and anyone can clear it. Treat this as a prompt to go and
                look, not as proof on its own.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
