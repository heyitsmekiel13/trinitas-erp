import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/lib/api'
import { liveApi } from '@/lib/adminApi'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart } from '@/components/charts'
import { DetailField, DetailGrid } from '@/components/data/ResourcePage'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { Badge, ProgressBar, Segmented, StatusBadge } from '@/components/ui/primitives'
import type { Supplier } from '@/data/master'

/**
 * The supplier record as a buyer needs it: accreditation and terms on one tab,
 * what we have actually bought and how well they performed on the other.
 *
 * Loaded per supplier rather than with the list — pulling every order for every
 * vendor to render a table nobody has opened would be wasteful.
 */

type History = {
  summary: {
    orders: number
    draftOrders: number
    spend: number
    avgOrderValue: number
    firstOrder: string | null
    lastOrder: string | null
    invoices: number
    invoicesMatched: number
    payablesOutstanding: number
    onTimeRate: number
    qualityRate: number
    scorecard: number
  }
  monthly: { month: string; spend: number }[]
  orders: {
    id: number
    no: string
    date: string | null
    expected: string | null
    warehouse: string
    amount: number
    receivedPct: number
    status: string
  }[]
  items: { sku: string; name: string; quantity: number; value: number }[]
  contracts: {
    no: string
    title: string
    type: string
    start: string | null
    end: string | null
    value: number
    status: string
  }[]
}

