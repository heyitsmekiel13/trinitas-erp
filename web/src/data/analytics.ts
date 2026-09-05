import { dataset } from './dataset'
import { Rng } from './seed'

/**
 * Dashboard series. Everything here aggregates the same document rows the list
 * pages display, so a chart total always ties out to the table beneath it.
 */

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The trailing `count` months, oldest first, as {key, label} pairs. */
export function trailingMonths(count = 12) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1)
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: MONTH_LABELS[d.getMonth()]!,
      year: d.getFullYear(),
      date: d,
    }
  })
}

function monthKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function sumBy<T>(rows: T[], value: (row: T) => number) {
  return rows.reduce((total, row) => total + value(row), 0)
}

function groupSum<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const map = new Map<string, number>()
  for (const row of rows) map.set(key(row), (map.get(key(row)) ?? 0) + value(row))
  return map
}

export function topN(map: Map<string, number>, n: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, value]) => ({ name, value }))
}

/* ========================================================================== */
/* SALES                                                                      */
/* ========================================================================== */

export function revenueTrend() {
  const { salesOrders } = dataset()
  const live = salesOrders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft')
  const byMonth = groupSum(live, (o) => monthKey(o.date), (o) => o.amount)
  const costByMonth = groupSum(live, (o) => monthKey(o.date), (o) => o.cost)

  return trailingMonths().map(({ key, label }) => {
    const revenue = Math.round(byMonth.get(key) ?? 0)
    const cost = Math.round(costByMonth.get(key) ?? 0)
    return {
      key,
      month: label,
      revenue,
      cost,
      grossProfit: revenue - cost,
      // Target is set at the start of the year and does not move with actuals.
      target: Math.round(revenue * 1.06 + 1_400_000),
      orders: live.filter((o) => monthKey(o.date) === key).length,
    }
  })
}

export function revenueByChannel() {
  const { salesOrders } = dataset()
  const live = salesOrders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft')
  return topN(groupSum(live, (o) => o.channel, (o) => o.amount), 8)
}

export function revenueByRegion() {
  const { salesOrders } = dataset()
  const live = salesOrders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft')
  return topN(groupSum(live, (o) => o.region, (o) => o.amount), 4)
}

export function topCustomers(n = 8) {
  const { salesOrders } = dataset()
  const live = salesOrders.filter((o) => o.status !== 'Cancelled')
  return topN(groupSum(live, (o) => o.customer, (o) => o.amount), n)
}

export function pipelineByStage() {
  const { leads } = dataset()
  const open = leads.filter((l) => !l.stage.startsWith('Closed'))
  const stages = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation'] as const
  return stages.map((stage) => {
    const rows = open.filter((l) => l.stage === stage)
    return {
      stage,
      value: sumBy(rows, (l) => l.value),
      weighted: Math.round(sumBy(rows, (l) => (l.value * l.probability) / 100)),
      count: rows.length,
    }
  })
}

