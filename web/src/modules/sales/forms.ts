import type { FormField } from '@/components/data/RecordForm'

/**
 * Form definitions for the Sales department.
 *
 * Each list declares its fields once; the API owns validation, so anything
 * accepted here is something the server will actually save. Option lists are
 * loaded from other registry endpoints rather than hard-coded, which is why a
 * customer you create appears in the order form immediately.
 *
 * Fields carry a `section` so a long document reads as a few short blocks. The
 * order within a section follows the order someone actually fills it in: who
 * the document is for, then what is on it, then how it is priced.
 */

/**
 * The sales team, not the whole company. Anyone who owns a quote, a lead or a
 * quota comes from the SALES department in the HR masterfile.
 */
const REP = { endpoint: 'sales/representatives', label: 'fullName', sublabel: 'position' } as const

/** Delivery is run by Operations and Warehouse, so drivers are a separate list. */
const DRIVER = { endpoint: 'sales/drivers', label: 'fullName', sublabel: 'position' } as const

const CUSTOMERS = { endpoint: 'sales/customers', label: 'name', sublabel: 'code' } as const
const ITEMS = { endpoint: 'warehouse/items', label: 'name', sublabel: 'sku' } as const

/** Orders narrowed to whichever customer the form has already chosen. */
const ORDERS_FOR_CUSTOMER = {
  endpoint: 'sales/orders',
  label: 'no',
  sublabel: 'customer',
  filterBy: { field: 'customerId', on: 'customerId' },
} as const

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

/** `days` from today, for validity and promise dates that default sensibly. */
const daysOut = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/* -------------------------------------------------------------------------- */

export const customerFields: FormField[] = [
  { name: 'name', label: 'Customer name', required: true, full: true, placeholder: 'Northgate Supermarket' },
  {
    name: 'channel',
    label: 'Channel',
    type: 'select',
    required: true,
    options: choices('Supermarket', 'Convenience', 'Wholesale', 'HoReCa', 'E-commerce', 'Industrial'),
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Active', 'On Hold', 'Inactive'),
  },

  { section: 'Contact', name: 'contact', label: 'Contact person' },
  { section: 'Contact', name: 'phone', label: 'Phone', type: 'tel', mask: 'phonePH' },
  { section: 'Contact', name: 'email', label: 'Email', type: 'email' },
  { section: 'Contact', name: 'tin', label: 'TIN', mask: 'tin' },
  {
    section: 'Contact',
    name: 'region',
    label: 'Sales region',
    type: 'select',
    required: true,
    hint: 'Which of the four books this account reports under.',
    options: choices('NCR', 'Luzon', 'Visayas', 'Mindanao'),
  },

  /**
   * The delivery address.
   *
   * One declaration renders the whole block — street through postal code — and
   * resolves the coordinates from it. Latitude and longitude used to be two
   * number boxes here; almost nobody filled them in, which left the delivery
   * planner with nothing to route.
   */
  { name: 'deliveryAddress', label: 'Delivery address', type: 'address', full: true },

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
    name: 'creditLimit',
    label: 'Credit limit',
    type: 'money',
    required: true,
    hint: 'Orders above this need approval.',
  },
  { section: 'Commercial terms', name: 'salesRepId', label: 'Sales representative', type: 'select', optionsFrom: REP },
  {
    section: 'Commercial terms',
    name: 'rating',
    label: 'Account rating',
    type: 'number',
    min: 0,
    max: 5,
    step: 0.1,
    hint: '0 to 5 — how well they pay and how much they buy.',
  },
]

export const customerDefaults = { status: 'Active', region: 'Mindanao', terms: 'Net 30', creditLimit: 0 }

/* -------------------------------------------------------------------------- */

/** Stage and probability move together; typing both by hand invites drift. */
const STAGE_PROBABILITY: Record<string, number> = {
  Qualification: 15,
  'Needs Analysis': 30,
  Proposal: 55,
  Negotiation: 75,
  'Closed Won': 100,
  'Closed Lost': 0,
}