function useSupplierHistory(supplierId: number) {
  return useQuery({
    queryKey: ['supplier-history', supplierId],
    staleTime: 60_000,
    queryFn: async (): Promise<History> => {
      const token = (() => {
        try {
          return JSON.parse(localStorage.getItem('trinitas.auth') ?? '{}')?.state?.token
        } catch {
          return null
        }
      })()

      const response = await fetch(`${API_BASE_URL}/procurement/suppliers/${supplierId}/history`, {
        headers: {
          Accept: 'application/json',
          ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!response.ok) throw new Error(`Could not load purchase history (${response.status}).`)
      return (await response.json()).data as History
    },
  })
}

/** Formats a metric the system has no evidence for yet. */
const orDash = (value: number | null | undefined, format: (v: number) => string) =>
  value === null || value === undefined ? '—' : format(value)

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wider text-ink-3 uppercase">{label}</p>
      <p className="tabular mt-1 text-[17px] leading-tight font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Profile({ row }: { row: Supplier }) {
  return (
    <div className="space-y-5">
      <DetailGrid>
        <DetailField label="Code">{row.code}</DetailField>
        <DetailField label="Status">
          <StatusBadge status={row.status} />
        </DetailField>
        <DetailField label="Category">
          {row.category ? <Badge tone="info">{row.category}</Badge> : <span className="text-ink-3">—</span>}
        </DetailField>
        <DetailField label="Payment terms">{row.terms}</DetailField>
      </DetailGrid>

      <section>
        <h3 className="mb-2.5 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          Contact
        </h3>
        <DetailGrid>
          <DetailField label="Contact person">{row.contact || <span className="text-ink-3">—</span>}</DetailField>
          <DetailField label="Phone">{row.phone || <span className="text-ink-3">—</span>}</DetailField>
          <DetailField label="Email">{row.email || <span className="text-ink-3">—</span>}</DetailField>
          <DetailField label="City">{row.city || <span className="text-ink-3">—</span>}</DetailField>
        </DetailGrid>
      </section>

      <section>
        <h3 className="mb-2.5 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          Performance
        </h3>
        <DetailGrid>
          <DetailField label="On-time delivery">{orDash(row.onTimeRate, percent)}</DetailField>
          <DetailField label="Quality acceptance">{orDash(row.qualityRate, percent)}</DetailField>
          <DetailField label="Price index">{orDash(row.priceIndex, (v) => num(v, 1))}</DetailField>
          <DetailField label="Accredited until">
            {row.accreditedUntil ? fmtDate(row.accreditedUntil) : <span className="text-ink-3">No expiry</span>}
          </DetailField>
          <DetailField label="Overall scorecard" full>
            {row.scorecard === null ? (
              <p className="text-[13px] text-ink-3">
                Not scored yet — run an evaluation under Supplier Scorecards.
              </p>
            ) : (
              <>
                <ProgressBar
                  className="mt-1"
                  value={row.scorecard}
                  tone={row.scorecard >= 88 ? 'good' : row.scorecard >= 76 ? 'brand' : 'warning'}
                />
                <p className="mt-1 text-[11px] text-ink-3">
                  {num(row.scorecard, 1)} out of 100
                  {row.sample ? ` · from ${num(row.sample)} document${row.sample === 1 ? '' : 's'}` : ''}
                </p>
              </>
            )}
          </DetailField>
        </DetailGrid>
      </section>
    </div>
  )
}

function Purchases({ supplierId }: { supplierId: number }) {
  const { data, isLoading, error, refetch } = useSupplierHistory(supplierId)

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  const { summary, monthly, orders, items, contracts } = data

  if (orders.length === 0 && contracts.length === 0) {
    return (
      <EmptyState
        title="Nothing bought yet"
        description="Once a purchase order is raised against this supplier it appears here, with spend, delivery progress and the items involved."
      />
    )
  }

  const hasSpend = monthly.some((m) => m.spend > 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Lifetime spend"
          value={moneyCompact(summary.spend)}
          hint={`${num(summary.orders)} committed order${summary.orders === 1 ? '' : 's'}`}
        />
        <Stat label="Average order" value={moneyCompact(summary.avgOrderValue)} />
        <Stat
          label="Payables open"
          value={moneyCompact(summary.payablesOutstanding)}
          hint={`${num(summary.invoicesMatched)} of ${num(summary.invoices)} invoices matched`}
        />
        <Stat
          label="Last order"
          value={summary.lastOrder ? fmtDate(summary.lastOrder) : '—'}
          hint={summary.firstOrder ? `First ${fmtDate(summary.firstOrder)}` : undefined}
        />
      </div>

      {summary.draftOrders > 0 && (
        <Badge tone="neutral">
          {num(summary.draftOrders)} draft order{summary.draftOrders === 1 ? '' : 's'} — not counted in spend
        </Badge>
      )}

      {hasSpend && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">Spend by month</h3>
          <div className="h-44 rounded-xl border border-line bg-surface-2 p-2">
            <BarSeriesChart data={monthly} xKey="month" series={[{ key: 'spend', label: 'Spend', slot: 2 }]} />
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          Purchase orders · {num(orders.length)}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-[13px]">
            <thead className="bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Raised</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <span className="font-medium text-ink">{order.no}</span>
                    <span className="block text-[11px] text-ink-3">{order.warehouse}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{order.date ? fmtDate(order.date) : '—'}</td>
                  <td className="tabular px-3 py-2 text-right font-medium text-ink">{money(order.amount)}</td>
                  <td className="tabular px-3 py-2 text-right text-ink-2">{percent(order.receivedPct, 0)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {items.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">What we buy from them</h3>
          <div className="divide-y divide-line rounded-xl border border-line">
            {items.map((item) => (
              <div key={item.sku} className="flex items-baseline gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{item.name}</p>
                  <p className="text-[11px] text-ink-3">{item.sku}</p>
                </div>
                <span className="tabular shrink-0 text-[11px] text-ink-3">{num(item.quantity)} units</span>
                <span className="tabular shrink-0 text-[13px] font-medium text-ink">{money(item.value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {contracts.length > 0 && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">Agreements in place</h3>
          <div className="divide-y divide-line rounded-xl border border-line">
            {contracts.map((c) => (
              <div key={c.no} className="flex flex-wrap items-baseline gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{c.title}</p>
                  <p className="text-[11px] text-ink-3">
                    {c.no} · {c.type}
                    {c.end ? ` · ends ${fmtDate(c.end)}` : ''}
                  </p>
                </div>
                <span className="tabular shrink-0 text-[13px] font-medium text-ink">
                  {money(c.value, { decimals: false })}
                </span>
                <StatusBadge status={c.status} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function SupplierDetail({ row }: { row: Supplier }) {
  const [tab, setTab] = React.useState<'profile' | 'history'>('profile')

  // The demo dataset uses string ids and has no API to ask.
  const supplierId = Number(row.id)
  const canLoadHistory = liveApi() && Number.isFinite(supplierId)

  return (
    <div className="space-y-4">
      {canLoadHistory && (
        <Segmented
          value={tab}
          onChange={setTab}
          size="sm"
          options={[
            { value: 'profile', label: 'Profile' },
            { value: 'history', label: 'Purchase history' },
          ]}
        />
      )}

      {tab === 'profile' || !canLoadHistory ? <Profile row={row} /> : <Purchases supplierId={supplierId} />}
    </div>
  )
}
