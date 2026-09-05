import type { FormField } from '@/components/data/RecordForm'

/**
 * Form definitions for Procurement.
 *
 * A purchase order is what makes goods arrive, so the warehouse's inbound
 * screen reads from these: announce a shipment there and it can only be
 * against an order that exists here and has not fully arrived.
 */

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

const daysOut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

const SUPPLIERS = { endpoint: 'procurement/suppliers', label: 'name', sublabel: 'code' } as const
const WAREHOUSES = { endpoint: 'warehouse/locations', label: 'name', sublabel: 'city' } as const

/** The purchasing team, not the whole company. */
const BUYERS = { endpoint: 'procurement/buyers', label: 'fullName', sublabel: 'position' } as const

/** Orders still open enough to receive or invoice against. */
const OPEN_ORDERS = { endpoint: 'procurement/open-orders', label: 'no', sublabel: 'supplier' } as const

/* -------------------------------------------------------------------------- */

export const supplierFields: FormField[] = [
  { name: 'name', label: 'Supplier name', required: true, full: true, placeholder: 'Mindanao Packaging Corp' },
  { name: 'category', label: 'Category', placeholder: 'Packaging' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Active', 'Probationary', 'Blacklisted'),
  },

  { section: 'Contact', name: 'contact', label: 'Contact person' },
  { section: 'Contact', name: 'phone', label: 'Phone', type: 'tel' },
  { section: 'Contact', name: 'email', label: 'Email', type: 'email' },
  { section: 'Contact', name: 'city', label: 'City' },
  { section: 'Contact', name: 'address', label: 'Address', full: true },

  { section: 'Commercial terms', name: 'tin', label: 'TIN', placeholder: '000-000-000-000' },
  {
    section: 'Commercial terms',
    name: 'terms',
    label: 'Payment terms',
    type: 'select',
    required: true,
    options: choices('COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'),
  },
  {
    section: 'Commercial terms',
    name: 'accreditedUntil',
    label: 'Accredited until',
    type: 'date',
    hint: 'Leave blank if accreditation does not expire.',
  },
]

export const supplierDefaults = { status: 'Active', terms: 'Net 30' }

/* -------------------------------------------------------------------------- */

export const purchaseOrderFields: FormField[] = [
  { name: 'supplierId', label: 'Supplier', type: 'select', required: true, optionsFrom: SUPPLIERS, full: true },
  { name: 'date', label: 'Order date', type: 'date', required: true },
  {
    name: 'expected',
    label: 'Expected delivery',
    type: 'date',
    hint: 'The warehouse plans receiving around this.',
  },

  {
    section: 'Delivery and approval',
    name: 'warehouseId',
    label: 'Deliver to',
    type: 'select',
    optionsFrom: { endpoint: 'warehouse/locations', label: 'name', sublabel: 'city' },
  },
  { section: 'Delivery and approval', name: 'buyerId', label: 'Buyer', type: 'select', optionsFrom: BUYERS },
  {
    section: 'Delivery and approval',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'For Approval', 'Approved', 'Partial', 'Completed', 'Cancelled'),
    full: true,
    hint: 'The warehouse can only announce a shipment against an Approved or Partial order.',
  },
]

export const purchaseOrderDefaults = { status: 'Draft', date: today(), expected: daysOut(14) }

/* -------------------------------------------------------------------------- */

export const requisitionFields: FormField[] = [
  { name: 'title', label: 'What is needed', required: true, full: true, placeholder: 'Q3 packaging replenishment' },
  { name: 'requestedById', label: 'Requested by', type: 'select', optionsFrom: BUYERS },
  {
    name: 'hrDepartmentId',
    label: 'Department',
    type: 'select',
    optionsFrom: { endpoint: 'hr/departments', label: 'name', sublabel: 'code' },
  },
  { name: 'date', label: 'Raised on', type: 'date', required: true },
  { name: 'needBy', label: 'Needed by', type: 'date', hint: 'A tender closes a week before this.' },

  {
    section: 'Approval',
    name: 'justification',
    label: 'Justification',
    type: 'textarea',
    full: true,
    placeholder: 'Carton stock covers three weeks at current run rate.',
    hint: 'This is what an approver actually reads.',
  },
  { section: 'Approval', name: 'budgetLeft', label: 'Budget remaining', type: 'money' },
  {
    section: 'Approval',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Submitted', 'For Approval', 'Approved', 'Rejected', 'Converted'),
    hint: 'Only an Approved requisition can go to tender or become an order.',
  },
]

export const requisitionDefaults = { status: 'Draft', date: today(), needBy: daysOut(30), budgetLeft: 0 }

/* -------------------------------------------------------------------------- */

export const rfqFields: FormField[] = [
  { name: 'title', label: 'Tender title', required: true, full: true },
  {
    name: 'purchaseRequisitionId',
    label: 'For requisition',
    type: 'select',
    optionsFrom: { endpoint: 'procurement/requisitions', label: 'no', sublabel: 'title' },
    full: true,
    hint: 'Linking it lets the winning bid become a purchase order in one click.',
  },
  { name: 'buyerId', label: 'Buyer', type: 'select', optionsFrom: BUYERS },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Open', 'Under Evaluation', 'Awarded', 'Cancelled'),
  },

  { section: 'Timing and value', name: 'issued', label: 'Issued', type: 'date', required: true },
  { section: 'Timing and value', name: 'closes', label: 'Closes', type: 'date' },
  { section: 'Timing and value', name: 'invited', label: 'Suppliers invited', type: 'number', min: 0 },
  {
    section: 'Timing and value',
    name: 'estimatedValue',
    label: 'Estimated value',
    type: 'money',
    min: 0,
    hint: 'Savings are measured against this. Response count and best bid come from the bids.',
  },
]