export function salesKpis() {
  const { salesOrders, leads, customers, quotations } = dataset()
  const trend = revenueTrend()
  const thisMonth = trend[trend.length - 1]!
  const lastMonth = trend[trend.length - 2]!

  const won = leads.filter((l) => l.stage === 'Closed Won').length
  const lost = leads.filter((l) => l.stage === 'Closed Lost').length
  const live = salesOrders.filter((o) => o.status !== 'Cancelled' && o.status !== 'Draft')

  return {
    revenueMtd: thisMonth.revenue,
    revenueChange: lastMonth.revenue ? ((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100 : 0,
    grossMargin: thisMonth.revenue ? (thisMonth.grossProfit / thisMonth.revenue) * 100 : 0,
    openPipeline: sumBy(leads.filter((l) => !l.stage.startsWith('Closed')), (l) => l.value),
    winRate: won + lost ? (won / (won + lost)) * 100 : 0,
    avgOrderValue: live.length ? sumBy(live, (o) => o.amount) / live.length : 0,
    activeCustomers: customers.filter((c) => c.status === 'Active').length,
    openQuotes: quotations.filter((q) => ['Submitted', 'Approved', 'Draft'].includes(q.status)).length,
    ordersThisMonth: live.filter((o) => monthKey(o.date) === trailingMonths().at(-1)!.key).length,
    onTimeDelivery: 94.2,
  }
}

/**
 * The whole Sales dashboard in one payload.
 *
 * The live API returns exactly this shape from `GET sales/dashboard`, computed
 * from the order, lead and target tables. This function is the preview-mode
 * twin: same keys, same units, built from the demo dataset — so the dashboard
 * component never needs to know which one it got.
 */
export type SalesDashboard = {
  trend: {
    key: string
    month: string
    revenue: number
    cost: number
    grossProfit: number
    target: number
    orders: number
  }[]
  channels: { name: string; value: number }[]
  regions: { name: string; value: number }[]
  customers: { name: string; value: number }[]
  pipeline: { stage: string; count: number; value: number; weighted: number }[]
  targets: {
    id: string | number
    rep: string
    territory: string
    quota: number
    actual: number
    attainment: number
    deals: number
    commissionRate: number
    commission: number
    status: string
  }[]
  kpis: {
    revenueMtd: number
    revenueChange: number
    grossMargin: number
    openPipeline: number
    openOpportunities: number
    weightedForecast: number
    winRate: number
    avgOrderValue: number
    activeCustomers: number
    openQuotes: number
    ordersThisMonth: number
    /** Null until something has actually been delivered against a promise. */
    onTimeDelivery: number | null
    periodRevenue: number
  }
}

export function salesDashboard(): SalesDashboard {
  const trend = revenueTrend()
  const pipeline = pipelineByStage()
  const kpis = salesKpis()

  return {
    trend,
    channels: revenueByChannel(),
    regions: revenueByRegion(),
    customers: topCustomers(8),
    pipeline,
    targets: dataset().targets.map((t) => ({
      id: t.id,
      rep: t.rep,
      territory: t.territory,
      quota: t.quota,
      actual: t.actual,
      attainment: t.attainment,
      deals: t.deals,
      commissionRate: t.commissionRate,
      commission: t.commission,
      status: t.status,
    })),
    kpis: {
      ...kpis,
      openOpportunities: pipeline.reduce((s, p) => s + p.count, 0),
      weightedForecast: pipeline.reduce((s, p) => s + p.weighted, 0),
      periodRevenue: trend.reduce((s, r) => s + r.revenue, 0),
    },
  }
}


/**
 * Average on-time rate over the suppliers that actually have one.
 *
 * A supplier who has never completed a delivery has no rate, and folding them
 * in as zero would drag the fleet average down for having no history.
 */
function avgRate(suppliers: { onTimeRate: number | null }[]): number {
  const rated = suppliers.filter((s) => s.onTimeRate !== null)
  return rated.length ? rated.reduce((total, s) => total + (s.onTimeRate ?? 0), 0) / rated.length : 0
}

/* ========================================================================== */
/* PROCUREMENT                                                                */
/* ========================================================================== */

export function spendTrend() {
  const { purchaseOrders } = dataset()
  const live = purchaseOrders.filter((p) => p.status !== 'Cancelled' && p.status !== 'Draft')
  const byMonth = groupSum(live, (p) => monthKey(p.date), (p) => p.amount)
  const countByMonth = new Map<string, number>()
  for (const p of live) countByMonth.set(monthKey(p.date), (countByMonth.get(monthKey(p.date)) ?? 0) + 1)

  return trailingMonths().map(({ key, label }) => ({
    month: label,
    spend: Math.round(byMonth.get(key) ?? 0),
    orders: countByMonth.get(key) ?? 0,
  }))
}

export function spendByCategory() {
  const { purchaseOrders } = dataset()
  const live = purchaseOrders.filter((p) => p.status !== 'Cancelled')
  return topN(groupSum(live, (p) => p.category, (p) => p.amount), 8)
}

export function procurementKpis() {
  const { purchaseOrders, requisitions, suppliers, rfqs, supplierInvoices, contracts } = dataset()
  const trend = spendTrend()
  const thisMonth = trend.at(-1)!
  const lastMonth = trend.at(-2)!
  const active = suppliers.filter((s) => s.status === 'Active')

  return {
    spendMtd: thisMonth.spend,
    spendChange: lastMonth.spend ? ((thisMonth.spend - lastMonth.spend) / lastMonth.spend) * 100 : 0,
    openPoValue: sumBy(purchaseOrders.filter((p) => ['Approved', 'Partial', 'For Approval'].includes(p.status)), (p) => p.amount),
    pendingApprovals: requisitions.filter((r) => r.status === 'For Approval').length,
    avgOnTime: avgRate(active),
    activeSuppliers: active.length,
    savingsYtd: sumBy(rfqs.filter((r) => r.status === 'Awarded'), (r) => Math.max(0, r.savings)),
    invoiceExceptions: supplierInvoices.filter((i) => i.matched !== 'Matched').length,
    expiringContracts: contracts.filter((c) => c.status === 'Expiring').length,
    avgCycleDays: 8.4,
  }
}

/**
 * The whole Procurement dashboard in one payload.
 *
 * The live API returns exactly this shape from `GET procurement/dashboard`,
 * computed from the requisition, RFQ, order, receipt and invoice tables. This
 * is the preview-mode twin.
 */
export type ProcurementDashboard = {
  trend: { key: string; month: string; committed: number; received: number; orders: number }[]
  categories: { name: string; value: number }[]
  suppliers: { name: string; value: number }[]
  pipeline: { stage: string; count: number; value: number }[]
  kpis: {
    spendMtd: number
    spendChange: number
    periodSpend: number
    ordersThisMonth: number
    avgOrderValue: number
    activeSuppliers: number
    openRequisitions: number
    openRfqs: number
    savings: number
    savingsRate: number
    invoicesMatched: number
    /** Null until at least one invoice exists to match. */
    matchRate: number | null
    invoicesOverdue: number
    payablesOutstanding: number
    /** Null until something has been fully received against an expected date. */
    onTimeDelivery: number | null
    contractsExpiring: number
  }
}

export function procurementDashboard(): ProcurementDashboard {
  const { purchaseOrders, requisitions, suppliers, rfqs, supplierInvoices, contracts } = dataset()
  const live = purchaseOrders.filter((p) => p.status !== 'Cancelled' && p.status !== 'Draft')

  const byMonth = groupSum(live, (p) => monthKey(p.date), (p) => p.amount)
  const countByMonth = new Map<string, number>()
  for (const p of live) countByMonth.set(monthKey(p.date), (countByMonth.get(monthKey(p.date)) ?? 0) + 1)

  const trend = trailingMonths().map(({ key, label }) => {
    const committed = Math.round(byMonth.get(key) ?? 0)
    return {
      key,
      month: label,
      committed,
      // The demo dataset has no per-line receipts; approximate from the
      // received percentage the orders carry.
      received: Math.round(
        live
          .filter((p) => monthKey(p.date) === key)
          .reduce((s, p) => s + (p.amount * Math.min(100, p.receivedPct)) / 100, 0),
      ),
      orders: countByMonth.get(key) ?? 0,
    }
  })

  const thisMonth = trend.at(-1)!
  const lastMonth = trend.at(-2)!
  const active = suppliers.filter((s) => s.status === 'Active')
  const awarded = rfqs.filter((r) => r.status === 'Awarded')
  const estimated = sumBy(awarded, (r) => r.estimatedValue)
  const savings = sumBy(awarded, (r) => Math.max(0, r.savings))
  const matched = supplierInvoices.filter((i) => i.matched === 'Matched').length
  const openReqs = requisitions.filter((r) => ['Submitted', 'For Approval', 'Approved'].includes(r.status))
  const openRfqs = rfqs.filter((r) => ['Open', 'Under Evaluation'].includes(r.status))
  const awaitingApproval = purchaseOrders.filter((p) => ['Draft', 'For Approval'].includes(p.status))
  const awaitingDelivery = purchaseOrders.filter((p) => ['Approved', 'Partial'].includes(p.status))
  const unpaid = supplierInvoices.filter((i) => !['Paid', 'Rejected'].includes(i.status))

  return {
    trend,
    categories: spendByCategory(),
    suppliers: topN(groupSum(live, (p) => p.supplier, (p) => p.amount), 8),
    pipeline: [
      { stage: 'Requisitions', count: openReqs.length, value: sumBy(openReqs, (r) => r.amount) },
      { stage: 'Out to tender', count: openRfqs.length, value: sumBy(openRfqs, (r) => r.estimatedValue) },
      { stage: 'Awaiting approval', count: awaitingApproval.length, value: sumBy(awaitingApproval, (p) => p.amount) },
      {
        stage: 'Awaiting delivery',
        count: awaitingDelivery.length,
        value: sumBy(awaitingDelivery, (p) => p.amount * (1 - Math.min(100, p.receivedPct) / 100)),
      },
    ],
    kpis: {
      spendMtd: thisMonth.committed,
      spendChange: lastMonth.committed
        ? ((thisMonth.committed - lastMonth.committed) / lastMonth.committed) * 100
        : 0,
      periodSpend: sumBy(trend, (t) => t.committed),
      ordersThisMonth: thisMonth.orders,
      avgOrderValue: live.length ? sumBy(live, (p) => p.amount) / live.length : 0,
      activeSuppliers: active.length,
      openRequisitions: openReqs.length,
      openRfqs: openRfqs.length,
      savings,
      savingsRate: estimated ? (savings / estimated) * 100 : 0,
      invoicesMatched: matched,
      matchRate: supplierInvoices.length ? (matched / supplierInvoices.length) * 100 : null,
      invoicesOverdue: supplierInvoices.filter((i) => i.status === 'Overdue').length,
      payablesOutstanding: sumBy(unpaid, (i) => i.amount),
      onTimeDelivery: avgRate(active) ?? null,
      contractsExpiring: contracts.filter((c) => c.status === 'Expiring').length,
    },
  }
}

/* ========================================================================== */
/* WAREHOUSE                                                                  */
/* ========================================================================== */

export function inventoryValueTrend() {
  const { stock } = dataset()
  const current = sumBy(stock, (s) => s.value)
  // Reconstructed backwards from today's balance with a stable seeded walk.
  const rng = new Rng(4711)
  const months = trailingMonths()
  const values: number[] = [current]
  for (let i = months.length - 2; i >= 0; i--) {
    values.unshift(Math.round(values[0]! / rng.float(0.97, 1.06)))
  }
  return months.map((m, i) => ({ month: m.label, value: values[i]!, turns: Number(rng.float(4.2, 7.4).toFixed(2)) }))
}

export function stockStatusMix() {
  const { stock } = dataset()
  const statuses = ['In Stock', 'Low Stock', 'Out of Stock', 'Expiring Soon', 'Overstock'] as const
  return statuses.map((status) => ({
    status,
    count: stock.filter((s) => s.status === status).length,
    value: sumBy(stock.filter((s) => s.status === status), (s) => s.value),
  }))
}

export function warehouseThroughput(days = 30) {
  const { inbound, outbound } = dataset()
  const rng = new Rng(9001)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return {
      day: `${d.getDate()}/${d.getMonth() + 1}`,
      inboundLines: Math.round(rng.gaussian(inbound.length * 2.4, 22, 24, 220)),
      outboundLines: Math.round(rng.gaussian(outbound.length * 2.1, 30, 30, 320)),
    }
  })
}

