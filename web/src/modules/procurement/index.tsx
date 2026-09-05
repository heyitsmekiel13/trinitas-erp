import * as React from 'react'
import { Building2, ClipboardCheck, FileSignature, Percent, PiggyBank, Star, TrendingDown, Truck } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { daysUntil, moneyCompact, num, percent } from '@/lib/format'
import type {
  Bid,
  Contract,
  GoodsReceipt,
  PurchaseOrder,
  Requisition,
  Rfq,
  SupplierInvoice,
} from '@/data/transactions'
import type { Supplier } from '@/data/master'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { ResourcePage } from '@/components/data/ResourcePage'
import { Dashboard } from './dashboard'
import { SupplierDetail } from './SupplierDetail'
import {
  AwardRfq,
  EvaluateSupplier,
  EvaluateSuppliers,
  MatchInvoice,
  RequisitionToOrder,
  RequisitionToRfq,
} from './actions'
import { ScorecardDetail } from './ScorecardDetail'
import * as forms from './forms'
import { cols } from '@/components/data/columns'

/* ========================================================================== */

/* ========================================================================== */
/* List modules                                                               */
/* ========================================================================== */

function Suppliers() {
  const c = cols<Supplier>()
  return (
    <ResourcePage
      title="Suppliers"
      description="Vendor master with accreditation, payment terms and rolling performance scores."
      endpoint="procurement/suppliers"
      loader={() => dataset().suppliers}
      exportName="suppliers"
      createLabel="New supplier"
      formFields={forms.supplierFields}
      formDefaults={forms.supplierDefaults}
      formTitle="supplier"
      filters={[
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
        { columnId: 'terms', label: 'Terms' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile
            label="Suppliers"
            value={num(rows.length)}
            icon={Building2}
            hint={`${num(rows.filter((r) => r.status === 'Active').length)} active`}
          />
          <StatTile label="YTD spend" value={moneyCompact(rows.reduce((s, r) => s + r.ytdSpend, 0))} icon={PiggyBank} />
          <StatTile
            label="Average scorecard"
            value={
              rows.filter((r) => r.scorecard !== null).length
                ? num(
                    rows.reduce((s, r) => s + (r.scorecard ?? 0), 0) /
                      rows.filter((r) => r.scorecard !== null).length,
                    1,
                  )
                : '—'
            }
            icon={Star}
            hint="Out of 100"
          />
          <StatTile
            label="Probationary or blacklisted"
            value={num(rows.filter((r) => r.status !== 'Active').length)}
            icon={Percent}
          />
        </StatGrid>
      )}
      detailSize="xl"
      renderDetail={(row) => <SupplierDetail row={row} />}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) => `${row.code}${row.category ? ` · ${row.category}` : ''}`}
      columns={[
        c.primary('name', 'Supplier', (row) => `${row.code} · ${row.city}`),
        c.tag('category', 'Category', 'info'),
        c.text('contact', 'Contact', { secondary: true }),
        c.text('terms', 'Terms', { secondary: true }),
        c.money('ytdSpend', 'YTD spend', { compact: true, bold: true }),
        c.number('openPo', 'Open POs'),
        c.percent('onTimeRate', 'On-time', { warnBelow: 85 }),
        c.percent('qualityRate', 'Quality', { warnBelow: 90 }),
        c.number('scorecard', 'Score'),
        c.date('accreditedUntil', 'Accredited to', { secondary: true, overdueWhenPast: true }),
        c.status(),
      ]}
    />
  )
}

