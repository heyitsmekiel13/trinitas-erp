import { CalendarClock, Clock, Moon, Users } from 'lucide-react'
import { num } from '@/lib/format'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import * as forms from './forms'

/**
 * Shifts and schedules.
 *
 * The shift is what a punch is measured against: change the start time here and
 * every lateness calculation, every undertime figure and every tardiness
 * infraction moves with it. That is why it is a screen rather than a constant
 * somewhere in the code.
 */

type ShiftRow = {
  id: number
  name: string
  startsAt: string
  endsAt: string
  window: string
  breakMinutes: number
  graceMinutes: number
  isNightShift: boolean
  isActive: boolean
  assigned: number
  status: string
}

export function Shifts() {
  const c = cols<ShiftRow>()

  return (
    <ResourcePage
      title="Shifts & Schedules"
      description="What the punch clock measures against. Changing a start time changes every lateness figure and every tardiness infraction that follows it."
      endpoint="hr/shifts"
      loader={() => []}
      exportName="shifts"
      createLabel="New shift"
      formFields={forms.shiftFields}
      formDefaults={forms.shiftDefaults}
      formTitle="shift"
      filters={[{ columnId: 'status', label: 'Status' }]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.window} · ${row.graceMinutes} min grace`}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Shifts" value={num(rows.length)} icon={CalendarClock} />
          <StatTile
            label="Employees rostered"
            value={num(rows.reduce((s, r) => s + r.assigned, 0))}
            icon={Users}
          />
          <StatTile
            label="Night shifts"
            value={num(rows.filter((r) => r.isNightShift).length)}
            icon={Moon}
            hint="End on the following day"
          />
          <StatTile
            label="Average grace"
            value={`${Math.round(rows.reduce((s, r) => s + r.graceMinutes, 0) / Math.max(1, rows.length))} min`}
            icon={Clock}
            hint="Arrive inside this and the day is not late"
          />
        </StatGrid>
      )}
      columns={[
        c.primary('name', 'Shift', (row) => row.window),
        c.text('startsAt', 'Starts'),
        c.text('endsAt', 'Ends'),
        c.number('breakMinutes', 'Break', { suffix: ' min' }),
        c.number('graceMinutes', 'Grace', { suffix: ' min' }),
        c.number('assigned', 'Rostered'),
        c.level('status', 'Status', { Active: 'good', Inactive: 'neutral' }),
      ]}
    />
  )
}
