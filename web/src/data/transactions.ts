import { Rng, docNo, personName } from './seed'
import type { Asset, Customer, Employee, Item, Supplier, WarehouseSite } from './master'

const YEAR = new Date().getFullYear()

/* ========================================================================== */
/* SALES & MARKETING                                                          */
/* ========================================================================== */

export type Lead = {
  id: string
  code: string
  company: string
  contact: string
  source: 'Referral' | 'Trade Show' | 'Cold Call' | 'Website' | 'Existing Customer' | 'Partner'
  stage: 'Qualification' | 'Needs Analysis' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost'
  value: number
  probability: number
  owner: string
  createdAt: string
  expectedClose: string
  nextStep: string
}

export const PIPELINE_STAGES = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'] as const

export function buildLeads(rng: Rng, reps: string[], count = 64): Lead[] {
  const probabilityByStage: Record<string, number> = {
    Qualification: 15,
    'Needs Analysis': 30,
    Proposal: 55,
    Negotiation: 75,
    'Closed Won': 100,
    'Closed Lost': 0,
  }
  const orgs = ['Northbay Retail Group', 'Sunrise Provisions', 'Marikina Foodmart', 'Vista Grande Hotels', 'Pacific Bulk Traders', 'Summit Convenience', 'Riverside Catering', 'Everline Commerce', 'Bayanihan Grocers', 'Highland Hospitality']

  return Array.from({ length: count }, (_, i) => {
    const stage = rng.weighted([
      ['Qualification', 6],
      ['Needs Analysis', 5],
      ['Proposal', 4],
      ['Negotiation', 3],
      ['Closed Won', 3],
      ['Closed Lost', 2],
    ] as const)
    return {
      id: `lead-${i + 1}`,
      code: docNo('OPP', YEAR, i + 1),
      company: `${rng.pick(orgs)} ${rng.int(1, 40)}`,
      contact: personName(rng),
      source: rng.pick(['Referral', 'Trade Show', 'Cold Call', 'Website', 'Existing Customer', 'Partner'] as const),
      stage,
      value: Math.round(rng.gaussian(880_000, 620_000, 65_000, 4_800_000) / 1000) * 1000,
      probability: probabilityByStage[stage]!,
      owner: rng.pick(reps),
      createdAt: rng.daysAgo(5, 160).toISOString(),
      expectedClose: rng.daysAhead(-20, 110).toISOString(),
      nextStep: rng.pick(['Send revised pricing', 'Schedule site visit', 'Await credit approval', 'Product demo', 'Contract review', 'Follow-up call']),
    }
  })
}

export type Quotation = {
  id: string
  no: string
  customer: string
  customerId: string
  date: string
  validUntil: string
  lines: number
  amount: number
  margin: number
  owner: string
  status: 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Expired' | 'Won'
}

export function buildQuotations(rng: Rng, customers: Customer[], count = 72): Quotation[] {
  return Array.from({ length: count }, (_, i) => {
    const c = rng.pick(customers)
    const date = rng.daysAgo(1, 120)
    const validUntil = new Date(date.getTime() + rng.int(14, 45) * 86_400_000)
    return {
      id: `qt-${i + 1}`,
      no: docNo('QT', YEAR, i + 1),
      customer: c.name,
      customerId: c.id,
      date: date.toISOString(),
      validUntil: validUntil.toISOString(),
      lines: rng.int(2, 24),
      amount: Math.round(rng.gaussian(420_000, 310_000, 22_000, 2_600_000)),
      margin: Number(rng.float(9, 34).toFixed(1)),
      owner: c.salesRep,
      status: validUntil < new Date() ? 'Expired' : rng.weighted([
        ['Draft', 2],
        ['Submitted', 4],
        ['Approved', 5],
        ['Won', 3],
        ['Rejected', 1],
      ] as const),
    }
  })
}

export type SalesOrder = {
  id: string
  no: string
  customer: string
  customerId: string
  channel: Customer['channel']
  region: string
  date: string
  promisedDate: string
  warehouse: string
  lines: number
  amount: number
  cost: number
  margin: number
  fulfilled: number
  rep: string
  status: 'Draft' | 'Confirmed' | 'Partial' | 'Delivered' | 'Cancelled' | 'On Hold'
}

export function buildSalesOrders(rng: Rng, customers: Customer[], sites: WarehouseSite[], count = 460): SalesOrder[] {
  return Array.from({ length: count }, (_, i) => {
    const c = rng.pick(customers)
    // A full trailing year, so the 12-month dashboard charts aggregate from
    // the same rows the order list shows.
    const date = rng.daysAgo(0, 364)
    const amount = Math.round(rng.gaussian(310_000, 260_000, 14_000, 2_400_000))
    const marginPct = rng.float(8, 33)
    const status = rng.weighted([
      ['Confirmed', 5],
      ['Partial', 3],
      ['Delivered', 9],
      ['Draft', 2],
      ['On Hold', 1],
      ['Cancelled', 1],
    ] as const)

    return {
      id: `so-${i + 1}`,
      no: docNo('SO', YEAR, i + 1),
      customer: c.name,
      customerId: c.id,
      channel: c.channel,
      region: c.region,
      date: date.toISOString(),
      promisedDate: new Date(date.getTime() + rng.int(2, 14) * 86_400_000).toISOString(),
      warehouse: rng.pick(sites).name,
      lines: rng.int(1, 32),
      amount,
      cost: Math.round(amount * (1 - marginPct / 100)),
      margin: Number(marginPct.toFixed(1)),
      fulfilled: status === 'Delivered' ? 100 : status === 'Partial' ? rng.int(25, 90) : status === 'Confirmed' ? rng.int(0, 40) : 0,
      rep: c.salesRep,
      status,
    }
  })
}

