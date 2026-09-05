import * as React from 'react'
import { Eye, ExternalLink, Globe, Megaphone, Send, Users, XCircle } from 'lucide-react'
import type { FormField } from '@/components/data/RecordForm'
import { AutoDetail, ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Button } from '@/components/ui/primitives'
import { useToast } from '@/components/ui/feedback'
import { closePosting, publishPosting } from '@/lib/adminApi'
import { invalidateResource } from '@/lib/api'
import { num } from '@/lib/format'

/**
 * The adverts, and the two acts that decide whether anybody can see them.
 *
 * A posting is written like any other record, but publishing is not an edit.
 * It is the moment a vacancy becomes readable by the entire internet, it
 * stamps the date it happened, and it tells the manpower request behind it
 * that sourcing has started. So it is a button with a consequence rather than
 * a status column somebody sets in a dropdown — which is also why the status
 * is deliberately missing from the form below.
 *
 * The salary band is the other thing worth a note. It is stored whether or not
 * it is published, because the figure is useful internally either way; the
 * "show it" switch is what decides if a candidate sees it. Adverts that state
 * a band attract materially more applications, so the switch is offered
 * plainly rather than buried.
 */

type PostingRow = {
  id: number
  slug: string
  title: string
  department: string | null
  location: string | null
  employmentType: string
  workSetup: string
  experienceLevel: string
  openings: number
  status: string
  publishedAt: string | null
  closesOn: string | null
  views: number
  applicantsCount: number
  salaryMin: number | null
  salaryMax: number | null
  salaryVisible: boolean
  summary: string | null
  responsibilities: string | null
  qualifications: string | null
  benefits: string | null
}

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const postingFields: FormField[] = [
  { name: 'title', label: 'Advert heading', required: true, full: true, hint: 'What a jobseeker sees in the list.' },
  {
    name: 'requisitionId',
    label: 'Manpower request',
    optionsFrom: { endpoint: 'hr/requisitions', label: 'no', sublabel: 'position' },
    hint: 'The approved vacancy this advert fills. Optional, but it is what counts the seat at hire.',
  },
  {
    name: 'positionId',
    label: 'Position',
    optionsFrom: { endpoint: 'hr/positions', label: 'title' },
  },
  {
    name: 'departmentId',
    label: 'Department',
    optionsFrom: { endpoint: 'hr/departments', label: 'name', sublabel: 'code' },
  },
  {
    name: 'branchId',
    label: 'Branch',
    optionsFrom: { endpoint: 'hr/branch-units', label: 'name', sublabel: 'code' },
  },
  { name: 'location', label: 'Location shown', hint: 'Left blank, the branch name is used.' },
  {
    name: 'employmentType',
    label: 'Employment type',
    type: 'select',
    required: true,
    options: choices('Full-time', 'Part-time', 'Contract', 'Project-based', 'Internship'),
  },
  {
    name: 'workSetup',
    label: 'Work setup',
    type: 'select',
    required: true,
    options: choices('On-site', 'Hybrid', 'Remote'),
  },
  {
    name: 'experienceLevel',
    label: 'Level',
    type: 'select',
    required: true,
    options: choices('Entry level', 'Associate', 'Mid-Senior', 'Manager', 'Director'),
  },
  { name: 'openings', label: 'Openings', type: 'number', required: true, min: 1 },

  {
    section: 'The advert',
    name: 'summary',
    label: 'Summary',
    type: 'textarea',
    full: true,
    hint: 'Two or three sentences. This decides whether anybody reads the rest.',
  },
  {
    section: 'The advert',
    name: 'responsibilities',
    label: 'What they would be doing',
    type: 'textarea',
    full: true,
    hint: 'One per line.',
  },
  {
    section: 'The advert',
    name: 'qualifications',
    label: 'What you are looking for',
    type: 'textarea',
    full: true,
    hint: 'One per line. These are also what the CV keyword match is scored against.',
  },
  {
    section: 'The advert',
    name: 'benefits',
    label: 'What you offer',
    type: 'textarea',
    full: true,
    hint: 'One per line.',
  },

  { section: 'Pay and closing', name: 'salaryMin', label: 'Salary from', type: 'money' },
  { section: 'Pay and closing', name: 'salaryMax', label: 'Salary to', type: 'money' },
  {
    section: 'Pay and closing',
    name: 'salaryVisible',
    label: 'Show the band on the advert',
    type: 'switch',
    hint: 'Off keeps the figures internal. Adverts that state a band get noticeably more applications.',
  },
  { section: 'Pay and closing', name: 'closesOn', label: 'Applications close', type: 'date' },
]

