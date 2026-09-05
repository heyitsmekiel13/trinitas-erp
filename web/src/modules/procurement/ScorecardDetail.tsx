import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info } from 'lucide-react'
import { getSupplierScorecard, liveApi } from '@/lib/adminApi'
import { fmtDate, money, num, percent } from '@/lib/format'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { Badge, ProgressBar } from '@/components/ui/primitives'
import type { Supplier } from '@/data/master'

/**
 * Why a supplier scores what they score.
 *
 * A number on its own invites an argument. This shows the rows behind each
 * component — how many orders were late and by how long, how much was rejected,
 * what we paid against what everyone else paid — so the conversation with the
 * supplier is about evidence rather than opinion.
 */

/** Tone thresholds shared by the bars, so 80% looks the same everywhere. */
function toneFor(value: number) {
  return value >= 90 ? 'good' : value >= 76 ? 'brand' : value >= 60 ? 'warning' : 'critical'
}

function Component({
  label,
  weight,
  value,
  detail,
  note,
}: {
  label: string
  weight: number
  value: number | null
  detail?: React.ReactNode
  note: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">
          {label}
          <span className="ml-1.5 text-[11px] font-normal text-ink-3">{percent(weight * 100, 0)} of score</span>
        </p>
        <p className="tabular shrink-0 text-[15px] font-semibold text-ink">
          {value === null ? <span className="text-ink-3">No data</span> : percent(value)}
        </p>
      </div>

      {value !== null && <ProgressBar className="mt-2" value={Math.min(100, value)} tone={toneFor(value)} />}

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{note}</p>
      {detail && <div className="mt-2 border-t border-line pt-2">{detail}</div>}
    </div>
  )
}

export function ScorecardDetail({ row }: { row: Supplier }) {
  const supplierId = Number(row.id)
  const enabled = liveApi() && Number.isFinite(supplierId)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['supplier-scorecard', supplierId],
    enabled,
    staleTime: 30_000,
    queryFn: () => getSupplierScorecard(supplierId),
  })

  if (!enabled) {
    return (
      <EmptyState
        title="Scores need the live database"
        description="Preview data has no receipts or prices to score against."
      />
    )
  }

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />
  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    )
  }

  const { score, sample, delivery, quality, price, weights } = data

  return (
    <div className="space-y-4">
      {/* ------------------------------ Headline ------------------------------ */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2 p-4">
        <div>
          <p className="text-[10px] font-medium tracking-wider text-ink-3 uppercase">Overall score</p>
          <p className="tabular mt-0.5 text-[28px] leading-none font-semibold text-ink">
            {score === null ? '—' : num(score, 1)}
            {score !== null && <span className="text-[15px] font-normal text-ink-3">/100</span>}
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {score !== null && <ProgressBar value={score} tone={toneFor(score)} />}
          <p className="text-[11px] text-ink-3">
            {sample === 0
              ? 'Nothing to score yet — no completed deliveries or receipts in the window.'
              : `Based on ${num(sample)} document${sample === 1 ? '' : 's'} over the last ${data.windowMonths} months, from ${fmtDate(data.windowFrom)}.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {data.needsReview && score !== null && <Badge tone="critical">Below review threshold</Badge>}
          {data.accreditationExpired && <Badge tone="warning">Accreditation expired</Badge>}
          {sample > 0 && sample < 5 && <Badge tone="neutral">Thin evidence</Badge>}
        </div>
      </div>

      {/* A high score off two documents is not the same claim as off forty. */}
      {sample > 0 && sample < 5 && (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-2.5 text-[11px] leading-relaxed text-ink-2 ring-1 ring-warning/25 ring-inset">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>
            This score rests on very few documents. Treat it as indicative until the supplier has more history.
          </span>
        </p>
      )}

      {/* ----------------------------- Components ---------------------------- */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Component
          label="Delivery reliability"
          weight={weights.delivery}
          value={delivery.rate}
          note={delivery.note}
          detail={
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-ink-3">On time</dt>
              <dd className="tabular text-right text-ink">{num(delivery.onTime)}</dd>
              <dt className="text-ink-3">Late</dt>
              <dd className="tabular text-right text-ink">{num(delivery.late)}</dd>
              {delivery.avgDaysLate !== null && (
                <>
                  <dt className="text-ink-3">Average delay</dt>
                  <dd className="tabular text-right text-ink">{num(delivery.avgDaysLate, 1)} days</dd>
                </>
              )}
              {delivery.openPastDue > 0 && (
                <>
                  <dt className="text-critical">Open and overdue</dt>
                  <dd className="tabular text-right font-medium text-critical">{num(delivery.openPastDue)}</dd>
                </>
              )}
            </dl>
          }
        />

        <Component
          label="Quality acceptance"
          weight={weights.quality}
          value={quality.rate}
          note={quality.note}
          detail={
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <dt className="text-ink-3">Receipts</dt>
              <dd className="tabular text-right text-ink">{num(quality.receipts)}</dd>
              <dt className="text-ink-3">Units accepted</dt>
              <dd className="tabular text-right text-ink">{num(quality.received)}</dd>
              <dt className={quality.rejected > 0 ? 'text-critical' : 'text-ink-3'}>Units rejected</dt>
              <dd
                className={`tabular text-right ${quality.rejected > 0 ? 'font-medium text-critical' : 'text-ink'}`}
              >
                {num(quality.rejected)}
              </dd>
            </dl>
          }
        />
      </div>

      {/* ------------------------------- Price -------------------------------- */}
      <section className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-ink">
            Price competitiveness
            <span className="ml-1.5 text-[11px] font-normal text-ink-3">
              {percent(weights.price * 100, 0)} of score
            </span>
          </p>
          <p className="tabular shrink-0 text-[15px] font-semibold text-ink">
            {price.index === null ? (
              <span className="text-ink-3">No data</span>
            ) : (
              <>
                {num(price.index, 1)}
                <span className="ml-1 text-[11px] font-normal text-ink-3">index</span>
              </>
            )}
          </p>
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{price.note}</p>

        {price.items.length > 0 && (
          <div className="mt-2.5 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[26rem] text-[12px]">
              <thead className="bg-surface text-[10px] tracking-wide text-ink-3 uppercase">
                <tr>
                  <th className="px-2.5 py-1.5 text-left font-medium">Item</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Our price</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Market</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {price.items.map((item) => (
                  <tr key={item.sku}>
                    <td className="px-2.5 py-1.5">
                      <span className="text-ink">{item.name}</span>
                      <span className="block text-[10px] text-ink-3">{item.sku}</span>
                    </td>
                    <td className="tabular px-2.5 py-1.5 text-right text-ink">{money(item.ourPrice)}</td>
                    <td className="tabular px-2.5 py-1.5 text-right text-ink-2">{money(item.marketPrice)}</td>
                    <td
                      className={`tabular px-2.5 py-1.5 text-right font-medium ${
                        item.variancePct > 0 ? 'text-critical' : 'text-good'
                      }`}
                    >
                      {item.variancePct > 0 ? '+' : ''}
                      {num(item.variancePct, 1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>
            Index 100 means this supplier charges the market average. Lower is cheaper. Only items bought from more
            than one supplier can be compared — a sole-source item has no market to measure against.
          </span>
        </p>
      </section>

      <p className="text-[11px] text-ink-3">
        Every figure above is derived from posted goods receipts and purchase order prices. Nothing here can be
        typed in — to change a score, the supplier has to deliver differently.
      </p>
    </div>
  )
}