export type Delivery = {
  id: string
  no: string
  soNo: string
  customer: string
  city: string
  scheduled: string
  vehicle: string
  driver: string
  pallets: number
  status: 'Scheduled' | 'In Transit' | 'Delivered' | 'Partial' | 'Cancelled'
  podReceived: boolean
  /** The costed run. Absent until both ends of the route have coordinates. */
  origin?: string
  distanceKm?: number | null
  roundTrip?: boolean
  etaMinutes?: number | null
  fuelLitres?: number | null
  fuelCost?: number | null
}

export function buildDeliveries(rng: Rng, orders: SalesOrder[], assets: Asset[], drivers: string[], count = 120): Delivery[] {
  const vehicles = assets.filter((a) => a.category === 'Delivery Vehicle')
  return Array.from({ length: count }, (_, i) => {
    const so = rng.pick(orders)
    const status = rng.weighted([
      ['Delivered', 8],
      ['In Transit', 3],
      ['Scheduled', 3],
      ['Partial', 1],
      ['Cancelled', 1],
    ] as const)
    return {
      id: `dr-${i + 1}`,
      no: docNo('DR', YEAR, i + 1),
      soNo: so.no,
      customer: so.customer,
      city: so.region,
      scheduled: rng.daysAgo(-10, 45).toISOString(),
      vehicle: vehicles.length ? rng.pick(vehicles).code : 'TRK-001',
      driver: rng.pick(drivers),
      pallets: rng.int(1, 22),
      status,
      podReceived: status === 'Delivered' && rng.bool(0.86),
    }
  })
}

export type ReturnDoc = {
  id: string
  no: string
  customer: string
  date: string
  reason: 'Damaged in transit' | 'Wrong item shipped' | 'Near expiry' | 'Quality complaint' | 'Over-delivery' | 'Order cancelled'
  qty: number
  amount: number
  disposition: 'Restock' | 'Scrap' | 'Return to Supplier' | 'Pending inspection'
  status: 'Submitted' | 'Approved' | 'Completed' | 'Rejected'
}

export function buildReturns(rng: Rng, customers: Customer[], count = 48): ReturnDoc[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `rma-${i + 1}`,
    no: docNo('RMA', YEAR, i + 1),
    customer: rng.pick(customers).name,
    date: rng.daysAgo(1, 150).toISOString(),
    reason: rng.pick(['Damaged in transit', 'Wrong item shipped', 'Near expiry', 'Quality complaint', 'Over-delivery', 'Order cancelled'] as const),
    qty: rng.int(1, 180),
    amount: Math.round(rng.gaussian(48_000, 42_000, 1_800, 340_000)),
    disposition: rng.pick(['Restock', 'Scrap', 'Return to Supplier', 'Pending inspection'] as const),
    status: rng.weighted([
      ['Completed', 6],
      ['Approved', 3],
      ['Submitted', 3],
      ['Rejected', 1],
    ] as const),
  }))
}

export type Campaign = {
  id: string
  name: string
  channel: 'Trade Promo' | 'Digital Ads' | 'Email' | 'Field Activation' | 'Print' | 'Loyalty'
  start: string
  end: string
  budget: number
  spend: number
  leads: number
  conversions: number
  revenue: number
  roi: number
  owner: string
  status: 'Planned' | 'Active' | 'Completed' | 'On Hold'
}

export function buildCampaigns(rng: Rng, reps: string[], count = 22): Campaign[] {
  const names = ['Summer Refresh', 'Back-to-School Bundle', 'Sari-Sari Loyalty Drive', 'Cold Chain Push', 'Q3 Trade Discount', 'Metro Expansion', 'Industrial Safety Week', 'Holiday Basket', 'New SKU Launch', 'Distributor Rally']
  return Array.from({ length: count }, (_, i) => {
    const budget = Math.round(rng.gaussian(680_000, 420_000, 90_000, 2_800_000) / 1000) * 1000
    const spend = Math.round(budget * rng.float(0.35, 1.12))
    const revenue = Math.round(spend * rng.gaussian(3.6, 1.9, 0.4, 9))
    const leads = rng.int(40, 620)
    return {
      id: `cmp-${i + 1}`,
      name: `${rng.pick(names)} ${YEAR} — Wave ${rng.int(1, 4)}`,
      channel: rng.pick(['Trade Promo', 'Digital Ads', 'Email', 'Field Activation', 'Print', 'Loyalty'] as const),
      start: rng.daysAgo(10, 240).toISOString(),
      end: rng.daysAhead(-90, 90).toISOString(),
      budget,
      spend,
      leads,
      conversions: Math.round(leads * rng.float(0.04, 0.28)),
      revenue,
      roi: Number(((revenue - spend) / spend).toFixed(2)),
      owner: rng.pick(reps),
      status: rng.weighted([
        ['Active', 4],
        ['Completed', 5],
        ['Planned', 2],
        ['On Hold', 1],
      ] as const),
    }
  })
}

export type SalesTarget = {
  id: string
  rep: string
  territory: string
  quota: number
  actual: number
  attainment: number
  deals: number
  commissionRate: number
  commission: number
  status: 'On Track' | 'At Risk' | 'Behind' | 'Achieved'
}

