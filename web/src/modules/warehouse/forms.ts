import type { FormField } from '@/components/data/RecordForm'
import { CATEGORY_CODES } from '@/data/sku'

/**
 * Form definitions for the Warehouse department.
 *
 * The two flow documents here deliberately start from somewhere else: an
 * inbound shipment begins with the purchase order that caused it, and a pick
 * list begins with the sales order it fulfils. That is what stops the
 * warehouse becoming a parallel set of lists somebody keys in by hand.
 */

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

const WAREHOUSES = { endpoint: 'warehouse/locations', label: 'name', sublabel: 'city' } as const
const EMPLOYEES = { endpoint: 'hr/employees', label: 'fullName', sublabel: 'employeeNo' } as const

/* -------------------------------------------------------------------------- */

export const inboundFields: FormField[] = [
  {
    name: 'purchaseOrderId',
    label: 'Purchase order',
    type: 'select',
    required: true,
    // Only orders Procurement has approved and not fully received.
    optionsFrom: { endpoint: 'warehouse/expected-orders', label: 'no', sublabel: 'supplier' },
    full: true,
    hint: 'Supplier, destination and expected lines are taken from the order.',
  },
  {
    name: 'warehouseId',
    label: 'Receiving warehouse',
    type: 'select',
    optionsFrom: WAREHOUSES,
    hint: 'Defaults to the warehouse on the order.',
  },
  { name: 'arrival', label: 'Expected arrival', type: 'date' },

  { section: 'Receiving', name: 'dock', label: 'Dock', placeholder: 'D-02' },
  { section: 'Receiving', name: 'pallets', label: 'Pallets', type: 'number', min: 0 },
  {
    section: 'Receiving',
    name: 'linesTotal',
    label: 'Lines expected',
    type: 'number',
    min: 0,
    hint: 'Blank takes the line count from the order.',
  },
  {
    section: 'Receiving',
    name: 'linesPutaway',
    label: 'Lines put away',
    type: 'number',
    min: 0,
    visibleWhen: (values) => ['Putaway', 'Completed'].includes(String(values.status)),
  },
  {
    section: 'Receiving',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Expected', 'Receiving', 'In Inspection', 'Putaway', 'Completed'),
    full: true,
  },
]

export const inboundDefaults = { status: 'Expected', pallets: 0, linesPutaway: 0, arrival: today() }

/* -------------------------------------------------------------------------- */

export const outboundFields: FormField[] = [
  {
    name: 'salesOrderId',
    label: 'Sales order',
    type: 'select',
    optionsFrom: { endpoint: 'sales/orders', label: 'no', sublabel: 'customer' },
    full: true,
    hint: 'Linking it means picking progress updates the order automatically.',
  },
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES },
  { name: 'cutoff', label: 'Cut-off', type: 'date' },

  { section: 'Floor', name: 'wave', label: 'Wave', placeholder: 'AM-1' },
  {
    section: 'Floor',
    name: 'pickerId',
    label: 'Picker',
    type: 'select',
    optionsFrom: { endpoint: 'sales/drivers', label: 'fullName', sublabel: 'position' },
  },
  { section: 'Floor', name: 'lines', label: 'Lines to pick', type: 'number', required: true, min: 0 },
  { section: 'Floor', name: 'linesPicked', label: 'Lines picked', type: 'number', min: 0 },
  {
    section: 'Floor',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Released', 'Picking', 'Packed', 'Staged', 'Dispatched', 'On Hold'),
    full: true,
    hint: 'Dispatched marks every line picked and closes the order out.',
  },
]

export const outboundDefaults = { status: 'Released', lines: 0, linesPicked: 0, cutoff: today() }

/* -------------------------------------------------------------------------- */

const ITEMS = { endpoint: 'warehouse/items', label: 'name', sublabel: 'sku' } as const

export const transferFields: FormField[] = [
  { name: 'fromWarehouseId', label: 'From', type: 'select', required: true, optionsFrom: WAREHOUSES },
  { name: 'toWarehouseId', label: 'To', type: 'select', required: true, optionsFrom: WAREHOUSES },
  { name: 'date', label: 'Transfer date', type: 'date', required: true },
  { name: 'eta', label: 'Expected arrival', type: 'date' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Approved', 'In Transit', 'Received', 'Cancelled'),
    full: true,
    hint: 'In Transit takes the stock off the source shelf; Received puts it on the destination’s.',
  },
]

export const transferDefaults = { status: 'Draft', date: today() }

