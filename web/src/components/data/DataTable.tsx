import * as React from 'react'
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Download,
  FileSpreadsheet,
  FileText,
  Inbox,
  Printer,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUi } from '@/app/store'
import { exportCsv, exportExcel, printRegion, type ExportColumn } from '@/lib/export'
import { Button, Input, Select } from '@/components/ui/primitives'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/overlay'
import { EmptyState, SkeletonTable } from '@/components/ui/feedback'
import { currentUser } from '@/app/auth'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends unknown, TValue> {
    /** Right-aligned, tabular figures. Use for money and counts. */
    numeric?: boolean
    /** Hidden below `lg` so phones show only what matters. */
    secondary?: boolean
    /** Plain-text value for CSV/Excel export. Defaults to the raw cell value. */
    exportValue?: (row: TData) => string | number
    width?: string
  }
}

export type FacetFilter = {
  columnId: string
  label: string
  /** Omit to derive the option list from the data itself. */
  options?: string[]
}

export function DataTable<T extends object>({
  data,
  columns,
  loading,
  error,
  searchPlaceholder = 'Search…',
  filters = [],
  onRowClick,
  toolbar,
  exportName,
  exportTitle,
  pageSize = 15,
  emptyTitle = 'No records found',
  emptyDescription = 'Try clearing the filters, or widen the date range.',
  stickyFirstColumn = true,
  className,
  onVisibleRowsChange,
}: {
  data: T[]
  columns: ColumnDef<T, any>[]
  loading?: boolean
  error?: unknown
  searchPlaceholder?: string
  filters?: FacetFilter[]
  onRowClick?: (row: T) => void
  toolbar?: React.ReactNode
  exportName: string
  exportTitle?: string
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  stickyFirstColumn?: boolean
  className?: string
  /** What search and the facet filters currently leave visible — the same set Export already uses, for a caller (a bulk print, say) that means "what I'm looking at", not "the whole table". */
  onVisibleRowsChange?: (rows: T[]) => void
}) {
  const density = useUi((s) => s.density)
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const regionRef = React.useRef<HTMLDivElement>(null)

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
  })

  const rows = table.getRowModel().rows
  const filteredRows = table.getFilteredRowModel().rows
  const activeFilters = columnFilters.length + (globalFilter ? 1 : 0)

  // Runs every render rather than depending on `filteredRows` — that array
  // is a fresh reference each time regardless of whether its contents
  // changed, and depending on it (or on things that turned out not to be as
  // stable as they looked, like the incoming `data` prop) fired this on
  // every render, which fed straight back in as a parent state update and
  // looped forever. Guarded by content instead: the parent is only told
  // when the set of visible row ids has actually changed.
  const visibleSignature = React.useRef<string>('')
  React.useEffect(() => {
    const signature = filteredRows.map((r) => r.id).join(',')
    if (signature !== visibleSignature.current) {
      visibleSignature.current = signature
      onVisibleRowsChange?.(filteredRows.map((r) => r.original))
    }
  })

  /** Export follows what the user is looking at: visible columns, filtered rows. */
  const buildExportColumns = (): ExportColumn<T>[] =>
    table
      .getVisibleLeafColumns()
      .filter((c) => c.id !== 'actions')
      .map((column) => ({
        header: typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id,
        value: (row: T) => {
          const custom = column.columnDef.meta?.exportValue
          if (custom) return custom(row)
          const value = (row as Record<string, unknown>)[column.id]
          return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : (value as string | number)
        },
      }))

  const exportRows = () => filteredRows.map((r) => r.original)

  const cellPad = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2.5'

  return (
    <div className={cn('card overflow-hidden', className)} ref={regionRef} data-print="keep">
      {/* ------------------------------- Toolbar ------------------------------ */}
      {/* Wraps rather than squeezing: a page with several facet filters must
          never crush the search box down to its icon. */}
      <div
        data-print="hide"
        className="flex flex-col gap-2.5 border-b border-line p-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search records"
            className="h-9 pr-8 pl-8"
          />
          {globalFilter && (
            <button
              onClick={() => setGlobalFilter('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-3 hover:text-ink"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* One filter row above the data — never inside a card. */}
        <div className="flex flex-wrap items-center gap-2">
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId)
            if (!column) return null
            const options =
              filter.options ??
              [...column.getFacetedUniqueValues().keys()]
                .filter((v): v is string => typeof v === 'string')
                .sort()
            return (
              <Select
                key={filter.columnId}
                value={(column.getFilterValue() as string) ?? ''}
                onChange={(e) => column.setFilterValue(e.target.value || undefined)}
                aria-label={`Filter by ${filter.label}`}
                className="h-9 w-auto min-w-[8.5rem]"
              >
                <option value="">All {filter.label.toLowerCase()}</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            )
          })}

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setColumnFilters([])
                setGlobalFilter('')
              }}
            >
              <SlidersHorizontal className="size-3.5" />
              Clear ({activeFilters})
            </Button>
          )}

          {toolbar}

          <Menu
            trigger={({ toggle }) => (
              <Button variant="secondary" size="sm" onClick={toggle} aria-label="Toggle columns">
                <Columns3 className="size-3.5" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            )}
          >
            <MenuLabel>Visible columns</MenuLabel>
            <div className="max-h-72 overflow-y-auto">
              {table
                .getAllLeafColumns()
                .filter((c) => c.getCanHide())
                .map((column) => (
                  <label
                    key={column.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3"
                  >
                    <input
                      type="checkbox"
                      checked={column.getIsVisible()}
                      onChange={column.getToggleVisibilityHandler()}
                      className="size-3.5 accent-[var(--color-brand-500)]"
                    />
                    <span className="truncate">
                      {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                    </span>
                  </label>
                ))}
            </div>
          </Menu>

          <Menu
            trigger={({ toggle }) => (
              <Button variant="secondary" size="sm" onClick={toggle}>
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>{filteredRows.length} filtered rows</MenuLabel>
                <MenuItem
                  icon={FileText}
                  onClick={() => {
                    exportCsv(exportName, buildExportColumns(), exportRows())
                    close()
                  }}
                >
                  Preview CSV
                </MenuItem>
                <MenuItem
                  icon={FileSpreadsheet}
                  onClick={() => {
                    exportExcel(exportName, exportTitle ?? exportName, buildExportColumns(), exportRows())
                    close()
                  }}
                >
                  Preview for Excel
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  icon={Printer}
                  onClick={() => {
                    printRegion(regionRef.current, {
                      title: exportTitle ?? exportName,
                      subtitle: `${filteredRows.length} records`,
                      preparedBy: currentUser().name,
                      criteria: [
                        ...(globalFilter ? [{ label: 'Search', value: globalFilter }] : []),
                        ...columnFilters.map((f) => ({ label: f.id, value: String(f.value) })),
                      ],
                    })
                    close()
                  }}
                >
                  Print / Save as PDF
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      {/* -------------------------------- Table ------------------------------- */}
      {loading ? (
        <SkeletonTable rows={8} cols={Math.min(columns.length, 7)} />
      ) : error ? (
        <EmptyState icon={Inbox} title="Could not load records" description={String(error)} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} />
      ) : (
        // Wide tables scroll inside their own container; the page never does.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2">
                {table.getHeaderGroups()[0]!.headers.map((header, i) => {
                  const meta = header.column.columnDef.meta
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      style={{ width: meta?.width }}
                      className={cn(
                        'px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-3 uppercase',
                        meta?.numeric ? 'text-right' : 'text-left',
                        meta?.secondary && 'hidden lg:table-cell',
                        stickyFirstColumn && i === 0 && 'sticky left-0 z-10 bg-surface-2',
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'inline-flex items-center gap-1 transition-colors hover:text-ink',
                            meta?.numeric && 'flex-row-reverse',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3 text-brand-500" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3 text-brand-500" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b border-line/70 transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  {row.getVisibleCells().map((cell, i) => {
                    const meta = cell.column.columnDef.meta
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          cellPad,
                          'text-ink-2',
                          meta?.numeric && 'num text-right',
                          meta?.secondary && 'hidden lg:table-cell',
                          stickyFirstColumn && i === 0 && 'sticky left-0 z-10 bg-surface font-medium text-ink',
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------ Pagination ---------------------------- */}
      {!loading && rows.length > 0 && (
        <div
          data-print="hide"
          className="flex flex-col gap-2.5 border-t border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-xs text-ink-3">
            Showing <span className="tabular font-medium text-ink-2">{rows.length}</span> of{' '}
            <span className="tabular font-medium text-ink-2">{filteredRows.length}</span> records
            {filteredRows.length !== data.length && <> (filtered from {data.length})</>}
          </p>

          <div className="flex items-center gap-2">
            <Select
              value={String(table.getState().pagination.pageSize)}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              aria-label="Rows per page"
              className="h-8 w-auto text-xs"
            >
              {[10, 15, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular px-1 text-xs whitespace-nowrap text-ink-3">
              {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
            </span>
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