export function warehouseKpis() {
  const { stock, sites, cycleCounts, outbound, replenishment, items } = dataset()
  const totalValue = sumBy(stock, (s) => s.value)
  const posted = cycleCounts.filter((c) => c.status === 'Posted')

  return {
    inventoryValue: totalValue,
    skuCount: items.length,
    stockAccuracy: posted.length ? sumBy(posted, (c) => c.accuracy) / posted.length : 0,
    spaceUtilisation: (sumBy(sites, (s) => s.usedPallets) / sumBy(sites, (s) => s.capacityPallets)) * 100,
    lowStockSkus: stock.filter((s) => s.status === 'Low Stock' || s.status === 'Out of Stock').length,
    expiringValue: sumBy(stock.filter((s) => s.status === 'Expiring Soon'), (s) => s.value),
    openPickLists: outbound.filter((o) => ['Released', 'Picking'].includes(o.status)).length,
    criticalReplenishments: replenishment.filter((r) => r.urgency === 'Critical').length,
    inventoryTurns: 5.8,
    perfectOrderRate: 96.1,
  }
}

/**
 * The whole Warehouse dashboard in one payload.
 *
 * The live API returns exactly this shape from `GET warehouse/dashboard`,
 * computed from stock balances and the movement log. This is the preview twin.
 */
export type WarehouseDashboard = {
  throughput: { key: string; day: string; received: number; issued: number; movements: number }[]
  statusMix: { name: string; value: number }[]
  valueByCategory: { name: string; value: number }[]
  valueByWarehouse: {
    name: string
    code: string
    value: number
    skus: number
    bins: number
    capacityPallets: number
    usedPallets: number
    /** Null when capacity has not been recorded — not an empty warehouse. */
    utilisation: number | null
  }[]
  expiring: {
    sku: string
    name: string
    warehouse: string
    batch: string | null
    expiry: string | null
    daysLeft: number | null
    onHand: number
    value: number
  }[]
  kpis: {
    stockValue: number
    skusHeld: number
    unitsOnHand: number
    unitsReceived: number
    unitsIssued: number
    movements: number
    /** Null until there is stock to turn over. */
    inventoryTurns: number | null
    /** Null until a count has been posted. */
    countAccuracy: number | null
    countVariances: number
    countValueVariance: number
    openPicks: number
    expectedInbound: number
    transfersInTransit: number
    replenishmentLines: number
    replenishmentCritical: number
    expiringSoon: number
    activeSkus: number
  }
}

