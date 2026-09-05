import * as React from 'react'
import { Download, Landmark, Printer } from 'lucide-react'
import { currentUser } from '@/app/auth'
import { useResource } from '@/lib/api'
import {
  getAgencySchedule,
  getBir2316,
  getThirteenthMonth,
  liveApi,
  type AgencyCode,
  type AgencySchedule,
  type Bir2316Report,
  type LegalEntitySummary,
  type ThirteenthMonthReport,
} from '@/lib/adminApi'
import { downloadExcelHtml, exportCsv, printRegion } from '@/lib/export'
import { exportPagibigConverter } from '@/lib/pagibig'
import { money } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { TabbedArea } from '@/components/layout/TabbedArea'
import { Button, Combobox, Field } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/feedback'
import { LegalEntities } from './legalEntities'
import { Remittances } from './payrollRuns'

/**
 * Government-facing numbers, generated rather than retyped.
 *
 * Every figure here already lives on a released payslip — see
 * `PayrollController::employeeSchedule()`. This module only regroups it by
 * agency and by calendar month (statutory forms are filed monthly; payroll
 * itself runs semi-monthly), so what HR files can never disagree with what
 * payroll actually paid.
 *
 * Not a facsimile of BIR 2316 / SSS R-3 / PhilHealth RF-1 / Pag-IBIG MCRF —
 * the official forms' box layouts change with every agency circular. This is
 * the data those forms ask for, laid out to be copied onto them or filed
 * alongside as the backup schedule.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * SSS/PhilHealth/Pag-IBIG are filed separately per registered employer, so
 * every report below needs to know which one it is running for. Shared
 * across all of them rather than repeated per screen.
 */
function useLegalEntityPicker() {
  const { data: entities = [] } = useResource<LegalEntitySummary[]>('hr/legal-entities', () => [])
  const [legalEntityId, setLegalEntityId] = React.useState<number | null>(null)

  const picker = (
    <Field label="Legal entity" composite hint={entities.length === 0 ? 'None set up yet' : undefined}>
      <Combobox
        value={legalEntityId}
        options={entities.map((e) => ({ value: e.id, label: e.name }))}
        onChange={(v) => setLegalEntityId(v == null ? null : Number(v))}
        placeholder="All entities"
      />
    </Field>
  )

  return { legalEntityId: legalEntityId ?? undefined, picker }
}

