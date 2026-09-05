import { CITIES, LAST_NAMES, Rng, personName, regionFor, type Region } from './seed'
import { buildSku } from './sku'

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type WarehouseSite = {
  id: string
  code: string
  name: string
  city: string
  region: Region
  type: 'Distribution Center' | 'Branch Warehouse' | 'Transit Hub'
  capacityPallets: number
  usedPallets: number
  bins: number
  manager: string
  status: 'Active' | 'Inactive'
}

export type Item = {
  id: string
  /** Structured code — `TRN-BEV-COR-0001`. See `data/warehouse.ts`. */
  sku: string
  /** The old running number. Kept so printed labels and supplier paperwork resolve. */
  legacySku: string
  name: string
  category: string
  brand: string
  uom: string
  packSize: string
  barcode: string
  unitCost: number
  sellPrice: number
  onHand: number
  allocated: number
  reorderPoint: number
  reorderQty: number
  leadTimeDays: number
  shelfLifeDays: number | null
  abc: 'A' | 'B' | 'C'
  abcComputedAt?: string | null
  status: 'Active' | 'Inactive'
  primarySupplier: string
}

export type Customer = {
  id: string
  code: string
  name: string
  channel: 'Supermarket' | 'Convenience' | 'Wholesale' | 'HoReCa' | 'E-commerce' | 'Industrial'
  contact: string
  email: string
  phone: string
  city: string
  region: Region
  terms: 'COD' | 'Net 15' | 'Net 30' | 'Net 45' | 'Net 60'
  creditLimit: number
  balance: number
  ytdSales: number
  lastOrder: string
  salesRep: string
  status: 'Active' | 'On Hold' | 'Inactive'
  rating: number
}

export type Supplier = {
  id: string
  code: string
  name: string
  category: string
  contact: string
  email: string
  phone: string
  city: string
  terms: 'COD' | 'Net 15' | 'Net 30' | 'Net 45' | 'Net 60'
  ytdSpend: number
  openPo: number
  onTimeRate: number | null
  qualityRate: number | null
  priceIndex: number | null
  scorecard: number | null
  /** How many documents the score rests on. 0 means never evaluated. */
  sample?: number
  evaluatedAt?: string | null
  accreditedUntil: string
  status: 'Active' | 'Probationary' | 'Blacklisted'
}

export type Employee = {
  id: string
  code: string
  name: string
  position: string
  department: string
  employmentType: 'Regular' | 'Probationary' | 'Project-based' | 'Part-time'
  branch: string
  dateHired: string
  email: string
  phone: string
  manager: string
  monthlyRate: number
  leaveBalance: number
  status: 'Active' | 'On Leave' | 'Resigned'
}

export type Asset = {
  id: string
  code: string
  name: string
  category: 'Delivery Vehicle' | 'Material Handling' | 'Facility' | 'Cold Chain' | 'Power' | 'IT Equipment'
  site: string
  acquiredOn: string
  acquisitionCost: number
  bookValue: number
  meterReading: number
  meterUnit: 'km' | 'hours'
  criticality: 'High' | 'Medium' | 'Low'
  condition: 'Excellent' | 'Good' | 'Fair' | 'Poor'
  lastService: string
  nextService: string
  status: 'Operational' | 'Under Maintenance' | 'Breakdown' | 'Retired'
  assignedTo: string
}

/* -------------------------------------------------------------------------- */
/* Reference lists                                                             */
/* -------------------------------------------------------------------------- */

export const ITEM_CATEGORIES = [
  'Beverages',
  'Packaged Food',
  'Household Care',
  'Personal Care',
  'Industrial Supplies',
  'Electrical',
  'Safety & PPE',
  'Packaging Materials',
] as const

const BRANDS_BY_CATEGORY: Record<string, string[]> = {
  Beverages: ['Cordilla', 'Freshwell', 'Montaña', 'Bayview'],
  'Packaged Food': ['Casa Verde', 'Golden Harvest', 'Marisol', 'Pantry Co.'],
  'Household Care': ['Brightline', 'PureHome', 'Sanitek'],
  'Personal Care': ['Lumière', 'Everly', 'Dermacare'],
  'Industrial Supplies': ['ForgePro', 'Titan Works', 'Ironclad'],
  Electrical: ['VoltEdge', 'Circuita', 'Amperex'],
  'Safety & PPE': ['GuardWell', 'SafeSpan', 'Sentinel'],
  'Packaging Materials': ['PackRight', 'Corrusafe', 'FlexiWrap'],
}

