import { Rng } from './seed'
import {
  buildAssets,
  buildCustomers,
  buildEmployees,
  buildItems,
  buildSuppliers,
  buildWarehouses,
  DEPARTMENT_NAMES,
} from './master'
import {
  buildCampaigns,
  buildContracts,
  buildCycleCounts,
  buildDeliveries,
  buildDowntime,
  buildFuelLogs,
  buildGoodsReceipts,
  buildInbound,
  buildLeads,
  buildOutbound,
  buildPmSchedules,
  buildPriceRows,
  buildPurchaseOrders,
  buildQuotations,
  buildReplenishment,
  buildRequisitions,
  buildReturns,
  buildRfqs,
  buildSalesOrders,
  buildStock,
  buildSupplierInvoices,
  buildTargets,
  buildTransfers,
  buildVehicles,
  buildWorkOrders,
} from './transactions'
import {
  buildAccounts,
  buildApBills,
  buildArInvoices,
  buildBankAccounts,
  buildBudgets,
  buildExpenses,
  buildFixedAssets,
  buildJournals,
  buildTaxFilings,
} from './finance'
import {
  buildMasterfile,
  buildPayslips,
  buildPeriods,
  summariseRun,
  PAYROLL_GROUPS,
} from './payroll'
import {
  buildApplicants,
  buildAttendance,
  buildCases,
  buildLeaves,
  buildPayrollRuns,
  buildPositions,
  buildReviews,
  buildTraining,
} from './hr'

const SEED = 20260728

function build() {
  const rng = new Rng(SEED)

  /* ---- Master data ---- */
  const sites = buildWarehouses(rng)
  const items = buildItems(rng)
  const suppliers = buildSuppliers(rng)
  const employees = buildEmployees(rng, sites)

  // Wire each SKU to a real supplier so procurement and warehouse agree.
  for (const item of items) item.primarySupplier = rng.pick(suppliers).name

  const staffIn = (dept: string, match?: RegExp) =>
    employees
      .filter((e) => e.department === dept && e.status !== 'Resigned' && (!match || match.test(e.position)))
      .map((e) => e.name)

  const salesReps = staffIn('Sales & Marketing', /Account Executive|Key Accounts|Sales Supervisor/)
  const buyers = staffIn('Procurement')
  const whStaff = staffIn('Warehouse')
  const drivers = whStaff.length ? whStaff : ['Ramon Cruz']
  const technicians = staffIn('Maintenance')
  const accountants = staffIn('Finance & Accounting')
  const hrStaff = staffIn('Human Resources')

  const assets = buildAssets(rng, sites, technicians.length ? technicians : ['Unassigned'])

  /* ---- Sales & Marketing ---- */
  const customers = buildCustomers(rng, salesReps)
  const leads = buildLeads(rng, salesReps)
  const quotations = buildQuotations(rng, customers)
  const salesOrders = buildSalesOrders(rng, customers, sites)
  const deliveries = buildDeliveries(rng, salesOrders, assets, drivers)
  const returns = buildReturns(rng, customers)
  const campaigns = buildCampaigns(rng, salesReps)
  const targets = buildTargets(rng, salesReps)
  const priceRows = buildPriceRows(rng, items)

  /* ---- Procurement ---- */
  const requisitions = buildRequisitions(rng, employees)
  const rfqs = buildRfqs(rng, buyers)
  const purchaseOrders = buildPurchaseOrders(rng, suppliers, buyers)
  const goodsReceipts = buildGoodsReceipts(rng, purchaseOrders, sites, whStaff)
  const supplierInvoices = buildSupplierInvoices(rng, purchaseOrders)
  const contracts = buildContracts(rng, suppliers, buyers)

  /* ---- Warehouse ---- */
  const stock = buildStock(rng, items, sites)
  const inbound = buildInbound(rng, purchaseOrders, sites)
  const outbound = buildOutbound(rng, salesOrders, whStaff)
  const transfers = buildTransfers(rng, sites)
  const cycleCounts = buildCycleCounts(rng, sites, whStaff)
  const replenishment = buildReplenishment(rng, items, sites)

  /* ---- Maintenance ---- */
  const workOrders = buildWorkOrders(rng, assets, technicians)
  const pmSchedules = buildPmSchedules(rng, assets, technicians)
  const vehicles = buildVehicles(rng, assets, drivers)
  const fuelLogs = buildFuelLogs(rng, vehicles)
  const downtime = buildDowntime(rng, assets)

  /* ---- Finance ---- */
  const accounts = buildAccounts(rng)
  const journals = buildJournals(rng, accountants)
  const arInvoices = buildArInvoices(rng, salesOrders, accountants)
  const apBills = buildApBills(rng, supplierInvoices)
  const bankAccounts = buildBankAccounts(rng)
  const expenses = buildExpenses(rng, employees)
  const fixedAssets = buildFixedAssets(rng)
  const taxFilings = buildTaxFilings(rng)
  const budgets = buildBudgets(rng, DEPARTMENT_NAMES.filter((d) => d !== 'Executive'))

  /* ---- HR ---- */
  const attendance = buildAttendance(rng, employees)
  const leaves = buildLeaves(rng, employees)
  const legacyPayrollRuns = buildPayrollRuns(rng, employees, hrStaff)
  const applicants = buildApplicants(rng, hrStaff)
  const reviews = buildReviews(rng, employees)
  const training = buildTraining(rng, employees)
  const cases = buildCases(rng, employees, hrStaff)
  const positions = buildPositions(employees)

  /* ---- Payroll (AUB masterfile shape, computed by the payroll engine) ---- */
  const masterfile = buildMasterfile(rng)
  const payrollPeriods = buildPeriods(12)
  const preparer = hrStaff[0] ?? 'HR Payroll Officer'

  // Payslips are computed for the three most recent cutoffs; older periods keep
  // only their run summary, which is all the archive views need.
  const recentPeriods = payrollPeriods.slice(-3)
  const payslips = recentPeriods.flatMap((period) => buildPayslips(rng, period, masterfile))

  const payrollRuns = payrollPeriods.flatMap((period, i) => {
    const slips = recentPeriods.includes(period)
      ? payslips.filter((p) => p.periodId === period.id)
      : buildPayslips(rng, period, masterfile)
    return PAYROLL_GROUPS.map((group, g) => summariseRun(period, slips, group, preparer, i * 10 + g)).filter(
      (run) => run.headcount > 0,
    )
  })

  return {
    masterfile,
    payrollPeriods,
    payslips,
    legacyPayrollRuns,
    sites,
    items,
    suppliers,
    employees,
    assets,
    customers,
    leads,
    quotations,
    salesOrders,
    deliveries,
    returns,
    campaigns,
    targets,
    priceRows,
    requisitions,
    rfqs,
    purchaseOrders,
    goodsReceipts,
    supplierInvoices,
    contracts,
    stock,
    inbound,
    outbound,
    transfers,
    cycleCounts,
    replenishment,
    workOrders,
    pmSchedules,
    vehicles,
    fuelLogs,
    downtime,
    accounts,
    journals,
    arInvoices,
    apBills,
    bankAccounts,
    expenses,
    fixedAssets,
    taxFilings,
    budgets,
    attendance,
    leaves,
    payrollRuns,
    applicants,
    reviews,
    training,
    cases,
    positions,
  }
}

export type Dataset = ReturnType<typeof build>

let cache: Dataset | null = null

/**
 * The whole preview dataset, generated once per browser session.
 *
 * When the Laravel backend lands this function disappears — each `useResource`
 * hook swaps its mock source for the matching API endpoint.
 */
export function dataset(): Dataset {
  cache ??= build()
  return cache
}
