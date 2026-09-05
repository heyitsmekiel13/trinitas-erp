import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/lib/api'
import { liveApi } from '@/lib/adminApi'
import { fmtDate, money, moneyCompact, num, percent } from '@/lib/format'
import { BarSeriesChart } from '@/components/charts'
import { DetailField, DetailGrid } from '@/components/data/ResourcePage'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { Badge, ProgressBar, Segmented, StatusBadge } from '@/components/ui/primitives'
import type { Customer } from '@/data/master'

/**
 * The customer record as a salesperson needs it: who they are on one tab, and
 * what they have actually bought on the other.
 *
 * The history is a separate request rather than part of the customer list —
 * fetching every order for every customer to render a table nobody has opened
 * yet would be wasteful, and it is only wanted one account at a time.
 */

type History = {
  summary: {
    orders: number
    draftOrders: number
    spend: number
    cost: number
    grossProfit: number
    marginPct: number
    avgOrderValue: number
    firstOrder: string | null
    lastOrder: string | null
    returnsValue: number
    returnsCount: number
    balance: number
    creditLimit: number
    creditUsedPct: number | null
  }
  monthly: { month: string; spend: number }[]
  orders: {
    id: number
    no: string
    date: string | null
    promisedDate: string | null
    warehouse: string
    amount: number
    margin: number
    fulfilled: number
    status: string
  }[]
  items: { sku: string; name: string; quantity: number; value: number }[]
}

function useCustomerHistory(customerId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['customer-history', customerId],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<History> => {
      const token = (() => {
        try {
          return JSON.parse(localStorage.getItem('trinitas.auth') ?? '{}')?.state?.token
        } catch {
          return null
        }
      })()

      const response = await fetch(`${API_BASE_URL}/sales/customers/${customerId}/history`, {
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

/* -------------------------------------------------------------------------- */

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wider text-ink-3 uppercase">{label}</p>
      <p className="tabular mt-1 text-[17px] leading-tight font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  )
}

function Profile({ row }: { row: Customer }) {
  const used = row.creditLimit > 0 ? (row.balance / row.creditLimit) * 100 : 0

  return (
    <div className="space-y-5">
      <DetailGrid>
        <DetailField label="Code">{row.code}</DetailField>
        <DetailField label="Status">
          <StatusBadge status={row.status} />
        </DetailField>
        <DetailField label="Channel">
          <Badge tone="info">{row.channel}</Badge>
        </DetailField>
        <DetailField label="Region">{row.region}</DetailField>
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
          Commercial terms
        </h3>
        <DetailGrid>
          <DetailField label="Payment terms">{row.terms}</DetailField>
          <DetailField label="Representative">{row.salesRep || <span className="text-ink-3">Unassigned</span>}</DetailField>
          <DetailField label="Credit limit">{money(row.creditLimit, { decimals: false })}</DetailField>
          <DetailField label="Outstanding balance">{money(row.balance, { decimals: false })}</DetailField>
          <DetailField label="Credit used" full>
            <ProgressBar
              className="mt-1"
              value={Math.min(100, used)}
              tone={used >= 90 ? 'critical' : used >= 70 ? 'warning' : 'good'}
            />
            <p className="mt-1 text-[11px] text-ink-3">
              {row.creditLimit > 0
                ? `${percent(used)} of ${money(row.creditLimit, { decimals: false })}`
                : 'No credit limit set'}
            </p>
          </DetailField>
        </DetailGrid>
      </section>
    </div>
  )
}

function Purchases({ customerId }: { customerId: number }) {
  const { data, isLoading, error, refetch } = useCustomerHistory(customerId, true)

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

  const { summary, monthly, orders, items } = data

  if (summary.orders === 0 && orders.length === 0) {
    return (
      <EmptyState
        title="No orders yet"
        description="Once this customer places an order it appears here, with spend, margin and the items they buy."
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
          hint={`${num(summary.orders)} billed order${summary.orders === 1 ? '' : 's'}`}
        />
        <Stat label="Average order" value={moneyCompact(summary.avgOrderValue)} />
        <Stat
          label="Gross margin"
          value={percent(summary.marginPct)}
          hint={`${moneyCompact(summary.grossProfit)} profit`}
        />
        <Stat
          label="Last order"
          value={summary.lastOrder ? fmtDate(summary.lastOrder) : '—'}
          hint={summary.firstOrder ? `First ${fmtDate(summary.firstOrder)}` : undefined}
        />
      </div>

      {(summary.returnsCount > 0 || summary.draftOrders > 0) && (
        <div className="flex flex-wrap gap-2">
          {summary.draftOrders > 0 && (
            <Badge tone="neutral">
              {num(summary.draftOrders)} draft order{summary.draftOrders === 1 ? '' : 's'} — not counted in spend
            </Badge>
          )}
          {summary.returnsCount > 0 && (
            <Badge tone="warning">
              {num(summary.returnsCount)} return{summary.returnsCount === 1 ? '' : 's'} ·{' '}
              {money(summary.returnsValue, { decimals: false })} credited
            </Badge>
          )}
        </div>
      )}

      {hasSpend && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">Spend by month</h3>
          <div className="h-44 rounded-xl border border-line bg-surface-2 p-2">
            <BarSeriesChart data={monthly} xKey="month" series={[{ key: 'spend', label: 'Spend', slot: 1 }]} />
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          Order history · {num(orders.length)}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] text-[13px]">
            <thead className="bg-surface-2 text-[11px] tracking-wide text-ink-3 uppercase">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Order</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
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
                  <td className="tabular px-3 py-2 text-right text-ink-2">{percent(order.margin)}</td>
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
          <h3 className="mb-2 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">What they buy</h3>
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
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function CustomerDetail({ row }: { row: Customer }) {
  const [tab, setTab] = React.useState<'profile' | 'history'>('profile')

  // The demo dataset uses string ids and has no API to ask, so the history tab
  // would only ever error. Hide it rather than offer a dead control.
  const customerId = Number(row.id)
  const canLoadHistory = liveApi() && Number.isFinite(customerId)

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

      {tab === 'profile' || !canLoadHistory ? <Profile row={row} /> : <Purchases customerId={customerId} />}
    </div>
  )
}