const postingDefaults = {
  employmentType: 'Full-time',
  workSetup: 'On-site',
  experienceLevel: 'Entry level',
  openings: 1,
  salaryVisible: false,
}

/** Publish, close, and open the live advert. The three things a row needs. */
function PostingActions({ row, done }: { row: PostingRow; done: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = React.useState(false)

  const run = async (action: () => Promise<unknown>, title: string) => {
    setBusy(true)
    try {
      await action()
      await invalidateResource('hr/job-postings')
      toast({ tone: 'success', title })
      done()
    } catch (error) {
      toast({ tone: 'error', title: 'That did not go through.', description: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {row.status !== 'Published' && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => void run(() => publishPosting(row.id, row.closesOn ?? undefined), 'Advert published')}
        >
          <Send className="size-3.5" />
          {row.status === 'Closed' ? 'Re-publish' : 'Publish'}
        </Button>
      )}

      {row.status === 'Published' && (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(`/careers/${row.slug}`, '_blank', 'noopener')}
          >
            <ExternalLink className="size-3.5" />
            View live
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            className="text-critical"
            onClick={() => void run(() => closePosting(row.id), 'Advert closed')}
          >
            <XCircle className="size-3.5" />
            Close it
          </Button>
        </>
      )}
    </div>
  )
}

export function JobPostings() {
  const c = cols<PostingRow>()

  return (
    <ResourcePage
      title="Job Postings"
      description="The adverts behind the careers site. Publishing one is what makes a vacancy readable by the public — and what starts sourcing against the manpower request behind it."
      endpoint="hr/job-postings"
      loader={() => []}
      exportName="job-postings"
      createLabel="New advert"
      formFields={postingFields}
      formDefaults={postingDefaults}
      formTitle="job posting"
      pageSize={25}
      actions={
        <Button variant="ghost" onClick={() => window.open('/careers', '_blank', 'noopener')}>
          <Globe className="size-4" />
          Open the careers site
        </Button>
      }
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'department', label: 'Department' },
        { columnId: 'employmentType', label: 'Type' },
        { columnId: 'workSetup', label: 'Setup' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile
            label="Live now"
            value={num(rows.filter((r) => r.status === 'Published').length)}
            icon={Megaphone}
            hint="Visible on the careers site"
          />
          <StatTile
            label="Drafts"
            value={num(rows.filter((r) => r.status === 'Draft').length)}
            icon={Megaphone}
            hint="Written but not published"
          />
          <StatTile
            label="Applications"
            value={num(rows.reduce((sum, r) => sum + (r.applicantsCount ?? 0), 0))}
            icon={Users}
          />
          <StatTile
            label="Advert views"
            value={num(rows.reduce((sum, r) => sum + (r.views ?? 0), 0))}
            icon={Eye}
            hint="How many times a posting was opened"
          />
        </StatGrid>
      )}
      detailTitle={(row) => row.title}
      detailSubtitle={(row) => [row.department, row.location].filter(Boolean).join(' · ')}
      detailSize="xl"
      detailActions={(row, done) => <PostingActions row={row} done={done} />}
      renderDetail={(row) => <AutoDetail row={row} />}
      columns={[
        c.primary('title', 'Advert', (row) => [row.department, row.location].filter(Boolean).join(' · ')),
        c.tag('employmentType', 'Type', 'info'),
        c.tag('workSetup', 'Setup', 'neutral'),
        c.text('experienceLevel', 'Level', { secondary: true }),
        c.number('openings', 'Openings'),
        c.number('applicantsCount', 'Applicants'),
        c.number('views', 'Views', { secondary: true }),
        c.date('publishedAt', 'Published'),
        c.date('closesOn', 'Closes', { overdueWhenPast: true }),
        c.level('status', 'Status', { Published: 'good', Draft: 'neutral', Closed: 'critical' }),
      ]}
    />
  )
}
