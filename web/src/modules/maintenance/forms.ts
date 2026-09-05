import type { FormField } from '@/components/data/RecordForm'

/**
 * Form definitions for the Maintenance department.
 *
 * Two things are deliberately absent from every form here. Nothing asks for a
 * cost that can be derived — parts are priced from the item master, book value
 * is depreciated, fuel economy is arithmetic on two odometer readings. And
 * nothing asks for a date the system can work out: a preventive schedule's next
 * due date follows from its frequency, not from someone's memory.
 */

const choices = (...values: string[]) => values.map((value) => ({ value, label: value }))

const today = () => new Date().toISOString().slice(0, 10)

const ASSETS = { endpoint: 'maintenance/assets', label: 'name', sublabel: 'code' } as const
const TECHNICIANS = { endpoint: 'maintenance/technicians', label: 'name', sublabel: 'position' } as const
const WAREHOUSES = { endpoint: 'warehouse/locations', label: 'name', sublabel: 'city' } as const
const EMPLOYEES = { endpoint: 'hr/employees', label: 'fullName', sublabel: 'employeeNo' } as const

/* -------------------------------------------------------------------------- */

export const assetFields: FormField[] = [
  { name: 'code', label: 'Asset code', required: true, placeholder: 'TRK-004' },
  { name: 'name', label: 'Description', required: true, placeholder: 'Isuzu Elf 6-wheeler' },
  {
    name: 'category',
    label: 'Category',
    type: 'select',
    required: true,
    options: choices('Delivery Vehicle', 'Material Handling', 'Facility', 'Cold Chain', 'Power', 'IT Equipment'),
  },
  { name: 'warehouseId', label: 'Located at', type: 'select', optionsFrom: WAREHOUSES },
  {
    name: 'criticality',
    label: 'Criticality',
    type: 'select',
    required: true,
    options: choices('High', 'Medium', 'Low'),
    hint: 'High means a failure stops the operation, not just this machine.',
  },
  {
    name: 'condition',
    label: 'Condition',
    type: 'select',
    required: true,
    options: choices('Excellent', 'Good', 'Fair', 'Poor'),
  },
  { name: 'assignedToId', label: 'Assigned to', type: 'select', optionsFrom: TECHNICIANS },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Operational', 'Under Maintenance', 'Breakdown', 'Retired'),
  },

  { section: 'Value', name: 'acquiredOn', label: 'Acquired on', type: 'date' },
  { section: 'Value', name: 'acquisitionCost', label: 'Acquisition cost', type: 'money', min: 0 },
  {
    section: 'Value',
    name: 'usefulLifeYears',
    label: 'Useful life (years)',
    type: 'number',
    min: 1,
    max: 60,
    hint: 'Book value is depreciated straight-line over this. Leave blank to hold it at cost.',
  },
  { section: 'Value', name: 'salvageValue', label: 'Salvage value', type: 'money', min: 0 },

  {
    section: 'Meter & service',
    name: 'meterUnit',
    label: 'Meter reads in',
    type: 'select',
    required: true,
    options: choices('km', 'hours'),
  },
  { section: 'Meter & service', name: 'meterReading', label: 'Current reading', type: 'number', min: 0 },
  { section: 'Meter & service', name: 'lastService', label: 'Last serviced', type: 'date' },
  { section: 'Meter & service', name: 'nextService', label: 'Next service due', type: 'date' },
  {
    section: 'Meter & service',
    name: 'kmPerLitre',
    label: 'Rated economy (km/L)',
    type: 'number',
    min: 0.1,
    max: 100,
    step: 0.1,
    visibleWhen: (values) => values.category === 'Delivery Vehicle',
    hint: 'Drives every delivery cost estimate until the vehicle has fuel history.',
  },
  {
    section: 'Meter & service',
    name: 'payloadPallets',
    label: 'Payload (pallets)',
    type: 'number',
    min: 0,
    max: 1000,
    visibleWhen: (values) => values.category === 'Delivery Vehicle',
  },
]

export const assetDefaults = {
  status: 'Operational',
  condition: 'Good',
  criticality: 'Medium',
  meterUnit: 'hours',
  meterReading: 0,
  acquisitionCost: 0,
  salvageValue: 0,
}

/* -------------------------------------------------------------------------- */

