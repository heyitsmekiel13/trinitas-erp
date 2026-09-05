import { ClipboardCheck } from 'lucide-react'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { EmptyState } from '@/components/ui/feedback'
import { Card } from '@/components/ui/primitives'
import { liveApi, type FuelRequestRecord } from '@/lib/adminApi'

/**
 * Oversight, not action.
 *
 * The day-to-day queue (`FuelRequests.tsx`) is built to move a request
 * forward — approve it, reject it, print it. This is the other half of the
 * same record set, read only: every request that has been decided one way or
 * another, who decided it and when, filterable the way any audit list needs
 * to be rather than laid out as a worklist. There is nothing new to compute
 * here — `approvedBy`, `approvedByRole`, `decidedAt` and `decisionNote`
 * already live on every fuel request; this just gives them their own screen.
 */
export function FuelApprovalsLog() {
  const c = cols<FuelRequestRecord>()

  if (!liveApi()) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardCheck}
          title="The approvals log needs the live API"
          description="It reads the same decided requests the queue does."
        />
      </Card>
    )
  }

  return (
    <ResourcePage
      title="Fuel Approvals Log"
      description="Every fuel request that has been decided — who approved or rejected it, and when."
      endpoint="maintenance/fuel-requests"
      loader={() => []}
      exportName="fuel-approvals-log"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'approvedBy', label: 'Approver' },
      ]}
      searchPlaceholder="Search by reference, requester, vehicle…"
      detailTitle={(row) => row.reference}
      detailSubtitle={(row) => `${row.vehicle ?? 'No vehicle'} · ${row.purpose}`}
      columns={[
        c.primary('reference', 'Request', (row) => `${row.requestedBy ?? ''} · ${row.vehicle ?? ''}`),
        c.status(),
        c.text('approvedBy', 'Approver'),
        c.text('approvedByRole', 'As', { secondary: true }),
        c.date('decidedAt', 'Decided'),
        c.text('decisionNote', 'Note', { secondary: true }),
      ]}
    />
  )
}
