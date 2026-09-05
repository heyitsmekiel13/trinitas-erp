import * as React from 'react'
import {
  CalendarCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardList,
  Equal,
  Lock,
  RefreshCw,
  RotateCcw,
  Scale,
  ScanBarcode,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { currentUser } from '@/app/auth'
import { dataset } from '@/data/dataset'
import { useResource } from '@/lib/api'
import { exportCsv, printRegion } from '@/lib/export'
import { fmtDate, fmtDateTime, money, moneyCompact, num, percent } from '@/lib/format'
import {
  COUNT_AREAS,
  COUNT_CONDITIONS,
  cycleFor,
  daysToCycleDue,
  needsRecount,
  nextCycleAfter,
  sheetProgress,
  tallyForArea,
  tallyKey,
  tallyTotal,
  variance,
  variancePct,
  type CountableItem,
  type CountableStock,
  type CountArea,
  type CountCondition,
  type CountLine,
  type CountSheet,
} from '@/data/warehouse'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, Input, ProgressBar, Segmented, Select, Textarea } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { LocationChips, LocationGrid } from './components/LocationGrid'
import { useOps } from './ops'

/**
 * Cycle Counts & Adjustments.
 *
 * The business counts on the 10th and the 25th, so the page is built around
 * that rhythm rather than around a "schedule a count" form. Opening it during a
 * cycle shows the sheet for that cycle, already generated: the 10th sweeps fast
 * movers and anything below its reorder point, the 25th sweeps everything else.
 *
 * The part that matters day to day is the recount flag. A line that has been
 * signed off in the *current* cycle stops asking to be counted, and says when
 * it is next due instead. It only comes back when the next cut-off opens — so
 * the list shrinks as the shift works through it rather than nagging forever.
 */

/* -------------------------------------------------------------------------- */
/* Physical tally                                                              */
/* -------------------------------------------------------------------------- */

const CONDITION_STYLE: Record<CountCondition, string> = {
  Good: 'text-[#046904] dark:text-[#4ec44e]',
  Defective: 'text-[#8a5d00] dark:text-[#f0b640]',
  Scrap: 'text-[#a11c1c] dark:text-[#f07575]',
  Salvage: 'text-[#1a5399] dark:text-[#6ba7ef]',
}

/**
 * The count grid: area down, condition across.
 *
 * Counting is done by walking an area, not by walking a condition — so the
 * areas are the rows, and each row totals on its own. Splitting the condition
 * out at count time is what stops eighty good units and four smashed ones being
 * recorded as eighty-four "on hand" and discovered at picking.
 */