/* -------------------------------------------------------------------------- */

export const cycleCountFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES },
  { name: 'zone', label: 'Zone', placeholder: 'A' },
  { name: 'date', label: 'Count date', type: 'date', required: true },
  {
    name: 'countedById',
    label: 'Counted by',
    type: 'select',
    optionsFrom: { endpoint: 'sales/drivers', label: 'fullName', sublabel: 'position' },
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Scheduled', 'In Progress', 'For Approval', 'Posted'),
    full: true,
    hint: 'Only Posted corrects the books — the count sheet becomes the authority.',
  },
]

export const cycleCountDefaults = { status: 'Scheduled', date: today() }

/* -------------------------------------------------------------------------- */

export const binFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES, full: true },
  { name: 'code', label: 'Bin code', required: true, placeholder: 'A-01-03' },
  { name: 'zone', label: 'Zone', placeholder: 'A' },
  { name: 'aisle', label: 'Aisle', placeholder: '01' },
  { name: 'capacity', label: 'Capacity (units)', type: 'number', min: 0 },
  {
    name: 'preferredClass',
    label: 'Preferred ABC class',
    type: 'select',
    options: choices('A', 'B', 'C'),
    hint: 'Tags this bin as where that class lives — drives putaway suggestions. Leave blank if it holds a mix.',
  },
  { name: 'isActive', label: 'In use', type: 'switch', hint: 'Turn off to stop putaway into this bin.' },
]

export const binDefaults = { isActive: true, capacity: 0 }

/* -------------------------------------------------------------------------- */

export const labelFields: FormField[] = [
  {
    name: 'template',
    label: 'Label template',
    type: 'select',
    required: true,
    options: choices('SKU Label', 'Bin Label', 'Pallet Label', 'Price Tag', 'Batch Label'),
    full: true,
  },
  { name: 'warehouseId', label: 'Warehouse', type: 'select', optionsFrom: WAREHOUSES },
  { name: 'quantity', label: 'Labels to print', type: 'number', required: true, min: 1 },
  { name: 'printer', label: 'Printer', placeholder: 'Zebra ZT411 — Receiving' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Queued', 'Printing', 'Completed', 'Failed'),
  },
]

export const labelDefaults = { template: 'SKU Label', status: 'Queued', quantity: 1 }

/* -------------------------------------------------------------------------- */

export const itemFields: FormField[] = [
  {
    name: 'sku',
    label: 'SKU',
    required: true,
    placeholder: 'TRN-BEV-COR-0001',
    hint: 'Category and brand decide the prefix — the panel below issues the next free code.',
  },
  { name: 'legacySku', label: 'Old code', placeholder: 'TRN-1001', hint: 'Kept so printed labels and supplier paperwork still resolve.' },
  { name: 'name', label: 'Item name', required: true, placeholder: 'Cordilla Bottled Water 500ml' },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: Object.keys(CATEGORY_CODES).map((value) => ({ value, label: `${value} (${CATEGORY_CODES[value]})` })),
  },
  { name: 'brand', label: 'Brand' },
  { name: 'uom', label: 'Unit of measure', type: 'select', required: true, options: choices('CASE', 'PIECE', 'PACK', 'KG', 'LITRE') },
  { name: 'packSize', label: 'Pack size', placeholder: '24 x 500ml' },
  {
    name: 'barcode',
    label: 'Barcode',
    full: true,
    placeholder: 'Defaults to the SKU',
    hint: 'Left blank, this is set to the SKU automatically. Only fill it in if the item scans under a different code.',
  },

  { section: 'Pricing', name: 'unitCost', label: 'Unit cost', type: 'money', required: true, min: 0, hint: 'Used to value stock and to cost every order line.' },
  { section: 'Pricing', name: 'sellPrice', label: 'Selling price', type: 'money', min: 0 },

  { section: 'Replenishment', name: 'reorderPoint', label: 'Reorder point', type: 'number', min: 0, hint: 'Available stock at or below this appears on the replenishment list.' },
  { section: 'Replenishment', name: 'reorderQty', label: 'Reorder quantity', type: 'number', min: 0 },
  { section: 'Replenishment', name: 'leadTimeDays', label: 'Lead time (days)', type: 'number', min: 0, max: 365, hint: 'Cover shorter than this counts as critical.' },
  { section: 'Replenishment', name: 'shelfLifeDays', label: 'Shelf life (days)', type: 'number', min: 0 },
  {
    section: 'Replenishment',
    name: 'primarySupplierId',
    label: 'Primary supplier',
    type: 'select',
    optionsFrom: { endpoint: 'procurement/suppliers', label: 'name', sublabel: 'code' },
  },
  { section: 'Replenishment', name: 'abc', label: 'ABC class', type: 'select', options: choices('A', 'B', 'C') },
]