export const leadFields: FormField[] = [
  { name: 'company', label: 'Company', required: true, full: true },
  { name: 'contact', label: 'Contact person' },
  {
    name: 'source',
    label: 'Source',
    type: 'select',
    required: true,
    options: choices('Referral', 'Trade Show', 'Cold Call', 'Website', 'Existing Customer', 'Partner'),
  },
  {
    name: 'customerId',
    label: 'Existing customer',
    type: 'select',
    optionsFrom: CUSTOMERS,
    full: true,
    hint: 'Link it if they already trade with us — the deal then shows on their account.',
  },

  {
    section: 'Qualification',
    name: 'stage',
    label: 'Stage',
    type: 'select',
    required: true,
    options: choices('Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'),
    onChange: (value) => ({ probability: STAGE_PROBABILITY[String(value)] ?? 0 }),
  },
  {
    section: 'Qualification',
    name: 'probability',
    label: 'Probability',
    type: 'percent',
    required: true,
    min: 0,
    max: 100,
    hint: 'Set from the stage — override it if you know better.',
  },
  { section: 'Qualification', name: 'value', label: 'Opportunity value', type: 'money', required: true },
  { section: 'Qualification', name: 'expectedClose', label: 'Expected close', type: 'date' },

  { section: 'Ownership', name: 'ownerId', label: 'Owner', type: 'select', optionsFrom: REP },
  { section: 'Ownership', name: 'nextStep', label: 'Next step', placeholder: 'Send revised pricing' },
]

export const leadDefaults = {
  stage: 'Qualification',
  probability: 15,
  source: 'Referral',
  value: 0,
  expectedClose: daysOut(30),
}

/* -------------------------------------------------------------------------- */

export const quotationFields: FormField[] = [
  { name: 'customerId', label: 'Customer', type: 'select', required: true, optionsFrom: CUSTOMERS, full: true },
  { name: 'date', label: 'Quotation date', type: 'date', required: true },
  { name: 'validUntil', label: 'Valid until', type: 'date', hint: 'Defaults to 30 days out.' },

  { section: 'Ownership', name: 'ownerId', label: 'Prepared by', type: 'select', optionsFrom: REP },
  {
    section: 'Ownership',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Submitted', 'Approved', 'Rejected', 'Expired', 'Won'),
  },
]

export const quotationDefaults = { status: 'Draft', date: today(), validUntil: daysOut(30) }

/* -------------------------------------------------------------------------- */

export const orderFields: FormField[] = [
  { name: 'customerId', label: 'Customer', type: 'select', required: true, optionsFrom: CUSTOMERS, full: true },
  { name: 'date', label: 'Order date', type: 'date', required: true },
  { name: 'promisedDate', label: 'Promised delivery', type: 'date', hint: 'On-time delivery is measured against this.' },

  {
    section: 'Fulfilment',
    name: 'warehouseId',
    label: 'Ship from',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'warehouse/locations', label: 'name', sublabel: 'code' },
    hint: 'Add one under Warehouse if the list is empty.',
  },
  {
    section: 'Fulfilment',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Draft', 'Confirmed', 'Partial', 'Delivered', 'Cancelled', 'On Hold'),
    hint: 'Draft orders are excluded from revenue.',
  },
  { section: 'Fulfilment', name: 'salesRepId', label: 'Sales representative', type: 'select', optionsFrom: REP },
]

export const orderDefaults = { status: 'Draft', date: today(), promisedDate: daysOut(7) }

/* -------------------------------------------------------------------------- */

