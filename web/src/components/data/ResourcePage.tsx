import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus, Printer, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { invalidateResource, useResource } from '@/lib/api'
import { deleteRecord, liveApi } from '@/lib/adminApi'
import { printRegion } from '@/lib/export'
import { fmtDate, money, num, titleCase } from '@/lib/format'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge, Button, StatusBadge } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/feedback'
import { DataTable, type FacetFilter } from './DataTable'
import { RecordForm, type FormField, type LineConfig } from './RecordForm'
import { currentUser } from '@/app/auth'

/* -------------------------------------------------------------------------- */
/* Detail panel                                                                */
/* -------------------------------------------------------------------------- */

export function DetailGrid({ children, columns = 2 }: { children: React.ReactNode; columns?: 1 | 2 }) {
  return <dl className={cn('grid gap-x-5 gap-y-4', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>{children}</dl>
}

export function DetailField({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn('min-w-0', full && 'col-span-full')}>
      <dt className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
      <dd className="mt-1 text-[13px] break-words text-ink">{children}</dd>
    </div>
  )
}

// Internal identifiers a user has no use for.
const HIDDEN_FIELDS = new Set(['id'])
const HIDDEN_SUFFIX = /Id$/

/** Formats a raw record field for display without any per-module wiring. */
function renderValue(key: string, value: unknown): React.ReactNode {
  if (value == null || value === '') return <span className="text-ink-3">—</span>
  if (typeof value === 'boolean') return <Badge tone={value ? 'good' : 'neutral'}>{value ? 'Yes' : 'No'}</Badge>
  if (key === 'status') return <StatusBadge status={String(value)} />

  if (typeof value === 'string') {
    // ISO timestamps come back from the API as strings.
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return fmtDate(value)
    return value
  }

  if (typeof value === 'number') {
    const isMoney = /amount|cost|price|value|balance|budget|spend|pay|salary|rate$|commission|quota|savings|limit|sales/i.test(key)
    if (isMoney && Math.abs(value) >= 1000) return money(value)
    if (/pct|percent|rate|accuracy|compliance|attainment|margin|utilisation/i.test(key)) return `${value}%`
    return num(value, Number.isInteger(value) ? 0 : 2)
  }
  return String(value)
}

/** The default drawer body: every field of the record, nicely laid out. */
export function AutoDetail<T extends object>({ row }: { row: T }) {
  const entries = Object.entries(row).filter(
    ([key, value]) => !HIDDEN_FIELDS.has(key) && !HIDDEN_SUFFIX.test(key) && typeof value !== 'object',
  )

  return (
    <DetailGrid>
      {entries.map(([key, value]) => (
        <DetailField key={key} label={titleCase(key)} full={typeof value === 'string' && value.length > 42}>
          {renderValue(key, value)}
        </DetailField>
      ))}
    </DetailGrid>
  )
}

/* -------------------------------------------------------------------------- */
/* Resource page                                                               */
/* -------------------------------------------------------------------------- */

export function ResourcePage<T extends object>({
  title,
  description,
  endpoint,
  loader,
  columns,
  filters,
  exportName,
  searchPlaceholder,
  createLabel,
  stats,
  aside,
  detailTitle,
  detailSubtitle,
  detailSize = 'lg',
  renderDetail,
  detailActions,
  pageSize,
  actions,
  formFields,
  formLines,
  formTitle,
  formDefaults,
  formExtras,
}: {
  title: string
  description: string
  /** Registry endpoint this page reads and writes, e.g. `sales/customers`. */
  endpoint: string
  loader: () => T[]
  columns: ColumnDef<T, any>[]
  filters?: FacetFilter[]
  exportName: string
  searchPlaceholder?: string
  createLabel?: string
  stats?: (rows: T[]) => React.ReactNode
  aside?: (rows: T[]) => React.ReactNode
  detailTitle?: (row: T) => string
  detailSubtitle?: (row: T) => string
  /** Widen the detail dialog for pages that show history or line items. */
  detailSize?: 'md' | 'lg' | 'xl' | '2xl'
  renderDetail?: (row: T) => React.ReactNode
  /**
   * Extra buttons in the detail dialog's footer — the place for actions that
   * move a document forward, like converting a quotation into an order.
   * `done` closes the dialog and refetches the list.
   */
  detailActions?: (row: T, done: () => void) => React.ReactNode
  pageSize?: number
  /**
   * Header buttons. Given the loaded rows when a function, for actions that
   * operate on the whole list rather than one record — raising a requisition
   * for everything below its reorder point, for instance.
   */
  actions?: React.ReactNode | ((rows: T[]) => React.ReactNode)
  /**
   * Supplying these turns on create, edit and delete. Without them the page
   * stays read-only and the New button is hidden rather than dead.
   */
  formFields?: FormField[]
  formLines?: LineConfig
  /** Singular noun for headings, e.g. "customer". Defaults from the title. */
  formTitle?: string
  formDefaults?: Record<string, unknown>
  /** Live panel rendered below the form fields — a calculation, a map. */
  formExtras?: (values: Record<string, unknown>) => React.ReactNode
}) {
  const toast = useToast()
  const { data = [], isLoading, error } = useResource<T[]>(endpoint, loader)
  // What search and the facet filters currently leave visible — starts as
  // the full set and narrows once DataTable reports its own filtered rows,
  // so `actions` sees what the user is looking at rather than everything.
  const [visibleRows, setVisibleRows] = React.useState<T[]>(data)
  const [selected, setSelected] = React.useState<T | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Record<string, unknown> | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<Record<string, unknown> | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const pageRef = React.useRef<HTMLDivElement>(null)

  // Writing needs a live API — on preview data there is nowhere to save to.
  const canWrite = Boolean(formFields?.length) && liveApi()
  const noun = formTitle ?? title.replace(/s$/, '').toLowerCase()

  const refresh = () => invalidateResource(endpoint)

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (row: T) => {
    setEditing(row as Record<string, unknown>)
    setFormOpen(true)
    setSelected(null)
  }

  const remove = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteRecord(endpoint, confirmDelete.id as number)
      await refresh()
      toast({ tone: 'success', title: `${titleCase(noun)} deleted` })
      setConfirmDelete(null)
      setSelected(null)
    } catch (e) {
      toast({ tone: 'error', title: 'Could not delete', description: (e as Error).message })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div ref={pageRef}>
      <PageHeader
        title={title}
        description={description}
        meta={
          !isLoading && (
            <Badge tone="neutral">
              {num(data.length)} record{data.length === 1 ? '' : 's'}
            </Badge>
          )
        }
        actions={
          <>
            {typeof actions === 'function' ? actions(visibleRows) : actions}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                printRegion(pageRef.current, { title, subtitle: description, preparedBy: currentUser().name })
              }
            >
              <Printer className="size-3.5" />
              <span className="hidden sm:inline">Print</span>
            </Button>
            {canWrite && (
              <Button variant="primary" size="sm" onClick={openCreate}>
                <Plus className="size-3.5" />
                {createLabel ?? `New ${noun}`}
              </Button>
            )}
          </>
        }
      />

      {stats && !isLoading && <div className="mb-4">{stats(data)}</div>}

      <div className={cn(aside && 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]')}>
        <DataTable
          data={data}
          columns={columns}
          loading={isLoading}
          error={error}
          filters={filters}
          exportName={exportName}
          exportTitle={title}
          searchPlaceholder={searchPlaceholder ?? `Search ${title.toLowerCase()}…`}
          pageSize={pageSize}
          onRowClick={setSelected}
          onVisibleRowsChange={setVisibleRows}
        />
        {aside && !isLoading && <div className="space-y-4">{aside(data)}</div>}
      </div>

      {/* ------------------------------ Detail ------------------------------ */}
      <Modal
        open={selected != null}
        onClose={() => setSelected(null)}
        size={detailSize}
        title={selected ? (detailTitle?.(selected) ?? title) : ''}
        description={selected ? detailSubtitle?.(selected) : undefined}
        footer={
          <>
            {canWrite && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(selected as Record<string, unknown>)}
              >
                <Trash2 className="size-3.5 text-critical" />
                Delete
              </Button>
            )}
            {selected &&
              detailActions?.(selected, () => {
                setSelected(null)
                refresh()
              })}
            <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
            {canWrite && (
              <Button variant="primary" size="sm" onClick={() => selected && openEdit(selected)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
          </>
        }
      >
        {selected && (renderDetail ? renderDetail(selected) : <AutoDetail row={selected} />)}
      </Modal>

      {/* ------------------------------- Form ------------------------------- */}
      {formFields && (
        <RecordForm
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSaved={refresh}
          endpoint={endpoint}
          title={noun}
          fields={formFields}
          lines={formLines}
          record={editing}
          defaults={formDefaults}
          extras={formExtras}
        />
      )}

      {/* ------------------------------ Delete ------------------------------ */}
      <Modal
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title={`Delete this ${noun}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={deleting}>
              Delete
            </Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-critical/10">
            <TriangleAlert className="size-4 text-critical" />
          </span>
          <div className="min-w-0 text-[13px] text-ink-2">
            <p className="font-medium text-ink">
              {String(confirmDelete?.name ?? confirmDelete?.no ?? confirmDelete?.code ?? confirmDelete?.company ?? '')}
            </p>
            <p className="mt-1">
              This removes the record from the system. Anything already linked to it — orders, invoices, history —
              keeps its own copy of the details.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