export function buildTargets(rng: Rng, reps: string[]): SalesTarget[] {
  return reps.map((rep, i) => {
    const quota = Math.round(rng.gaussian(6_400_000, 1_800_000, 2_800_000, 12_000_000) / 100_000) * 100_000
    const actual = Math.round(quota * rng.gaussian(0.94, 0.24, 0.38, 1.5))
    const attainment = Number(((actual / quota) * 100).toFixed(1))
    const commissionRate = Number(rng.float(0.8, 2.6).toFixed(2))
    return {
      id: `tgt-${i + 1}`,
      rep,
      territory: rng.pick(['NCR North', 'NCR South', 'Central Luzon', 'Southern Luzon', 'Cebu & Bohol', 'Davao Region', 'Northern Mindanao', 'Western Visayas']),
      quota,
      actual,
      attainment,
      deals: rng.int(12, 78),
      commissionRate,
      commission: Math.round((actual * commissionRate) / 100),
      status: attainment >= 100 ? 'Achieved' : attainment >= 85 ? 'On Track' : attainment >= 65 ? 'At Risk' : 'Behind',
    }
  })
}

export type PriceRow = {
  id: string
  sku: string
  name: string
  category: string
  tier: 'Standard' | 'Wholesale' | 'Key Account' | 'Distributor'
  listPrice: number
  discount: number
  netPrice: number
  unitCost: number
  margin: number
  effective: string
  status: 'Active' | 'Scheduled' | 'Expired'
}

export function buildPriceRows(rng: Rng, items: Item[], count = 96): PriceRow[] {
  return rng.sample(items, Math.min(count, items.length)).map((item, i) => {
    const tier = rng.pick(['Standard', 'Wholesale', 'Key Account', 'Distributor'] as const)
    const discount = Number(rng.float(0, tier === 'Distributor' ? 22 : tier === 'Key Account' ? 16 : 9).toFixed(1))
    const netPrice = Math.round(item.sellPrice * (1 - discount / 100))
    return {
      id: `pr-${i + 1}`,
      sku: item.sku,
      name: item.name,
      category: item.category,
      tier,
      listPrice: item.sellPrice,
      discount,
      netPrice,
      unitCost: item.unitCost,
      margin: Number((((netPrice - item.unitCost) / netPrice) * 100).toFixed(1)),
      effective: rng.daysAgo(-30, 200).toISOString(),
      status: rng.weighted([
        ['Active', 8],
        ['Scheduled', 2],
        ['Expired', 1],
      ] as const),
    }
  })
}

/* ========================================================================== */
/* PROCUREMENT                                                                */
/* ========================================================================== */

export type Requisition = {
  id: string
  no: string
  title: string
  requester: string
  department: string
  date: string
  needBy: string
  lines: number
  amount: number
  budgetLeft: number
  status: 'Draft' | 'Submitted' | 'For Approval' | 'Approved' | 'Rejected' | 'Converted'
}

export function buildRequisitions(rng: Rng, employees: Employee[], count = 68): Requisition[] {
  const titles = ['Warehouse consumables restock', 'Q3 stock replenishment', 'Forklift spare parts', 'Office supplies', 'PPE for DC staff', 'Delivery van tyres', 'Packaging materials', 'IT peripherals', 'Cleaning supplies', 'Pallet racking repair kit']
  return Array.from({ length: count }, (_, i) => {
    const e = rng.pick(employees)
    const amount = Math.round(rng.gaussian(320_000, 280_000, 12_000, 1_900_000))
    return {
      id: `pr-req-${i + 1}`,
      no: docNo('PR', YEAR, i + 1),
      title: rng.pick(titles),
      requester: e.name,
      department: e.department,
      date: rng.daysAgo(0, 110).toISOString(),
      needBy: rng.daysAhead(-15, 60).toISOString(),
      lines: rng.int(1, 18),
      amount,
      budgetLeft: Math.round(amount * rng.float(-0.4, 3.2)),
      status: rng.weighted([
        ['Approved', 6],
        ['For Approval', 4],
        ['Converted', 5],
        ['Submitted', 2],
        ['Draft', 2],
        ['Rejected', 1],
      ] as const),
    }
  })
}

export type Rfq = {
  id: string
  no: string
  title: string
  buyer: string
  issued: string
  closes: string
  invited: number
  responses: number
  bestBid: number
  estimatedValue: number
  savings: number
  /** Set on award. May differ from the lowest bid — that is the point. */
  awardedSupplier?: string | null
  status: 'Open' | 'Under Evaluation' | 'Awarded' | 'Cancelled'
}

export function buildRfqs(rng: Rng, buyers: string[], count = 34): Rfq[] {
  const titles = ['Corrugated boxes annual supply', 'Third-party trucking rates', 'Beverage principal restock', 'Forklift maintenance contract', 'PPE bulk supply', 'Stretch film supply', 'Genset servicing', 'Warehouse racking expansion']
  return Array.from({ length: count }, (_, i) => {
    const estimatedValue = Math.round(rng.gaussian(1_600_000, 1_100_000, 180_000, 7_400_000))
    const bestBid = Math.round(estimatedValue * rng.float(0.78, 1.06))
    const invited = rng.int(3, 9)
    return {
      id: `rfq-${i + 1}`,
      no: docNo('RFQ', YEAR, i + 1),
      title: `${rng.pick(titles)} — ${YEAR}`,
      buyer: rng.pick(buyers),
      issued: rng.daysAgo(3, 130).toISOString(),
      closes: rng.daysAhead(-40, 35).toISOString(),
      invited,
      responses: rng.int(1, invited),
      bestBid,
      estimatedValue,
      savings: estimatedValue - bestBid,
      status: rng.weighted([
        ['Awarded', 5],
        ['Under Evaluation', 3],
        ['Open', 3],
        ['Cancelled', 1],
      ] as const),
    }
  })
}

