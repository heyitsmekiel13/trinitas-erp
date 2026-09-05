import * as React from 'react'
import { Barcode, Check, Copy, TriangleAlert } from 'lucide-react'
import { dataset } from '@/data/dataset'
import { useResource } from '@/lib/api'
import { brandCode, buildSku, categoryCode, companyPrefix, parseSku } from '@/data/sku'
import { cn } from '@/lib/cn'
import { Badge, Button } from '@/components/ui/primitives'

/**
 * The SKU builder, shown live under the item form.
 *
 * A new item's code should not be a decision. Given the category and the brand
 * the prefix is fixed, and the only free part is the sequence — which the
 * system can issue, because it knows what has already been used. So this
 * proposes the next code and explains, in words, what each block of it means.
 *
 * It also flags a typed code that does not follow the pattern, rather than
 * silently accepting it: one hand-keyed exception is how a naming convention
 * stops being one.
 */
export function SkuBuilder({ values }: { values: Record<string, unknown> }) {
  const category = String(values.category ?? '')
  const brand = String(values.brand ?? '')
  const typed = String(values.sku ?? '').trim()

  // The real catalogue, so the sequence continues from codes already issued
  // rather than restarting at 0001 on top of two thousand live items.
  const { data: items = [] } = useResource<{ sku: string }[]>('warehouse/items', () => dataset().items)

  // The next free sequence in this category — the only part a person cannot
  // work out from the item in front of them.
  const suggestion = React.useMemo(() => {
    if (!category) return null
    const code = categoryCode(category)
    const used = items
      .map((item) => parseSku(item.sku))
      .filter((parsed) => parsed?.category === code)
      .map((parsed) => parsed!.sequence)
    return buildSku(category, brand, Math.max(0, ...used) + 1)
  }, [items, category, brand])

  const parsed = typed ? parseSku(typed) : null
  const clash = typed ? items.some((item) => item.sku.toUpperCase() === typed.toUpperCase()) : false

  return (
    <section className="rounded-xl border border-line bg-surface-2 p-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
        <Barcode className="size-3.5" />
        SKU convention
      </h3>

      {!category ? (
        <p className="py-2 text-center text-xs text-ink-3">Choose a category and the code writes itself.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[15px] font-semibold tracking-wide text-ink ring-1 ring-line-strong ring-inset">
              {suggestion}
            </code>
            {suggestion && suggestion !== typed.toUpperCase() && (
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  void navigator.clipboard?.writeText(suggestion)
                }}
              >
                <Copy className="size-3" />
                Copy next free code
              </Button>
            )}
          </div>

          <dl className={cn('grid gap-2 text-center', brand.trim() ? 'grid-cols-4' : 'grid-cols-3')}>
            {[
              [companyPrefix(), 'Company'],
              [categoryCode(category), category],
              // The brand block only exists when the item has a brand; the
              // imported catalogue has none, so the code is three blocks.
              ...(brand.trim() ? [[brandCode(brand), brand] as const] : []),
              [suggestion?.split('-').at(-1) ?? '0001', 'Sequence'],
            ].map(([code, label]) => (
              <div key={label} className="rounded-lg bg-surface px-1.5 py-1.5">
                <dt className="font-mono text-[13px] font-semibold text-ink">{code}</dt>
                <dd className="mt-0.5 truncate text-[10px] text-ink-3">{label}</dd>
              </div>
            ))}
          </dl>

          {typed && (
            <p className="flex items-start gap-1.5 text-[11px]">
              {clash ? (
                <>
                  <TriangleAlert className="mt-0.5 size-3 shrink-0 text-critical" />
                  <span className="text-critical">
                    <strong>{typed}</strong> is already in use. Take the suggested code instead.
                  </span>
                </>
              ) : parsed ? (
                <>
                  <Check className="mt-0.5 size-3 shrink-0 text-good" />
                  <span className="text-ink-3">
                    <strong className="text-ink">{typed}</strong> follows the convention.
                  </span>
                </>
              ) : (
                <>
                  <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" />
                  <span className="text-ink-2">
                    <strong className="text-ink">{typed}</strong> does not follow{' '}
                    <Badge tone="neutral">{companyPrefix()}-CAT-0000</Badge>. It will still save — old codes have to keep
                    working — but new items read better on the pattern.
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