export function warehouseDashboard(): WarehouseDashboard {
  const { stock, sites, cycleCounts, outbound, inbound, transfers, replenishment, items } = dataset()
  const posted = cycleCounts.filter((c) => c.status === 'Posted')

  // The demo dataset has no movement log, so throughput is approximated from
  // the documents that would have produced one.
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (29 - i))
    return d
  })

  return {
    throughput: days.map((d) => ({
      key: d.toISOString().slice(0, 10),
      day: `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`,
      received: 0,
      issued: 0,
      movements: 0,
    })),
    statusMix: topN(
      groupSum(stock, (s) => s.status, () => 1),
      6,
    ),
    valueByCategory: topN(groupSum(stock, (s) => s.category, (s) => s.value), 8),
    valueByWarehouse: sites.map((s) => ({
      name: s.name,
      code: s.code,
      value: sumBy(stock.filter((row) => row.warehouse === s.name), (row) => row.value),
      skus: stock.filter((row) => row.warehouse === s.name).length,
      bins: s.bins,
      capacityPallets: s.capacityPallets,
      usedPallets: s.usedPallets,
      utilisation: s.capacityPallets > 0 ? (s.usedPallets / s.capacityPallets) * 100 : null,
    })),
    expiring: [],
    kpis: {
      stockValue: sumBy(stock, (s) => s.value),
      skusHeld: new Set(stock.map((s) => s.sku)).size,
      unitsOnHand: sumBy(stock, (s) => s.onHand),
      unitsReceived: 0,
      unitsIssued: 0,
      movements: 0,
      inventoryTurns: null,
      countAccuracy: posted.length ? sumBy(posted, (c) => c.accuracy) / posted.length : null,
      countVariances: posted.reduce((s, c) => s + c.variances, 0),
      countValueVariance: sumBy(posted, (c) => c.valueVariance),
      openPicks: outbound.filter((o) => ['Released', 'Picking', 'Packed', 'Staged'].includes(o.status)).length,
      expectedInbound: inbound.filter((i) => ['Expected', 'Receiving', 'In Inspection'].includes(i.status)).length,
      transfersInTransit: transfers.filter((t) => t.status === 'In Transit').length,
      replenishmentLines: replenishment.length,
      replenishmentCritical: replenishment.filter((r) => r.urgency === 'Critical').length,
      expiringSoon: stock.filter((s) => s.status === 'Expiring Soon').length,
      activeSkus: items.length,
    },
  }
}

/* ========================================================================== */
/* MAINTENANCE                                                                */
/* ========================================================================== */

/**
 * The whole Maintenance dashboard in one payload.
 *
 * The live API returns exactly this shape from `GET maintenance/dashboard`,
 * computed from work orders and the downtime log. This is the preview twin.
 */
export type MaintenanceDashboard = {
  trend: { key: string; month: string; downtimeHours: number; maintenanceCost: number; jobsCompleted: number }[]
  costByCategory: { name: string; value: number }[]
  statusMix: { name: string; value: number }[]
  worstAssets: {
    code: string
    name: string
    category: string
    jobs: number
    downtimeHours: number
    value: number
    /** Upkeep as a share of acquisition cost. Null when the cost is unknown. */
    costRatio: number | null
  }[]
  technicians: {
    id: number
    code: string
    name: string
    position: string | null
    openJobs: number
    completedJobs: number
    overdueJobs: number
    hoursLogged: number
    /** Null until this technician has finished something. */
    avgRepairHours: number | null
    availability: 'Available' | 'Busy' | 'Overloaded'
  }[]
  upcoming: {
    id: number
    code: string
    asset: string | null
    assetName: string | null
    task: string
    frequency: string
    due: string | null
    daysLeft: number | null
    assignedTo: string | null
    status: string
  }[]
  fleetAlerts: {
    plate: string
    code: string | null
    model: string | null
    kind: 'Registration' | 'Insurance'
    expires: string
    daysLeft: number
  }[]
  kpis: {
    /** Null when the register is empty — not a fleet that is 0% available. */
    assetUptime: number | null
    assetsInService: number
    openWorkOrders: number
    overdueWorkOrders: number
    criticalOpen: number
    /** Null until a preventive job has been finished. */
    pmCompliance: number | null
    pmSchedules: number
    overduePm: number
    duePm: number
    /** Null until a job has recorded any downtime. */
    mttrHours: number | null
    downtimeHours: number
    downtimeEvents: number
    downtimeCost: number
    maintenanceCost: number
    partsCost: number
    jobsCompleted: number
    breakdowns: number
    underMaintenance: number
    fleetSize: number
    vehiclesAvailable: number
    documentsExpiring: number
    flaggedFuel: number
    sparePartsShort: number
  }
}

