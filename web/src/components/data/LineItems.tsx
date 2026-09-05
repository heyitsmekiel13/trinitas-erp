import * as React from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/api'
import { money, num } from '@/lib/format'
import { Button, Combobox, Input, type ComboOption } from '@/components/ui/primitives'

/**
 * The line-item editor.
 *
 * Entering lines is the single most repetitive thing anybody does in this
 * system — a sales order is thirty seconds of choosing a customer and five
 * minutes of typing items. The design follows from that:
 *
 *   - It reads as a table, not a stack of cards. Quantities and prices sit in
 *     one column so they can be compared down the page, which is how somebody
 *     checking an order actually reads it.
 *   - It is driven from the keyboard. Enter on the last row adds another and
 *     puts the cursor in its item picker, so a twenty-line order never needs
 *     the mouse.
 *   - Every line shows what the item costs, what is in stock, and whether the
 *     price has been overridden — the three questions that otherwise send
 *     somebody to a different screen mid-entry.
 *   - It warns rather than blocks. Selling more than is on hand is a real and
 *     normal thing (backorders exist); silently allowing it is what causes
 *     the argument later, so the row says so and lets the person decide.
 *
 * Rows are keyed by a client-side id rather than their array index. With an
 * index, deleting the second of three rows makes React reuse the deleted row's
 * DOM for the one that moved up, and the item picker's open state and search
 * text move with it.
 */

export type Line = {
  itemId: number | null
  quantity: number
  unitPrice: number
  discountPct: number
  /* Journal lines, carried on the same shape so one form can serve both. */
  accountId?: number | null
  description?: string
  debit?: number
  credit?: number
  /** Client-side row identity. Stripped before the payload is sent. */
  _uid?: string
}

export type LineConfig = {
  /** Item lookup for the line's product column. */
  itemsEndpoint: string
  /** Copies the item's selling price into the line when chosen. */
  priceField?: string
  /** Heading above the editor. Defaults to "Line items". */
  title?: string
  /**
   * Shows the price as a read-out instead of an input.
   *
   * For documents that consume rather than sell — a work order's spare parts
   * are costed from the item master, and letting a technician type over that
   * would make the job as cheap as they liked.
   */
  readOnlyPrice?: boolean
  /** What the money column is called, e.g. "Unit cost". */
  priceLabel?: string
  /**
   * `journal` swaps the item/quantity/price editor for account/debit/credit,
   * and shows how far the entry is from balancing. A ledger entry is not a
   * list of things bought, and pretending otherwise makes the form lie about
   * what it is capturing.
   */
  kind?: 'items' | 'journal'
}

let uidCounter = 0
const nextUid = () => `line-${++uidCounter}`

export const emptyLine = (): Line => ({ itemId: null, quantity: 1, unitPrice: 0, discountPct: 0, _uid: nextUid() })

export const emptyJournalLine = (): Line => ({
  itemId: null, quantity: 0, unitPrice: 0, discountPct: 0,
  accountId: null, description: '', debit: 0, credit: 0, _uid: nextUid(),
})

/** Gives rows loaded from a saved document the identity they arrive without. */
export const withUids = (lines: Line[]): Line[] => lines.map((line) => ({ ...line, _uid: line._uid ?? nextUid() }))

/** Removes the client-only id so it never reaches the API. */
export const stripUids = (lines: Line[]) => lines.map(({ _uid, ...line }) => line)

export const lineTotal = (line: Line) =>
  line.quantity * line.unitPrice * (1 - (line.discountPct || 0) / 100)

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A numeric cell.
 *
 * Right-aligned and tabular, because a column of money that does not line up
 * on the decimal point cannot be scanned — and scanning is the whole reason
 * to put these in a column. The unit sits inside the box as a fixed affix
 * rather than in the label, so the field says what it wants while you type.
 */
function NumberCell({
  value,
  onChange,
  prefix,
  suffix,
  min,
  max,
  step,
  label,
  onKeyDown,
  invalid,
}: {
  value: number
  onChange: (value: number) => void
  prefix?: string
  suffix?: string
  min?: number
  max?: number
  step?: number
  label: string
  onKeyDown?: (e: React.KeyboardEvent) => void
  invalid?: boolean
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-ink-3">
          {prefix}
        </span>
      )}
      <Input
        type="number"
        inputMode="decimal"
        aria-label={label}
        className={cn(
          'tabular h-8 text-right text-[13px]',
          prefix && 'pl-6',
          suffix && 'pr-6',
          invalid && 'border-warning focus:border-warning focus:ring-warning/20',
        )}
        value={Number.isFinite(value) ? String(value) : ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        onKeyDown={onKeyDown}
        // Selecting on focus means typing replaces rather than appends, which
        // is what somebody correcting a quantity expects.
        onFocus={(e) => e.currentTarget.select()}
      />
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-ink-3">
          {suffix}
        </span>
      )}
    </div>
  )
}