export const deliveryFields: FormField[] = [
  {
    name: 'salesOrderId',
    label: 'Sales order',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'sales/orders', label: 'no', sublabel: 'customer' },
    full: true,
    hint: 'The destination is the order’s customer.',
  },
  { name: 'scheduled', label: 'Scheduled for', type: 'date' },
  { name: 'pallets', label: 'Pallets', type: 'number', min: 0 },

  {
    section: 'Route',
    name: 'originWarehouseId',
    label: 'Departs from',
    type: 'select',
    optionsFrom: { endpoint: 'warehouse/locations', label: 'name', sublabel: 'city' },
    hint: 'Defaults to your default origin; change it for a branch run.',
  },
  {
    section: 'Route',
    name: 'roundTrip',
    label: 'Truck returns to origin',
    type: 'switch',
    hint: 'Doubles the distance and fuel.',
  },

  {
    section: 'Vehicle and crew',
    name: 'vehicleAssetId',
    label: 'Vehicle',
    type: 'select',
    // Operational delivery vehicles only — and it carries km/L, so choosing
    // one re-costs the run.
    optionsFrom: { endpoint: 'sales/vehicles', label: 'name', sublabel: 'code' },
  },
  { section: 'Vehicle and crew', name: 'driverId', label: 'Driver', type: 'select', optionsFrom: DRIVER },

  {
    section: 'Status',
    name: 'status',
    label: 'Delivery status',
    type: 'select',
    required: true,
    options: choices('Scheduled', 'In Transit', 'Delivered', 'Partial', 'Cancelled'),
  },
  {
    section: 'Status',
    name: 'deliveredAt',
    label: 'Actually delivered',
    type: 'date',
    hint: 'On-time performance compares this with the promised date.',
    visibleWhen: (values) => ['Delivered', 'Partial'].includes(String(values.status)),
  },
  {
    section: 'Status',
    name: 'podReceived',
    label: 'Proof of delivery received',
    type: 'switch',
    // Only meaningful once the goods have actually arrived.
    visibleWhen: (values) => ['Delivered', 'Partial'].includes(String(values.status)),
  },
]

export const deliveryDefaults = {
  status: 'Scheduled',
  pallets: 0,
  podReceived: false,
  roundTrip: true,
  scheduled: today(),
}

/* -------------------------------------------------------------------------- */

export const returnFields: FormField[] = [
  { name: 'customerId', label: 'Customer', type: 'select', required: true, optionsFrom: CUSTOMERS, full: true },
  {
    name: 'salesOrderId',
    label: 'Against order',
    type: 'select',
    optionsFrom: ORDERS_FOR_CUSTOMER,
    hint: 'Only shows orders belonging to the customer above.',
  },
  { name: 'date', label: 'Return date', type: 'date', required: true },

  {
    section: 'Goods returned',
    name: 'reason',
    label: 'Reason',
    type: 'select',
    required: true,
    options: choices(
      'Damaged in transit',
      'Wrong item shipped',
      'Near expiry',
      'Quality complaint',
      'Over-delivery',
      'Order cancelled',
    ),
  },
  { section: 'Goods returned', name: 'qty', label: 'Quantity', type: 'number', required: true, min: 0 },
  { section: 'Goods returned', name: 'amount', label: 'Credit value', type: 'money', required: true, min: 0 },

  {
    section: 'Resolution',
    name: 'disposition',
    label: 'Disposition',
    type: 'select',
    required: true,
    options: choices('Restock', 'Scrap', 'Return to Supplier', 'Pending inspection'),
    hint: 'Restock puts the goods back on sale; scrap writes them off.',
  },
  {
    section: 'Resolution',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Submitted', 'Approved', 'Completed', 'Rejected'),
  },
]

export const returnDefaults = { status: 'Submitted', disposition: 'Pending inspection', date: today(), qty: 0, amount: 0 }

/* -------------------------------------------------------------------------- */

/** Keeps net price consistent with list price and discount. */
function recalcNet(_: unknown, values: Record<string, unknown>) {
  const list = Number(values.listPrice ?? 0)
  const discount = Number(values.discount ?? 0)
  return { netPrice: Math.round(list * (1 - discount / 100) * 100) / 100 }
}

export const priceFields: FormField[] = [
  { name: 'itemId', label: 'Item', type: 'select', required: true, optionsFrom: ITEMS, full: true },
  {
    name: 'tier',
    label: 'Price tier',
    type: 'select',
    required: true,
    options: choices('Standard', 'Wholesale', 'Key Account', 'Distributor'),
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Active', 'Scheduled', 'Expired'),
  },

  { section: 'Pricing', name: 'listPrice', label: 'List price', type: 'money', required: true, min: 0, onChange: recalcNet },
  { section: 'Pricing', name: 'discount', label: 'Discount', type: 'percent', min: 0, max: 100, onChange: recalcNet },
  {
    section: 'Pricing',
    name: 'netPrice',
    label: 'Net price',
    type: 'money',
    required: true,
    min: 0,
    full: true,
    hint: 'Calculated from list price less discount — override it for a negotiated deal.',
  },

  { section: 'Validity', name: 'effective', label: 'Effective from', type: 'date', required: true },
  { section: 'Validity', name: 'effectiveTo', label: 'Effective to', type: 'date', hint: 'Leave blank for open-ended.' },
]