export function maintenanceDashboard(): MaintenanceDashboard {
  const { assets, workOrders, pmSchedules, downtime, vehicles, employees } = dataset()
  const completed = workOrders.filter((w) => w.status === 'Completed')
  const open = workOrders.filter((w) => ['Open', 'Assigned', 'In Progress', 'On Hold'].includes(w.status))
  const inService = assets.filter((a) => a.status !== 'Retired')
  const trend = downtimeTrend()

  const categoryOf = new Map(assets.map((a) => [a.code, a.category]))
  const costOf = new Map(assets.map((a) => [a.code, a.acquisitionCost]))

  const byAsset = new Map<string, { jobs: number; hours: number; cost: number; name: string }>()
  for (const job of completed) {
    const entry = byAsset.get(job.asset) ?? { jobs: 0, hours: 0, cost: 0, name: job.assetName }
    entry.jobs++
    entry.hours += job.downtimeHours
    entry.cost += job.laborCost + job.partsCost
    byAsset.set(job.asset, entry)
  }

  return {
    trend: trend.map((t) => ({
      key: t.month,
      month: t.month,
      downtimeHours: t.downtimeHours,
      maintenanceCost: t.maintenanceCost,
      jobsCompleted: 0,
    })),
    costByCategory: maintenanceCostByCategory(),
    statusMix: [...new Map(inService.map((a) => [a.status, 0])).keys()].map((status) => ({
      name: status,
      value: inService.filter((a) => a.status === status).length,
    })),
    worstAssets: [...byAsset.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .slice(0, 8)
      .map(([code, v]) => ({
        code,
        name: `${code} — ${v.name}`,
        category: categoryOf.get(code) ?? 'Unassigned',
        jobs: v.jobs,
        downtimeHours: Math.round(v.hours * 10) / 10,
        value: Math.round(v.cost),
        costRatio: costOf.get(code) ? Math.round((v.cost / (costOf.get(code) as number)) * 1000) / 10 : null,
      })),
    technicians: employees
      .filter((e) => e.department === 'Maintenance' && e.status !== 'Resigned')
      .map((e, index) => {
        const jobs = workOrders.filter((w) => w.technician === e.name)
        const finished = jobs.filter((w) => w.status === 'Completed')
        const active = jobs.filter((w) => ['Open', 'Assigned', 'In Progress', 'On Hold'].includes(w.status))
        return {
          id: index + 1,
          code: e.id,
          name: e.name,
          position: e.position,
          openJobs: active.length,
          completedJobs: finished.length,
          overdueJobs: 0,
          hoursLogged: Math.round(sumBy(jobs, (w) => w.downtimeHours) * 10) / 10,
          avgRepairHours: finished.length
            ? Math.round((sumBy(finished, (w) => w.downtimeHours) / finished.length) * 10) / 10
            : null,
          availability: (active.length > 9 ? 'Overloaded' : active.length > 5 ? 'Busy' : 'Available') as
            | 'Available'
            | 'Busy'
            | 'Overloaded',
        }
      })
      .sort((a, b) => b.openJobs - a.openJobs),
    upcoming: pmSchedules
      .filter((p) => p.status === 'Overdue' || p.status === 'Due')
      .slice(0, 12)
      .map((p, index) => ({
        id: index + 1,
        code: p.code,
        asset: p.asset,
        assetName: p.assetName,
        task: p.task,
        frequency: p.frequency,
        due: p.nextDue,
        daysLeft: Math.round((new Date(p.nextDue).getTime() - Date.now()) / 86_400_000),
        assignedTo: p.assignedTo,
        status: p.status,
      })),
    fleetAlerts: vehicles
      .flatMap((v) =>
        (
          [
            ['Registration', v.registrationExpiry],
            ['Insurance', v.insuranceExpiry],
          ] as const
        ).map(([kind, date]) => ({
          plate: v.plate,
          code: v.code,
          model: v.model,
          kind,
          expires: date,
          daysLeft: Math.round((new Date(date).getTime() - Date.now()) / 86_400_000),
        })),
      )
      .filter((a) => a.daysLeft <= 60)
      .sort((a, b) => a.daysLeft - b.daysLeft),
    kpis: {
      assetUptime: inService.length
        ? Math.round((inService.filter((a) => a.status === 'Operational').length / inService.length) * 1000) / 10
        : null,
      assetsInService: inService.length,
      openWorkOrders: open.length,
      overdueWorkOrders: open.filter((w) => new Date(w.due).getTime() < Date.now()).length,
      criticalOpen: open.filter((w) => w.priority === 'Critical' || w.priority === 'High').length,
      pmCompliance: pmSchedules.length ? Math.round(sumBy(pmSchedules, (p) => p.compliance) / pmSchedules.length) : null,
      pmSchedules: pmSchedules.filter((p) => p.status !== 'Inactive' && p.status !== 'Completed').length,
      overduePm: pmSchedules.filter((p) => p.status === 'Overdue').length,
      duePm: pmSchedules.filter((p) => p.status === 'Due').length,
      mttrHours: completed.length
        ? Math.round((sumBy(completed, (w) => w.downtimeHours) / completed.length) * 10) / 10
        : null,
      downtimeHours: Math.round(sumBy(downtime, (d) => d.hours)),
      downtimeEvents: downtime.length,
      downtimeCost: Math.round(sumBy(downtime, (d) => d.costImpact)),
      maintenanceCost: Math.round(sumBy(completed, (w) => w.laborCost + w.partsCost)),
      partsCost: Math.round(sumBy(completed, (w) => w.partsCost)),
      jobsCompleted: completed.length,
      breakdowns: inService.filter((a) => a.status === 'Breakdown').length,
      underMaintenance: inService.filter((a) => a.status === 'Under Maintenance').length,
      fleetSize: vehicles.length,
      vehiclesAvailable: vehicles.filter((v) => v.status === 'Available' || v.status === 'On Trip').length,
      documentsExpiring: vehicles.filter(
        (v) => new Date(v.registrationExpiry).getTime() - Date.now() < 60 * 86_400_000,
      ).length,
      flaggedFuel: dataset().fuelLogs.filter((f) => f.flagged).length,
      sparePartsShort: 0,
    },
  }
}

export function downtimeTrend() {
  const { downtime, workOrders } = dataset()
  const hoursByMonth = groupSum(downtime, (d) => monthKey(d.date), (d) => d.hours)
  const costByMonth = groupSum(
    workOrders.filter((w) => w.status === 'Completed'),
    (w) => monthKey(w.reported),
    (w) => w.laborCost + w.partsCost,
  )
  return trailingMonths().map(({ key, label }) => ({
    month: label,
    downtimeHours: Math.round(hoursByMonth.get(key) ?? 0),
    maintenanceCost: Math.round(costByMonth.get(key) ?? 0),
  }))
}

export function maintenanceCostByCategory() {
  const { workOrders, assets } = dataset()
  const categoryOf = new Map(assets.map((a) => [a.code, a.category]))
  return topN(
    groupSum(
      workOrders.filter((w) => w.status === 'Completed'),
      (w) => categoryOf.get(w.asset) ?? 'Other',
      (w) => w.laborCost + w.partsCost,
    ),
    8,
  )
}

export function maintenanceKpis() {
  const { assets, workOrders, pmSchedules, downtime, vehicles } = dataset()
  const completed = workOrders.filter((w) => w.status === 'Completed')
  const operational = assets.filter((a) => a.status === 'Operational').length
  const inService = assets.filter((a) => a.status !== 'Retired').length

  return {
    assetUptime: inService ? (operational / inService) * 100 : 0,
    openWorkOrders: workOrders.filter((w) => ['Open', 'Assigned', 'In Progress'].includes(w.status)).length,
    overduePm: pmSchedules.filter((p) => p.status === 'Overdue').length,
    pmCompliance: pmSchedules.length ? sumBy(pmSchedules, (p) => p.compliance) / pmSchedules.length : 0,
    mttrHours: completed.length ? sumBy(completed, (w) => w.downtimeHours) / completed.length : 0,
    downtimeHoursYtd: sumBy(downtime, (d) => d.hours),
    maintenanceCostYtd: sumBy(completed, (w) => w.laborCost + w.partsCost),
    breakdowns: assets.filter((a) => a.status === 'Breakdown').length,
    vehiclesAvailable: vehicles.filter((v) => v.status === 'Available' || v.status === 'On Trip').length,
    fleetSize: vehicles.length,
  }
}

/* ========================================================================== */
/* FINANCE                                                                    */
/* ========================================================================== */

export function cashflowTrend() {
  const { arInvoices, apBills } = dataset()
  const inflow = groupSum(arInvoices.filter((i) => i.paid > 0), (i) => monthKey(i.date), (i) => i.paid)
  const outflow = groupSum(apBills.filter((b) => b.paid > 0), (b) => monthKey(b.date), (b) => b.paid)

  let running = 12_400_000
  return trailingMonths().map(({ key, label }) => {
    const inflowValue = Math.round(inflow.get(key) ?? 0)
    const outflowValue = Math.round(outflow.get(key) ?? 0)
    running += inflowValue - outflowValue
    return { month: label, inflow: inflowValue, outflow: outflowValue, net: inflowValue - outflowValue, balance: running }
  })
}

export function profitTrend() {
  const revenue = revenueTrend()
  const rng = new Rng(3301)
  return revenue.map((r) => {
    const opex = Math.round(r.revenue * rng.float(0.11, 0.19))
    return {
      month: r.month,
      revenue: r.revenue,
      cogs: r.cost,
      opex,
      netProfit: r.grossProfit - opex,
      marginPct: r.revenue ? Number((((r.grossProfit - opex) / r.revenue) * 100).toFixed(1)) : 0,
    }
  })
}

export function financeKpis() {
  const { arInvoices, apBills, bankAccounts, taxFilings, expenses } = dataset()
  const profit = profitTrend()
  const thisMonth = profit.at(-1)!
  const receivables = sumBy(arInvoices.filter((i) => i.balance > 0), (i) => i.balance)
  const payables = sumBy(apBills.filter((b) => b.balance > 0), (b) => b.balance)

  return {
    cashPosition: sumBy(bankAccounts, (b) => b.balance),
    revenueMtd: thisMonth.revenue,
    netProfitMtd: thisMonth.netProfit,
    netMargin: thisMonth.marginPct,
    receivables,
    overdueReceivables: sumBy(arInvoices.filter((i) => i.daysOverdue > 0), (i) => i.balance),
    payables,
    payablesDueSoon: sumBy(apBills.filter((b) => b.balance > 0 && b.daysToDue >= 0 && b.daysToDue <= 14), (b) => b.balance),
    dso: 42,
    dpo: 38,
    pendingExpenses: expenses.filter((e) => ['Submitted', 'For Approval'].includes(e.status)).length,
    taxDueSoon: taxFilings.filter((t) => ['Not Started', 'In Preparation', 'For Review'].includes(t.status)).length,
  }
}

/**
 * The whole Finance dashboard in one payload.
 *
 * The live API returns exactly this shape from `GET finance/dashboard`,
 * computed from the general ledger and the AR/AP sub-ledgers. This is the
 * preview twin.
 */
export type FinanceDashboard = {
  trend: {
    key: string
    month: string
    revenue: number
    cogs: number
    expenses: number
    grossProfit: number
    netProfit: number
  }[]
  cashByAccount: {
    name: string
    bank: string
    type: string
    value: number
    unreconciled: number
    lastReconciled: string | null
  }[]
  receivableAgeing: { name: string; value: number; documents: number }[]
  payableAgeing: { name: string; value: number; documents: number }[]
  expenseByCategory: { name: string; value: number }[]
  topDebtors: { name: string; value: number; invoices: number; oldestDays: number }[]
  upcomingObligations: {
    kind: 'Bill' | 'Tax'
    label: string
    party: string | null
    due: string | null
    daysToDue: number
    amount: number
  }[]
  kpis: {
    cashPosition: number
    bankAccounts: number
    unreconciled: number
    receivables: number
    receivablesOverdue: number
    receivablesCount: number
    overdueInvoices: number
    payables: number
    payablesOverdue: number
    payablesCount: number
    dueThisWeek: number
    revenue: number
    grossProfit: number
    netProfit: number
    /** Null until there is revenue to take a margin on. */
    grossMarginPct: number | null
    netMarginPct: number | null
    opex: number
    totalAssets: number
    totalLiabilities: number
    totalEquity: number
    /** False means the ledger has a problem the statements should not hide. */
    balanceSheetBalanced: boolean
    workingCapital: number
    daysSalesOutstanding: number | null
    draftJournals: number
    postedJournals: number
    trialBalanced: boolean
    trialDifference: number
    expenseClaims: number
    expenseClaimsValue: number
    fixedAssetsNbv: number
    depreciationDue: number
    taxDue: number
    taxOverdue: number
  }
}

export function financeDashboard(): FinanceDashboard {
  const { arInvoices, apBills, bankAccounts, taxFilings, expenses, accounts } = dataset()
  const profit = profitTrend()
  const open = arInvoices.filter((i) => i.balance > 0)
  const openBills = apBills.filter((b) => b.balance > 0)

  const bucketOf = (rows: { bucket: string; balance: number }[]) => {
    const order = ['Current', '1-30', '31-60', '61-90', '90+']
    return order
      .map((name) => {
        const matching = rows.filter((r) => r.bucket === name)
        return { name, value: sumBy(matching, (r) => r.balance), documents: matching.length }
      })
      .filter((b) => b.documents > 0)
  }

  const revenue = sumBy(profit, (p) => p.revenue)
  const cogs = sumBy(profit, (p) => p.cogs)
  const opex = sumBy(profit, (p) => p.opex)
  const balanceOf = (code: string) => accounts.find((a) => a.code === code)?.balance ?? 0

  return {
    trend: profit.map((p, i) => ({
      key: String(i),
      month: p.month,
      revenue: p.revenue,
      cogs: p.cogs,
      expenses: p.opex,
      grossProfit: p.revenue - p.cogs,
      netProfit: p.netProfit,
    })),
    cashByAccount: bankAccounts.map((b) => ({
      name: b.name,
      bank: b.bank,
      type: b.type,
      value: b.balance,
      unreconciled: b.unreconciled,
      lastReconciled: b.lastReconciled ?? null,
    })),
    receivableAgeing: bucketOf(open),
    payableAgeing: bucketOf(openBills),
    expenseByCategory: topN(
      groupSum(
        expenses.filter((e) => ['Approved', 'Liquidated'].includes(e.status)),
        (e) => e.category,
        (e) => e.amount,
      ),
      8,
    ),
    topDebtors: [],
    upcomingObligations: [],
    kpis: {
      cashPosition: sumBy(bankAccounts, (b) => b.balance),
      bankAccounts: bankAccounts.length,
      unreconciled: bankAccounts.reduce((s, b) => s + b.unreconciled, 0),
      receivables: sumBy(open, (i) => i.balance),
      receivablesOverdue: sumBy(open.filter((i) => i.daysOverdue > 0), (i) => i.balance),
      receivablesCount: open.length,
      overdueInvoices: open.filter((i) => i.daysOverdue > 0).length,
      payables: sumBy(openBills, (b) => b.balance),
      payablesOverdue: sumBy(openBills.filter((b) => b.daysToDue < 0), (b) => b.balance),
      payablesCount: openBills.length,
      dueThisWeek: sumBy(openBills.filter((b) => b.daysToDue >= 0 && b.daysToDue <= 7), (b) => b.balance),
      revenue,
      grossProfit: revenue - cogs,
      netProfit: sumBy(profit, (p) => p.netProfit),
      grossMarginPct: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null,
      netMarginPct: revenue > 0 ? Math.round((sumBy(profit, (p) => p.netProfit) / revenue) * 1000) / 10 : null,
      opex,
      totalAssets: balanceOf('1000'),
      totalLiabilities: balanceOf('2000'),
      totalEquity: balanceOf('3000'),
      balanceSheetBalanced: true,
      workingCapital: sumBy(open, (i) => i.balance) + sumBy(bankAccounts, (b) => b.balance) - sumBy(openBills, (b) => b.balance),
      daysSalesOutstanding: 42,
      draftJournals: 0,
      postedJournals: 0,
      trialBalanced: true,
      trialDifference: 0,
      expenseClaims: expenses.filter((e) => ['Submitted', 'For Approval'].includes(e.status)).length,
      expenseClaimsValue: sumBy(
        expenses.filter((e) => ['Submitted', 'For Approval'].includes(e.status)),
        (e) => e.amount,
      ),
      fixedAssetsNbv: 0,
      depreciationDue: 0,
      taxDue: sumBy(
        taxFilings.filter((t) => !['Filed', 'Paid'].includes(t.status)),
        (t) => t.taxDue,
      ),
      taxOverdue: taxFilings.filter((t) => t.status === 'Overdue').length,
    },
  }
}

/** One line of a rendered statement. */
export type StatementLine = { label: string; amount: number; level: 0 | 1 | 2; emphasis?: boolean }

/** The three statements, exactly as `GET finance/statements` returns them. */
export type FinancialStatements = {
  profitAndLoss: {
    title: string
    from: string
    to: string
    lines: StatementLine[]
    totals: {
      revenue: number
      cogs: number
      grossProfit: number
      opex: number
      netProfit: number
      grossMarginPct: number | null
      netMarginPct: number | null
    }
  }
  balanceSheet: {
    title: string
    asAt: string
    lines: StatementLine[]
    totals: { assets: number; liabilities: number; equity: number; difference: number; balanced: boolean }
  }
  cashFlow: {
    title: string
    from: string
    to: string
    lines: StatementLine[]
    totals: {
      operating: number
      investing: number
      financing: number
      netMovement: number
      opening: number
      closing: number
    }
  }
}

/**
 * Preview twin of the statements.
 *
 * Deliberately thin: on preview data there is no ledger, and the previous
 * version of this screen filled the gap with invented percentages. An empty
 * statement is the honest answer to "what has been posted?" when nothing has.
 */
export function financialStatements(): FinancialStatements {
  const today = new Date().toISOString().slice(0, 10)
  const empty = (label: string): StatementLine[] => [
    { label, amount: 0, level: 0 },
    { label: 'Nothing posted to the ledger yet', amount: 0, level: 2 },
  ]

  return {
    profitAndLoss: {
      title: 'Statement of Comprehensive Income',
      from: today,
      to: today,
      lines: empty('Revenue'),
      totals: {
        revenue: 0, cogs: 0, grossProfit: 0, opex: 0, netProfit: 0,
        grossMarginPct: null, netMarginPct: null,
      },
    },
    balanceSheet: {
      title: 'Statement of Financial Position',
      asAt: today,
      lines: empty('Assets'),
      totals: { assets: 0, liabilities: 0, equity: 0, difference: 0, balanced: true },
    },
    cashFlow: {
      title: 'Statement of Cash Flows',
      from: today,
      to: today,
      lines: empty('Operating activities'),
      totals: { operating: 0, investing: 0, financing: 0, netMovement: 0, opening: 0, closing: 0 },
    },
  }
}

/* ========================================================================== */
/* HR                                                                         */
/* ========================================================================== */

export function headcountTrend() {
  const { employees } = dataset()
  const months = trailingMonths()
  return months.map(({ label, date }) => {
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0)
    const headcount = employees.filter((e) => new Date(e.dateHired) <= endOfMonth && e.status !== 'Resigned').length
    return { month: label, headcount, hires: 0, exits: 0 }
  }).map((row, i, all) => ({
    ...row,
    hires: i === 0 ? 0 : Math.max(0, row.headcount - all[i - 1]!.headcount),
  }))
}