function Requisitions() {
  const c = cols<Requisition>()
  return (
    <ResourcePage
      title="Purchase Requisitions"
      description="Internal requests for goods and services, with budget availability checked before approval."
      endpoint="procurement/requisitions"
      loader={() => dataset().requisitions}
      exportName="requisitions"
      createLabel="New requisition"
      formFields={forms.requisitionFields}
      formDefaults={forms.requisitionDefaults}
      formLines={{ itemsEndpoint: 'warehouse/items', priceField: 'unitCost' }}
      formTitle="requisition"
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'department', label: 'Department' },
      ]}
      stats={(rows) => (
        <StatGrid>
          <StatTile
            label="Awaiting approval"
            value={num(rows.filter((r) => ['Submitted', 'For Approval'].includes(r.status)).length)}
            icon={ClipboardCheck}
          />
          <StatTile
            label="Approved, not yet ordered"
            value={num(rows.filter((r) => r.status === 'Approved').length)}
            icon={FileSignature}
            hint="Ready to tender or order"
          />
          <StatTile label="Value requested" value={moneyCompact(rows.reduce((s, r) => s + r.amount, 0))} icon={PiggyBank} />
          <StatTile
            label="Needed within 14 days"
            value={num(rows.filter((r) => r.needBy && daysUntil(r.needBy) >= 0 && daysUntil(r.needBy) <= 14 && r.status !== 'Converted').length)}
            icon={Truck}
          />
        </StatGrid>
      )}
      detailActions={(row, done) => (
        <>
          <RequisitionToRfq row={row} done={done} />
          <RequisitionToOrder row={row} done={done} />
        </>
      )}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.title}
      columns={[
        c.primary('no', 'Requisition', (row) => row.title),
        c.text('requester', 'Requester'),
        c.text('department', 'Department', { secondary: true }),
        c.date('date', 'Raised'),
        c.date('needBy', 'Needed by', { overdueWhenPast: true }),
        c.number('lines', 'Lines', { secondary: true }),
        c.money('amount', 'Amount', { bold: true }),
        c.money('budgetLeft', 'Budget left', { compact: true, secondary: true }),
        c.status(),
      ]}
    />
  )
}

function RfqPage() {
  const c = cols<Rfq>()
  return (
    <ResourcePage
      title="RFQ & Bid Analysis"
      description="Quote solicitations with response rate and the saving achieved against the estimate."
      endpoint="procurement/rfqs"
      loader={() => dataset().rfqs}
      exportName="rfqs"
      createLabel="New RFQ"
      formFields={forms.rfqFields}
      formDefaults={forms.rfqDefaults}
      formTitle="RFQ"
      filters={[{ columnId: 'status', label: 'Status' }]}
      stats={(rows) => {
        const awarded = rows.filter((r) => r.status === 'Awarded')
        const estimated = awarded.reduce((s, r) => s + r.estimatedValue, 0)
        const savings = awarded.reduce((s, r) => s + Math.max(0, r.savings), 0)
        return (
          <StatGrid>
            <StatTile
              label="Out to tender"
              value={num(rows.filter((r) => ['Open', 'Under Evaluation'].includes(r.status)).length)}
              icon={ClipboardCheck}
            />
            <StatTile label="Value at tender" value={moneyCompact(rows.reduce((s, r) => s + r.estimatedValue, 0))} icon={PiggyBank} />
            <StatTile
              label="Savings achieved"
              value={moneyCompact(savings)}
              icon={TrendingDown}
              hint={estimated ? `${percent((savings / estimated) * 100)} below estimate` : 'No awards yet'}
            />
            <StatTile
              label="Closing within 7 days"
              value={num(rows.filter((r) => r.closes && daysUntil(r.closes) >= 0 && daysUntil(r.closes) <= 7).length)}
              icon={Truck}
            />
          </StatGrid>
        )
      }}
      detailActions={(row, done) => <AwardRfq row={row} done={done} />}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.title}
      columns={[
        c.primary('no', 'RFQ', (row) => row.title),
        c.text('buyer', 'Buyer', { secondary: true }),
        c.date('issued', 'Issued'),
        c.date('closes', 'Closes', { overdueWhenPast: true }),
        c.number('invited', 'Invited', { secondary: true }),
        c.number('responses', 'Responses'),
        c.money('estimatedValue', 'Estimate', { compact: true }),
        c.money('bestBid', 'Best bid', { compact: true, bold: true }),
        c.text('awardedSupplier', 'Awarded to', { secondary: true }),
        c.money('savings', 'Saving', { compact: true }),
        c.status(),
      ]}
    />
  )
}