export type PurchaseOrder = {
  id: string
  no: string
  supplier: string
  supplierId: string
  category: string
  date: string
  expected: string
  lines: number
  amount: number
  receivedPct: number
  buyer: string
  status: 'Draft' | 'For Approval' | 'Approved' | 'Partial' | 'Completed' | 'Cancelled'
}

export function buildPurchaseOrders(rng: Rng, suppliers: Supplier[], buyers: string[], count = 320): PurchaseOrder[] {
  return Array.from({ length: count }, (_, i) => {
    const s = rng.pick(suppliers)
    const status = rng.weighted([
      ['Completed', 8],
      ['Partial', 3],
      ['Approved', 4],
      ['For Approval', 2],
      ['Draft', 1],
      ['Cancelled', 1],
    ] as const)
    return {
      id: `po-${i + 1}`,
      no: docNo('PO', YEAR, i + 1),
      supplier: s.name,
      supplierId: s.id,
      category: s.category,
      date: rng.daysAgo(0, 364).toISOString(),
      expected: rng.daysAhead(-60, 45).toISOString(),
      lines: rng.int(1, 26),
      amount: Math.round(rng.gaussian(540_000, 430_000, 22_000, 3_600_000)),
      receivedPct: status === 'Completed' ? 100 : status === 'Partial' ? rng.int(20, 88) : 0,
      buyer: rng.pick(buyers),
      status,
    }
  })
}

export type GoodsReceipt = {
  id: string
  no: string
  poNo: string
  supplier: string
  warehouse: string
  date: string
  lines: number
  qtyReceived: number
  qtyRejected: number
  receivedBy: string
  status: 'Draft' | 'Posted' | 'For Approval' | 'Rejected'
}

export function buildGoodsReceipts(rng: Rng, pos: PurchaseOrder[], sites: WarehouseSite[], staff: string[], count = 132): GoodsReceipt[] {
  return Array.from({ length: count }, (_, i) => {
    const po = rng.pick(pos)
    const qtyReceived = rng.int(40, 2400)
    return {
      id: `grn-${i + 1}`,
      no: docNo('GRN', YEAR, i + 1),
      poNo: po.no,
      supplier: po.supplier,
      warehouse: rng.pick(sites).name,
      date: rng.daysAgo(0, 150).toISOString(),
      lines: rng.int(1, 20),
      qtyReceived,
      qtyRejected: rng.bool(0.22) ? rng.int(1, Math.max(2, Math.round(qtyReceived * 0.06))) : 0,
      receivedBy: rng.pick(staff),
      status: rng.weighted([
        ['Posted', 9],
        ['For Approval', 2],
        ['Draft', 1],
        ['Rejected', 1],
      ] as const),
    }
  })
}

export type SupplierInvoice = {
  id: string
  no: string
  supplier: string
  poNo: string
  date: string
  due: string
  amount: number
  matched: 'Matched' | '2-way only' | 'Price variance' | 'Qty variance' | 'Unmatched'
  status: 'Draft' | 'For Approval' | 'Approved' | 'Paid' | 'Overdue' | 'Rejected'
}

export function buildSupplierInvoices(rng: Rng, pos: PurchaseOrder[], count = 148): SupplierInvoice[] {
  return Array.from({ length: count }, (_, i) => {
    const po = rng.pick(pos)
    const date = rng.daysAgo(0, 160)
    const due = new Date(date.getTime() + rng.pick([15, 30, 45, 60]) * 86_400_000)
    const status = rng.weighted([
      ['Paid', 8],
      ['Approved', 3],
      ['For Approval', 3],
      ['Overdue', 2],
      ['Draft', 1],
    ] as const)
    return {
      id: `sinv-${i + 1}`,
      no: `SI-${YEAR}-${String(4000 + i)}`,
      supplier: po.supplier,
      poNo: po.no,
      date: date.toISOString(),
      due: due.toISOString(),
      amount: Math.round(po.amount * rng.float(0.85, 1.05)),
      matched: rng.weighted([
        ['Matched', 10],
        ['2-way only', 2],
        ['Price variance', 2],
        ['Qty variance', 1],
        ['Unmatched', 1],
      ] as const),
      status: due < new Date() && status !== 'Paid' ? 'Overdue' : status,
    }
  })
}

export type Contract = {
  id: string
  no: string
  supplier: string
  title: string
  type: 'Supply Agreement' | 'Service Contract' | 'Framework Agreement' | 'Lease'
  start: string
  end: string
  value: number
  autoRenew: boolean
  owner: string
  status: 'Active' | 'Expiring' | 'Expired' | 'Draft' | 'Terminated'
}

export function buildContracts(rng: Rng, suppliers: Supplier[], buyers: string[], count = 28): Contract[] {
  return Array.from({ length: count }, (_, i) => {
    const end = rng.daysAhead(-90, 500)
    const daysLeft = Math.round((end.getTime() - Date.now()) / 86_400_000)
    return {
      id: `ct-${i + 1}`,
      no: docNo('CTR', YEAR, i + 1, 3),
      supplier: rng.pick(suppliers).name,
      title: rng.pick(['Annual supply of packaging', 'Third-party logistics', 'Fleet maintenance', 'Warehouse lease', 'Genset servicing', 'IT support retainer', 'Security services', 'Pest control']),
      type: rng.pick(['Supply Agreement', 'Service Contract', 'Framework Agreement', 'Lease'] as const),
      start: rng.daysAgo(120, 900).toISOString(),
      end: end.toISOString(),
      value: Math.round(rng.gaussian(2_800_000, 2_100_000, 240_000, 12_000_000)),
      autoRenew: rng.bool(0.42),
      owner: rng.pick(buyers),
      status: daysLeft < 0 ? 'Expired' : daysLeft < 60 ? 'Expiring' : rng.weighted([['Active', 9], ['Draft', 1]] as const),
    }
  })
}