const PRODUCTS_BY_CATEGORY: Record<string, string[]> = {
  Beverages: ['Bottled Water 500ml', 'Iced Tea Lemon 1L', 'Cola Regular 1.5L', 'Orange Juice 1L', 'Energy Drink 250ml', 'Coffee 3-in-1'],
  'Packaged Food': ['Corned Beef 150g', 'Sardines in Tomato 155g', 'Instant Noodles Beef', 'Biscuits Assorted 300g', 'All-Purpose Flour 1kg', 'Cooking Oil 1L'],
  'Household Care': ['Dish Liquid 500ml', 'Fabric Conditioner 1L', 'Laundry Powder 1kg', 'Floor Cleaner 1L', 'Bleach 1L'],
  'Personal Care': ['Shampoo 340ml', 'Bath Soap 3-pack', 'Toothpaste 150g', 'Hand Sanitiser 500ml', 'Body Lotion 200ml'],
  'Industrial Supplies': ['Hex Bolt M12 Box', 'Cutting Disc 4in', 'Industrial Lubricant 5L', 'Welding Rod 2.5mm', 'Air Filter Element'],
  Electrical: ['LED Bulb 9W', 'THHN Wire 3.5mm 150m', 'Circuit Breaker 30A', 'Extension Cord 5m', 'Electrical Tape Roll'],
  'Safety & PPE': ['Nitrile Gloves Box', 'Safety Helmet', 'Reflective Vest', 'Safety Goggles', 'Steel-Toe Boots'],
  'Packaging Materials': ['Carton Box Medium', 'Stretch Film 500mm', 'Packing Tape 48mm', 'Pallet Wrap Roll', 'Bubble Wrap 1m x 50m'],
}

export const DEPARTMENT_NAMES = [
  'Sales & Marketing',
  'Procurement',
  'Warehouse',
  'Maintenance',
  'Finance & Accounting',
  'Human Resources',
  'Executive',
] as const

const POSITIONS: Record<string, string[]> = {
  'Sales & Marketing': ['Account Executive', 'Sales Supervisor', 'Key Accounts Manager', 'Marketing Associate', 'Merchandiser', 'Sales Director'],
  Procurement: ['Buyer', 'Senior Buyer', 'Sourcing Analyst', 'Procurement Manager', 'Purchasing Assistant'],
  Warehouse: ['Warehouse Clerk', 'Forklift Operator', 'Picker/Packer', 'Inventory Analyst', 'Warehouse Supervisor', 'Logistics Manager'],
  Maintenance: ['Maintenance Technician', 'Auto Mechanic', 'Electrician', 'Fleet Coordinator', 'Maintenance Supervisor'],
  'Finance & Accounting': ['Accounting Assistant', 'General Accountant', 'AR Specialist', 'AP Specialist', 'Finance Manager', 'Comptroller'],
  'Human Resources': ['HR Assistant', 'Recruitment Officer', 'Payroll Officer', 'HR Business Partner', 'HR Manager'],
  Executive: ['Chief Executive Officer', 'Chief Operating Officer', 'Chief Finance Officer'],
}

export const SUPPLIER_CATEGORIES = [
  'FMCG Principal',
  'Industrial Goods',
  'Packaging',
  'Logistics Services',
  'Facilities & MRO',
  'IT & Office',
]

/* -------------------------------------------------------------------------- */
/* Generators                                                                  */
/* -------------------------------------------------------------------------- */

export function buildWarehouses(rng: Rng): WarehouseSite[] {
  const defs: [string, string, string, WarehouseSite['type']][] = [
    ['WH-MAIN', 'Main Distribution Center', 'Muntinlupa', 'Distribution Center'],
    ['WH-NORTH', 'North Luzon Branch', 'Angeles', 'Branch Warehouse'],
    ['WH-CEBU', 'Visayas Hub', 'Cebu City', 'Distribution Center'],
    ['WH-DVO', 'Mindanao Branch', 'Davao City', 'Branch Warehouse'],
    ['WH-TRANSIT', 'Metro Transit Hub', 'Pasig', 'Transit Hub'],
  ]
  return defs.map(([code, name, city, type], i) => {
    const capacity = type === 'Distribution Center' ? rng.int(2800, 4200) : type === 'Transit Hub' ? rng.int(600, 900) : rng.int(1200, 1900)
    return {
      id: `wh-${i + 1}`,
      code,
      name,
      city,
      region: regionFor(city),
      type,
      capacityPallets: capacity,
      usedPallets: Math.round(capacity * rng.float(0.52, 0.93)),
      bins: type === 'Transit Hub' ? rng.int(40, 80) : rng.int(180, 460),
      manager: personName(rng),
      status: 'Active',
    }
  })
}

