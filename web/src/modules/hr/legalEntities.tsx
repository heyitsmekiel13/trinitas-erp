import { Landmark } from 'lucide-react'
import { liveApi } from '@/lib/adminApi'
import { num } from '@/lib/format'
import { ResourcePage } from '@/components/data/ResourcePage'
import { cols } from '@/components/data/columns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { EmptyState } from '@/components/ui/feedback'
import * as forms from './forms'

/**
 * The registered employers statutory contributions are actually filed
 * under — distinct from Org & Positions' business groups (the operating
 * brand somebody works under). One employee can sit under one business
 * group and a different legal entity; see the migration for why the two
 * do not collapse into each other.
 */

type LegalEntity = {
  id: number
  name: string
  legalName: string | null
  tin: string | null
  sssEmployerNo: string | null
  philhealthEmployerNo: string | null
  pagibigEmployerNo: string | null
  pagibigBranchCode: string | null
  address: string | null
  zipCode: string | null
  phone: string | null
  active: boolean
  employeeCount: number
}

export function LegalEntities() {
  const c = cols<LegalEntity>()

  if (!liveApi()) {
    return (
      <>
        <PageHeader title="Legal Entities" description="The registered employers statutory contributions are filed under." />
        <div className="card">
          <EmptyState icon={Landmark} title="Needs the live API" description="Entities are read and written on the server." />
        </div>
      </>
    )
  }

  return (
    <ResourcePage<LegalEntity>
      title="Legal Entities"
      description="The registered employers each employee's SSS, PhilHealth and Pag-IBIG contributions are actually filed under — assign employees to one from their 201 file, then filter Statutory Reports by it."
      endpoint="hr/legal-entities"
      loader={() => []}
      exportName="legal-entities"
      createLabel="New entity"
      formFields={forms.legalEntityFields}
      formDefaults={forms.legalEntityDefaults}
      formTitle="legal entity"
      stats={(list) => (
        <StatGrid>
          <StatTile label="Entities" value={num(list.length)} icon={Landmark} />
          <StatTile label="Active" value={num(list.filter((e) => e.active).length)} icon={Landmark} />
          <StatTile label="Employees assigned" value={num(list.reduce((s, e) => s + e.employeeCount, 0))} icon={Landmark} />
        </StatGrid>
      )}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => row.legalName ?? 'No registered legal name on file'}
      columns={[
        c.primary('name', 'Entity', (row) => row.legalName ?? ''),
        c.text('tin', 'TIN', { mono: true, secondary: true }),
        c.text('sssEmployerNo', 'SSS employer no.', { mono: true, secondary: true }),
        c.number('employeeCount', 'Employees'),
        c.bool('active', 'Active'),
      ]}
    />
  )
}