/* ========================================================================== */
/* WAREHOUSE                                                                  */
/* ========================================================================== */

export type StockRow = {
  id: string
  sku: string
  name: string
  category: string
  warehouse: string
  bin: string
  batch: string
  expiry: string | null
  onHand: number
  allocated: number
  available: number
  unitCost: number
  value: number
  abc: 'A' | 'B' | 'C'
  status: 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Expiring Soon' | 'Overstock'
  /** Last time this item was physically counted in this warehouse, from posted count history. */
  lastCountedAt?: string | null
}

export function buildStock(rng: Rng, items: Item[], sites: WarehouseSite[]): StockRow[] {
  const rows: StockRow[] = []
  let n = 1

  for (const item of items) {
    // Every SKU sits in the main DC; a subset is also stocked in the branches.
    const locations = [sites[0]!, ...rng.sample(sites.slice(1), rng.int(0, 2))]
    for (const site of locations) {
      const onHand = site === sites[0] ? item.onHand : Math.round(item.onHand * rng.float(0.05, 0.4))
      const allocated = Math.min(onHand, Math.round(onHand * rng.float(0, 0.35)))
      const available = onHand - allocated
      const expiryDate = item.shelfLifeDays ? rng.daysAhead(-20, item.shelfLifeDays) : null
      const daysToExpiry = expiryDate ? Math.round((expiryDate.getTime() - Date.now()) / 86_400_000) : Infinity

      const status: StockRow['status'] =
        onHand === 0
          ? 'Out of Stock'
          : daysToExpiry < 60
            ? 'Expiring Soon'
            : available <= item.reorderPoint
              ? 'Low Stock'
              : onHand > item.reorderPoint * 4
                ? 'Overstock'
                : 'In Stock'

      rows.push({
        id: `stk-${n++}`,
        sku: item.sku,
        name: item.name,
        category: item.category,
        warehouse: site.name,
        bin: `${rng.pick(['A', 'B', 'C', 'D'])}-${String(rng.int(1, 32)).padStart(2, '0')}-${String(rng.int(1, 6))}`,
        batch: `B${rng.int(2400, 2699)}-${rng.int(100, 999)}`,
        expiry: expiryDate?.toISOString() ?? null,
        onHand,
        allocated,
        available,
        unitCost: item.unitCost,
        value: onHand * item.unitCost,
        abc: item.abc,
        status,
      })
    }
  }
  return rows
}

export type InboundDoc = {
  id: string
  no: string
  reference: string
  supplier: string
  warehouse: string
  arrival: string
  dock: string
  pallets: number
  linesTotal: number
  linesPutaway: number
  status: 'Expected' | 'Receiving' | 'In Inspection' | 'Putaway' | 'Completed'
}

export function buildInbound(rng: Rng, pos: PurchaseOrder[], sites: WarehouseSite[], count = 56): InboundDoc[] {
  return Array.from({ length: count }, (_, i) => {
    const po = rng.pick(pos)
    const linesTotal = rng.int(2, 24)
    const status = rng.weighted([
      ['Completed', 6],
      ['Putaway', 2],
      ['In Inspection', 2],
      ['Receiving', 2],
      ['Expected', 3],
    ] as const)
    return {
      id: `in-${i + 1}`,
      no: docNo('ASN', YEAR, i + 1),
      reference: po.no,
      supplier: po.supplier,
      warehouse: rng.pick(sites).name,
      arrival: rng.daysAgo(-7, 30).toISOString(),
      dock: `Dock ${rng.int(1, 8)}`,
      pallets: rng.int(2, 26),
      linesTotal,
      linesPutaway: status === 'Completed' ? linesTotal : rng.int(0, linesTotal),
      status,
    }
  })
}

export type OutboundDoc = {
  id: string
  no: string
  soNo: string
  customer: string
  warehouse: string
  warehouseId?: number
  cutoff: string
  wave: string
  waveId?: number | null
  picker: string
  lines: number
  linesPicked: number
  status: 'Released' | 'Picking' | 'Packed' | 'Staged' | 'Dispatched' | 'On Hold'
}

export function buildOutbound(rng: Rng, orders: SalesOrder[], staff: string[], count = 74): OutboundDoc[] {
  return Array.from({ length: count }, (_, i) => {
    const so = rng.pick(orders)
    const lines = rng.int(1, 28)
    const status = rng.weighted([
      ['Dispatched', 5],
      ['Staged', 2],
      ['Packed', 2],
      ['Picking', 3],
      ['Released', 3],
      ['On Hold', 1],
    ] as const)
    return {
      id: `out-${i + 1}`,
      no: docNo('PL', YEAR, i + 1),
      soNo: so.no,
      customer: so.customer,
      warehouse: so.warehouse,
      cutoff: rng.daysAgo(-3, 14).toISOString(),
      wave: `Wave ${rng.int(1, 6)}`,
      picker: rng.pick(staff),
      lines,
      linesPicked: status === 'Released' ? 0 : status === 'Picking' ? rng.int(1, lines) : lines,
      status,
    }
  })
}