export const workOrderFields: FormField[] = [
  { name: 'assetId', label: 'Asset', type: 'select', required: true, optionsFrom: ASSETS, full: true },
  { name: 'summary', label: 'What is wrong', required: true, placeholder: 'Hydraulic leak on tailgate', full: true },
  {
    name: 'type',
    label: 'Type',
    type: 'select',
    required: true,
    options: choices('Corrective', 'Preventive', 'Inspection', 'Calibration', 'Emergency'),
  },
  {
    name: 'priority',
    label: 'Priority',
    type: 'select',
    required: true,
    options: choices('Critical', 'High', 'Medium', 'Low'),
  },
  { name: 'reported', label: 'Reported', type: 'date', required: true },
  { name: 'due', label: 'Due', type: 'date' },
  { name: 'technicianId', label: 'Technician', type: 'select', optionsFrom: TECHNICIANS },
  {
    name: 'pmScheduleId',
    label: 'Preventive schedule',
    type: 'select',
    optionsFrom: { endpoint: 'maintenance/preventive', label: 'code', sublabel: 'task' },
    visibleWhen: (values) => values.type === 'Preventive',
    hint: 'Completing the job rolls this schedule forward to its next due date.',
  },
  { name: 'description', label: 'Notes', type: 'textarea', full: true },

  {
    section: 'Completion',
    name: 'warehouseId',
    label: 'Parts drawn from',
    type: 'select',
    optionsFrom: WAREHOUSES,
    hint: 'Where the spare parts come off. Needed before a job with parts can be completed.',
  },
  { section: 'Completion', name: 'downtimeHours', label: 'Downtime (hours)', type: 'number', min: 0, step: 0.5 },
  {
    section: 'Completion',
    name: 'laborCost',
    label: 'Labour cost',
    type: 'money',
    min: 0,
    hint: 'Parts are costed from the item master — only labour is entered here.',
  },
  {
    section: 'Completion',
    name: 'meterReading',
    label: 'Meter at service',
    type: 'number',
    min: 0,
    hint: 'Moves the asset’s meter and rolls any meter-based schedule forward.',
  },
  {
    section: 'Completion',
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'),
    full: true,
    hint: 'Completed issues the parts below and puts the asset back into service.',
  },
]

export const workOrderDefaults = {
  status: 'Open',
  type: 'Corrective',
  priority: 'Medium',
  reported: today(),
  downtimeHours: 0,
  laborCost: 0,
}

/** The spare parts a job consumed. Priced from the item master, never typed. */
export const workOrderLines = {
  itemsEndpoint: 'maintenance/spare-parts',
  priceField: 'unitCost',
  title: 'Spare parts used',
  readOnlyPrice: true,
  priceLabel: 'Unit cost',
} as const

/* -------------------------------------------------------------------------- */

export const preventiveFields: FormField[] = [
  { name: 'assetId', label: 'Asset', type: 'select', required: true, optionsFrom: ASSETS, full: true },
  { name: 'task', label: 'Task', required: true, placeholder: 'Engine oil & filter change', full: true },
  {
    name: 'frequency',
    label: 'Frequency',
    type: 'select',
    required: true,
    options: choices('Weekly', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'Meter'),
    hint: 'Everything but Meter sets its own next due date from the last service.',
  },
  {
    name: 'meterInterval',
    label: 'Every',
    type: 'number',
    min: 1,
    required: true,
    visibleWhen: (values) => values.frequency === 'Meter',
    hint: 'Kilometres or hours between services, in the asset’s own meter unit.',
  },
  { name: 'lastDone', label: 'Last done', type: 'date' },
  {
    name: 'nextDue',
    label: 'Next due',
    type: 'date',
    hint: 'Leave blank and the frequency works it out.',
  },
  { name: 'assignedToId', label: 'Assigned to', type: 'select', optionsFrom: TECHNICIANS },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Scheduled', 'Due', 'Overdue', 'Completed', 'Inactive'),
    hint: 'Due and Overdue are worked out from the date — set Inactive to stop the plan.',
  },
]

export const preventiveDefaults = { status: 'Scheduled', frequency: 'Monthly' }

/* -------------------------------------------------------------------------- */

