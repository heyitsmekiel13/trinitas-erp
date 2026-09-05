import * as React from 'react'
import { BrainCircuit, Grid3x3, Sparkles, Star } from 'lucide-react'
import { liveApi } from '@/lib/adminApi'
import { useResource } from '@/lib/api'
import { num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { EmptyState, ErrorState, SkeletonDashboard } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * Skills and succession — who can do what, and who is being groomed for what.
 *
 * Deliberately not derived from the Process module's performance-review
 * scores: a review is a verdict on the cycle just finished, while these
 * ratings are HR's standing read on a person's skill level and trajectory,
 * updated on their own schedule. The two can be cross-checked by eye — they
 * are not meant to be forced to agree automatically.
 */

type Competency = {
  id: number
  name: string
  category: string | null
  description: string | null
  rated: number
}

type EmployeeCompetency = {
  id: number
  employeeId: number
  employee: string
  employeeNo: string
  department: string | null
  competencyId: number
  competency: string
  category: string | null
  level: number
  assessedOn: string
  assessedBy: string | null
  notes: string | null
}

type SuccessionPlan = {
  id: number
  employeeId: number
  employee: string
  employeeNo: string
  department: string | null
  currentTitle: string | null
  targetPositionId: number | null
  targetPosition: string | null
  performanceRating: number
  potentialRating: number
  readiness: string
  notes: string | null
  assessedOn: string
}

const LEVEL_TONE: Record<string, 'critical' | 'warning' | 'neutral' | 'info' | 'good'> = {
  '1': 'critical', '2': 'warning', '3': 'neutral', '4': 'info', '5': 'good',
}

function Competencies() {
  const c = cols<Competency>()
  return (
    <ResourcePage<Competency>
      title="Competency Catalog"
      description="The skills and behaviours the company rates people against."
      endpoint="hr/competencies"
      loader={() => []}
      exportName="competencies"
      createLabel="New competency"
      formFields={forms.competencyFields}
      formDefaults={forms.competencyDefaults}
      formTitle="competency"
      filters={[{ columnId: 'category', label: 'Category' }]}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => row.category ?? 'Uncategorised'}
      columns={[
        c.primary('name', 'Competency', (row) => row.category ?? ''),
        c.tag('category', 'Category', 'neutral'),
        c.number('rated', 'Employees rated'),
        c.text('description', 'Description', { secondary: true }),
      ]}
    />
  )
}

function EmployeeSkills() {
  const c = cols<EmployeeCompetency>()
  return (
    <ResourcePage<EmployeeCompetency>
      title="Employee Skills"
      description="Who is rated at what level, on which competency."
      endpoint="hr/employee-competencies"
      loader={() => []}
      exportName="employee-skills"
      createLabel="Rate employee"
      formFields={forms.employeeCompetencyFields}
      formDefaults={forms.employeeCompetencyDefaults}
      formTitle="rating"
      filters={[
        { columnId: 'competency', label: 'Competency' },
        { columnId: 'department', label: 'Department' },
      ]}
      detailTitle={(row) => row.employee}
      detailSubtitle={(row) => row.competency}
      columns={[
        c.primary('employee', 'Employee', (row) => row.employeeNo),
        c.text('department', 'Department', { secondary: true }),
        c.text('competency', 'Competency'),
        c.level('level', 'Level', LEVEL_TONE),
        c.date('assessedOn', 'Assessed', { secondary: true }),
        c.text('assessedBy', 'By', { secondary: true }),
      ]}
    />
  )
}

/** A 3×3 grid, buckets 1–2 low / 3 mid / 4–5 high on each axis. */
function bucket(rating: number): 0 | 1 | 2 {
  if (rating <= 2) return 0
  if (rating === 3) return 1
  return 2
}

const POTENTIAL_LABEL = ['Low Potential', 'Medium Potential', 'High Potential']
const PERFORMANCE_LABEL = ['Low Performer', 'Solid Performer', 'Top Performer']

