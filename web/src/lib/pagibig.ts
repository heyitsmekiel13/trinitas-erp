import { escapeHtml } from './export'
import type { AgencySchedule, LegalEntitySummary } from './adminApi'

/** The template wants MM/DD/YYYY; the schedule gives an ISO date string. */
function formatMmDdYyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

/**
 * The real Pag-IBIG "PAGIBIG CONVERTER" upload template, reproduced exactly
 * — same header block, same detail-row columns, in the same order — from a
 * genuine blank template on file (`SBC_PAGIBIG_TEMPLATE with CDV DG2
 * v2.08202024.xls`). Two values on the header block are near-universal for
 * a private employer filing a monthly contribution and are written as-is
 * ("P - Private", "MC - Monthly Contribution") rather than exposed as
 * settings nobody here needs to change; everything else — employer name,
 * ID, address, ZIP, phone, branch code — comes from the legal entity the
 * schedule was run for, never hardcoded.
 *
 * Unlike SSS and PhilHealth, no genuine blank upload template for those two
 * agencies was found on file, so they get an honest CSV of the same
 * schedule instead of a fabricated portal format (see `exportAgencyCsv`).
 */
export function exportPagibigConverter(schedule: AgencySchedule, entity: LegalEntitySummary | null): string {
  const period = `${schedule.year}/${String(schedule.month).padStart(2, '0')}`
  const cell = (v: string | number | null | undefined) => `<td>${escapeHtml(v == null ? '' : String(v))}</td>`
  const th = (v: string) => `<th>${escapeHtml(v)}</th>`

  const rows = schedule.rows
    .map(
      (r) =>
        `<tr>${[
          cell(r.number),
          cell(''),
          cell(r.lastName ?? ''),
          cell(r.firstName ?? ''),
          cell(r.middleName ?? ''),
          cell(r.employee.toFixed(2)),
          cell(r.employer.toFixed(2)),
          cell(r.tin ?? ''),
          cell(r.birthDate ? formatMmDdYyyy(r.birthDate) : ''),
        ].join('')}</tr>`,
    )
    .join('')

  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">
<style>
  table { border-collapse: collapse; font-family: Calibri, sans-serif; font-size: 10pt; }
  td, th { padding: 3px 6px; border: 1px solid #D9DDE3; }
  th { background: #E11D34; color: #fff; font-weight: 600; text-align: left; }
</style></head><body>
<table>
<tr><td colspan="9">               PAGIBIG CONVERTER</td></tr>
<tr>${th('Employer Name*')}<td></td>${th('Employer ID *')}${th('Employer Address*')}<td></td>${th('ZIP Code')}${th('Telephone')}<td></td><td></td></tr>
<tr>${cell(entity?.legalName ?? entity?.name ?? '')}<td></td>${cell(entity?.pagibigEmployerNo)}${cell(entity?.address)}<td></td>${cell(entity?.zipCode)}${cell(entity?.phone)}<td></td><td></td></tr>
<tr>${th('Employer Type*')}${th('Payment Type*')}${th('Period Covered\n(YYYY/MM)*')}${th('Branch Code*')}${th('Total EE Amount')}${th('Total ER Amount')}${th('Grand Total')}<td></td>${th('No of Employees')}</tr>
<tr>${cell('P - Private')}${cell('MC - Monthly Contribution')}${cell(period)}${cell(entity?.pagibigBranchCode)}${cell(schedule.totals.employee.toFixed(2))}${cell(schedule.totals.employer.toFixed(2))}${cell(schedule.totals.total.toFixed(2))}<td></td>${cell(schedule.rows.length)}</tr>
<tr>${th('PAGIBIG ID / ACCTNO / HLIDNO*')}${th('COMPANY ID')}${th('LASTNAME *')}${th('FIRSTNAME *')}${th('MIDDLENAME')}${th('EE\n(EMPLOYEE SHARE) *')}${th('ER\n(EMPLOYER SHARE)')}${th('TIN\n(XXX-XXX-XXX-000)')}${th('BIRTHDATE\n(MM/DD/YYYY) *')}</tr>
${rows}
</table></body></html>`
}