/** The identity a printed schedule needs, shown above the table when one entity is chosen. */
function EntityLetterhead({ entity }: { entity: LegalEntitySummary | null | undefined }) {
  if (!entity) return null

  return (
    <div className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
      <span className="font-semibold text-ink">{entity.legalName ?? entity.name}</span>
      {entity.tin && <span className="ml-2">TIN {entity.tin}</span>}
      {entity.sssEmployerNo && <span className="ml-2">SSS ER# {entity.sssEmployerNo}</span>}
      {entity.philhealthEmployerNo && <span className="ml-2">PhilHealth ER# {entity.philhealthEmployerNo}</span>}
      {entity.pagibigEmployerNo && <span className="ml-2">Pag-IBIG ER# {entity.pagibigEmployerNo}</span>}
    </div>
  )
}

function yearOptions() {
  const current = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => current - i).map((y) => ({ value: y, label: String(y) }))
}

function AgencyReport({ agency, title, reference }: { agency: AgencyCode; title: string; reference: string }) {
  const now = new Date()
  const [year, setYear] = React.useState(now.getFullYear())
  const [month, setMonth] = React.useState(now.getMonth() + 1)
  const [data, setData] = React.useState<AgencySchedule | null>(null)
  const [loading, setLoading] = React.useState(false)
  const printRef = React.useRef<HTMLDivElement>(null)
  const { legalEntityId, picker } = useLegalEntityPicker()

  React.useEffect(() => {
    if (!liveApi()) return
    setLoading(true)
    getAgencySchedule(agency, year, month, legalEntityId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [agency, year, month, legalEntityId])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Year" composite>
            <Combobox value={year} options={yearOptions()} onChange={(v) => v != null && setYear(Number(v))} />
          </Field>
          <Field label="Month" composite>
            <Combobox
              value={month}
              options={MONTHS.map((label, i) => ({ value: i + 1, label }))}
              onChange={(v) => v != null && setMonth(Number(v))}
            />
          </Field>
          {picker}
        </div>
        {data && data.rows.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                agency === 'pagibig'
                  ? downloadExcelHtml(`pagibig-converter-${year}-${String(month).padStart(2, '0')}`, exportPagibigConverter(data, data.legalEntity))
                  : exportCsv(
                      `${agency}-schedule-${year}-${String(month).padStart(2, '0')}`,
                      [
                        { header: 'Employee No.', value: (r) => r.employeeNo },
                        { header: 'Name', value: (r) => r.name },
                        { header: `${title.split(' ')[0]} No.`, value: (r) => r.number },
                        { header: 'TIN', value: (r) => r.tin },
                        { header: 'Employee Share', value: (r) => r.employee },
                        { header: 'Employer Share', value: (r) => r.employer },
                        ...(agency === 'sss' ? [{ header: 'EC', value: (r: (typeof data.rows)[number]) => r.ec ?? 0 }] : []),
                        { header: 'Total', value: (r) => r.total },
                      ],
                      data.rows,
                    )
              }
            >
              <Download className="size-4" />
              {agency === 'pagibig' ? 'Export for e-filing' : 'Export CSV'}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                printRegion(printRef.current, {
                  title,
                  subtitle: `${MONTHS[month - 1]} ${year} · ${data.legalEntity?.name ?? 'All entities'} · ${reference}`,
                  preparedBy: currentUser().name,
                })
              }
            >
              <Printer className="size-4" />
              Print
            </Button>
          </div>
        )}
      </div>

      {!liveApi() ? (
        <div className="card">
          <EmptyState icon={Landmark} title="Needs a live connection" description="Reports are read from released payslips on the server." />
        </div>
      ) : loading ? (
        <div className="card h-64 shimmer" />
      ) : !data || data.rows.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Landmark}
            title="Nothing to report"
            description="No released payroll run falls in this month yet."
          />
        </div>
      ) : (
        <div ref={printRef}>
          <EntityLetterhead entity={data.legalEntity} />
          <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[42rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">{title.split(' ')[0]} No.</th>
                <th className="px-3 py-2 text-right">Employee share</th>
                <th className="px-3 py-2 text-right">Employer share</th>
                {agency === 'sss' && <th className="px-3 py-2 text-right">EC</th>}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-[13px] text-ink">
                    {r.name}
                    <span className="ml-1.5 text-[11px] text-ink-3">{r.employeeNo}</span>
                  </td>
                  <td className="px-3 py-2 text-[13px] text-ink-2">{r.number ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.employee)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.employer)}</td>
                  {agency === 'sss' && (
                    <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.ec ?? 0)}</td>
                  )}
                  <td className="tabular px-3 py-2 text-right text-[13px] font-semibold text-ink">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong bg-surface-2 font-semibold text-ink">
                <td className="px-3 py-2 text-[13px]" colSpan={2}>
                  Total — {data.rows.length} employee{data.rows.length === 1 ? '' : 's'}
                </td>
                <td className="tabular px-3 py-2 text-right text-[13px]">{money(data.totals.employee)}</td>
                <td className="tabular px-3 py-2 text-right text-[13px]">{money(data.totals.employer)}</td>
                {agency === 'sss' && (
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(data.totals.ec ?? 0)}</td>
                )}
                <td className="tabular px-3 py-2 text-right text-[13px]">{money(data.totals.total)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ThirteenthMonth() {
  const [year, setYear] = React.useState(new Date().getFullYear())
  const [data, setData] = React.useState<ThirteenthMonthReport | null>(null)
  const [loading, setLoading] = React.useState(false)
  const printRef = React.useRef<HTMLDivElement>(null)
  const { legalEntityId, picker } = useLegalEntityPicker()

  React.useEffect(() => {
    if (!liveApi()) return
    setLoading(true)
    getThirteenthMonth(year, legalEntityId).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [year, legalEntityId])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Year" composite>
            <Combobox value={year} options={yearOptions()} onChange={(v) => v != null && setYear(Number(v))} />
          </Field>
          {picker}
        </div>
        {data && data.rows.length > 0 && (
          <Button
            variant="secondary"
            onClick={() =>
              printRegion(printRef.current, {
                title: '13th Month Pay',
                subtitle: `Calendar year ${year} · ${data.legalEntity?.name ?? 'All entities'} · Presidential Decree 851`,
                preparedBy: currentUser().name,
              })
            }
          >
            <Printer className="size-4" />
            Print
          </Button>
        )}
      </div>

      {!liveApi() ? (
        <div className="card">
          <EmptyState icon={Landmark} title="Needs a live connection" description="Reports are read from released payslips on the server." />
        </div>
      ) : loading ? (
        <div className="card h-64 shimmer" />
      ) : !data || data.rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={Landmark} title="Nothing to report" description="No released payroll run falls in this year yet." />
        </div>
      ) : (
        <div ref={printRef}>
          <EntityLetterhead entity={data.legalEntity} />
          <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-right">Basic pay earned</th>
                <th className="px-3 py-2 text-right">13th month due</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-[13px] text-ink">
                    {r.name}
                    <span className="ml-1.5 text-[11px] text-ink-3">{r.employeeNo}</span>
                  </td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.totalBasicPay)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px] font-semibold text-ink">{money(r.thirteenthMonthDue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong bg-surface-2 font-semibold text-ink">
                <td className="px-3 py-2 text-[13px]">
                  Total — {data.rows.length} employee{data.rows.length === 1 ? '' : 's'}
                </td>
                <td />
                <td className="tabular px-3 py-2 text-right text-[13px]">{money(data.totalDue)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Bir2316() {
  const [year, setYear] = React.useState(new Date().getFullYear())
  const [data, setData] = React.useState<Bir2316Report | null>(null)
  const [loading, setLoading] = React.useState(false)
  const printRef = React.useRef<HTMLDivElement>(null)
  const { legalEntityId, picker } = useLegalEntityPicker()

  React.useEffect(() => {
    if (!liveApi()) return
    setLoading(true)
    getBir2316(year, legalEntityId).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }, [year, legalEntityId])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Year" composite>
            <Combobox value={year} options={yearOptions()} onChange={(v) => v != null && setYear(Number(v))} />
          </Field>
          {picker}
        </div>
        {data && data.rows.length > 0 && (
          <Button
            variant="secondary"
            onClick={() =>
              printRegion(printRef.current, {
                title: 'Annual Compensation Summary (BIR 2316 basis)',
                subtitle: `Calendar year ${year} · ${data.legalEntity?.name ?? 'All entities'}`,
                preparedBy: currentUser().name,
              })
            }
          >
            <Printer className="size-4" />
            Print
          </Button>
        )}
      </div>

      {!liveApi() ? (
        <div className="card">
          <EmptyState icon={Landmark} title="Needs a live connection" description="Reports are read from released payslips on the server." />
        </div>
      ) : loading ? (
        <div className="card h-64 shimmer" />
      ) : !data || data.rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={Landmark} title="Nothing to report" description="No released payroll run falls in this year yet." />
        </div>
      ) : (
        <div ref={printRef}>
          <EntityLetterhead entity={data.legalEntity} />
          <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">TIN</th>
                <th className="px-3 py-2 text-right">Gross compensation</th>
                <th className="px-3 py-2 text-right">Non-taxable</th>
                <th className="px-3 py-2 text-right">Taxable compensation</th>
                <th className="px-3 py-2 text-right">Tax withheld</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-line last:border-0">
                  <td className="px-3 py-2 text-[13px] text-ink">
                    {r.name}
                    <span className="ml-1.5 text-[11px] text-ink-3">{r.employeeNo}</span>
                  </td>
                  <td className="px-3 py-2 text-[13px] text-ink-2">{r.tin ?? '—'}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.grossCompensation)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.nonTaxableCompensation)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px]">{money(r.taxableCompensation)}</td>
                  <td className="tabular px-3 py-2 text-right text-[13px] font-semibold text-ink">{money(r.taxWithheld)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-ink-3">
            A working summary for BIR Form 2316 — the exact box layout is set by BIR's own revision of the form.
          </p>
          </div>
        </div>
      )}
    </div>
  )
}

