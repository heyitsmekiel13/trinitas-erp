import * as React from 'react'
import {
  ArrowRight,
  CalendarClock,
  Check,
  ChevronLeft,
  ClipboardCheck,
  Gauge,
  Map as MapIcon,
  MapPin,
  Package,
  Printer,
  Search,
  Timer,
  Truck,
  User,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { currentUser } from '@/app/auth'
import { fmtDate, fmtDateTime, num, percent } from '@/lib/format'
import { printRegion } from '@/lib/export'
import {
  CLEAN_CHECK,
  DISPATCH_STAGES,
  STAGE_FAULT,
  deliveredOf,
  nextStage,
  otifFor,
  otifRate,
  piecesOf,
  stageIndex,
  verdictFor,
  type ConditionCheck,
  type Dispatch,
  type DispatchStage,
} from '@/data/warehouse'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatGrid, StatTile } from '@/components/dashboard/StatTile'
import { Badge, Button, Card, Input, Segmented, Textarea } from '@/components/ui/primitives'
import { Modal } from '@/components/ui/overlay'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { ConditionCheckPanel, VerdictBadge } from './components/ConditionCheck'
import { RouteSummary } from './components/DeliveryMap'
import { DeliveryRouteMap } from './components/DeliveryRouteMap'
import { LocationChips, LocationGrid } from './components/LocationGrid'
import { StageTracker } from './components/StageTracker'
import { STAGE_HINT, useOps } from './ops'
import { useSeedFloor } from './useFloorData'

/**
 * Pick, Pack & Dispatch.
 *
 * One card per shipment, one primary button on each: the next thing that
 * happens to it. Everything else — details, printing, placement — is secondary
 * and sits behind it, because a picker on the floor is looking for the button
 * that says what they just did, not for a form.
 *
 * Advancing a shipment always asks the same three things, in the same order:
 * who is confirming, what condition the goods are in at this hand-over, and
 * where they now physically are. The middle one is what makes damage
 * attributable — the earliest stage that reports a fault is the stage it
 * happened at, and nobody has to reconstruct it a week later.
 *
 * The department's headline number, OTIF, is computed from these cards and
 * nothing else: on time is the promise against the delivery stamp, in full is
 * every line delivered at the quantity ordered.
 */

/* -------------------------------------------------------------------------- */
/* Advance wizard                                                              */
/* -------------------------------------------------------------------------- */

type Step = 'confirm' | 'condition' | 'location'