export type Transfer = {
  id: string
  no: string
  from: string
  to: string
  date: string
  eta: string
  lines: number
  qty: number
  value: number
  status: 'Draft' | 'Approved' | 'In Transit' | 'Received' | 'Cancelled'
}

export function buildTransfers(rng: Rng, sites: WarehouseSite[], count = 42): Transfer[] {
  return Array.from({ length: count }, (_, i) => {
    const [from, to] = rng.sample(sites, 2)
    return {
      id: `trf-${i + 1}`,
      no: docNo('TR', YEAR, i + 1, 3),
      from: from!.name,
      to: to!.name,
      date: rng.daysAgo(0, 90).toISOString(),
      eta: rng.daysAhead(-20, 14).toISOString(),
      lines: rng.int(1, 22),
      qty: rng.int(20, 1800),
      value: Math.round(rng.gaussian(280_000, 220_000, 12_000, 1_500_000)),
      status: rng.weighted([
        ['Received', 7],
        ['In Transit', 3],
        ['Approved', 2],
        ['Draft', 1],
        ['Cancelled', 1],
      ] as const),
    }
  })
}

export type CycleCount = {
  id: string
  no: string
  warehouse: string
  zone: string
  date: string
  counter: string
  skusCounted: number
  variances: number
  accuracy: number
  valueVariance: number
  status: 'Scheduled' | 'In Progress' | 'For Approval' | 'Posted'
}

export function buildCycleCounts(rng: Rng, sites: WarehouseSite[], staff: string[], count = 38): CycleCount[] {
  return Array.from({ length: count }, (_, i) => {
    const skusCounted = rng.int(25, 320)
    const variances = rng.int(0, Math.max(1, Math.round(skusCounted * 0.09)))
    return {
      id: `cc-${i + 1}`,
      no: docNo('CC', YEAR, i + 1, 3),
      warehouse: rng.pick(sites).name,
      zone: `Zone ${rng.pick(['A', 'B', 'C', 'D', 'E'])}`,
      date: rng.daysAgo(-5, 120).toISOString(),
      counter: rng.pick(staff),
      skusCounted,
      variances,
      accuracy: Number((((skusCounted - variances) / skusCounted) * 100).toFixed(2)),
      valueVariance: Math.round(rng.gaussian(0, 62_000, -420_000, 420_000)),
      status: rng.weighted([
        ['Posted', 7],
        ['For Approval', 2],
        ['In Progress', 2],
        ['Scheduled', 2],
      ] as const),
    }
  })
}

export type ReplenishmentRow = {
  id: string
  /** Present on live data; the demo dataset has no numeric ids. */
  itemId?: number
  sku: string
  name: string
  category: string
  warehouse?: string
  onHand: number
  available: number
  reorderPoint: number
  avgDailyDemand: number
  /** Null when nothing has been consumed, so cover cannot be computed. */
  coverDays: number | null
  suggestedQty: number
  suggestedValue?: number
  supplier: string | null
  leadTimeDays: number
  urgency: 'Critical' | 'High' | 'Medium' | 'Low'
}

export function buildReplenishment(rng: Rng, items: Item[], sites: WarehouseSite[]): ReplenishmentRow[] {
  return items
    .filter((item) => item.status === 'Active')
    .map((item, i) => {
      const available = Math.max(0, item.onHand - item.allocated)
      const avgDailyDemand = Math.max(1, Math.round(rng.gaussian(item.reorderPoint / 12, 8, 1, 220)))
      const coverDays = Math.round(available / avgDailyDemand)
      const row: ReplenishmentRow = {
        id: `rep-${i + 1}`,
        sku: item.sku,
        name: item.name,
        category: item.category,
        warehouse: sites[0]!.name,
        onHand: item.onHand,
        available,
        reorderPoint: item.reorderPoint,
        avgDailyDemand,
        coverDays,
        suggestedQty: available <= item.reorderPoint ? item.reorderQty : 0,
        supplier: item.primarySupplier,
        leadTimeDays: item.leadTimeDays,
        urgency:
          coverDays <= item.leadTimeDays * 0.5
            ? 'Critical'
            : coverDays <= item.leadTimeDays
              ? 'High'
              : coverDays <= item.leadTimeDays * 2
                ? 'Medium'
                : 'Low',
      }
      return row
    })
    .filter((r) => r.urgency !== 'Low' || (r.coverDays ?? 0) < 120)
}

/* ========================================================================== */
/* MAINTENANCE                                                                */
/* ========================================================================== */

export type WorkOrder = {
  id: string
  no: string
  asset: string
  assetName: string
  /** What is wrong, in the technician's words. Absent on preview data. */
  summary?: string
  description?: string
  type: 'Corrective' | 'Preventive' | 'Inspection' | 'Calibration' | 'Emergency'
  priority: 'Critical' | 'High' | 'Medium' | 'Low'
  reported: string
  due: string
  completed?: string | null
  technician: string
  downtimeHours: number
  meterReading?: number | null
  laborCost: number
  partsCost: number
  /** Labour plus parts, computed by the API so two columns cannot disagree. */
  totalCost?: number
  /** Where the spare parts came off. */
  warehouseId?: number | null
  status: 'Open' | 'Assigned' | 'In Progress' | 'On Hold' | 'Completed' | 'Cancelled'
}