export function headcountByDepartment() {
  const { employees } = dataset()
  const map = new Map<string, number>()
  for (const e of employees) {
    if (e.status === 'Resigned') continue
    map.set(e.department, (map.get(e.department) ?? 0) + 1)
  }
  return topN(map, 8)
}

export function attendanceTrend() {
  const { attendance } = dataset()
  const byDate = new Map<string, { present: number; total: number; late: number }>()
  for (const row of attendance) {
    if (row.status === 'Rest Day' || row.status === 'Holiday') continue
    const key = row.date.slice(0, 10)
    const bucket = byDate.get(key) ?? { present: 0, total: 0, late: 0 }
    bucket.total++
    if (row.status === 'Present' || row.status === 'Late') bucket.present++
    if (row.status === 'Late') bucket.late++
    byDate.set(key, bucket)
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, b]) => ({
      day: `${new Date(date).getDate()}/${new Date(date).getMonth() + 1}`,
      attendanceRate: Number(((b.present / b.total) * 100).toFixed(1)),
      lateRate: Number(((b.late / b.total) * 100).toFixed(1)),
    }))
}

export function hrKpis() {
  const { employees, leaves, applicants, payrollRuns, training, positions } = dataset()
  const active = employees.filter((e) => e.status !== 'Resigned')
  const resigned = employees.filter((e) => e.status === 'Resigned')
  const attendance = attendanceTrend()

  return {
    headcount: active.length,
    attritionRate: employees.length ? (resigned.length / employees.length) * 100 : 0,
    openPositions: sumBy(positions, (p) => p.vacant),
    pendingLeaves: leaves.filter((l) => l.status === 'For Approval').length,
    onLeaveToday: employees.filter((e) => e.status === 'On Leave').length,
    activeApplicants: applicants.filter((a) => !['Hired', 'Rejected'].includes(a.stage)).length,
    payrollCost: payrollRuns[0]?.grossPay ?? 0,
    avgAttendance: attendance.length ? sumBy(attendance, (a) => a.attendanceRate) / attendance.length : 0,
    expiringCerts: training.filter((t) => t.status === 'Expiring Soon' || t.status === 'Expired').length,
    avgTenureYears:
      active.length
        ? sumBy(active, (e) => (Date.now() - new Date(e.dateHired).getTime()) / (365 * 86_400_000)) / active.length
        : 0,
  }
}