function Orders() {
  const c = cols<PurchaseOrder>()
  return (
    <ResourcePage
      title="Purchase Orders"
      description="Committed orders to suppliers, their delivery schedule and receiving progress."
      endpoint="procurement/orders"
      loader={() => dataset().purchaseOrders}
      exportName="purchase-orders"
      createLabel="New PO"
      formFields={forms.purchaseOrderFields}
      formDefaults={forms.purchaseOrderDefaults}
      formTitle="purchase order"
      formLines={{ itemsEndpoint: 'warehouse/items', priceField: 'unitCost' }}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'category', label: 'Category' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.supplier}
      columns={[
        c.primary('no', 'Purchase order', (row) => row.supplier),
        c.date('date', 'Raised'),
        c.date('expected', 'Expected', { overdueWhenPast: true }),
        c.tag('category', 'Category', 'info', true),
        c.number('lines', 'Lines', { secondary: true }),
        c.money('amount', 'Amount', { bold: true }),
        c.progress('receivedPct', 'Received', {
          tone: (v) => (v === 100 ? 'good' : v === 0 ? 'warning' : 'brand'),
        }),
        c.text('buyer', 'Buyer', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Receipts() {
  const c = cols<GoodsReceipt>()
  return (
    <ResourcePage
      title="Goods Receipts"
      description="Receiving against purchase orders, including quantities rejected at inspection."
      endpoint="procurement/goods-receipts"
      loader={() => dataset().goodsReceipts}
      exportName="goods-receipts"
      createLabel="New receipt"
      formFields={forms.receiptFields}
      formDefaults={forms.receiptDefaults}
      formLines={{ itemsEndpoint: 'warehouse/items' }}
      formTitle="goods receipt"
      stats={(rows) => (
        <StatGrid>
          <StatTile
            label="Awaiting posting"
            value={num(rows.filter((r) => ['Draft', 'For Approval'].includes(r.status)).length)}
            icon={ClipboardCheck}
            hint="Not yet counted against the order"
          />
          <StatTile label="Posted" value={num(rows.filter((r) => r.status === 'Posted').length)} icon={FileSignature} />
          <StatTile
            label="Quantity received"
            value={num(rows.reduce((s, r) => s + r.qtyReceived, 0))}
            icon={Truck}
          />
          <StatTile
            label="Quantity rejected"
            value={num(rows.reduce((s, r) => s + r.qtyRejected, 0))}
            icon={Percent}
            hint="Failed inspection"
          />
        </StatGrid>
      )}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'warehouse', label: 'Warehouse' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.supplier} · ${row.poNo}`}
      columns={[
        c.primary('no', 'Receipt', (row) => row.poNo),
        c.text('supplier', 'Supplier'),
        c.text('warehouse', 'Warehouse', { secondary: true }),
        c.date('date', 'Received'),
        c.number('lines', 'Lines', { secondary: true }),
        c.number('qtyReceived', 'Qty received'),
        c.number('qtyRejected', 'Qty rejected'),
        c.text('receivedBy', 'Received by', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

function Invoices() {
  const c = cols<SupplierInvoice>()
  return (
    <ResourcePage
      title="Supplier Invoices"
      description="Three-way match between purchase order, goods receipt and supplier invoice."
      endpoint="procurement/supplier-invoices"
      loader={() => dataset().supplierInvoices}
      exportName="supplier-invoices"
      createLabel="Record invoice"
      formFields={forms.invoiceFields}
      formDefaults={forms.invoiceDefaults}
      formTitle="supplier invoice"
      stats={(rows) => (
        <StatGrid>
          <StatTile
            label="Awaiting approval"
            value={num(rows.filter((r) => ['Draft', 'For Approval'].includes(r.status)).length)}
            icon={ClipboardCheck}
          />
          <StatTile
            label="Payables open"
            value={moneyCompact(rows.filter((r) => !['Paid', 'Rejected'].includes(r.status)).reduce((s, r) => s + r.amount, 0))}
            icon={PiggyBank}
          />
          <StatTile
            label="Failed the match"
            value={num(rows.filter((r) => !['Matched', 'Unmatched'].includes(r.matched)).length)}
            icon={Percent}
            hint="Price or quantity variance"
          />
          <StatTile
            label="Overdue"
            value={num(rows.filter((r) => !['Paid', 'Rejected'].includes(r.status) && r.due && daysUntil(r.due) < 0).length)}
            icon={Truck}
          />
        </StatGrid>
      )}
      detailActions={(row, done) => <MatchInvoice row={row} done={done} />}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'matched', label: 'Match result' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => row.supplier}
      columns={[
        c.primary('no', 'Invoice', (row) => row.supplier),
        c.text('poNo', 'PO reference', { secondary: true }),
        c.date('date', 'Invoice date'),
        c.date('due', 'Due', { overdueWhenPast: true }),
        c.money('amount', 'Amount', { bold: true }),
        c.level('matched', 'Match', {
          Matched: 'good',
          '2-way only': 'warning',
          'Price variance': 'serious',
          'Qty variance': 'serious',
          Unmatched: 'critical',
        }),
        c.status(),
      ]}
    />
  )
}

function Contracts() {
  const c = cols<Contract>()
  return (
    <ResourcePage
      title="Contracts"
      description="Framework agreements and service contracts, with renewal windows surfaced before they lapse."
      endpoint="procurement/contracts"
      loader={() => dataset().contracts}
      exportName="contracts"
      createLabel="New contract"
      formFields={forms.contractFields}
      formDefaults={forms.contractDefaults}
      formTitle="contract"
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Active agreements" value={num(rows.filter((r) => r.status === 'Active').length)} icon={FileSignature} />
          <StatTile label="Committed value" value={moneyCompact(rows.reduce((s, r) => s + r.value, 0))} icon={PiggyBank} />
          <StatTile
            label="Expiring within 90 days"
            value={num(rows.filter((r) => r.end && daysUntil(r.end) >= 0 && daysUntil(r.end) <= 90).length)}
            icon={ClipboardCheck}
            hint="Give notice before the window closes"
          />
          <StatTile
            label="Auto-renewing"
            value={num(rows.filter((r) => r.autoRenew).length)}
            icon={Percent}
            hint="Renew unless cancelled"
          />
        </StatGrid>
      )}
      filters={[
        { columnId: 'status', label: 'Status' },
        { columnId: 'type', label: 'Type' },
      ]}
      detailTitle={(row) => row.no}
      detailSubtitle={(row) => `${row.supplier} · ${row.title}`}
      columns={[
        c.primary('no', 'Contract', (row) => row.title),
        c.text('supplier', 'Supplier'),
        c.tag('type', 'Type', 'info', true),
        c.date('start', 'Start', { secondary: true }),
        c.date('end', 'Expiry', { overdueWhenPast: true }),
        c.money('value', 'Contract value', { compact: true, bold: true }),
        c.bool('autoRenew', 'Auto-renew', { yes: 'Renews', no: 'Manual', tone: 'warning' }),
        c.text('owner', 'Owner', { secondary: true }),
        c.status(),
      ]}
    />
  )
}

/**
 * Supplier scorecards.
 *
 * Read-only by design: every figure is derived from posted receipts, rejected
 * quantities and prices paid, so there is nothing to type. The evaluation
 * button recomputes them; the detail dialog shows the evidence.
 */
function Performance() {
  const c = cols<Supplier>()
  return (
    <ResourcePage
      title="Supplier Scorecards"
      description="Objective supplier ranking on delivery reliability, quality acceptance and price competitiveness — all derived from documents, none of it typed."
      endpoint="procurement/supplier-performance"
      loader={() => dataset().suppliers.slice().sort((a, b) => (b.scorecard ?? -1) - (a.scorecard ?? -1))}
      exportName="supplier-scorecards"
      actions={<EvaluateSuppliers />}
      filters={[
        { columnId: 'category', label: 'Category' },
        { columnId: 'status', label: 'Status' },
      ]}
      detailSize="xl"
      renderDetail={(row) => <ScorecardDetail row={row} />}
      detailActions={(row, done) => <EvaluateSupplier row={row} done={done} />}
      detailTitle={(row) => row.name}
      detailSubtitle={(row) =>
        row.sample ? `Score ${row.scorecard}/100 from ${row.sample} documents` : 'Not yet scored'
      }
      stats={(rows) => {
        const scored = rows.filter((r) => (r.sample ?? 0) > 0)
        const stale = rows.filter((r) => !r.evaluatedAt)
        return (
          <StatGrid>
            <StatTile
              label="Suppliers scored"
              value={num(scored.length)}
              icon={Building2}
              hint={
                stale.length > 0
                  ? `${num(stale.length)} never evaluated`
                  : `${num(rows.length - scored.length)} with no history yet`
              }
            />
            <StatTile
              label="Average score"
              value={scored.length ? num(scored.reduce((s, r) => s + (r.scorecard ?? 0), 0) / scored.length, 1) : '—'}
              icon={Star}
              hint="Suppliers with evidence only"
            />
            <StatTile
              label="Below threshold"
              value={num(scored.filter((r) => (r.scorecard ?? 100) < 76).length)}
              icon={Percent}
              hint="Score under 76 — review required"
            />
            <StatTile
              label="Accreditation expired"
              value={num(rows.filter((r) => r.accreditedUntil && daysUntil(r.accreditedUntil) < 0).length)}
              icon={TrendingDown}
            />
          </StatGrid>
        )
      }}
      columns={[
        c.primary('name', 'Supplier', (row) => row.category || 'Uncategorised'),
        c.number('scorecard', 'Score', { decimals: 1 }),
        c.percent('onTimeRate', 'On-time', { warnBelow: 85 }),
        c.percent('qualityRate', 'Quality', { warnBelow: 90 }),
        c.number('priceIndex', 'Price index', { decimals: 1 }),
        c.number('sample', 'Evidence', { secondary: true }),
        c.money('ytdSpend', 'YTD spend', { compact: true }),
        c.date('evaluatedAt', 'Last scored', { secondary: true }),
        c.status(),
      ]}
    />
  )
}


/**
 * Every quote received, across all tenders.
 *
 * The award itself happens from the RFQ — this is the flat list for entering
 * bids as they come in and seeing how one supplier prices against another.
 */
function Bids() {
  const c = cols<Bid>()
  return (
    <ResourcePage
      title="Supplier Bids"
      description="Quotes received against open tenders, with lead time and technical score alongside price."
      endpoint="procurement/rfq-bids"
      loader={() => [] as Bid[]}
      exportName="supplier-bids"
      createLabel="Record bid"
      formFields={forms.bidFields}
      formDefaults={forms.bidDefaults}
      formTitle="bid"
      filters={[{ columnId: 'rfqNo', label: 'RFQ' }]}
      stats={(rows) => (
        <StatGrid>
          <StatTile label="Bids recorded" value={num(rows.length)} icon={ClipboardCheck} />
          <StatTile
            label="Lowest quote"
            value={rows.length ? moneyCompact(Math.min(...rows.map((r) => r.amount))) : '—'}
            icon={TrendingDown}
          />
          <StatTile
            label="Average lead time"
            value={rows.length ? `${num(rows.reduce((s, r) => s + r.leadTimeDays, 0) / rows.length, 1)} days` : '—'}
            icon={Truck}
          />
          <StatTile label="Awarded" value={num(rows.filter((r) => r.isAwarded).length)} icon={FileSignature} />
        </StatGrid>
      )}
      detailTitle={(row) => row.supplier}
      detailSubtitle={(row) => `${row.rfqNo} · ${moneyCompact(row.amount)}`}
      columns={[
        c.primary('supplier', 'Supplier', (row) => row.rfqNo),
        c.money('amount', 'Quoted', { bold: true }),
        c.number('leadTimeDays', 'Lead days'),
        c.text('paymentTerms', 'Terms', { secondary: true }),
        c.number('technicalScore', 'Technical'),
        c.bool('isAwarded', 'Awarded', { yes: 'Awarded', no: '—', falseTone: 'neutral' }),
      ]}
    />
  )
}

export const PAGES: Record<string, React.ComponentType> = {
  '': Dashboard,
  suppliers: Suppliers,
  requisitions: Requisitions,
  rfq: RfqPage,
  bids: Bids,
  orders: Orders,
  receipts: Receipts,
  invoices: Invoices,
  contracts: Contracts,
  performance: Performance,
}