export function buildWorkOrders(rng: Rng, assets: Asset[], technicians: string[], count = 280): WorkOrder[] {
  const faults = ['Hydraulic leak', 'Brake pad replacement', 'Battery failure', 'Overheating', 'Belt replacement', 'Coolant top-up', 'Electrical fault', 'Tyre replacement', 'Compressor noise', 'Sensor calibration']
  return Array.from({ length: count }, (_, i) => {
    const asset = rng.pick(assets)
    const type = rng.weighted([
      ['Preventive', 5],
      ['Corrective', 5],
      ['Inspection', 3],
      ['Emergency', 1],
      ['Calibration', 1],
    ] as const)
    const status = rng.weighted([
      ['Completed', 9],
      ['In Progress', 3],
      ['Assigned', 2],
      ['Open', 2],
      ['On Hold', 1],
      ['Cancelled', 1],
    ] as const)
    return {
      id: `wo-${i + 1}`,
      no: docNo('WO', YEAR, i + 1),
      asset: asset.code,
      assetName: `${asset.name} — ${rng.pick(faults)}`,
      type,
      priority: type === 'Emergency' ? 'Critical' : rng.weighted([['High', 3], ['Medium', 6], ['Low', 3], ['Critical', 1]] as const),
      reported: rng.daysAgo(0, 364).toISOString(),
      due: rng.daysAhead(-25, 40).toISOString(),
      technician: rng.pick(technicians),
      downtimeHours: Number(rng.gaussian(6.4, 5.8, 0.5, 42).toFixed(1)),
      laborCost: Math.round(rng.gaussian(8_400, 5_600, 900, 42_000)),
      partsCost: Math.round(rng.gaussian(22_000, 24_000, 0, 180_000)),
      status,
    }
  })
}

export type PmSchedule = {
  id: string
  code: string
  asset: string
  assetName: string
  task: string
  frequency: 'Weekly' | 'Monthly' | 'Quarterly' | 'Semi-annual' | 'Annual' | 'Every 5,000 km' | 'Every 250 hours'
  lastDone: string
  nextDue: string
  assignedTo: string
  compliance: number
  status: 'Scheduled' | 'Due' | 'Overdue' | 'Completed' | 'Inactive'
}

export function buildPmSchedules(rng: Rng, assets: Asset[], technicians: string[], count = 74): PmSchedule[] {
  const tasks = ['Engine oil & filter change', 'Brake system inspection', 'Battery & terminal check', 'Hydraulic fluid service', 'Refrigerant pressure check', 'Genset load test', 'Racking integrity inspection', 'Fire suppression check', 'Tyre rotation & pressure']
  return Array.from({ length: count }, (_, i) => {
    const asset = rng.pick(assets)
    const nextDue = rng.daysAhead(-30, 120)
    const daysLeft = Math.round((nextDue.getTime() - Date.now()) / 86_400_000)
    return {
      id: `pm-${i + 1}`,
      code: docNo('PM', YEAR, i + 1, 3),
      asset: asset.code,
      assetName: asset.name,
      task: rng.pick(tasks),
      frequency: rng.pick(['Weekly', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'Every 5,000 km', 'Every 250 hours'] as const),
      lastDone: rng.daysAgo(5, 220).toISOString(),
      nextDue: nextDue.toISOString(),
      assignedTo: rng.pick(technicians),
      compliance: Math.round(rng.gaussian(87, 13, 42, 100)),
      status: daysLeft < 0 ? 'Overdue' : daysLeft < 7 ? 'Due' : rng.weighted([['Scheduled', 8], ['Completed', 3], ['Inactive', 1]] as const),
    }
  })
}

export type Vehicle = {
  id: string
  code: string
  plate: string
  model: string
  driver: string
  site: string
  odometer: number
  kmSinceService: number
  fuelEfficiency: number
  registrationExpiry: string
  insuranceExpiry: string
  status: 'Available' | 'On Trip' | 'Under Maintenance' | 'Breakdown' | 'Retired'
  ownership: 'CO' | 'PO' | 'R&C'
  ownerEmployee?: string
  vehicleType?: 'Sedan' | 'Pickup' | 'Van' | 'Truck' | 'Motorcycle'
}

export function buildVehicles(rng: Rng, assets: Asset[], drivers: string[]): Vehicle[] {
  return assets
    .filter((a) => a.category === 'Delivery Vehicle')
    .map((a, i) => ({
      id: `veh-${i + 1}`,
      code: a.code,
      plate: `${rng.pick(['NAB', 'CAS', 'DAT', 'PLM', 'ZRT'])} ${rng.int(1000, 9999)}`,
      model: a.name,
      driver: rng.pick(drivers),
      site: a.site,
      odometer: a.meterReading,
      kmSinceService: rng.int(200, 9_800),
      fuelEfficiency: Number(rng.gaussian(6.4, 1.3, 3.2, 10.5).toFixed(2)),
      registrationExpiry: rng.daysAhead(-30, 340).toISOString(),
      insuranceExpiry: rng.daysAhead(-20, 360).toISOString(),
      status:
        a.status === 'Breakdown'
          ? 'Breakdown'
          : a.status === 'Under Maintenance'
            ? 'Under Maintenance'
            : a.status === 'Retired'
              ? 'Retired'
              : rng.weighted([['Available', 5], ['On Trip', 5]] as const),
      ownership: rng.weighted([['CO', 8], ['PO', 1], ['R&C', 1]] as const),
      vehicleType: rng.pick(['Sedan', 'Pickup', 'Van', 'Truck', 'Motorcycle'] as const),
    }))
}

export type FuelLog = {
  id: string
  date: string
  vehicle: string
  driver: string
  liters: number
  cost: number
  odometer: number
  /** Kilometres since the previous fill. Derived, never typed. */
  distance?: number
  kmPerLiter: number
  station: string
  flagged: boolean
  /** "Check" or "Normal" — the flag in a word a supervisor can read. */
  review?: 'Check' | 'Normal'
}