function TallyGrid({
  line,
  onSet,
  disabled,
}: {
  line: CountLine
  onSet: (area: CountArea, condition: CountCondition, qty: number) => void
  disabled?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[30rem] text-[12px]">
        <thead>
          <tr>
            <th className="pb-1.5 text-left text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Area</th>
            {COUNT_CONDITIONS.map((condition) => (
              <th
                key={condition}
                className={cn('pb-1.5 text-center text-[10px] font-semibold tracking-wider uppercase', CONDITION_STYLE[condition])}
              >
                {condition}
              </th>
            ))}
            <th className="pb-1.5 text-right text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Row total</th>
          </tr>
        </thead>
        <tbody>
          {COUNT_AREAS.map((area) => (
            <tr key={area}>
              <td className="py-1 pr-3 font-medium whitespace-nowrap text-ink-2">{area}</td>
              {COUNT_CONDITIONS.map((condition) => (
                <td key={condition} className="px-1 py-1">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    disabled={disabled}
                    value={line.tally[tallyKey(area, condition)] ?? ''}
                    placeholder="0"
                    onChange={(e) => onSet(area, condition, Number(e.target.value))}
                    aria-label={`${line.sku} — ${area} ${condition}`}
                    className="h-8 w-full min-w-[4.5rem] text-center text-[13px]"
                  />
                </td>
              ))}
              <td className="tabular py-1 pl-3 text-right font-medium text-ink">{num(tallyForArea(line.tally, area))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* One line                                                                    */
/* -------------------------------------------------------------------------- */

function CountRow({
  line,
  sheetId,
  cycleId,
  nextDue,
  locked,
  occupied,
}: {
  line: CountLine
  sheetId: string
  cycleId: string
  nextDue: string
  locked: boolean
  occupied: Record<string, string>
}) {
  const [open, setOpen] = React.useState(false)
  const ops = useOps()
  const toast = useToast()

  const physical = tallyTotal(line.tally)
  const delta = variance(line)
  const pct = variancePct(line)
  const pending = needsRecount(line, cycleId)
  const low = line.systemCount <= line.threshold

  const tone = delta === 0 ? 'good' : Math.abs(pct) >= 5 ? 'critical' : 'warning'

  const confirm = () => {
    ops.confirmLine(sheetId, line.id, cycleId, currentUser().name)
    setOpen(false)
    toast({
      tone: delta === 0 ? 'success' : 'warning',
      title: `${line.sku} counted`,
      description:
        delta === 0
          ? `Matches the system. Next check ${fmtDate(nextDue)}.`
          : `Variance ${delta > 0 ? '+' : ''}${num(delta)} — ${money(delta * line.unitCost, { decimals: false })}.`,
    })
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        open ? 'border-brand-300 bg-surface shadow-[var(--shadow-card)]' : 'border-line bg-surface',
      )}
    >
      {/* ------------------------------ Summary ------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <ChevronDown className={cn('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">{line.name}</span>
            <span className="block truncate font-mono text-[11px] text-ink-3">
              {line.sku}
              <span className="font-sans">
                {line.legacySku && line.legacySku !== line.sku ? ` · was ${line.legacySku}` : ''} · {line.category}
              </span>
            </span>
          </span>
        </button>

        <LocationChips locations={line.locations} className="shrink-0" />

        <div className="flex shrink-0 items-center gap-4 text-[12px]">
          <span className="text-center">
            <span className="block text-[10px] tracking-wider text-ink-3 uppercase">System</span>
            <span className="tabular block font-semibold text-ink">{num(line.systemCount)}</span>
          </span>
          <span className="text-center">
            <span className="block text-[10px] tracking-wider text-ink-3 uppercase">Physical</span>
            <span className={cn('tabular block font-semibold', physical ? 'text-ink' : 'text-ink-3')}>
              {physical ? num(physical) : '—'}
            </span>
          </span>
          <span className="w-20 text-center">
            <span className="block text-[10px] tracking-wider text-ink-3 uppercase">Variance</span>
            {pending && physical === 0 ? (
              <span className="block text-ink-3">—</span>
            ) : (
              <span
                className={cn(
                  'tabular block font-semibold',
                  delta === 0 ? 'text-good' : delta > 0 ? 'text-[#1a5399] dark:text-[#6ba7ef]' : 'text-critical',
                )}
              >
                {delta > 0 ? '+' : ''}
                {num(delta)}{' '}
                <span className="font-normal text-ink-3">({percent(pct)})</span>
              </span>
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {low && <Badge tone="warning">Below threshold</Badge>}
          {pending ? (
            <Badge tone="critical" dot>
              Needs count
            </Badge>
          ) : (
            <Badge tone="good" dot>
              Counted · next {fmtDate(nextDue)}
            </Badge>
          )}

          {!locked &&
            (pending ? (
              <>
                <Button
                  variant="secondary"
                  size="xs"
                  title="Record the system figure as found and sign it off"
                  onClick={() => {
                    ops.matchSystem(sheetId, line.id)
                    ops.confirmLine(sheetId, line.id, cycleId, currentUser().name)
                  }}
                >
                  <Equal className="size-3" />
                  Matches
                </Button>
                <Button variant="primary" size="xs" onClick={() => setOpen(true)}>
                  <Scale className="size-3" />
                  Count
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="xs" onClick={() => ops.reopenLine(sheetId, line.id)}>
                <RotateCcw className="size-3" />
                Recount
              </Button>
            ))}
        </div>
      </div>

      {/* ------------------------------ Expanded ----------------------------- */}
      {open && (
        <div className="animate-in space-y-4 border-t border-line px-3 py-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                What is physically on the floor
              </p>
              <TallyGrid
                line={line}
                disabled={locked}
                onSet={(area, condition, qty) => ops.setTally(sheetId, line.id, area, condition, qty)}
              />

              <div
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg px-3 py-2 text-[13px]',
                  tone === 'good' ? 'bg-good/10' : tone === 'warning' ? 'bg-warning/10' : 'bg-critical/10',
                )}
              >
                <span className="text-ink-2">
                  Counted <strong className="tabular text-ink">{num(physical)}</strong> against a system figure of{' '}
                  <strong className="tabular text-ink">{num(line.systemCount)}</strong>
                </span>
                <span className="ml-auto font-medium text-ink">
                  {delta === 0
                    ? 'No variance'
                    : `${delta > 0 ? 'Overage' : 'Shortage'} of ${num(Math.abs(delta))} · ${money(Math.abs(delta) * line.unitCost, { decimals: false })}`}
                </span>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                  Note for the variance
                </span>
                <Textarea
                  disabled={locked}
                  value={line.note}
                  onChange={(e) => ops.setLineNote(sheetId, line.id, e.target.value)}
                  placeholder="Four cases found in the showroom display, never booked out."
                  className="min-h-14 text-[13px]"
                />
              </label>
            </div>

            <div className="min-w-0">
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                Where it is stored
              </p>
              <LocationGrid
                compact
                disabled={locked}
                value={line.locations}
                occupied={occupied}
                onChange={(next) => ops.setLineLocations(sheetId, line.id, next)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-[11px] text-ink-3">
              {line.countedAt
                ? `Last counted by ${line.countedBy} on ${fmtDateTime(line.countedAt)}.`
                : 'Not counted in this cycle yet.'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              {!locked && (
                <Button variant="primary" size="sm" onClick={confirm}>
                  <Check className="size-3.5" />
                  Confirm count
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Fast scan                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Scan, key a number, done — the loop most of a cycle count actually is.
 *
 * The detailed grid above is real and stays: splitting what's on the shelf
 * by area and condition is genuine information a careful count needs. But
 * walking every line through that grid for the common case — a shelf that
 * simply has what the system thinks it has, or a plain overage/shortage
 * with nothing defective about it — is nine clicks longer than it needs to
 * be. This is the fast path: the barcode field never loses focus except to
 * hand off to the quantity field and back, so a shift with a scanner gun
 * can run through a sheet without touching the mouse.
 *
 * The quantity is recorded as one number in one bucket (`setQuantityFound`),
 * not folded into whatever the detailed grid already held — scanning an
 * item says "this is everything I found," not "add this to what's there."
 * Reopen the line and use the detailed grid if it actually needs splitting
 * by condition after the fact.
 */
function FastScanPanel({
  sheet,
  sheetId,
  cycleId,
  locked,
}: {
  sheet: CountSheet | undefined
  sheetId: string
  cycleId: string
  locked: boolean
}) {
  const ops = useOps()
  const toast = useToast()
  const [scan, setScan] = React.useState('')
  const [matched, setMatched] = React.useState<CountLine | null>(null)
  const [qty, setQty] = React.useState('')
  const scanRef = React.useRef<HTMLInputElement>(null)
  const qtyRef = React.useRef<HTMLInputElement>(null)

  const focusScan = () => requestAnimationFrame(() => scanRef.current?.focus())

  React.useEffect(() => {
    if (!locked) focusScan()
  }, [locked])

  const cancel = () => {
    setMatched(null)
    setQty('')
    focusScan()
  }

  const submitScan = (e: React.FormEvent) => {
    e.preventDefault()
    const code = scan.trim()
    if (!code) return
    setScan('')

    if (!sheet) {
      toast({ tone: 'error', title: 'No sheet yet', description: 'This warehouse has no count sheet open for the current cycle.' })
      focusScan()
      return
    }

    const line = sheet.lines.find(
      (l) => l.barcode === code || l.sku.toLowerCase() === code.toLowerCase() || l.legacySku === code,
    )

    if (!line) {
      toast({ tone: 'error', title: 'Not on this sheet', description: `Nothing matches "${code}" in this cycle.` })
      focusScan()
      return
    }

    setMatched(line)
    setQty(tallyTotal(line.tally) ? String(tallyTotal(line.tally)) : '')
    requestAnimationFrame(() => qtyRef.current?.select())
  }

  const submitQty = (e: React.FormEvent) => {
    e.preventDefault()
    if (!matched) return
    const n = Number(qty)
    if (qty.trim() === '' || !Number.isFinite(n) || n < 0) return

    ops.setQuantityFound(sheetId, matched.id, n)
    ops.confirmLine(sheetId, matched.id, cycleId, currentUser().name)

    const delta = n - matched.systemCount
    toast({
      tone: delta === 0 ? 'success' : 'warning',
      title: `${matched.sku} counted`,
      description: delta === 0 ? 'Matches the system.' : `Variance ${delta > 0 ? '+' : ''}${num(delta)}.`,
    })
    cancel()
  }

  if (locked) {
    return (
      <Card>
        <EmptyState icon={Lock} title="This cycle is posted" description="Switch to Detailed to review what was counted." />
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="mx-auto max-w-sm text-center">
        {!matched ? (
          <form onSubmit={submitScan} className="space-y-3">
            <ScanBarcode className="mx-auto size-8 text-brand-500" />
            <p className="text-[13px] text-ink-2">Scan the item's barcode, or type its SKU.</p>
            <Input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Scan or type a barcode / SKU…"
              autoFocus
              className="h-11 text-center text-[15px]"
            />
          </form>
        ) : (
          <form onSubmit={submitQty} className="space-y-3">
            <div>
              <p className="text-[13px] font-medium text-ink">{matched.name}</p>
              <p className="font-mono text-[11px] text-ink-3">{matched.sku}</p>
              <p className="mt-1 text-[11px] text-ink-3">System count: {num(matched.systemCount)}</p>
            </div>
            <Input
              ref={qtyRef}
              type="number"
              min={0}
              inputMode="numeric"
              autoFocus
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="Quantity found"
              aria-label={`Quantity found for ${matched.sku}`}
              className="h-14 text-center text-[22px] font-semibold"
            />
            <div className="flex justify-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={qty.trim() === ''}>
                <Check className="size-3.5" />
                Save &amp; next
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

type Filter = 'pending' | 'variance' | 'counted' | 'all'

export function CycleCounts() {
  const toast = useToast()
  const ops = useOps()
  const pageRef = React.useRef<HTMLDivElement>(null)

  // Everything counted comes through the same seam the rest of the app uses:
  // the live API when one is configured, the preview dataset otherwise. The
  // sheet must reflect real balances, not a demo catalogue.
  const { data: sites = [] } = useResource('warehouse/locations', () => dataset().sites)
  const { data: stock = [] } = useResource('warehouse/stock', () => dataset().stock)
  const { data: items = [] } = useResource('warehouse/items', () => dataset().items)

  const source = React.useMemo(
    () => ({ stock: stock as CountableStock[], items: items as CountableItem[] }),
    [stock, items],
  )

  const [warehouse, setWarehouse] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('pending')
  const [query, setQuery] = React.useState('')
  // Fast scan is the everyday path — see FastScanPanel; Detailed is the
  // area/condition grid for a count that actually needs to be split.
  const [mode, setMode] = React.useState<'fast' | 'detailed'>('fast')

  const cycle = React.useMemo(() => cycleFor(), [])
  const upcoming = React.useMemo(() => nextCycleAfter(cycle), [cycle])
  const dueIn = daysToCycleDue(cycle)

  const sheetId = `${warehouse}|${cycle.id}`
  const sheet = useOps((s) => s.sheets[sheetId])

  // Generating on open is deliberate: the count is scheduled by the calendar,
  // not by somebody remembering to press a button on the 10th.
  // Default to the first site once the list arrives, and never hold a name
  // that is no longer in it.
  React.useEffect(() => {
    if (!sites.length) return
    if (!sites.some((site) => site.name === warehouse)) setWarehouse(sites[0]!.name)
  }, [sites, warehouse])

  React.useEffect(() => {
    if (warehouse && source.stock.length) ops.openSheet(warehouse, cycle, source)
  }, [warehouse, cycle, ops, source])

  const progress = sheet ? sheetProgress(sheet, cycle.id) : null

  const occupied = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const line of sheet?.lines ?? []) {
      for (const cell of line.locations) map[cell] ??= line.sku
    }
    return map
  }, [sheet])

  const visible = React.useMemo(() => {
    const lines = sheet?.lines ?? []
    const q = query.trim().toLowerCase()
    return lines.filter((line) => {
      if (q && !`${line.sku} ${line.legacySku} ${line.name} ${line.barcode}`.toLowerCase().includes(q)) return false
      const pending = needsRecount(line, cycle.id)
      if (filter === 'pending') return pending
      if (filter === 'counted') return !pending
      if (filter === 'variance') return !pending && variance(line) !== 0
      return true
    })
  }, [sheet, query, filter, cycle.id])

  const locked = Boolean(sheet?.postedAt)

  const post = () => {
    if (!sheet) return
    if (progress && progress.counted < progress.total) {
      toast({
        tone: 'warning',
        title: 'Sheet is not finished',
        description: `${progress.total - progress.counted} line${progress.total - progress.counted === 1 ? '' : 's'} still need counting.`,
      })
      return
    }
    ops.postSheet(sheetId, currentUser().name)
    toast({ tone: 'success', title: `${sheet.no} posted`, description: 'The count is now the authority on these balances.' })
  }

  return (
    <div ref={pageRef}>
      <PageHeader
        title="Cycle Counts & Adjustments"
        description="Counts run on the 10th and the 25th. The sheet for the open cycle is generated for you — walk the area, key what you find, and the variance falls out."
        meta={
          <>
            <Badge tone="brand" dot>
              {cycle.label}
            </Badge>
            <Badge tone={dueIn < 0 ? 'critical' : dueIn <= 2 ? 'warning' : 'neutral'}>
              {dueIn < 0 ? `${Math.abs(dueIn)} day${Math.abs(dueIn) === 1 ? '' : 's'} overdue` : `due in ${dueIn} day${dueIn === 1 ? '' : 's'}`}
            </Badge>
            {locked && (
              <Badge tone="good" dot>
                Posted
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={locked}
              onClick={() => {
                ops.regenerate(warehouse, cycle, source)
                toast({ tone: 'info', title: 'Count sheet rebuilt', description: 'Fresh system figures pulled in.' })
              }}
            >
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">Rebuild sheet</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                exportCsv(
                  `count-sheet-${cycle.id}`,
                  [
                    { header: 'SKU', value: (l: CountLine) => l.sku },
                    { header: 'Legacy code', value: (l: CountLine) => l.legacySku },
                    { header: 'Item', value: (l: CountLine) => l.name },
                    { header: 'Locations', value: (l: CountLine) => l.locations.join(' ') },
                    { header: 'System', value: (l: CountLine) => l.systemCount },
                    { header: 'Physical', value: (l: CountLine) => tallyTotal(l.tally) },
                    { header: 'Variance', value: (l: CountLine) => variance(l) },
                    { header: 'Value variance', value: (l: CountLine) => variance(l) * l.unitCost },
                    { header: 'Counted by', value: (l: CountLine) => l.countedBy },
                    { header: 'Note', value: (l: CountLine) => l.note },
                  ],
                  sheet?.lines ?? [],
                )
              }
            >
              <ClipboardList className="size-3.5" />
              <span className="hidden sm:inline">Export sheet</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                printRegion(pageRef.current, {
                  title: 'Cycle Count Sheet',
                  subtitle: `${warehouse} · ${cycle.label}`,
                  preparedBy: currentUser().name,
                })
              }
            >
              Print
            </Button>
            <Button variant="primary" size="sm" disabled={locked || !sheet} onClick={post}>
              <Lock className="size-3.5" />
              Post count
            </Button>
          </>
        }
      />

      <StatGrid className="mb-4">
        <StatTile
          label="Cycle progress"
          value={progress ? `${progress.counted} / ${progress.total}` : '—'}
          icon={ClipboardList}
          hint="lines signed off this cycle"
          progress={progress ? { value: progress.pct, tone: progress.pct === 100 ? 'good' : 'brand' } : undefined}
        />
        <StatTile
          label="Count accuracy"
          value={progress?.accuracy == null ? '—' : percent(progress.accuracy)}
          icon={CalendarCheck}
          hint={progress?.accuracy == null ? 'nothing counted yet' : 'lines that matched exactly'}
        />
        <StatTile
          label="Variances found"
          value={progress ? num(progress.variances) : '—'}
          icon={TriangleAlert}
          hint="lines where the shelf disagreed"
        />
        <StatTile
          label="Value variance"
          value={progress ? moneyCompact(progress.valueVariance) : '—'}
          icon={Scale}
          hint={progress && progress.valueVariance < 0 ? 'stock written down' : 'stock written up'}
        />
      </StatGrid>

      {/* --------------------------- Warehouse & mode -------------------------- */}
      <Card className="mb-4 p-3" data-print="hide">
        <div className="flex flex-wrap items-center gap-2.5">
          <Select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            aria-label="Warehouse"
            className="h-9 w-auto min-w-[13rem]"
          >
            {sites.map((site) => (
              <option key={site.code} value={site.name}>
                {site.name}
              </option>
            ))}
          </Select>

          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fast', label: 'Fast scan' },
              { value: 'detailed', label: 'Detailed' },
            ]}
          />

          {progress && (
            <span className="ml-auto text-[11px] text-ink-3">
              {progress.counted} of {progress.total} counted · next cycle {fmtDate(upcoming.dueOn)}
            </span>
          )}
        </div>

        {progress && (
          <ProgressBar
            value={progress.pct}
            tone={progress.pct === 100 ? 'good' : 'brand'}
            className="mt-3"
            label="Cycle progress"
          />
        )}
      </Card>

      {mode === 'fast' ? (
        <FastScanPanel sheet={sheet} sheetId={sheetId} cycleId={cycle.id} locked={locked} />
      ) : (
        <>
          {/* ------------------------------- Toolbar ----------------------------- */}
          <Card className="mb-4 p-3" data-print="hide">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Scan or type a SKU, old code, name or barcode…"
                  className="h-9 pl-8"
                />
              </div>

              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'pending', label: `To count${progress ? ` (${progress.total - progress.counted})` : ''}` },
                  { value: 'variance', label: 'Variances' },
                  { value: 'counted', label: 'Done' },
                  { value: 'all', label: 'All' },
                ]}
              />
            </div>
          </Card>

          {/* -------------------------------- Lines ------------------------------- */}
          <div className="space-y-2">
            {visible.length === 0 ? (
              <Card>
                <EmptyState
                  icon={filter === 'pending' ? CalendarCheck : CalendarClock}
                  title={filter === 'pending' ? 'Nothing left to count this cycle' : 'No lines match'}
                  description={
                    filter === 'pending'
                      ? `Every line on this sheet has been signed off. The next sweep opens on ${fmtDate(upcoming.dueOn)}.`
                      : 'Try another filter, or clear the search.'
                  }
                />
              </Card>
            ) : (
              visible.map((line) => (
                <CountRow
                  key={line.id}
                  line={line}
                  sheetId={sheetId}
                  cycleId={cycle.id}
                  nextDue={upcoming.dueOn}
                  locked={locked}
                  occupied={occupied}
                />
              ))
            )}
          </div>
        </>
      )}

      {sheet?.postedAt && (
        <p className="mt-4 text-center text-[11px] text-ink-3">
          Posted by {sheet.postedBy} on {fmtDateTime(sheet.postedAt)} — this sheet is now read-only.
        </p>
      )}
    </div>
  )
}