export const priceDefaults = { tier: 'Standard', status: 'Active', effective: today(), discount: 0 }

/* -------------------------------------------------------------------------- */

export const campaignFields: FormField[] = [
  { name: 'name', label: 'Campaign name', required: true, full: true, placeholder: 'Holiday Basket 2026' },
  {
    name: 'channel',
    label: 'Channel',
    type: 'select',
    required: true,
    options: choices('Trade Promo', 'Digital Ads', 'Email', 'Field Activation', 'Print', 'Loyalty'),
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Planned', 'Active', 'Completed', 'On Hold'),
  },
  { name: 'ownerId', label: 'Owner', type: 'select', optionsFrom: REP, full: true },

  { section: 'Schedule and budget', name: 'start', label: 'Starts', type: 'date', required: true },
  { section: 'Schedule and budget', name: 'end', label: 'Ends', type: 'date' },
  { section: 'Schedule and budget', name: 'budget', label: 'Budget', type: 'money', required: true, min: 0 },
  { section: 'Schedule and budget', name: 'spend', label: 'Spend to date', type: 'money', min: 0 },

  { section: 'Results', name: 'leads', label: 'Leads generated', type: 'number', min: 0 },
  { section: 'Results', name: 'conversions', label: 'Conversions', type: 'number', min: 0 },
  {
    section: 'Results',
    name: 'revenue',
    label: 'Attributed revenue',
    type: 'money',
    min: 0,
    full: true,
    hint: 'ROI is calculated from this against spend.',
  },
]

export const campaignDefaults = { status: 'Planned', start: today(), budget: 0, spend: 0, leads: 0, conversions: 0, revenue: 0 }

/* -------------------------------------------------------------------------- */

/** Commission follows from actual sales and the agreed rate. */
function recalcCommission(_: unknown, values: Record<string, unknown>) {
  const actual = Number(values.actual ?? 0)
  const rate = Number(values.commissionRate ?? 0)
  return { commission: Math.round(actual * (rate / 100) * 100) / 100 }
}

const PERIODS = [
  { value: 0, label: 'Full year' },
  ...['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(
    (label, i) => ({ value: i + 1, label }),
  ),
]

export const targetFields: FormField[] = [
  { name: 'employeeId', label: 'Representative', type: 'select', required: true, optionsFrom: REP, full: true },
  { name: 'territory', label: 'Territory', placeholder: 'Davao Region' },
  { name: 'year', label: 'Year', type: 'number', required: true, min: 2000, max: 2100 },
  {
    name: 'period',
    label: 'Period',
    type: 'select',
    options: PERIODS,
    full: true,
    hint: 'A full-year quota is spread evenly across the months on the dashboard.',
  },

  { section: 'Quota and results', name: 'quota', label: 'Quota', type: 'money', required: true, min: 0 },
  { section: 'Quota and results', name: 'actual', label: 'Actual to date', type: 'money', min: 0, onChange: recalcCommission },
  { section: 'Quota and results', name: 'deals', label: 'Deals closed', type: 'number', min: 0 },

  {
    section: 'Commission',
    name: 'commissionRate',
    label: 'Commission rate',
    type: 'percent',
    min: 0,
    max: 100,
    onChange: recalcCommission,
  },
  {
    section: 'Commission',
    name: 'commission',
    label: 'Commission payable',
    type: 'money',
    min: 0,
    hint: 'Calculated from actual × rate.',
  },
]

export const targetDefaults = {
  year: new Date().getFullYear(),
  period: 0,
  quota: 0,
  actual: 0,
  deals: 0,
  commissionRate: 0,
  commission: 0,
}
