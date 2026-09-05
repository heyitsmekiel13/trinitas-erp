import * as React from 'react'
import { FileSpreadsheet, FileText, Printer, RefreshCw, Settings2, Share2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { exportExcel, printRegion, printReport, type ReportSection } from '@/lib/export'
import { fmtDate } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Field, Input, Segmented, Switch, Textarea } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuLabel, MenuSeparator, Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { currentUser } from '@/app/auth'

/* -------------------------------------------------------------------------- */
/* Period filter — one filter row above everything it scopes                   */
/* -------------------------------------------------------------------------- */

export type Period = 'mtd' | 'qtd' | 'ytd' | '12m'

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'mtd', label: 'MTD' },
  { value: 'qtd', label: 'QTD' },
  { value: 'ytd', label: 'YTD' },
  { value: '12m', label: '12M' },
]

/** How many trailing months the period covers. */
export function monthsForPeriod(period: Period) {
  const month = new Date().getMonth()
  return { mtd: 1, qtd: (month % 3) + 1, ytd: month + 1, '12m': 12 }[period]
}

/** Scopes a month-indexed series to the selected period. */
export function slicePeriod<T>(rows: T[], period: Period): T[] {
  return rows.slice(-monthsForPeriod(period))
}

export function periodLabel(period: Period) {
  const now = new Date()
  const start = {
    mtd: new Date(now.getFullYear(), now.getMonth(), 1),
    qtd: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1),
    ytd: new Date(now.getFullYear(), 0, 1),
    '12m': new Date(now.getFullYear(), now.getMonth() - 11, 1),
  }[period]
  return `${fmtDate(start)} — ${fmtDate(now)}`
}

/* -------------------------------------------------------------------------- */
/* Report builder                                                              */
/* -------------------------------------------------------------------------- */

export type ReportOption = {
  id: string
  label: string
  description: string
  /** Built lazily so a deselected section costs nothing. */
  build: () => ReportSection[]
  defaultOn?: boolean
}

function ReportBuilder({
  open,
  onClose,
  defaultTitle,
  period,
  options,
}: {
  open: boolean
  onClose: () => void
  defaultTitle: string
  period: Period
  options: ReportOption[]
}) {
  const toast = useToast()
  const [title, setTitle] = React.useState(defaultTitle)
  const [notes, setNotes] = React.useState('')
  const [confidential, setConfidential] = React.useState(true)
  const [pageBreaks, setPageBreaks] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>(() => options.filter((o) => o.defaultOn !== false).map((o) => o.id))

  React.useEffect(() => {
    if (open) setTitle(defaultTitle)
  }, [open, defaultTitle])

  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))

  const generate = () => {
    const chosen = options.filter((o) => selected.includes(o.id))
    if (!chosen.length) {
      toast({ tone: 'warning', title: 'Select at least one section' })
      return
    }

    const sections: ReportSection[] = []
    chosen.forEach((option, i) => {
      if (pageBreaks && i > 0) sections.push({ kind: 'pagebreak' })
      sections.push(...option.build())
    })
    if (notes.trim()) sections.push({ kind: 'text', title: 'Notes & Commentary', body: notes.trim() })

    printReport(sections, {
      title,
      subtitle: `Reporting period: ${periodLabel(period)}`,
      preparedBy: currentUser().name,
      confidential,
      criteria: [
        { label: 'Period', value: PERIOD_OPTIONS.find((p) => p.value === period)!.label },
        { label: 'Sections', value: String(chosen.length) },
        { label: 'Branch', value: currentUser().branch },
      ],
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Build a report"
      description="Pick the sections to include. You will see the finished page before anything prints."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={generate}>
            <FileText className="size-4" />
            Generate report
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Report title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-2">Sections</p>
          <div className="space-y-1.5">
            {options.map((option) => {
              const checked = selected.includes(option.id)
              return (
                <label
                  key={option.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                    checked ? 'border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-950' : 'border-line hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(option.id)}
                    className="mt-0.5 size-4 accent-[var(--color-brand-500)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                    <span className="block text-xs text-ink-3">{option.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <Field label="Notes & commentary" hint="Appears as the closing section of the report.">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Management commentary, assumptions, or follow-up actions…"
          />
        </Field>

        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5">
          <label className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-ink-2">Mark as confidential</span>
            <Switch checked={confidential} onChange={setConfidential} label="Mark as confidential" />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span className="text-[13px] text-ink-2">Start each section on a new page</span>
            <Switch checked={pageBreaks} onChange={setPageBreaks} label="Page break per section" />
          </label>
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Dashboard shell                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Wraps every department dashboard: title, the single period filter that
 * scopes all charts below it, and the export menu.
 */
export function DashboardShell({
  title,
  description,
  period,
  onPeriodChange,
  reportTitle,
  reportOptions,
  excelExport,
  children,
}: {
  title: string
  description: string
  period: Period
  onPeriodChange: (p: Period) => void
  reportTitle: string
  reportOptions: ReportOption[]
  /** Flat data behind the dashboard, for a spreadsheet-shaped export. */
  excelExport?: { name: string; columns: { header: string; value: (row: any) => string | number }[]; rows: any[] }
  children: React.ReactNode
}) {
  const regionRef = React.useRef<HTMLDivElement>(null)
  const [builderOpen, setBuilderOpen] = React.useState(false)

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        meta={<span className="text-[11px] text-ink-3">Period: {periodLabel(period)}</span>}
        actions={
          <>
            <Segmented value={period} onChange={onPeriodChange} options={PERIOD_OPTIONS} size="sm" />

            <Button variant="secondary" size="sm" onClick={() => window.location.reload()} aria-label="Refresh data">
              <RefreshCw className="size-3.5" />
            </Button>

            <Menu
              trigger={({ toggle }) => (
                <Button variant="primary" size="sm" onClick={toggle}>
                  <Share2 className="size-3.5" />
                  Export
                </Button>
              )}
            >
              {(close) => (
                <>
                  <MenuLabel>Export this dashboard</MenuLabel>
                  <MenuItem
                    icon={Printer}
                    onClick={() => {
                      printRegion(regionRef.current, {
                        title,
                        subtitle: description,
                        preparedBy: currentUser().name,
                        criteria: [{ label: 'Period', value: periodLabel(period) }],
                      })
                      close()
                    }}
                  >
                    Dashboard as-is (PDF)
                  </MenuItem>
                  {excelExport && (
                    <MenuItem
                      icon={FileSpreadsheet}
                      onClick={() => {
                        exportExcel(excelExport.name, title, excelExport.columns, excelExport.rows)
                        close()
                      }}
                    >
                      Underlying data (Excel)
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  <MenuItem
                    icon={Settings2}
                    onClick={() => {
                      setBuilderOpen(true)
                      close()
                    }}
                  >
                    Custom report…
                  </MenuItem>
                </>
              )}
            </Menu>
          </>
        }
      />

      {/* Everything inside this region is what "export as-is" captures. */}
      <div ref={regionRef} className="space-y-4">
        {children}
      </div>

      <ReportBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        defaultTitle={reportTitle}
        period={period}
        options={reportOptions}
      />
    </div>
  )
}