export const itemDefaults = {
  uom: 'CASE',
  unitCost: 0,
  sellPrice: 0,
  reorderPoint: 0,
  reorderQty: 0,
  leadTimeDays: 7,
  abc: 'C',
}

/** Referenced by the transfer and count line editors. */
export const LINE_ITEMS = ITEMS

/* -------------------------------------------------------------------------- */

export const incidentFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES, full: true },
  { name: 'occurredOn', label: 'Date', type: 'date', required: true },
  { name: 'reportedBy', label: 'Reported by', type: 'select', optionsFrom: EMPLOYEES },
  {
    name: 'hazardType',
    label: 'Hazard type',
    type: 'select',
    required: true,
    options: choices('MHE', 'Dock', 'Racking', 'Manual Handling', 'Chemical', 'Fire', 'Other'),
  },
  { name: 'severity', label: 'Severity', type: 'select', required: true, options: choices('Near-miss', 'Minor', 'Moderate', 'Major') },
  { name: 'location', label: 'Location', placeholder: 'Aisle 3, Bay 12' },
  { name: 'description', label: 'What happened', type: 'textarea', required: true, full: true },
  { name: 'ppeInvolved', label: 'PPE involved', type: 'textarea', full: true, hint: 'What was and was not being worn.' },
  { name: 'correctiveAction', label: 'Corrective action', type: 'textarea', full: true },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Open', 'Investigating', 'Resolved', 'Closed'),
  },
]

export const incidentDefaults = { occurredOn: today(), severity: 'Minor', status: 'Open' }

/* -------------------------------------------------------------------------- */

export const suggestionFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES, full: true },
  { name: 'raisedBy', label: 'Raised by', type: 'select', optionsFrom: EMPLOYEES },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: choices('5S', 'Safety', 'Efficiency', 'Quality', 'Other'),
  },
  { name: 'zone', label: 'Zone', placeholder: 'A' },
  { name: 'description', label: 'Suggestion', type: 'textarea', required: true, full: true },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Submitted', 'Under Review', 'In Progress', 'Implemented', 'Rejected'),
  },
  { name: 'impactNote', label: 'Impact / outcome', type: 'textarea', full: true, hint: 'Filled in once it is acted on.' },
]

export const suggestionDefaults = { category: '5S', status: 'Submitted' }

/* -------------------------------------------------------------------------- */

const scoreField = (name: string, label: string): FormField => ({
  name,
  label,
  type: 'select',
  required: true,
  options: [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
})

export const auditFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES, full: true },
  { name: 'zone', label: 'Zone', required: true, placeholder: 'A' },
  { name: 'auditedOn', label: 'Date', type: 'date', required: true },
  { name: 'auditedBy', label: 'Audited by', type: 'select', optionsFrom: EMPLOYEES },
  scoreField('sortScore', 'Sort'),
  scoreField('setScore', 'Set in order'),
  scoreField('shineScore', 'Shine'),
  scoreField('standardizeScore', 'Standardize'),
  scoreField('sustainScore', 'Sustain'),
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]

export const auditDefaults = { auditedOn: today(), sortScore: '3', setScore: '3', shineScore: '3', standardizeScore: '3', sustainScore: '3' }

/* -------------------------------------------------------------------------- */

export const dockAppointmentFields: FormField[] = [
  { name: 'warehouseId', label: 'Warehouse', type: 'select', required: true, optionsFrom: WAREHOUSES, full: true },
  { name: 'dockCode', label: 'Dock', required: true, placeholder: 'D-02' },
  { name: 'type', label: 'Direction', type: 'select', required: true, options: choices('Inbound', 'Outbound') },
  { name: 'scheduledAt', label: 'Scheduled for', type: 'date', required: true },
  { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', min: 5 },
  { name: 'reference', label: 'Reference', placeholder: 'PO-2026-0114' },
  { name: 'carrier', label: 'Carrier' },
  { name: 'driver', label: 'Driver' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Scheduled', 'Checked In', 'In Progress', 'Completed', 'No-show', 'Cancelled'),
  },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
]

export const dockAppointmentDefaults = { type: 'Inbound', durationMinutes: 30, status: 'Scheduled' }