export function buildFuelLogs(rng: Rng, vehicles: Vehicle[], count = 180): FuelLog[] {
  if (!vehicles.length) return []
  return Array.from({ length: count }, (_, i) => {
    const v = rng.pick(vehicles)
    const liters = Number(rng.gaussian(64, 22, 18, 140).toFixed(1))
    const kmPerLiter = Number(rng.gaussian(v.fuelEfficiency, 1.1, 2.4, 11).toFixed(2))
    return {
      id: `fuel-${i + 1}`,
      date: rng.daysAgo(0, 120).toISOString(),
      vehicle: v.code,
      driver: v.driver,
      liters,
      cost: Math.round(liters * rng.float(62, 74)),
      odometer: v.odometer - rng.int(0, 14_000),
      kmPerLiter,
      station: rng.pick(['Petron Alabang', 'Shell SLEX', 'Caltex Sucat', 'Phoenix Bicutan', 'Seaoil Paranaque']),
      flagged: kmPerLiter < v.fuelEfficiency - 1.6,
    }
  })
}

export type DowntimeEvent = {
  id: string
  date: string
  asset: string
  assetName: string
  cause: string
  hours: number
  impact: 'Deliveries delayed' | 'Reduced throughput' | 'None' | 'Line stopped' | 'Cold chain risk'
  rootCause: string
  costImpact: number
  /** The job raised to fix it, once one has been. */
  workOrder?: string | null
  status: 'Under Investigation' | 'Resolved' | 'Recurring'
}

export function buildDowntime(rng: Rng, assets: Asset[], count = 110): DowntimeEvent[] {
  const causes = ['Mechanical failure', 'Electrical fault', 'Operator error', 'Parts unavailable', 'Scheduled overrun', 'Power interruption', 'Wear and tear']
  const roots = ['Deferred preventive service', 'Component past service life', 'Inadequate operator training', 'Spare part stockout', 'Supplier quality issue', 'Environmental / ambient heat']
  return Array.from({ length: count }, (_, i) => {
    const asset = rng.pick(assets)
    const hours = Number(rng.gaussian(7.8, 7.2, 0.5, 56).toFixed(1))
    return {
      id: `dt-${i + 1}`,
      date: rng.daysAgo(0, 364).toISOString(),
      asset: asset.code,
      assetName: asset.name,
      cause: rng.pick(causes),
      hours,
      impact: rng.pick(['Deliveries delayed', 'Reduced throughput', 'None', 'Line stopped', 'Cold chain risk'] as const),
      rootCause: rng.pick(roots),
      costImpact: Math.round(hours * rng.gaussian(6_200, 3_100, 800, 22_000)),
      status: rng.weighted([['Resolved', 7], ['Under Investigation', 2], ['Recurring', 2]] as const),
    }
  })
}

/** A single supplier's quote against a tender. */
export type Bid = {
  id: string
  rfqId: string
  rfqNo: string
  supplier: string
  amount: number
  leadTimeDays: number
  paymentTerms: string
  technicalScore: number
  isAwarded: boolean
}

/** One bin location inside a warehouse. */
export type WarehouseBinRow = {
  id: string
  code: string
  warehouse: string
  zone: string | null
  aisle: string | null
  capacity: number
  preferredClass?: 'A' | 'B' | 'C' | null
  onHand: number
  status: 'Active' | 'Inactive'
}

/** A safety/HSSE incident logged against a warehouse. */
export type WarehouseIncidentRow = {
  id: string
  no: string
  warehouse: string
  warehouseId?: number
  reportedBy: string | null
  occurredOn: string
  hazardType: 'MHE' | 'Dock' | 'Racking' | 'Manual Handling' | 'Chemical' | 'Fire' | 'Other'
  severity: 'Near-miss' | 'Minor' | 'Moderate' | 'Major'
  location: string | null
  description: string
  ppeInvolved: string | null
  correctiveAction: string | null
  status: 'Open' | 'Investigating' | 'Resolved' | 'Closed'
  resolvedAt: string | null
}

/** A 5S/Kaizen improvement suggestion raised against a warehouse. */
export type WarehouseSuggestionRow = {
  id: string
  no: string
  warehouse: string
  warehouseId?: number
  raisedBy: string | null
  category: '5S' | 'Safety' | 'Efficiency' | 'Quality' | 'Other'
  zone: string | null
  description: string
  status: 'Submitted' | 'Under Review' | 'In Progress' | 'Implemented' | 'Rejected'
  impactNote: string | null
  createdAt: string
}

/** A 5S audit of one zone, scored across the five pillars. */
export type Warehouse5sAuditRow = {
  id: string
  no: string
  warehouse: string
  warehouseId?: number
  zone: string
  auditedBy: string | null
  auditedOn: string
  sortScore: number
  setScore: number
  shineScore: number
  standardizeScore: number
  sustainScore: number
  totalScore?: number
  notes: string | null
}

/** A booked dock appointment. */
export type DockAppointmentRow = {
  id: string
  no: string
  warehouse: string
  warehouseId?: number
  dockCode: string
  scheduledAt: string
  durationMinutes: number
  type: 'Inbound' | 'Outbound'
  reference: string | null
  carrier: string | null
  driver: string | null
  status: 'Scheduled' | 'Checked In' | 'In Progress' | 'Completed' | 'No-show' | 'Cancelled'
  notes: string | null
}