/** Column labels. Shown once on desktop; each cell relabels itself on mobile. */
function ColumnHeader({ readOnlyPrice, priceLabel }: { readOnlyPrice?: boolean; priceLabel?: string }) {
  return (
    <div
      className={cn(
        'hidden gap-2 px-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-3 uppercase sm:grid',
        readOnlyPrice
          ? 'sm:grid-cols-[1.5rem_1fr_5rem_7rem_7rem_2rem]'
          : 'sm:grid-cols-[1.5rem_1fr_5rem_7.5rem_5rem_7rem_2rem]',
      )}
    >
      <span />
      <span>Item</span>
      <span className="text-right">Qty</span>
      <span className="text-right">{readOnlyPrice ? (priceLabel ?? 'Unit cost') : 'Unit price'}</span>
      {!readOnlyPrice && <span className="text-right">Disc</span>}
      <span className="text-right">Line total</span>
      <span />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

type ItemRow = Record<string, unknown>

export function LineItemsEditor({
  config,
  lines,
  onChange,
  error,
  showGrandTotal = true,
}: {
  config: LineConfig
  lines: Line[]
  onChange: (lines: Line[]) => void
  error?: string
  /**
   * False when the dialog footer is already showing the total.
   *
   * The footer's copy stays put while the lines scroll, so it is the more
   * useful of the two — printing the same figure again forty pixels below the
   * last row just reads as a mistake.
   */
  showGrandTotal?: boolean
}) {
  const { data: items = [] } = useResource<ItemRow[]>(config.itemsEndpoint, () => [])
  const container = React.useRef<HTMLDivElement>(null)
  /** Set when a row was just added, so focus can follow it after the render. */
  const focusRow = React.useRef<string | null>(null)

  const itemOptions = React.useMemo<ComboOption[]>(
    () =>
      items.map((item) => ({
        value: Number(item.id),
        label: String(item.name ?? ''),
        sublabel: String(item.sku ?? ''),
      })),
    [items],
  )

  const itemById = React.useMemo(() => {
    const map = new Map<number, ItemRow>()
    for (const item of items) map.set(Number(item.id), item)
    return map
  }, [items])

  const priceOf = (itemId: number | null) =>
    Number(itemById.get(Number(itemId))?.[config.priceField ?? 'sellPrice'] ?? 0)

  /** On hand less what other documents have already spoken for. */
  const availableOf = (itemId: number | null) => {
    const item = itemById.get(Number(itemId))
    if (!item || item.onHand === undefined) return null
    return Number(item.onHand ?? 0) - Number(item.allocated ?? 0)
  }

  const unitOf = (line: Line) => (config.readOnlyPrice ? priceOf(line.itemId) : line.unitPrice)
  const totalOf = (line: Line) => line.quantity * unitOf(line) * (1 - (line.discountPct || 0) / 100)

  const update = (uid: string, patch: Partial<Line>) =>
    onChange(lines.map((line) => (line._uid === uid ? { ...line, ...patch } : line)))

  const addLine = () => {
    const line = emptyLine()
    focusRow.current = line._uid!
    onChange([...lines, line])
  }

  const remove = (uid: string) => onChange(lines.filter((line) => line._uid !== uid))

  // Put the cursor in the item picker of a row that was just added.
  React.useLayoutEffect(() => {
    if (!focusRow.current) return
    const trigger = container.current?.querySelector<HTMLButtonElement>(
      `[data-row="${focusRow.current}"] [data-item-picker] button`,
    )
    trigger?.focus()
    focusRow.current = null
  })

  const subtotal = lines.reduce((sum, l) => sum + l.quantity * unitOf(l), 0)
  const total = lines.reduce((sum, l) => sum + totalOf(l), 0)
  const discount = subtotal - total

  /** Items chosen on more than one line — usually a slip, occasionally not. */
  const duplicated = React.useMemo(() => {
    const seen = new Map<number, number>()
    for (const line of lines) {
      if (line.itemId == null) continue
      seen.set(line.itemId, (seen.get(line.itemId) ?? 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id))
  }, [lines])

  const cols = config.readOnlyPrice
    ? 'sm:grid-cols-[1.5rem_1fr_5rem_7rem_7rem_2rem]'
    : 'sm:grid-cols-[1.5rem_1fr_5rem_7.5rem_5rem_7rem_2rem]'

  return (
    <section className="sm:col-span-2">
      <header className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          {config.title ?? 'Line items'}
          {lines.length > 0 && <span className="ml-1 text-ink-3">· {lines.length}</span>}
        </h3>
        <Button type="button" variant="secondary" size="xs" onClick={addLine}>
          <Plus className="size-3" />
          Add item
        </Button>
      </header>

      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-critical">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {lines.length === 0 ? (
        <button
          type="button"
          onClick={addLine}
          className="w-full rounded-xl border border-dashed border-line py-6 text-center text-xs text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
        >
          No items yet — click to add the first line.
        </button>
      ) : (
        <div ref={container}>
          <ColumnHeader readOnlyPrice={config.readOnlyPrice} priceLabel={config.priceLabel} />

          <div className="space-y-1.5 sm:space-y-1">
            {lines.map((line, index) => {
              const available = availableOf(line.itemId)
              const listPrice = priceOf(line.itemId)
              const overridden =
                !config.readOnlyPrice && line.itemId != null && listPrice > 0 && line.unitPrice !== listPrice
              const short = available !== null && line.quantity > available
              const repeated = line.itemId != null && duplicated.has(line.itemId)
              const item = itemById.get(Number(line.itemId))
              const last = index === lines.length - 1

              // Enter on the last row is "and another" — the single most
              // common next action when typing an order.
              const onKeyDown = (e: React.KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (last) addLine()
                }
              }

              return (
                <div
                  key={line._uid}
                  data-row={line._uid}
                  className={cn(
                    'rounded-lg border p-2 sm:rounded-md sm:border-transparent sm:p-0',
                    'border-line bg-surface-2 sm:bg-transparent',
                    'sm:hover:bg-surface-2',
                  )}
                >
                  <div className={cn('grid grid-cols-2 items-center gap-2 sm:px-2 sm:py-1', cols)}>
                    {/* Row number. A line somebody is told about by phone is
                        "line four", so it needs to be on screen. */}
                    <span className="tabular col-span-2 text-[11px] text-ink-3 sm:col-span-1 sm:text-center">
                      {index + 1}
                    </span>

                    <div className="col-span-2 sm:col-span-1" data-item-picker>
                      <Combobox
                        value={line.itemId}
                        options={itemOptions}
                        allowClear={false}
                        placeholder="Search an item by name or SKU…"
                        onChange={(itemId) => {
                          const id = itemId === null ? null : Number(itemId)
                          update(line._uid!, {
                            itemId: id,
                            // Default from the item master; still overridable
                            // for a one-off deal, unless the price is a cost.
                            unitPrice: config.readOnlyPrice ? priceOf(id) : line.unitPrice || priceOf(id),
                          })
                        }}
                      />
                    </div>

                    <label className="block sm:contents">
                      <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                        Qty
                      </span>
                      <NumberCell
                        label={`Quantity, line ${index + 1}`}
                        value={line.quantity}
                        min={0}
                        step={1}
                        suffix={item?.uom ? String(item.uom).slice(0, 4).toLowerCase() : undefined}
                        invalid={short}
                        onChange={(quantity) => update(line._uid!, { quantity })}
                        onKeyDown={onKeyDown}
                      />
                    </label>

                    {config.readOnlyPrice ? (
                      <div className="block sm:contents">
                        <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                          {config.priceLabel ?? 'Unit cost'}
                        </span>
                        <p className="tabular flex h-8 items-center justify-end text-[13px] text-ink-2">
                          {money(unitOf(line))}
                        </p>
                      </div>
                    ) : (
                      <label className="block sm:contents">
                        <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                          Unit price
                        </span>
                        <NumberCell
                          label={`Unit price, line ${index + 1}`}
                          value={line.unitPrice}
                          min={0}
                          step={0.01}
                          prefix="₱"
                          onChange={(unitPrice) => update(line._uid!, { unitPrice })}
                          onKeyDown={onKeyDown}
                        />
                      </label>
                    )}

                    {!config.readOnlyPrice && (
                      <label className="block sm:contents">
                        <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                          Discount
                        </span>
                        <NumberCell
                          label={`Discount percent, line ${index + 1}`}
                          value={line.discountPct}
                          min={0}
                          max={100}
                          step={0.5}
                          suffix="%"
                          onChange={(discountPct) => update(line._uid!, { discountPct })}
                          onKeyDown={onKeyDown}
                        />
                      </label>
                    )}

                    <div className="block sm:contents">
                      <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                        Line total
                      </span>
                      <p className="tabular flex h-8 items-center justify-end text-[13px] font-semibold text-ink">
                        {money(totalOf(line))}
                      </p>
                    </div>

                    {/* Remove only. A tooltip here sits over the line total,
                        so the icon carries its meaning alone and the label is
                        left to assistive tech. */}
                    <div className="col-span-2 flex items-center justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() => remove(line._uid!)}
                      >
                        <Trash2 className="size-3.5 text-critical" />
                      </Button>
                    </div>
                  </div>

                  {/* What the row cannot say in its cells: what is in stock,
                      what the list price was, and anything that looks wrong. */}
                  {line.itemId != null && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-0 pt-1 text-[11px] sm:px-2 sm:pb-1">
                      {item?.sku ? <span className="text-ink-3">{String(item.sku)}</span> : null}

                      {available !== null && (
                        <span className={cn(short ? 'font-medium text-warning' : 'text-ink-3')}>
                          {num(available)} available
                        </span>
                      )}

                      {short && (
                        <span className="inline-flex items-center gap-1 font-medium text-warning">
                          <AlertTriangle className="size-3" />
                          {num(line.quantity - (available ?? 0))} short — this will backorder
                        </span>
                      )}

                      {overridden && (
                        <span className="text-ink-3">
                          List {money(listPrice)}
                          <span className={cn('ml-1 font-medium', line.unitPrice < listPrice ? 'text-warning' : 'text-good')}>
                            ({line.unitPrice < listPrice ? '−' : '+'}
                            {Math.abs(Math.round(((line.unitPrice - listPrice) / listPrice) * 1000) / 10)}%)
                          </span>
                        </span>
                      )}

                      {repeated && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle className="size-3" />
                          Also on another line
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Totals. The discount is broken out because "what did we give
              away" is a question every sales manager asks of every order —
              and it is the one figure the footer cannot show. */}
          {(discount > 0.005 || showGrandTotal) && (
            <div className="mt-2 space-y-1 border-t border-line pt-2.5 text-[13px]">
              {discount > 0.005 && (
                <>
                  <div className="flex items-baseline justify-between text-ink-2">
                    <span>Subtotal</span>
                    <span className="tabular">{money(subtotal)}</span>
                  </div>
                  <div className="flex items-baseline justify-between text-ink-2">
                    <span>Discount</span>
                    <span className="tabular text-warning">−{money(discount)}</span>
                  </div>
                </>
              )}
              {showGrandTotal && (
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-ink-2">Document total</span>
                  <span className="tabular text-[15px] font-semibold text-ink">{money(total)}</span>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={addLine}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[12px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
          >
            <Plus className="size-3.5" />
            Add another item
            <span className="ml-1 hidden text-[10px] text-ink-3 sm:inline">or press Enter on the last row</span>
          </button>
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Journal                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The ledger variant.
 *
 * Kept apart from the item editor because a journal entry is not a list of
 * things bought: it has two money columns that must agree, no quantities, and
 * no prices. The one thing it shares is the shape of the row.
 */
export function JournalLinesEditor({
  config,
  lines,
  onChange,
  error,
}: {
  config: LineConfig
  lines: Line[]
  onChange: (lines: Line[]) => void
  error?: string
}) {
  const { data: accounts = [] } = useResource<ItemRow[]>(config.itemsEndpoint, () => [])
  const container = React.useRef<HTMLDivElement>(null)
  const focusRow = React.useRef<string | null>(null)

  const accountOptions = React.useMemo<ComboOption[]>(
    () =>
      accounts
        // A journal cannot be posted to a heading, so the picker does not
        // offer one. Being refused on save is a worse way to learn that.
        .filter((account) => account.isPostable !== false)
        .map((account) => ({
          value: Number(account.id),
          label: String(account.name ?? ''),
          sublabel: String(account.code ?? ''),
        })),
    [accounts],
  )

  const update = (uid: string, patch: Partial<Line>) =>
    onChange(lines.map((line) => (line._uid === uid ? { ...line, ...patch } : line)))

  const addLine = () => {
    const line = emptyJournalLine()
    focusRow.current = line._uid!
    onChange([...lines, line])
  }

  const remove = (uid: string) => onChange(lines.filter((line) => line._uid !== uid))

  React.useLayoutEffect(() => {
    if (!focusRow.current) return
    container.current
      ?.querySelector<HTMLButtonElement>(`[data-row="${focusRow.current}"] [data-item-picker] button`)
      ?.focus()
    focusRow.current = null
  })

  const debitTotal = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0)
  const creditTotal = lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0)
  const difference = Math.round((debitTotal - creditTotal) * 100) / 100

  return (
    <section className="sm:col-span-2">
      <header className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
          {config.title ?? 'Journal lines'}
          {lines.length > 0 && <span className="ml-1 text-ink-3">· {lines.length}</span>}
        </h3>
        <Button type="button" variant="secondary" size="xs" onClick={addLine}>
          <Plus className="size-3" />
          Add line
        </Button>
      </header>

      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-critical">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {lines.length === 0 ? (
        <button
          type="button"
          onClick={addLine}
          className="w-full rounded-xl border border-dashed border-line py-6 text-center text-xs text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
        >
          No lines yet — click to add the first one.
        </button>
      ) : (
        <div ref={container}>
          <div className="hidden gap-2 px-2 pb-1 text-[10px] font-semibold tracking-wide text-ink-3 uppercase sm:grid sm:grid-cols-[1.5rem_1fr_1fr_7rem_7rem_2rem]">
            <span />
            <span>Account</span>
            <span>Description</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span />
          </div>

          <div className="space-y-1.5 sm:space-y-1">
            {lines.map((line, index) => {
              const last = index === lines.length - 1
              const onKeyDown = (e: React.KeyboardEvent) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (last) addLine()
                }
              }

              return (
                <div
                  key={line._uid}
                  data-row={line._uid}
                  className="rounded-lg border border-line bg-surface-2 p-2 sm:rounded-md sm:border-transparent sm:bg-transparent sm:p-0 sm:hover:bg-surface-2"
                >
                  <div className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[1.5rem_1fr_1fr_7rem_7rem_2rem] sm:px-2 sm:py-1">
                    <span className="tabular col-span-2 text-[11px] text-ink-3 sm:col-span-1 sm:text-center">
                      {index + 1}
                    </span>

                    <div className="col-span-2 sm:col-span-1" data-item-picker>
                      <Combobox
                        value={line.accountId ?? null}
                        options={accountOptions}
                        allowClear={false}
                        placeholder="Search an account…"
                        onChange={(accountId) =>
                          update(line._uid!, { accountId: accountId === null ? null : Number(accountId) })
                        }
                      />
                    </div>

                    <label className="col-span-2 block sm:col-span-1">
                      <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                        Description
                      </span>
                      <Input
                        className="h-8 text-[13px]"
                        aria-label={`Description, line ${index + 1}`}
                        placeholder="What this line is for"
                        value={String(line.description ?? '')}
                        onChange={(e) => update(line._uid!, { description: e.target.value })}
                        onKeyDown={onKeyDown}
                      />
                    </label>

                    <label className="block sm:contents">
                      <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                        Debit
                      </span>
                      <NumberCell
                        label={`Debit, line ${index + 1}`}
                        value={Number(line.debit ?? 0)}
                        min={0}
                        step={0.01}
                        prefix="₱"
                        // A line is one side or the other. Typing in one clears
                        // the other rather than quietly leaving both.
                        onChange={(debit) => update(line._uid!, { debit, credit: 0 })}
                        onKeyDown={onKeyDown}
                      />
                    </label>

                    <label className="block sm:contents">
                      <span className="mb-0.5 block text-[10px] tracking-wide text-ink-3 uppercase sm:hidden">
                        Credit
                      </span>
                      <NumberCell
                        label={`Credit, line ${index + 1}`}
                        value={Number(line.credit ?? 0)}
                        min={0}
                        step={0.01}
                        prefix="₱"
                        onChange={(credit) => update(line._uid!, { credit, debit: 0 })}
                        onKeyDown={onKeyDown}
                      />
                    </label>

                    <div className="col-span-2 flex justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() => remove(line._uid!)}
                      >
                        <Trash2 className="size-3.5 text-critical" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-2.5 text-[13px]">
            <span className="font-medium text-ink-2">Totals</span>
            <span className="tabular flex gap-4">
              <span className="text-ink-2">
                Dr <strong className="text-ink">{money(debitTotal)}</strong>
              </span>
              <span className="text-ink-2">
                Cr <strong className="text-ink">{money(creditTotal)}</strong>
              </span>
            </span>
          </div>

          {/* The difference is stated plainly, because it is the one thing
              standing between this entry and the ledger. */}
          <p
            className={cn(
              'mt-2 rounded-lg p-2.5 text-[13px]',
              difference === 0 ? 'bg-good/10 text-good' : 'bg-critical/10 text-critical',
            )}
          >
            {difference === 0
              ? 'Balanced — this entry can be posted.'
              : `Out of balance by ${money(Math.abs(difference))}. Debits and credits must match before it can be posted.`}
          </p>

          <button
            type="button"
            onClick={addLine}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2 text-[12px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
          >
            <Plus className="size-3.5" />
            Add another line
          </button>
        </div>
      )}
    </section>
  )
}