function AdvanceWizard({
  dispatch,
  onClose,
}: {
  dispatch: Dispatch | null
  onClose: () => void
}) {
  const ops = useOps()
  const toast = useToast()
  const [step, setStep] = React.useState<Step>('confirm')
  const [by, setBy] = React.useState(currentUser().name)
  const [note, setNote] = React.useState('')
  const [checks, setChecks] = React.useState<Record<string, ConditionCheck>>({})
  const [locations, setLocations] = React.useState<string[]>([])

  const target = dispatch ? nextStage(dispatch.stage) : null

  React.useEffect(() => {
    if (!dispatch) return
    setStep('confirm')
    setBy(currentUser().name)
    setNote('')
    setLocations(dispatch.locations)
    setChecks(
      Object.fromEntries(
        dispatch.lines.map((line) => [
          line.sku,
          { ...CLEAN_CHECK, stage: STAGE_FAULT[dispatch.stage], qty: 0 },
        ]),
      ),
    )
  }, [dispatch])

  if (!dispatch || !target) return null

  // Placement only matters while the goods are still in the building.
  const needsLocation = stageIndex(target) <= stageIndex('Out for Delivery')
  const steps: Step[] = needsLocation ? ['confirm', 'condition', 'location'] : ['confirm', 'condition']
  const at = steps.indexOf(step)
  const flagged = Object.values(checks).filter((c) => verdictFor(c.physical, c.functional) !== 'Good')

  const finish = () => {
    ops.setDispatchLocations(dispatch.id, locations)
    ops.advance(dispatch.id, {
      by,
      note,
      checks: Object.entries(checks)
        .filter(([, check]) => verdictFor(check.physical, check.functional) !== 'Good')
        .map(([sku, check]) => ({ sku, check })),
    })
    toast({
      tone: flagged.length ? 'warning' : 'success',
      title: `${dispatch.no} → ${target}`,
      description: flagged.length
        ? `${flagged.length} line${flagged.length === 1 ? '' : 's'} flagged at ${STAGE_FAULT[dispatch.stage].toLowerCase()}.`
        : 'Everything checked clean at this hand-over.',
    })
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${dispatch.no} — move to ${target}`}
      description={`${dispatch.customer} · ${num(piecesOf(dispatch))} pcs · ${dispatch.soNo}`}
      headerAside={
        <span className="hidden items-center gap-1 sm:flex">
          {steps.map((s, i) => (
            <span
              key={s}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === at ? 'bg-brand-500' : i < at ? 'bg-good' : 'bg-line-strong',
              )}
            />
          ))}
        </span>
      }
      footer={
        <>
          {at > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setStep(steps[at - 1]!)}>
              <ChevronLeft className="size-3.5" />
              Back
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {at < steps.length - 1 ? (
            <Button variant="primary" size="sm" disabled={!by.trim()} onClick={() => setStep(steps[at + 1]!)}>
              Continue
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={finish}>
              <Check className="size-3.5" />
              Confirm &amp; advance
            </Button>
          )}
        </>
      }
    >
      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Current status</p>
              <p className="mt-1 text-[15px] font-semibold text-ink">{dispatch.stage}</p>
            </div>
            <div className="rounded-xl border border-good/40 bg-good/10 p-3">
              <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Moving to</p>
              <p className="mt-1 text-[15px] font-semibold text-[#046904] dark:text-[#4ec44e]">{target}</p>
            </div>
          </div>

          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{STAGE_HINT[target]}</p>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Confirmed by
            </span>
            <Input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Who is signing this off" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Notes <span className="font-normal text-ink-3 normal-case">(optional)</span>
            </span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Customer asked for a 2pm drop — driver briefed."
              className="min-h-16 text-[13px]"
            />
          </label>
        </div>
      )}

      {step === 'condition' && (
        <div className="space-y-4">
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            Grade each line as it is right now, at{' '}
            <strong className="text-ink">{STAGE_FAULT[dispatch.stage].toLowerCase()}</strong>. Lines that pass need no
            further input — leave them as they are and continue.
          </p>

          {dispatch.lines.map((line) => {
            const check = checks[line.sku] ?? CLEAN_CHECK
            const clean = verdictFor(check.physical, check.functional) === 'Good'
            return (
              <div key={line.id} className="rounded-xl border border-line">
                <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{line.name}</p>
                    <p className="truncate font-mono text-[11px] text-ink-3">
                      {line.sku}
                      <span className="font-sans"> · {num(line.qtyOrdered)} {line.uom}</span>
                    </p>
                  </div>
                  <VerdictBadge check={check} />
                </div>
                <div className={cn('p-3', clean && 'pb-3')}>
                  <ConditionCheckPanel
                    value={check}
                    maxQty={line.qtyOrdered}
                    atStage={STAGE_FAULT[dispatch.stage]}
                    onChange={(next) => setChecks((c) => ({ ...c, [line.sku]: next }))}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {step === 'location' && (
        <div className="space-y-3">
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
            <MapPin className="mr-1 inline size-3.5 text-brand-500" />
            Click grid cells to pinpoint where this shipment is placed. Click multiple cells when it is split across
            bays; click a selected cell again to remove it.
          </p>
          <LocationGrid value={locations} onChange={setLocations} />
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

function DispatchDetail({ dispatch, onClose }: { dispatch: Dispatch | null; onClose: () => void }) {
  const ops = useOps()
  const bodyRef = React.useRef<HTMLDivElement>(null)
  if (!dispatch) return null

  const otif = otifFor(dispatch)

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={dispatch.no}
      description={`${dispatch.customer} · ${dispatch.soNo} · ${dispatch.warehouse}`}
      headerAside={
        otif.settled ? (
          <Badge tone={otif.otif ? 'good' : 'critical'} dot>
            {otif.otif ? 'OTIF' : otif.onTime ? 'Short' : 'Late'}
          </Badge>
        ) : (
          <Badge tone="info" dot>
            {dispatch.stage}
          </Badge>
        )
      }
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              printRegion(bodyRef.current, {
                title: `Dispatch ${dispatch.no}`,
                subtitle: `${dispatch.customer} · ${dispatch.soNo}`,
                preparedBy: currentUser().name,
              })
            }
          >
            <Printer className="size-3.5" />
            Print picking slip
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-5">
        <StageTracker stage={dispatch.stage} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {/* ------------------------------ Lines ----------------------------- */}
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-[10px] tracking-wider text-ink-3 uppercase">
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Picked</th>
                    <th className="px-3 py-2 text-right">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatch.lines.map((line) => {
                    const short = line.qtyDelivered > 0 && line.qtyDelivered < line.qtyOrdered
                    return (
                      <tr key={line.id} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-2">
                          <span className="block truncate text-ink">{line.name}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-3">{line.sku}</span>
                        </td>
                        <td className="tabular px-3 py-2 text-right text-ink-2">{num(line.qtyOrdered)}</td>
                        <td className="tabular px-3 py-2 text-right text-ink-2">{num(line.qtyPicked)}</td>
                        <td className={cn('tabular px-3 py-2 text-right font-medium', short ? 'text-critical' : 'text-ink')}>
                          {line.qtyDelivered ? num(line.qtyDelivered) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ---------------------------- Timeline ---------------------------- */}
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Hand-over history</p>
              {dispatch.history.length === 0 ? (
                <p className="text-[13px] text-ink-3">Nothing recorded yet — this shipment has not moved.</p>
              ) : (
                <ol className="space-y-2.5">
                  {dispatch.history.map((event, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1 size-2 shrink-0 rounded-full bg-good" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-ink">
                          <strong className="font-medium">{event.stage}</strong>{' '}
                          <span className="text-ink-3">by {event.by}</span>
                        </p>
                        <p className="text-[11px] text-ink-3">{fmtDateTime(event.at)}</p>
                        {event.note && <p className="mt-0.5 text-[12px] text-ink-2">{event.note}</p>}
                        {event.checks.map((c, j) => (
                          <p key={j} className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <VerdictBadge check={c.check} />
                            <span className="font-mono text-ink-3">{c.sku}</span>
                            <span className="text-ink-2">
                              {c.check.qty} unit{c.check.qty === 1 ? '' : 's'} · {c.check.stage} · {c.check.liability} ·{' '}
                              {c.check.disposition}
                            </span>
                          </p>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* ------------------------------ OTIF ------------------------------ */}
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">OTIF for this drop</p>
              {otif.settled ? (
                <div className="mt-2 space-y-1.5 text-[13px]">
                  <p className="flex items-center justify-between">
                    <span className="text-ink-2">On time</span>
                    <Badge tone={otif.onTime ? 'good' : 'critical'}>
                      {otif.onTime ? 'Yes' : `${otif.hoursLate}h late`}
                    </Badge>
                  </p>
                  <p className="flex items-center justify-between">
                    <span className="text-ink-2">In full</span>
                    <Badge tone={otif.inFull ? 'good' : 'critical'}>
                      {otif.inFull ? 'Yes' : `${otif.shortLines} line${otif.shortLines === 1 ? '' : 's'} short`}
                    </Badge>
                  </p>
                  <p className="mt-2 border-t border-line pt-2 text-[11px] text-ink-3">
                    Promised {fmtDateTime(dispatch.promisedAt)} · delivered {fmtDateTime(dispatch.deliveredAt!)}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 text-[13px] text-ink-3">
                  Not settled yet. Promised {fmtDateTime(dispatch.promisedAt)}.
                </p>
              )}
            </div>

            {/* ------------------------------- Map ------------------------------ */}
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                <MapIcon className="size-3.5 text-ink-3" />
                Delivery route
              </p>
              <DeliveryRouteMap dispatches={[dispatch]} focusId={dispatch.id} height={220} />
              <RouteSummary dispatch={dispatch} className="mt-3" />
            </div>

            {/* ---------------------------- Placement --------------------------- */}
            <div data-print="hide">
              <p className="mb-2 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Storage location</p>
              <LocationGrid
                compact
                value={dispatch.locations}
                onChange={(next) => ops.setDispatchLocations(dispatch.id, next)}
              />
            </div>

            <div className="rounded-xl border border-line p-3 text-[13px]">
              <p className="flex items-center gap-2 text-ink-2">
                <User className="size-3.5 text-ink-3" />
                Driver <strong className="ml-auto font-medium text-ink">{dispatch.driver}</strong>
              </p>
              <p className="mt-1.5 flex items-center gap-2 text-ink-2">
                <Truck className="size-3.5 text-ink-3" />
                Vehicle <strong className="ml-auto font-medium text-ink">{dispatch.vehicle}</strong>
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

function DispatchCard({
  dispatch,
  onAdvance,
  onOpen,
}: {
  dispatch: Dispatch
  onAdvance: () => void
  onOpen: () => void
}) {
  const target = nextStage(dispatch.stage)
  const otif = otifFor(dispatch)
  const pieces = piecesOf(dispatch)

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="grad-brand flex items-center justify-between gap-2 px-3 py-2 text-white">
        <span className="flex min-w-0 items-center gap-1.5">
          <Package className="size-3.5 shrink-0 opacity-90" />
          <span className="truncate text-[13px] font-semibold">{dispatch.no}</span>
        </span>
        <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
          {dispatch.stage}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex items-start gap-2">
          <span className="grad-brand-soft flex size-8 shrink-0 items-center justify-center rounded-lg">
            <User className="size-4 text-brand-500" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-ink">{dispatch.customer}</span>
            <span className="block truncate text-[11px] text-ink-3">
              {num(pieces)} pcs · {dispatch.destination.city}
            </span>
          </span>
        </div>

        <StageTracker stage={dispatch.stage} size="sm" />

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge tone={otif.settled ? (otif.otif ? 'good' : 'critical') : 'neutral'}>
            <CalendarClock className="size-3" />
            {otif.settled
              ? otif.otif
                ? 'On time, in full'
                : otif.onTime
                  ? `${otif.shortLines} short`
                  : `${otif.hoursLate}h late`
              : `due ${fmtDate(dispatch.promisedAt)}`}
          </Badge>
          <LocationChips locations={dispatch.locations} />
        </div>

        <div className="mt-auto flex flex-wrap gap-1.5">
          {target ? (
            <Button variant="primary" size="sm" className="flex-1" onClick={onAdvance}>
              Mark as {target}
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <span className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-good/10 px-3 py-1.5 text-[12px] font-medium text-[#046904] dark:text-[#4ec44e]">
              <Check className="size-3.5" />
              Fulfilled
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={onOpen}>
            Details
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

type View = 'active' | 'settled' | 'all'

export function DispatchBoard() {
  const dispatches = useOps((s) => s.dispatches)
  const pageRef = React.useRef<HTMLDivElement>(null)

  const [view, setView] = React.useState<View>('active')
  const [query, setQuery] = React.useState('')
  const [advancing, setAdvancing] = React.useState<string | null>(null)
  const [opened, setOpened] = React.useState<string | null>(null)
  const [mapFocus, setMapFocus] = React.useState<string | null>(null)

  useSeedFloor()

  const otif = React.useMemo(() => otifRate(dispatches), [dispatches])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return dispatches.filter((d) => {
      if (q && !`${d.no} ${d.soNo} ${d.customer} ${d.destination.city}`.toLowerCase().includes(q)) return false
      const settled = stageIndex(d.stage) >= stageIndex('Delivered')
      if (view === 'active') return !settled
      if (view === 'settled') return settled
      return true
    })
  }, [dispatches, query, view])

  const grouped = React.useMemo(
    () =>
      DISPATCH_STAGES.map((stage) => ({ stage, rows: visible.filter((d) => d.stage === stage) })).filter(
        (group) => group.rows.length > 0,
      ),
    [visible],
  )

  const late = dispatches.filter((d) => {
    const result = otifFor(d)
    return result.settled ? result.onTime === false : new Date(d.promisedAt) < new Date()
  }).length

  return (
    <div ref={pageRef}>
      <PageHeader
        title="Pick, Pack & Dispatch"
        description="Every shipment on one board, each with one button: the next thing that happens to it. Advancing a card records who confirmed it, what condition the goods were in, and where they went."
        meta={
          <>
            <Badge tone="brand" dot>
              OTIF is the department KPI
            </Badge>
            <Badge tone="neutral">{num(dispatches.length)} shipments</Badge>
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              printRegion(pageRef.current, {
                title: 'Dispatch Board',
                subtitle: `${visible.length} shipments`,
                preparedBy: currentUser().name,
              })
            }
          >
            <Printer className="size-3.5" />
            <span className="hidden sm:inline">Print board</span>
          </Button>
        }
      />

      <StatGrid className="mb-4">
        <StatTile
          label="OTIF"
          value={otif.rate == null ? '—' : percent(otif.rate)}
          icon={Gauge}
          hint={otif.rate == null ? 'nothing delivered yet' : `across ${num(otif.settled)} settled drops`}
          progress={otif.rate == null ? undefined : { value: otif.rate, tone: otif.rate >= 95 ? 'good' : otif.rate >= 85 ? 'warning' : 'critical' }}
        />
        <StatTile
          label="On time"
          value={otif.onTime == null ? '—' : percent(otif.onTime)}
          icon={Timer}
          hint="delivered by the promised date"
        />
        <StatTile
          label="In full"
          value={otif.inFull == null ? '—' : percent(otif.inFull)}
          icon={ClipboardCheck}
          hint="every line at the ordered quantity"
        />
        <StatTile
          label="Running late"
          value={num(late)}
          icon={CalendarClock}
          hint={late === 0 ? 'nothing past its promise' : 'past the promised date'}
        />
      </StatGrid>

      {/* ------------------------------- Toolbar ------------------------------ */}
      <Card className="mb-4 p-3" data-print="hide">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:min-w-[14rem]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a shipment, order, customer or city…"
              className="h-9 pl-8"
            />
          </div>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'active', label: 'On the floor' },
              { value: 'settled', label: 'Delivered' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
      </Card>

      {/* --------------------------------- Map -------------------------------- */}
      <Card className="mb-4 overflow-hidden" data-print="keep">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">Where today's loads are going</h3>
            <p className="mt-0.5 text-xs text-ink-3">
              Click a route to focus it. The marker shows the stage, not a GPS fix.
            </p>
          </div>
          {mapFocus && (
            <Button variant="ghost" size="xs" onClick={() => setMapFocus(null)}>
              Show all routes
            </Button>
          )}
        </div>
        <div className="grid gap-4 px-4 pb-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <DeliveryRouteMap
            dispatches={visible.length ? visible : dispatches}
            focusId={mapFocus}
            onSelect={(d) => setMapFocus((current) => (current === d.id ? null : d.id))}
            height={300}
          />
          <div>
            {(() => {
              const focused = dispatches.find((d) => d.id === mapFocus)
              if (!focused) {
                return (
                  <p className="text-[13px] text-ink-3">
                    {visible.length} route{visible.length === 1 ? '' : 's'} drawn. Pick one on the map — or open a card —
                    to see the distance, the estimated run and where it currently sits.
                  </p>
                )
              }
              return (
                <>
                  <p className="text-[13px] font-semibold text-ink">{focused.no}</p>
                  <p className="mb-3 text-[11px] text-ink-3">{focused.customer}</p>
                  <RouteSummary dispatch={focused} />
                </>
              )
            })()}
          </div>
        </div>
      </Card>

      {/* -------------------------------- Board ------------------------------- */}
      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={Truck}
            title="Nothing here"
            description="No shipment matches this view. Try 'All', or clear the search."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.stage}>
              <div className="mb-2.5 flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-ink">{group.stage}</h2>
                <Badge tone="neutral">{group.rows.length}</Badge>
                <span className="hidden text-[11px] text-ink-3 sm:inline">{STAGE_HINT[group.stage as DispatchStage]}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {group.rows.map((dispatch) => (
                  <DispatchCard
                    key={dispatch.id}
                    dispatch={dispatch}
                    onAdvance={() => setAdvancing(dispatch.id)}
                    onOpen={() => setOpened(dispatch.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <AdvanceWizard
        dispatch={dispatches.find((d) => d.id === advancing) ?? null}
        onClose={() => setAdvancing(null)}
      />
      <DispatchDetail dispatch={dispatches.find((d) => d.id === opened) ?? null} onClose={() => setOpened(null)} />
    </div>
  )
}

/** Exported for the dashboard, which reports the same number. */
export function useOtif() {
  const dispatches = useOps((s) => s.dispatches)
  return React.useMemo(() => otifRate(dispatches), [dispatches])
}

/** Units that actually reached customers — used by the dashboard's throughput. */
export function deliveredUnits(dispatches: Dispatch[]) {
  return dispatches.reduce((sum, d) => sum + deliveredOf(d), 0)
}