export function buildItems(rng: Rng, count = 148): Item[] {
  const items: Item[] = []
  let n = 1000
  // The structured SKU sequences within its category, not across the catalogue,
  // so BEV-0004 is the fourth beverage rather than the fourth thing keyed in.
  const sequenceByCategory = new Map<string, number>()

  while (items.length < count) {
    for (const category of ITEM_CATEGORIES) {
      if (items.length >= count) break
      for (const product of PRODUCTS_BY_CATEGORY[category]!) {
        if (items.length >= count) break
        const brand = rng.pick(BRANDS_BY_CATEGORY[category]!)
        const unitCost = Math.round(rng.gaussian(210, 160, 18, 1800))
        const margin = rng.float(0.14, 0.42)
        const onHand = Math.max(0, Math.round(rng.gaussian(620, 520, 0, 4200)))
        const reorderPoint = Math.round(rng.gaussian(280, 140, 40, 900))
        const abc = rng.weighted([
          ['A', 2],
          ['B', 3],
          ['C', 5],
        ] as const)

        const sequence = (sequenceByCategory.get(category) ?? 0) + 1
        sequenceByCategory.set(category, sequence)

        items.push({
          id: `item-${n}`,
          sku: buildSku(category, brand, sequence),
          legacySku: `TRN-${n}`,
          name: `${brand} ${product}`,
          category,
          brand,
          uom: category === 'Packaging Materials' ? 'ROLL' : 'CASE',
          packSize: rng.pick(['6 x 1', '12 x 1', '24 x 1', '10 x 1', '1 x 1']),
          barcode: `48${String(rng.int(10000000000, 99999999999))}`.slice(0, 13),
          unitCost,
          sellPrice: Math.round(unitCost * (1 + margin)),
          onHand,
          allocated: Math.round(onHand * rng.float(0, 0.35)),
          reorderPoint,
          reorderQty: Math.round(reorderPoint * rng.float(1.4, 2.6)),
          leadTimeDays: rng.int(3, 28),
          shelfLifeDays: ['Beverages', 'Packaged Food', 'Personal Care'].includes(category) ? rng.int(120, 720) : null,
          abc,
          status: rng.bool(0.94) ? 'Active' : 'Inactive',
          primarySupplier: '',
        })
        n++
      }
    }
  }
  return items
}