function NineBox({ rows }: { rows: SuccessionPlan[] }) {
  // grid[potentialBucket][performanceBucket] — potential runs bottom→top,
  // performance runs left→right, matching how a 9-box is conventionally read.
  const grid: SuccessionPlan[][][] = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => []))
  for (const row of rows) {
    grid[bucket(row.potentialRating)][bucket(row.performanceRating)].push(row)
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-[6rem_repeat(3,1fr)] gap-1.5">
        <div />
        {PERFORMANCE_LABEL.map((label) => (
          <div key={label} className="px-2 pb-1 text-center text-[11px] font-semibold text-ink-3 uppercase">
            {label}
          </div>
        ))}

        {[2, 1, 0].map((potentialRow) => (
          <React.Fragment key={potentialRow}>
            <div className="flex items-center justify-end pr-2 text-right text-[11px] font-semibold text-ink-3 uppercase">
              {POTENTIAL_LABEL[potentialRow]}
            </div>
            {[0, 1, 2].map((performanceCol) => {
              const cell = grid[potentialRow][performanceCol]
              return (
                <div
                  key={performanceCol}
                  className="min-h-[6.5rem] rounded-xl border border-line bg-surface-2 p-2"
                >
                  <div className="flex flex-wrap gap-1.5">
                    {cell.map((r) => (
                      <span
                        key={r.id}
                        title={`${r.employee} · Performance ${r.performanceRating} · Potential ${r.potentialRating}`}
                        className="grad-brand rounded-full px-2 py-1 text-[11px] font-medium text-white"
                      >
                        {r.employee}
                      </span>
                    ))}
                  </div>
                  {cell.length === 0 && <span className="text-[11px] text-ink-3">—</span>}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function SuccessionGrid() {
  const c = cols<SuccessionPlan>()
  const { data, isLoading, error, refetch } = useResource<SuccessionPlan[]>('hr/succession-plans', () => [])

  return (
    <div>
      <div className="mb-4">
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data || isLoading ? (
          <SkeletonDashboard />
        ) : data.length === 0 ? (
          <EmptyState icon={Grid3x3} title="No assessments yet" description="Rate somebody below and they will appear on the grid." />
        ) : (
          <>
            <StatGrid>
              <StatTile label="Assessed" value={num(data.length)} icon={BrainCircuit} />
              <StatTile label="Ready now" value={num(data.filter((r) => r.readiness === 'Ready Now').length)} icon={Star} />
              <StatTile
                label="Top performer / high potential"
                value={num(data.filter((r) => bucket(r.performanceRating) === 2 && bucket(r.potentialRating) === 2).length)}
                icon={Sparkles}
                hint="Top-right box"
              />
            </StatGrid>
            <div className="card mt-4 p-4">
              <NineBox rows={data} />
            </div>
          </>
        )}
      </div>

      <ResourcePage<SuccessionPlan>
        title="Assessments"
        description="One current placement per employee — re-assessing edits the existing row."
        endpoint="hr/succession-plans"
        loader={() => []}
        exportName="succession-plans"
        createLabel="Assess employee"
        formFields={forms.successionPlanFields}
        formDefaults={forms.successionPlanDefaults}
        formTitle="succession assessment"
        filters={[
          { columnId: 'readiness', label: 'Readiness' },
          { columnId: 'department', label: 'Department' },
        ]}
        detailTitle={(row) => row.employee}
        detailSubtitle={(row) => row.targetPosition ?? 'No named successor track'}
        columns={[
          c.primary('employee', 'Employee', (row) => `${row.employeeNo} · ${row.currentTitle ?? ''}`),
          c.text('department', 'Department', { secondary: true }),
          c.text('targetPosition', 'Grooming for', { secondary: true }),
          c.number('performanceRating', 'Performance'),
          c.number('potentialRating', 'Potential'),
          c.tag('readiness', 'Readiness', 'info'),
          c.date('assessedOn', 'Assessed', { secondary: true }),
        ]}
      />
    </div>
  )
}

export function TalentAndSuccession() {
  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Talent & Succession" description="The competency matrix and 9-box succession grid." />
        <div className="card">
          <EmptyState icon={BrainCircuit} title="Needs the live API" description="Ratings are read and written on the server." />
        </div>
      </>
    )
  }

  return (
    <TabbedArea
      storageKey="talent-succession"
      tabs={[
        {
          id: 'competencies',
          label: 'Competency Catalog',
          hint: 'The skills and behaviours the company rates people against.',
          render: () => <Competencies />,
        },
        {
          id: 'skills',
          label: 'Employee Skills',
          hint: 'Who is rated at what level, on which competency.',
          render: () => <EmployeeSkills />,
        },
        {
          id: 'succession',
          label: 'Succession Grid',
          hint: 'Performance against potential — a 9-box read of the bench.',
          render: () => <SuccessionGrid />,
        },
      ]}
    />
  )
}