export function StatutoryReports() {
  return (
    <>
      <PageHeader
        title="Statutory Reports"
        description="What each agency is owed, and the per-employee schedules for filing it — SSS, PhilHealth, Pag-IBIG, 13th month pay and BIR 2316 — read straight from released payroll."
      />
      <TabbedArea
        storageKey="statutory-reports"
        tabs={[
          { id: 'remittances', label: 'Remittances', hint: 'What each agency is owed per cut-off.', render: () => <Remittances /> },
          { id: 'sss', label: 'SSS', hint: 'Contribution schedule for one calendar month.', render: () => <AgencyReport agency="sss" title="SSS Contribution Schedule" reference="SSS Circular 2024-006" /> },
          { id: 'philhealth', label: 'PhilHealth', hint: 'Premium schedule for one calendar month.', render: () => <AgencyReport agency="philhealth" title="PhilHealth Premium Schedule" reference="UHC Act RA 11223" /> },
          { id: 'pagibig', label: 'Pag-IBIG', hint: 'Contribution schedule for one calendar month.', render: () => <AgencyReport agency="pagibig" title="Pag-IBIG Contribution Schedule" reference="HDMF Circular 460" /> },
          { id: 'thirteenth', label: '13th Month Pay', hint: 'Due for the calendar year, per Presidential Decree 851.', render: () => <ThirteenthMonth /> },
          { id: 'bir2316', label: 'BIR 2316', hint: 'Annual compensation and tax withheld, per employee.', render: () => <Bir2316 /> },
          { id: 'entities', label: 'Legal Entities', hint: 'The registered employers each report above can be filtered to.', render: () => <LegalEntities /> },
        ]}
      />
    </>
  )
}