export function buildCustomers(rng: Rng, reps: string[], count = 86): Customer[] {
  const chains = ['Metro', 'Golden', 'Sunrise', 'Pacific', 'Highland', 'Eastwood', 'Riverside', 'Northgate', 'Prime', 'Vista', 'Summit', 'Anchor']
  const suffix: Record<Customer['channel'], string[]> = {
    Supermarket: ['Supermarket', 'Hypermart', 'Grocery Center'],
    Convenience: ['Mini Mart', 'Convenience Store', 'Quick Stop'],
    Wholesale: ['Trading Corp.', 'Wholesale Inc.', 'Distributors'],
    HoReCa: ['Restaurant Group', 'Hotel & Resort', 'Catering Services'],
    'E-commerce': ['Online Retail', 'Digital Commerce', 'Shop Online'],
    Industrial: ['Manufacturing Corp.', 'Industrial Supply', 'Works Inc.'],
  }

  return Array.from({ length: count }, (_, i) => {
    const channel = rng.weighted([
      ['Supermarket', 4],
      ['Convenience', 5],
      ['Wholesale', 4],
      ['HoReCa', 3],
      ['E-commerce', 2],
      ['Industrial', 2],
    ] as const)
    const city = rng.pick(CITIES)
    const name = `${rng.pick(chains)} ${rng.pick(LAST_NAMES)} ${rng.pick(suffix[channel])}`
    const creditLimit = rng.pick([150_000, 300_000, 500_000, 750_000, 1_000_000, 2_000_000, 3_500_000])
    const ytdSales = Math.round(rng.gaussian(creditLimit * 3.1, creditLimit * 1.4, 40_000, creditLimit * 9))

    return {
      id: `cus-${i + 1}`,
      code: `C-${String(1001 + i)}`,
      name,
      channel,
      contact: personName(rng),
      email: `purchasing@${name.split(' ')[0]!.toLowerCase()}${i}.com.ph`,
      phone: `+63 9${rng.int(10, 99)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      city,
      region: regionFor(city),
      terms: rng.weighted([
        ['COD', 2],
        ['Net 15', 2],
        ['Net 30', 5],
        ['Net 45', 2],
        ['Net 60', 1],
      ] as const),
      creditLimit,
      balance: Math.round(creditLimit * rng.float(0, 1.08)),
      ytdSales,
      lastOrder: rng.daysAgo(0, 75).toISOString(),
      salesRep: rng.pick(reps),
      status: rng.weighted([
        ['Active', 12],
        ['On Hold', 2],
        ['Inactive', 1],
      ] as const),
      rating: Number(rng.float(2.6, 5).toFixed(1)),
    }
  })
}

export function buildSuppliers(rng: Rng, count = 54): Supplier[] {
  const prefixes = ['Allied', 'Premier', 'National', 'Unified', 'Coastal', 'Meridian', 'Apex', 'Cornerstone', 'Vanguard', 'Horizon', 'Landmark', 'Regent']
  const kinds = ['Trading', 'Industries', 'Manufacturing', 'Distribution', 'Enterprises', 'Corporation', 'Resources']

  return Array.from({ length: count }, (_, i) => {
    const onTime = rng.gaussian(88, 11, 46, 100)
    const quality = rng.gaussian(93, 7, 58, 100)
    const priceIndex = rng.gaussian(100, 9, 78, 128)
    // A weighted blend — price scored inversely, since lower is better.
    const scorecard = Math.round(onTime * 0.4 + quality * 0.4 + (200 - priceIndex) * 0.2)
    const city = rng.pick(CITIES)

    return {
      id: `sup-${i + 1}`,
      code: `S-${String(2001 + i)}`,
      name: `${rng.pick(prefixes)} ${rng.pick(LAST_NAMES)} ${rng.pick(kinds)}`,
      category: rng.pick(SUPPLIER_CATEGORIES),
      contact: personName(rng),
      email: `sales@supplier${i + 1}.com.ph`,
      phone: `+63 2 8${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      city,
      terms: rng.weighted([
        ['COD', 1],
        ['Net 15', 2],
        ['Net 30', 6],
        ['Net 45', 3],
        ['Net 60', 2],
      ] as const),
      ytdSpend: Math.round(rng.gaussian(4_200_000, 3_400_000, 180_000, 22_000_000)),
      openPo: rng.int(0, 9),
      onTimeRate: Number(onTime.toFixed(1)),
      qualityRate: Number(quality.toFixed(1)),
      priceIndex: Number(priceIndex.toFixed(1)),
      scorecard,
      accreditedUntil: rng.daysAhead(-40, 500).toISOString(),
      status: scorecard < 72 ? (rng.bool(0.3) ? 'Blacklisted' : 'Probationary') : 'Active',
    }
  })
}

export function buildEmployees(rng: Rng, sites: WarehouseSite[], count = 128): Employee[] {
  const weights: [string, number][] = [
    ['Sales & Marketing', 6],
    ['Warehouse', 7],
    ['Procurement', 2],
    ['Maintenance', 3],
    ['Finance & Accounting', 3],
    ['Human Resources', 2],
    ['Executive', 1],
  ]

  const employees = Array.from({ length: count }, (_, i) => {
    const department = i < 3 ? 'Executive' : rng.weighted(weights)
    const position = rng.pick(POSITIONS[department]!)
    const isLeader = /Manager|Director|Chief|Supervisor|Comptroller/.test(position)
    const monthlyRate = Math.round(
      (isLeader ? rng.gaussian(96_000, 34_000, 52_000, 260_000) : rng.gaussian(31_000, 12_000, 16_500, 78_000)) / 500,
    ) * 500

    return {
      id: `emp-${i + 1}`,
      code: `E-${String(3001 + i)}`,
      name: personName(rng),
      position,
      department,
      employmentType: rng.weighted([
        ['Regular', 8],
        ['Probationary', 2],
        ['Project-based', 1],
        ['Part-time', 1],
      ] as const),
      branch: department === 'Warehouse' ? rng.pick(sites).name : 'Head Office — Muntinlupa',
      dateHired: rng.daysAgo(30, 4200).toISOString(),
      email: '',
      phone: `+63 9${rng.int(10, 99)} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      manager: '',
      monthlyRate,
      leaveBalance: rng.int(0, 15),
      status: rng.weighted([
        ['Active', 22],
        ['On Leave', 2],
        ['Resigned', 1],
      ] as const),
    } satisfies Employee
  })

  // Derive email from the generated name, and hang everyone off a real manager.
  const leadersByDept = new Map<string, string>()
  for (const e of employees) {
    if (/Manager|Director|Chief|Comptroller/.test(e.position) && !leadersByDept.has(e.department)) {
      leadersByDept.set(e.department, e.name)
    }
  }
  const ceo = employees.find((e) => e.position === 'Chief Executive Officer')?.name ?? employees[0]!.name

  for (const e of employees) {
    const [first, ...rest] = e.name.toLowerCase().split(' ')
    e.email = `${first}.${rest.join('').replace(/[^a-z]/g, '')}@trinitas.com.ph`
    const lead = leadersByDept.get(e.department)
    e.manager = !lead || lead === e.name ? ceo : lead
  }

  return employees
}

export function buildAssets(rng: Rng, sites: WarehouseSite[], technicians: string[], count = 62): Asset[] {
  const defs: [Asset['category'], string[], Asset['meterUnit']][] = [
    ['Delivery Vehicle', ['Isuzu Elf 4W Closed Van', 'Fuso Canter 6W', 'Hyundai H100 Pickup', 'Isuzu FRR Wing Van'], 'km'],
    ['Material Handling', ['Toyota 2.5T Forklift', 'Electric Pallet Jack', 'Reach Truck 6m', 'Hand Pallet Truck'], 'hours'],
    ['Facility', ['Loading Dock Leveler', 'Roll-up Shutter Door', 'Pallet Racking Bay', 'Fire Pump System'], 'hours'],
    ['Cold Chain', ['Walk-in Chiller 40sqm', 'Reefer Container 20ft', 'Blast Freezer Unit'], 'hours'],
    ['Power', ['Cummins 150kVA Genset', 'UPS 20kVA', 'Solar Inverter 30kW'], 'hours'],
    ['IT Equipment', ['Barcode Scanner Fleet', 'Warehouse Server Rack', 'CCTV NVR System'], 'hours'],
  ]

  return Array.from({ length: count }, (_, i) => {
    const [category, models, meterUnit] = rng.pick(defs)
    const acquisitionCost = Math.round(rng.gaussian(category === 'Delivery Vehicle' ? 1_850_000 : 480_000, 380_000, 68_000, 4_200_000))
    const ageYears = rng.float(0.2, 9)
    const status = rng.weighted([
      ['Operational', 14],
      ['Under Maintenance', 3],
      ['Breakdown', 1],
      ['Retired', 1],
    ] as const)

    return {
      id: `ast-${i + 1}`,
      code: `${category === 'Delivery Vehicle' ? 'TRK' : category === 'Material Handling' ? 'MHE' : 'AST'}-${String(i + 1).padStart(3, '0')}`,
      name: rng.pick(models),
      category,
      site: rng.pick(sites).name,
      acquiredOn: new Date(Date.now() - ageYears * 365 * 86_400_000).toISOString(),
      acquisitionCost,
      bookValue: Math.round(acquisitionCost * Math.max(0.08, 1 - ageYears / 10)),
      meterReading: meterUnit === 'km' ? Math.round(ageYears * rng.gaussian(31_000, 9_000, 8_000, 60_000)) : Math.round(ageYears * rng.gaussian(1_450, 420, 300, 3_000)),
      meterUnit,
      criticality: rng.weighted([
        ['High', 3],
        ['Medium', 5],
        ['Low', 2],
      ] as const),
      condition: rng.weighted([
        ['Excellent', 3],
        ['Good', 6],
        ['Fair', 3],
        ['Poor', 1],
      ] as const),
      lastService: rng.daysAgo(3, 210).toISOString(),
      nextService: rng.daysAhead(-14, 150).toISOString(),
      status,
      assignedTo: rng.pick(technicians),
    }
  })
}
