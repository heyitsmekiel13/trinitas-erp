import type { ComponentType } from 'react'
import { Lock } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import { useIsProcessOffice } from '@/app/auth'
import { DeliveryDashboard } from './dashboard'
import { Projects } from './projects'
import { WorkBoard } from './board'
import { MyTasks } from './myTasks'
import { AllTasks } from './allTasks'
import { Workload } from './workload'
import { Goals } from './goals'
import { Automations } from './automations'
import { ComplianceRegister } from './compliance'
import { ProcessMetricsPage } from './metrics'
import { Evaluations } from './evaluations'
import { PerformanceReviews } from './performanceReviews'
import { TabbedArea } from '@/components/layout/TabbedArea'

/**
 * Process & Performance.
 *
 * Two audiences in one department. The project screens are the company's work
 * tool and everyone who can open the department can use them; the compliance
 * screens belong to the office alone.
 *
 * `OfficeOnly` below is a courtesy, not the control — the API refuses those
 * routes for every other account with a 404. It exists so somebody who lands
 * on the URL sees an explanation rather than a page that fails to load.
 */

function OfficeOnly({ children, title }: { children: React.ReactNode; title: string }) {
  const allowed = useIsProcessOffice()

  if (allowed) return <>{children}</>

  return (
    <>
      <PageHeader title={title} description="Restricted to the Process & Performance office." />
      <Card>
        <EmptyState
          icon={Lock}
          title="This page belongs to the Process & Performance office"
          description="Delivery assessments are kept by that office. If you need something from it, ask them directly — the data is not readable from this account."
        />
      </Card>
    </>
  )
}

export const PAGES: Record<string, ComponentType> = {
  '': DeliveryDashboard,
  projects: Projects,
  board: WorkBoard,
  'all-tasks': AllTasks,
  'my-tasks': MyTasks,
  workload: Workload,
  goals: Goals,
  automations: Automations,
  metrics: () => (
    <OfficeOnly title="Flow & Throughput">
      <ProcessMetricsPage />
    </OfficeOnly>
  ),
  compliance: () => (
    <OfficeOnly title="Compliance Register">
      <ComplianceRegister />
    </OfficeOnly>
  ),
  /*
   * Judgement, in one place.
   *
   * Delivery verdicts and performance reviews are the same act at two
   * timescales — what the office concluded about a piece of work, and what a
   * manager concluded about a person over a cycle. They were in different
   * departments, so an opinion was formed on one screen and written down on
   * another, and neither referred to the other. HR keeps the 201 file and the
   * pay; the judgement lives here.
   */
  evaluations: () => (
    <OfficeOnly title="Evaluations">
      <TabbedArea
        storageKey="evaluations"
        tabs={[
          {
            id: 'delivery',
            label: 'Delivery Verdicts',
            hint: 'What the office concluded about work that has been delivered, and the scorecards behind it.',
            render: () => <Evaluations />,
          },
          {
            id: 'reviews',
            label: 'Performance Reviews',
            hint: 'The review cycle for each employee — self-assessment, manager review, calibration, close.',
            render: () => <PerformanceReviews />,
          },
        ]}
      />
    </OfficeOnly>
  ),
}

export { MyTasks }