/* ========================================================================== */
/* EXECUTIVE                                                                  */
/* ========================================================================== */

export function executiveKpis() {
  const sales = salesKpis()
  const finance = financeKpis()
  const warehouse = warehouseKpis()
  const hr = hrKpis()
  const procurement = procurementKpis()
  const maintenance = maintenanceKpis()
  return { sales, finance, warehouse, hr, procurement, maintenance }
}

/** Cross-department health, used by the executive scorecard. */
export function departmentScorecard() {
  const { sales, finance, warehouse, hr, procurement, maintenance } = executiveKpis()
  return [
    { department: 'Sales & Marketing', id: 'sales', metric: 'Gross margin', value: sales.grossMargin, target: 22, unit: '%', slot: 1 },
    { department: 'Procurement', id: 'procurement', metric: 'Supplier on-time', value: procurement.avgOnTime, target: 92, unit: '%', slot: 2 },
    { department: 'Warehouse', id: 'warehouse', metric: 'Stock accuracy', value: warehouse.stockAccuracy, target: 98, unit: '%', slot: 3 },
    { department: 'Maintenance', id: 'maintenance', metric: 'Asset uptime', value: maintenance.assetUptime, target: 95, unit: '%', slot: 4 },
    { department: 'Finance', id: 'finance', metric: 'Net margin', value: finance.netMargin, target: 8, unit: '%', slot: 7 },
    { department: 'Human Resources', id: 'hr', metric: 'Attendance rate', value: hr.avgAttendance, target: 95, unit: '%', slot: 5 },
  ]
}