export const vehicleFields: FormField[] = [
  {
    name: 'assetId',
    label: 'Asset',
    type: 'select',
    required: true,
    optionsFrom: ASSETS,
    full: true,
    hint: 'The asset register holds the truck’s history and value; this adds the road-going detail.',
  },
  { name: 'plate', label: 'Plate number', required: true, placeholder: 'NAB 4471' },
  { name: 'model', label: 'Model', placeholder: 'Isuzu Elf 6-wheeler' },
  { name: 'driverId', label: 'Assigned driver', type: 'select', optionsFrom: TECHNICIANS },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Available', 'On Trip', 'Under Maintenance', 'Breakdown', 'Retired'),
  },
  {
    section: 'Odometer & papers',
    name: 'odometer',
    label: 'Odometer (km)',
    type: 'number',
    min: 0,
    hint: 'Kept current by fuel issuances — this is just the starting figure.',
  },
  { section: 'Odometer & papers', name: 'kmSinceService', label: 'Km since service', type: 'number', min: 0 },
  { section: 'Odometer & papers', name: 'registrationExpiry', label: 'Registration expires', type: 'date' },
  { section: 'Odometer & papers', name: 'insuranceExpiry', label: 'Insurance expires', type: 'date' },
  {
    section: 'Ownership',
    name: 'ownership',
    label: 'Ownership',
    type: 'select',
    required: true,
    options: [
      { value: 'CO', label: 'Company-owned' },
      { value: 'PO', label: 'Personally-owned' },
      { value: 'R&C', label: 'Rented & chartered' },
    ],
    hint: 'A trip ticket for this vehicle defaults from here — the driver can still override it per trip.',
  },
  {
    section: 'Ownership',
    name: 'ownerEmployeeId',
    label: 'Owner',
    type: 'select',
    optionsFrom: EMPLOYEES,
    hint: 'Required for a personally-owned vehicle — this is who gets reimbursed for trips.',
  },
  {
    section: 'Ownership',
    name: 'vehicleType',
    label: 'Vehicle type',
    type: 'select',
    options: choices('Sedan', 'Pickup', 'Van', 'Truck', 'Motorcycle'),
    hint: 'Used as a fallback fuel-economy estimate until this vehicle has its own fill-up history.',
  },
]

export const vehicleDefaults = { status: 'Available', odometer: 0, kmSinceService: 0, ownership: 'CO' }

/* -------------------------------------------------------------------------- */

export const fuelFields: FormField[] = [
  {
    name: 'vehicleId',
    label: 'Vehicle',
    type: 'select',
    required: true,
    optionsFrom: { endpoint: 'maintenance/fleet', label: 'plate', sublabel: 'model' },
    full: true,
  },
  { name: 'driverId', label: 'Driver', type: 'select', optionsFrom: TECHNICIANS },
  { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'liters', label: 'Litres', type: 'number', required: true, min: 0.01, max: 2000, step: 0.1 },
  { name: 'cost', label: 'Cost', type: 'money', required: true, min: 0 },
  {
    name: 'odometer',
    label: 'Odometer (km)',
    type: 'number',
    required: true,
    min: 0,
    hint: 'Distance, economy and the anomaly flag are all worked out from this against the last fill.',
  },
  { name: 'station', label: 'Station', placeholder: 'Petron Tagum' },
]

export const fuelDefaults = { date: today(), liters: 0, cost: 0, odometer: 0 }

/* -------------------------------------------------------------------------- */

export const downtimeFields: FormField[] = [
  { name: 'assetId', label: 'Asset', type: 'select', required: true, optionsFrom: ASSETS, full: true },
  { name: 'cause', label: 'What failed', required: true, placeholder: 'Compressor overheating', full: true },
  { name: 'date', label: 'Occurred', type: 'date', required: true },
  { name: 'hours', label: 'Hours lost', type: 'number', required: true, min: 0, step: 0.5 },
  {
    name: 'impact',
    label: 'Impact',
    type: 'select',
    required: true,
    options: choices('Deliveries delayed', 'Reduced throughput', 'Line stopped', 'Cold chain risk', 'None'),
  },
  { name: 'costImpact', label: 'Cost impact', type: 'money', min: 0 },
  {
    name: 'rootCause',
    label: 'Root cause',
    placeholder: 'Deferred preventive service',
    full: true,
    hint: 'What has to change for this not to happen again — the point of keeping the log.',
  },
  {
    name: 'workOrderId',
    label: 'Work order',
    type: 'select',
    optionsFrom: { endpoint: 'maintenance/work-orders', label: 'no', sublabel: 'summary' },
    hint: 'Leave blank and raise one from the record instead.',
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: choices('Under Investigation', 'Resolved', 'Recurring'),
    hint: 'Recurring means the root cause is still there.',
  },
]

export const downtimeDefaults = {
  status: 'Under Investigation',
  impact: 'None',
  date: today(),
  hours: 0,
  costImpact: 0,
}