export const rfqDefaults = { status: 'Open', issued: today(), closes: daysOut(14), invited: 0, estimatedValue: 0 }

/* -------------------------------------------------------------------------- */

export const bidFields: FormField[] = [
  {
    name: 'rfqId',
    label: 'RFQ',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'procurement/rfqs', label: 'no', sublabel: 'title' },
    full: true,
  },
  { name: 'supplierId', label: 'Supplier', type: 'select', required: true, optionsFrom: SUPPLIERS, full: true },
  { name: 'amount', label: 'Quoted amount', type: 'money', required: true, min: 0 },
  { name: 'leadTimeDays', label: 'Lead time (days)', type: 'number', min: 0, max: 365 },
  { name: 'paymentTerms', label: 'Payment terms', placeholder: 'Net 30' },
  {
    name: 'technicalScore',
    label: 'Technical score',
    type: 'number',
    min: 0,
    max: 100,
    hint: 'Out of 100 — quality, capability, compliance.',
  },
]

export const bidDefaults = { amount: 0, leadTimeDays: 0, technicalScore: 0 }

/* -------------------------------------------------------------------------- */

export const receiptFields: FormField[] = [
  {
    name: 'purchaseOrderId',
    label: 'Purchase order',
    type: 'select',
    required: true,
    optionsFrom: OPEN_ORDERS,
    full: true,
    hint: 'Only approved orders that are not fully received.',
  },
  { name: 'warehouseId', label: 'Received into', type: 'select', required: true, optionsFrom: WAREHOUSES },
  { name: 'date', label: 'Received on', type: 'date', required: true },

  { section: 'Inspection', name: 'receivedById', label: 'Received by', type: 'select', optionsFrom: BUYERS },
  {
    section: 'Inspection',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'For Approval', 'Posted', 'Rejected'),
    hint: 'Only Posted updates the order — a draft is still being counted.',
  },
  {
    section: 'Inspection',
    name: 'notes',
    label: 'Inspection notes',
    type: 'textarea',
    full: true,
    placeholder: 'Two cartons crushed on the top layer; rejected.',
  },
]

export const receiptDefaults = { status: 'Draft', date: today() }

/* -------------------------------------------------------------------------- */

export const invoiceFields: FormField[] = [
  {
    name: 'no',
    label: 'Invoice number',
    required: true,
    full: true,
    placeholder: 'SPS-88412',
    hint: 'The supplier’s own number. Must be unique — paying an invoice twice is the classic mistake.',
  },
  { name: 'supplierId', label: 'Supplier', type: 'select', required: true, optionsFrom: SUPPLIERS },
  { name: 'amount', label: 'Amount billed', type: 'money', required: true, min: 0 },
  { name: 'date', label: 'Invoice date', type: 'date', required: true },
  { name: 'due', label: 'Due date', type: 'date', required: true },

  {
    section: 'Matching',
    name: 'purchaseOrderId',
    label: 'Against order',
    type: 'select',
    optionsFrom: { endpoint: 'procurement/orders', label: 'no', sublabel: 'supplier' },
    hint: 'Needed for a three-way match.',
  },
  {
    section: 'Matching',
    name: 'goodsReceiptId',
    label: 'Against receipt',
    type: 'select',
    optionsFrom: { endpoint: 'procurement/goods-receipts', label: 'no', sublabel: 'poNo' },
  },
  {
    section: 'Matching',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'For Approval', 'Approved', 'Paid', 'Overdue', 'Rejected'),
    full: true,
  },
]

export const invoiceDefaults = { status: 'Draft', date: today(), due: daysOut(30), amount: 0 }

/* -------------------------------------------------------------------------- */

export const contractFields: FormField[] = [
  { name: 'title', label: 'Contract title', required: true, full: true, placeholder: 'Corrugated carton supply 2026' },
  { name: 'supplierId', label: 'Supplier', type: 'select', required: true, optionsFrom: SUPPLIERS },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('Supply Agreement', 'Service Contract', 'Framework Agreement', 'Lease'),
  },

  { section: 'Term', name: 'start', label: 'Starts', type: 'date', required: true },
  { section: 'Term', name: 'end', label: 'Ends', type: 'date', required: true },
  { section: 'Term', name: 'value', label: 'Contract value', type: 'money', min: 0 },
  {
    section: 'Term',
    name: 'noticeDays',
    label: 'Notice period (days)',
    type: 'number',
    min: 0,
    max: 365,
    hint: 'How long before expiry you must give notice.',
  },
  {
    section: 'Term',
    name: 'autoRenew',
    label: 'Renews automatically',
    type: 'switch',
    hint: 'Auto-renewing contracts need watching before the notice window closes.',
  },

  { section: 'Ownership', name: 'ownerId', label: 'Owner', type: 'select', optionsFrom: BUYERS },
  {
    section: 'Ownership',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Active', 'Expiring', 'Expired', 'Terminated'),
  },
]

export const contractDefaults = {
  status: 'Draft',
  type: 'Supply Agreement',
  start: today(),
  end: daysOut(365),
  value: 0,
  noticeDays: 30,
  autoRenew: false,
}
