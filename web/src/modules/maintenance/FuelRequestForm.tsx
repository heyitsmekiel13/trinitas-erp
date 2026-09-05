import * as React from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Crosshair, Loader2, MapPin, RefreshCw, Route, Send, Truck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fmtDate, money, num } from '@/lib/format'
import { useResource } from '@/lib/api'
import {
  createFuelRequest,
  getFuelPrice,
  getFuelRequest,
  previewRoute,
  updateFuelRequest,
  type FuelPriceToday,
  type FuelRequestRecord,
  type RoutePreview,
} from '@/lib/adminApi'
import { currentUser } from '@/app/auth'
import { EMPTY_ADDRESS, HOME_SITE, formatAddress, hasAddress, type AddressParts, type LatLng } from '@/lib/places'
import { AddressFields, PlaceSearchBox, useAddressForPoint } from '@/components/data/PlacePicker'
import { RouteMap } from '@/components/data/RouteMap'
import { Badge, Button, Combobox, Field, Input, Select, Switch, Textarea } from '@/components/ui/primitives'
import { DEFAULT_SUPPLIER, FUEL_PRODUCTS, FUEL_UNITS, OWNERSHIP_CODES, PO_CATEGORIES } from './fuelForm'
import { useToast } from '@/components/ui/feedback'
import { FuelRequestSheet } from './FuelRequestSheet'

/**
 * Raising a fuel request, four questions at a time.
 *
 * The form asks for twenty-odd things. Shown all at once — which is how it
 * started — that is a wall, and a wall gets abandoned or filled in carelessly.
 * The second is worse: a trip ticket with a guessed destination produces a
 * litre figure nobody can check, which defeats the point of the document.
 *
 * So it is four steps, in the order the answers actually arrive:
 *
 *   1. Trip      who is going, in what, on whose budget, and why
 *   2. Route     where from and to — the map, and the address it implies
 *   3. Fuel      what to pump, how much margin, at what price
 *   4. Review    the whole thing once, then submit
 *
 * Each step validates before it will advance, so an error lands beside the
 * field that caused it rather than at the foot of a long scroll. Everything
 * the system can answer for itself — the department, the price, the origin,
 * the distance, the litres, the address under the pin — is answered, and every
 * one of those stays editable.
 */

type Vehicle = {
  id: number
  plate: string
  model: string
  fuelEfficiency: number
  ownership: 'CO' | 'PO' | 'R&C'
  vehicleType?: string | null
}
type Employee = { id: number; fullName: string; position?: string; department?: string }
type Department = { id: number; code: string; name: string }

const SOURCE_LABEL: Record<RoutePreview['source'], { text: string; tone: 'good' | 'info' | 'warning' }> = {
  google: { text: 'Google Directions', tone: 'good' },
  osrm: { text: 'OpenStreetMap routing', tone: 'info' },
  'straight-line': { text: 'Direct line estimate', tone: 'warning' },
}

const hoursMinutes = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`

/* -------------------------------------------------------------------------- */
/* Legs — one trip, one or more destinations                                  */
/* -------------------------------------------------------------------------- */

export type Leg = {
  _uid: string
  originLabel: string
  origin: LatLng | null
  originParts: AddressParts
  destinationLabel: string
  destination: LatLng | null
  destParts: AddressParts
  roundTrip: boolean
}

let legUidCounter = 0
const nextLegUid = () => `leg-${++legUidCounter}`

const emptyLeg = (from?: { label: string; point: LatLng }): Leg => ({
  _uid: nextLegUid(),
  originLabel: from?.label ?? '',
  origin: from?.point ?? null,
  originParts: EMPTY_ADDRESS,
  destinationLabel: '',
  destination: null,
  destParts: EMPTY_ADDRESS,
  roundTrip: true,
})

/**
 * One leg of the trip: where it starts, where it ends, and whether it comes
 * back the same way. Collapsed to a single line once it has both ends set —
 * a driver planning four stops does not need four open maps fighting for
 * scroll space, only the one they are currently pinning.
 */
function LegCard({
  leg,
  index,
  expanded,
  onToggle,
  onUpdate,
  onRemove,
  route,
  pricing,
  fuelPrice,
  vehicleOwnership,
}: {
  leg: Leg
  index: number
  expanded: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<Leg>) => void
  onRemove: (() => void) | null
  route: RoutePreview | null
  pricing: boolean
  fuelPrice: number
  vehicleOwnership: 'CO' | 'PO' | 'R&C'
}) {
  const [picking, setPicking] = React.useState<'origin' | 'destination' | null>(null)
  const [locating, setLocating] = React.useState<'origin' | 'destination' | null>(null)
  const toast = useToast()

  const setOriginAddress = useAddressForPoint(leg.origin, leg.originParts, (p) => onUpdate({ originParts: p }), expanded)
  const setDestAddress = useAddressForPoint(leg.destination, leg.destParts, (p) => onUpdate({ destParts: p }), expanded)

  const complete = Boolean(leg.origin && leg.destination)

  /**
   * Drops the pin on wherever the browser says this device actually is,
   * rather than making someone hunt for their own position on the map or
   * type an address for a place they are standing in right now.
   *
   * Same write `onPick`/`onDrag` already make — a raw point, nothing else —
   * so it goes through the exact same reverse-geocode effect
   * (`useAddressForPoint`) that fills in the address fields either of those
   * paths would have triggered.
   */
  const useMyLocation = (which: 'origin' | 'destination') => {
    if (!navigator.geolocation) {
      toast({ tone: 'error', title: 'Location is not available in this browser.' })
      return
    }
    setLocating(which)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: LatLng = { lat: position.coords.latitude, lng: position.coords.longitude }
        if (which === 'origin') onUpdate({ origin: point })
        else {
          onUpdate({
            destination: point,
            destinationLabel: leg.destinationLabel || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
          })
        }
        setLocating(null)
      },
      (err) => {
        setLocating(null)
        toast({
          tone: 'error',
          title: 'Could not get your location',
          description: err.code === err.PERMISSION_DENIED ? 'Location access was denied.' : err.message,
        })
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-surface-2"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-bold text-ink-2">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {leg.originLabel || 'Starting point'} <ChevronRight className="inline size-3 text-ink-3" />{' '}
            {leg.destinationLabel || 'Destination'}
          </span>
          {!expanded && route && (
            <span className="text-[11px] text-ink-3">
              {num(route.distanceKm, 1)} km · {hoursMinutes(route.durationMinutes)}
              {leg.roundTrip && ' · return'}
            </span>
          )}
          {!expanded && !complete && <span className="text-[11px] text-warning">Not set yet</span>}
        </span>
        {onRemove && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                onRemove()
              }
            }}
            aria-label={`Remove leg ${index + 1}`}
            className="rounded-md p-1 text-ink-3 hover:bg-critical/10 hover:text-critical"
          >
            ✕
          </span>
        )}
        <ChevronRight className={cn('size-4 shrink-0 text-ink-3 transition-transform', expanded && 'rotate-90')} />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-good text-[10px] font-bold text-white">
                  A
                </span>
                <span className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Starts at</span>
              </div>
              <PlaceSearchBox
                value={leg.originLabel}
                point={leg.origin}
                onPick={(p, label, parts) =>
                  onUpdate({ origin: p, originLabel: label, ...(hasAddress(parts) ? { originParts: parts } : {}) })
                }
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant={picking === 'origin' ? 'primary' : 'ghost'}
                  size="xs"
                  onClick={() => setPicking(picking === 'origin' ? null : 'origin')}
                >
                  <MapPin className="size-3" />
                  {picking === 'origin' ? 'Click the map…' : 'Pick on map'}
                </Button>
                <Button variant="ghost" size="xs" disabled={locating === 'origin'} onClick={() => useMyLocation('origin')}>
                  {locating === 'origin' ? <Loader2 className="size-3 animate-spin" /> : <Crosshair className="size-3" />}
                  Use my location
                </Button>
              </div>
            </div>

            <div className="card p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-critical text-[10px] font-bold text-white">
                  B
                </span>
                <span className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Ends at</span>
              </div>
              <PlaceSearchBox
                value={leg.destinationLabel}
                point={leg.destination}
                onPick={(p, label, parts) =>
                  onUpdate({
                    destination: p,
                    destinationLabel: label,
                    ...(hasAddress(parts) ? { destParts: parts } : {}),
                  })
                }
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant={picking === 'destination' ? 'primary' : 'ghost'}
                  size="xs"
                  onClick={() => setPicking(picking === 'destination' ? null : 'destination')}
                >
                  <MapPin className="size-3" />
                  {picking === 'destination' ? 'Click the map…' : 'Pick on map'}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={locating === 'destination'}
                  onClick={() => useMyLocation('destination')}
                >
                  {locating === 'destination' ? <Loader2 className="size-3 animate-spin" /> : <Crosshair className="size-3" />}
                  Use my location
                </Button>
              </div>
            </div>
          </div>

          <RouteMap
            origin={leg.origin}
            destination={leg.destination}
            polyline={route?.polyline}
            picking={picking}
            height={260}
            onPick={(point) => {
              if (picking === 'origin') onUpdate({ origin: point })
              else if (picking === 'destination') {
                onUpdate({
                  destination: point,
                  destinationLabel: leg.destinationLabel || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
                })
              }
              setPicking(null)
            }}
            onDrag={(which, point) => onUpdate(which === 'origin' ? { origin: point } : { destination: point })}
          />

          <div className="card p-4">
            <p className="mb-3 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Destination address</p>
            <AddressFields parts={leg.destParts} onChange={setDestAddress} />
          </div>

          <details className="card p-4">
            <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
              Origin address
            </summary>
            <div className="mt-3">
              <AddressFields parts={leg.originParts} onChange={setOriginAddress} />
            </div>
          </details>

          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Route className="size-4 text-brand-500" />
              <span className="text-[13px] font-semibold text-ink">Measured</span>
              {route && <Badge tone={SOURCE_LABEL[route.source].tone}>{SOURCE_LABEL[route.source].text}</Badge>}
              {pricing && <span className="text-[11px] text-ink-3">working it out…</span>}
            </div>

            {!route ? (
              <p className="text-[12px] text-ink-3">Set both ends and the distance and time appear here.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                {[
                  ['Distance', `${num(route.distanceKm, 1)} km`, leg.roundTrip ? 'there and back' : 'one way'],
                  ['Travel time', hoursMinutes(route.durationMinutes), leg.roundTrip ? 'both legs' : 'one way'],
                  ...(vehicleOwnership === 'PO'
                    ? [['Reimbursement', money(route.mileageAmount ?? 0, { decimals: false }), 'this leg']]
                    : [
                        ['Fuel', `${num(route.suggestedLitres ?? 0, 2)} L`, 'this leg'],
                        ['Cost', money(route.estimatedCost ?? 0, { decimals: false }), `at ${money(fuelPrice)}/L`],
                      ]),
                ].map(([label, value, hint]) => (
                  <div key={label}>
                    <p className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
                    <p className="tabular text-[15px] font-semibold text-ink">{value}</p>
                    <p className="text-[11px] text-ink-3">{hint}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="card flex items-center justify-between gap-3 p-4">
            <span>
              <span className="block text-[13px] font-medium text-ink">Return leg</span>
              <span className="text-[11px] text-ink-3">Doubles this leg's distance and fuel.</span>
            </span>
            <Switch checked={leg.roundTrip} onChange={(v) => onUpdate({ roundTrip: v })} label="Return leg" />
          </label>
        </div>
      )}
    </div>
  )
}

const STEPS = [
  { id: 'trip', label: 'The trip', short: 'Trip' },
  { id: 'route', label: 'Where to', short: 'Route' },
  { id: 'fuel', label: 'Fuel & order', short: 'Fuel' },
  { id: 'review', label: 'Check & submit', short: 'Review' },
] as const

function Steps({ current, onJump }: { current: number; onJump: (i: number) => void }) {
  return (
    <ol className="mb-5 flex items-center gap-1 overflow-x-auto pb-1" aria-label="Progress">
      {STEPS.map((step, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={step.id} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              // Going back is free; jumping ahead is not, because each step is
              // built out of the answers before it.
              disabled={i > current}
              onClick={() => onJump(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                active
                  ? 'grad-brand text-white shadow-sm'
                  : done
                    ? 'text-ink-2 hover:bg-surface-2'
                    : 'cursor-not-allowed text-ink-3',
              )}
            >
              <span
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-full text-[10px] font-semibold',
                  active ? 'bg-white/20' : done ? 'bg-good/15 text-good' : 'bg-surface-3 text-ink-3',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
              <span className="sm:hidden">{step.short}</span>
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="size-3 shrink-0 text-ink-3" aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

/* -------------------------------------------------------------------------- */

export function FuelRequestForm({
  editId,
  onCreated,
}: {
  editId?: number | null
  onCreated?: (r: FuelRequestRecord) => void
}) {
  const toast = useToast()
  const [loading, setLoading] = React.useState(Boolean(editId))
  const [step, setStep] = React.useState(0)

  const { data: vehicles = [] } = useResource<Vehicle[]>('maintenance/fleet', () => [])
  const { data: employees = [] } = useResource<Employee[]>('hr/employees', () => [])
  const { data: departments = [] } = useResource<Department[]>('hr/departments', () => [])

  const [vehicleId, setVehicleId] = React.useState<number | null>(null)
  const [driverId, setDriverId] = React.useState<number | null>(null)
  const [businessUnit, setBusinessUnit] = React.useState('')
  const [purpose, setPurpose] = React.useState('')
  const [departAt, setDepartAt] = React.useState('')
  const [notes, setNotes] = React.useState('')

  /*
   * The trip starts at the office unless somebody says otherwise. Nearly every
   * run does, and making a driver search for their own workplace is friction
   * that buys nothing. One leg to start — a second, third, etc. destination
   * is added explicitly, since most trips only ever have the one.
   */
  const [legs, setLegs] = React.useState<Leg[]>(() => [emptyLeg({ label: HOME_SITE.label, point: { ...HOME_SITE.point } })])
  const [expandedLeg, setExpandedLeg] = React.useState<string | null>(() => legs[0]._uid)
  const [legRoutes, setLegRoutes] = React.useState<Record<string, RoutePreview | null>>({})

  const [supplier, setSupplier] = React.useState(DEFAULT_SUPPLIER)
  const [ownership, setOwnership] = React.useState<'CO' | 'PO' | 'R&C'>('CO')
  const [poCategory, setPoCategory] = React.useState('')
  const [products, setProducts] = React.useState<string[]>(['Diesel - MAX'])
  const [productOther, setProductOther] = React.useState('')
  const [unit, setUnit] = React.useState('Litres')

  const [reservePct, setReservePct] = React.useState(10)
  const [fuelPrice, setFuelPrice] = React.useState(0)
  const [priceInfo, setPriceInfo] = React.useState<FuelPriceToday | null>(null)
  const [priceLoading, setPriceLoading] = React.useState(false)

  const [pricing, setPricing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [created, setCreated] = React.useState<FuelRequestRecord | null>(null)

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null

  const updateLeg = (uid: string, patch: Partial<Leg>) =>
    setLegs((current) => current.map((leg) => (leg._uid === uid ? { ...leg, ...patch } : leg)))

  const addLeg = () => {
    const last = legs[legs.length - 1]
    const next = emptyLeg(
      last?.destination ? { label: last.destinationLabel, point: last.destination } : undefined,
    )
    setLegs((current) => [...current, next])
    setExpandedLeg(next._uid)
  }

  const removeLeg = (uid: string) => {
    setLegs((current) => {
      const rest = current.filter((leg) => leg._uid !== uid)
      if (expandedLeg === uid) setExpandedLeg(rest[rest.length - 1]?._uid ?? null)
      return rest
    })
  }

  // The trip's totals — every leg's own measured distance/time/fuel or
  // mileage, added together. This is exactly what the server itself computes
  // from summed distance, since litres and mileage are both linear in
  // distance for a fixed economy/rate — a leg-by-leg sum and a
  // sum-then-compute give the identical answer.
  const route = React.useMemo<RoutePreview | null>(() => {
    const measured = legs.map((l) => legRoutes[l._uid]).filter((r): r is RoutePreview => Boolean(r))
    if (measured.length === 0 || measured.length !== legs.length) return null

    const sourceRank = { google: 0, osrm: 1, 'straight-line': 2 } as const
    const worst = measured.reduce((a, b) => (sourceRank[b.source] > sourceRank[a.source] ? b : a))

    return {
      distanceKm: measured.reduce((s, r) => s + r.distanceKm, 0),
      durationMinutes: measured.reduce((s, r) => s + r.durationMinutes, 0),
      source: worst.source,
      note: worst.note,
      polyline: measured.flatMap((r) => r.polyline),
      roundTrip: legs.length === 1 ? legs[0].roundTrip : false,
      vehicleOwnership: ownership,
      kmPerLitre: measured[0]?.kmPerLitre,
      reservePct: measured[0]?.reservePct,
      suggestedLitres: measured.reduce((s, r) => s + (r.suggestedLitres ?? 0), 0),
      estimatedCost: measured.reduce((s, r) => s + (r.estimatedCost ?? 0), 0),
      mileageRate: measured[0]?.mileageRate,
      mileageAmount: measured.reduce((s, r) => s + (r.mileageAmount ?? 0), 0),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, legRoutes, ownership])

  /**
   * The trip ticket defaults its ownership box from the vehicle's own record
   * — the usual case is that whoever owns the vehicle owns every trip it
   * makes — but stays a free choice per trip, since a company vehicle can
   * still show up on a rented-and-chartered order in the odd case.
   *
   * Skipped while editing: an existing request already has its own answer
   * loaded from the record, and this would otherwise clobber it the moment
   * the vehicle field's effect runs.
   */
  React.useEffect(() => {
    if (editId || !vehicle) return
    setOwnership(vehicle.ownership)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, vehicleId])

  /* ------------------------------- defaults ------------------------------- */

  const loadPrice = React.useCallback(async (refresh = false) => {
    setPriceLoading(true)
    try {
      const today = await getFuelPrice(refresh)
      setPriceInfo(today)
      setFuelPrice(today.price)
    } catch {
      // Leave whatever is in the box; a missing feed must not zero the price.
    } finally {
      setPriceLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!editId) void loadPrice()
  }, [editId, loadPrice])

  /** Charged to the issuer's own department unless they change it. */
  React.useEffect(() => {
    if (editId || businessUnit) return
    const mine = currentUser()?.department
    if (mine) setBusinessUnit(mine)
  }, [editId, businessUnit])

  /**
   * The department list, with whatever is already selected folded in.
   *
   * A combobox only shows a value it has an option for, so an issuer whose
   * department is not on the HR list would otherwise open the form with the
   * field looking empty while a value is quietly attached to it.
   */
  const departmentOptions = React.useMemo(() => {
    const options = departments.map((d) => ({ value: d.name, label: d.name, sublabel: d.code }))
    return businessUnit && !options.some((o) => o.value === businessUnit)
      ? [...options, { value: businessUnit, label: businessUnit, sublabel: 'not in the HR list' }]
      : options
  }, [departments, businessUnit])

  /* -------------------------------- loading ------------------------------- */

  React.useEffect(() => {
    if (!editId) return
    let cancelled = false

    getFuelRequest(editId)
      .then((r) => {
        if (cancelled) return
        setVehicleId(r.vehicleId)
        setDriverId(r.driverId)
        setPurpose(r.purpose)
        setDepartAt(r.departAt ? new Date(r.departAt).toISOString().slice(0, 16) : '')
        setNotes(r.notes ?? '')
        // A request raised before legs existed has none on the record —
        // fall back to its header origin/destination as a single leg so an
        // old trip ticket is still fully editable.
        const loadedLegs: Leg[] =
          r.legs && r.legs.length > 0
            ? r.legs.map((leg) => ({
                _uid: nextLegUid(),
                originLabel: leg.originLabel,
                origin: { lat: leg.originLat, lng: leg.originLng },
                originParts: EMPTY_ADDRESS,
                destinationLabel: leg.destinationLabel,
                destination: { lat: leg.destinationLat, lng: leg.destinationLng },
                destParts: EMPTY_ADDRESS,
                roundTrip: leg.roundTrip,
              }))
            : [
                {
                  _uid: nextLegUid(),
                  originLabel: r.originLabel,
                  origin: { lat: r.originLat, lng: r.originLng },
                  originParts: EMPTY_ADDRESS,
                  destinationLabel: r.destinationLabel,
                  destination: { lat: r.destinationLat, lng: r.destinationLng },
                  destParts: EMPTY_ADDRESS,
                  roundTrip: r.roundTrip,
                },
              ]
        setLegs(loadedLegs)
        setExpandedLeg(loadedLegs[0]._uid)
        setReservePct(r.reservePct)
        setFuelPrice(r.fuelPrice)
        setBusinessUnit(r.businessUnit ?? '')
        setSupplier(r.supplier || DEFAULT_SUPPLIER)
        setOwnership(r.vehicleOwnership)
        setPoCategory(r.poCategory ?? '')
        setProducts(r.products ?? [])
        setProductOther(r.productOther ?? '')
        setUnit(r.unit)
      })
      .catch((err) => toast({ tone: 'error', title: 'Could not load it', description: (err as Error).message }))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  /* -------------------------------- pricing ------------------------------- */

  const readyLegs = legs.filter((l) => l.origin && l.destination)

  React.useEffect(() => {
    if (readyLegs.length === 0) {
      setLegRoutes({})
      return
    }

    let cancelled = false
    setPricing(true)

    const timer = setTimeout(async () => {
      try {
        const entries = await Promise.all(
          readyLegs.map(async (leg) => {
            const result = await previewRoute({
              originLat: leg.origin!.lat,
              originLng: leg.origin!.lng,
              destinationLat: leg.destination!.lat,
              destinationLng: leg.destination!.lng,
              vehicleId,
              roundTrip: leg.roundTrip,
              reservePct,
              fuelPrice,
              vehicleOwnership: ownership,
            })
            return [leg._uid, result] as const
          }),
        )
        if (!cancelled) setLegRoutes(Object.fromEntries(entries))
      } catch (err) {
        if (!cancelled) {
          toast({ tone: 'error', title: 'Could not work out the route', description: (err as Error).message })
        }
      } finally {
        if (!cancelled) setPricing(false)
      }
    }, 450)

    return () => {
      cancelled = true
      clearTimeout(timer)
      setPricing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyLegs.map((l) => `${l._uid}:${l.origin?.lat},${l.origin?.lng},${l.destination?.lat},${l.destination?.lng},${l.roundTrip}`).join('|'), vehicleId, reservePct, fuelPrice, ownership])

  const eta = React.useMemo(() => {
    if (!departAt || !route) return null
    const start = new Date(departAt)
    if (Number.isNaN(start.getTime())) return null
    return new Date(start.getTime() + route.durationMinutes * 60_000)
  }, [departAt, route])

  /* ------------------------------- navigation ----------------------------- */

  const blocking = (index: number): string | null => {
    if (index === 0) {
      if (!vehicleId) return 'Choose the vehicle.'
      if (!purpose.trim()) return 'Say what the trip is for.'
      return null
    }
    if (index === 1) {
      const incomplete = legs.find((l) => !l.origin || !l.originLabel.trim() || !l.destination || !l.destinationLabel.trim())
      if (incomplete) return `Set both ends of leg ${legs.indexOf(incomplete) + 1}.`
      if (!route) return 'Still measuring the route — one moment.'
      return null
    }
    if (index === 2) {
      if (!supplier.trim()) return 'Name the service station this order is addressed to.'
      if (!products.length && !productOther.trim()) return 'Tick at least one product.'
      return null
    }
    return null
  }

  const next = () => {
    const stop = blocking(step)
    if (stop) return setError(stop)
    setError('')
    setStep((s) => Math.min(STEPS.length - 1, s + 1))
  }

  const back = () => {
    setError('')
    setStep((s) => Math.max(0, s - 1))
  }

  /* -------------------------------- submit -------------------------------- */

  const submit = async () => {
    for (let i = 0; i < 3; i++) {
      const stop = blocking(i)
      if (stop) {
        setStep(i)
        return setError(stop)
      }
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        vehicleId,
        driverId,
        purpose: purpose.trim(),
        // Local wall time converted to an instant — the API stores UTC, and
        // handing it "07:00" unconverted books the trip eight hours out.
        departAt: departAt ? new Date(departAt).toISOString() : null,
        legs: legs.map((leg) => ({
          originLabel: formatAddress(leg.originParts, leg.originLabel) || leg.originLabel.trim(),
          originLat: leg.origin!.lat,
          originLng: leg.origin!.lng,
          destinationLabel: formatAddress(leg.destParts, leg.destinationLabel) || leg.destinationLabel.trim(),
          destinationLat: leg.destination!.lat,
          destinationLng: leg.destination!.lng,
          roundTrip: leg.roundTrip,
        })),
        reservePct,
        fuelPrice,
        notes: notes.trim() || null,
        businessUnit: businessUnit.trim() || null,
        supplier: supplier.trim() || null,
        vehicleOwnership: ownership,
        poCategory: poCategory || null,
        products,
        productOther: productOther.trim() || null,
        unit,
      }

      const record = editId ? await updateFuelRequest(editId, payload) : await createFuelRequest(payload)
      setCreated(record)
      onCreated?.(record)
      toast({
        tone: 'success',
        title: `${record.reference} ${editId ? 'updated' : 'submitted'}`,
        description: editId
          ? 'The route was re-measured, so the litres match the trip as it now stands.'
          : 'A supervisor, manager or administrator can approve it now.',
      })
    } catch (err) {
      toast({
        tone: 'error',
        title: editId ? 'Could not save the changes' : 'Could not submit',
        description: (err as Error).message,
      })
    } finally {
      setSaving(false)
    }
  }

  /* -------------------------------- states -------------------------------- */

  if (loading) return <p className="py-16 text-center text-[13px] text-ink-3">Loading the request…</p>

  if (created) {
    return (
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-3 p-4" data-print="hide">
          <span className="flex size-9 items-center justify-center rounded-full bg-good/15">
            <Check className="size-5 text-good" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">
              {created.reference} {editId ? 'has been updated' : 'is with the approvers'}
            </p>
            <p className="text-[12px] text-ink-3">
              Print the form now if the driver needs a copy, or wait for the approved version.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Print
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setCreated(null)
              setStep(0)
            }}
          >
            Raise another
          </Button>
        </div>
        <FuelRequestSheet request={created} />
      </div>
    )
  }

  /* ================================== steps ================================ */

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Steps current={step} onJump={(i) => i <= step && (setError(''), setStep(i))} />

      {/* -------------------------------- 1. trip ---------------------------- */}
      {step === 0 && (
        <div className="card space-y-4 p-5">
          <Field label="Vehicle" required composite>
            <Combobox
              value={vehicleId}
              options={vehicles.map((v) => ({
                value: v.id,
                label: v.plate,
                sublabel: `${v.model}${v.fuelEfficiency ? ` · ${v.fuelEfficiency} km/L` : ' · no economy yet'}`,
              }))}
              onChange={(v) => setVehicleId(v === null ? null : Number(v))}
              placeholder="Choose a vehicle…"
            />
          </Field>

          <Field label="Driver" hint="Anybody on the payroll, not just the maintenance roster." composite>
            <Combobox
              value={driverId}
              options={employees.map((e) => ({
                value: e.id,
                label: e.fullName,
                sublabel: [e.position, e.department].filter(Boolean).join(' · '),
              }))}
              onChange={(v) => setDriverId(v === null ? null : Number(v))}
              placeholder="Search every employee…"
            />
          </Field>

          <Field
            label="Business unit"
            hint="Filled in from your own department. Change it if the trip belongs to another."
            composite
          >
            <Combobox
              value={businessUnit}
              options={departmentOptions}
              onChange={(v) => setBusinessUnit(v === null ? '' : String(v))}
              placeholder="Search departments…"
            />
          </Field>

          <Field label="What is the trip for?" required>
            <Input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Deliver 40 cases to Davao branch"
            />
          </Field>

          <Field label="Leaving" hint="Sets the arrival estimate on the next step.">
            <Input type="datetime-local" value={departAt} onChange={(e) => setDepartAt(e.target.value)} />
          </Field>

          {vehicle && vehicle.ownership === 'PO' && (
            <p className="rounded-lg bg-info/10 p-2.5 text-[11px] leading-relaxed text-info">
              <Truck className="mr-1 inline size-3" />
              {vehicle.plate} is personally-owned. This trip prices as a mileage reimbursement, not fuel — see the
              fuel step for the rate.
            </p>
          )}

          {vehicle && vehicle.ownership !== 'PO' && !vehicle.fuelEfficiency && (
            <p className="rounded-lg bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning">
              <Truck className="mr-1 inline size-3" />
              {vehicle.plate} has no measured economy yet, so the litres will assume a{' '}
              {vehicle.vehicleType ? `typical figure for a ${vehicle.vehicleType.toLowerCase()}` : 'conservative 6 km/L'}.
              It sharpens once a couple of fills have been logged against it.
            </p>
          )}
        </div>
      )}

      {/* -------------------------------- 2. route --------------------------- */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            {legs.map((leg, index) => (
              <LegCard
                key={leg._uid}
                leg={leg}
                index={index}
                expanded={expandedLeg === leg._uid}
                onToggle={() => setExpandedLeg((current) => (current === leg._uid ? null : leg._uid))}
                onUpdate={(patch) => updateLeg(leg._uid, patch)}
                onRemove={legs.length > 1 ? () => removeLeg(leg._uid) : null}
                route={legRoutes[leg._uid] ?? null}
                pricing={pricing}
                fuelPrice={fuelPrice}
                vehicleOwnership={ownership}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addLeg}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-[12px] text-ink-3 transition-colors hover:border-brand-400 hover:text-ink-2"
          >
            <MapPin className="size-3.5" />
            Add another destination
          </button>

          {/* The whole trip's totals — every leg added together. */}
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Route className="size-4 text-brand-500" />
              <span className="text-[13px] font-semibold text-ink">
                {legs.length > 1 ? `Trip total · ${legs.length} legs` : 'Measured'}
              </span>
              {route && <Badge tone={SOURCE_LABEL[route.source].tone}>{SOURCE_LABEL[route.source].text}</Badge>}
              {pricing && <span className="text-[11px] text-ink-3">working it out…</span>}
            </div>

            {!route ? (
              <p className="text-[12px] text-ink-3">Set every leg's ends and the distance, time and fuel appear here.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  {[
                    ['Distance', `${num(route.distanceKm, 1)} km`, `${legs.length} leg${legs.length > 1 ? 's' : ''}`],
                    ['Travel time', hoursMinutes(route.durationMinutes), 'all legs'],
                    ...(route.vehicleOwnership === 'PO'
                      ? [
                          ['Mileage rate', `${money(route.mileageRate ?? 0)}/km`, 'set in Admin → Settings'],
                          [
                            'Reimbursement',
                            money(route.mileageAmount ?? 0, { decimals: false }),
                            'paid to the vehicle owner, not fuelled',
                          ],
                        ]
                      : [
                          [
                            'Suggested fuel',
                            `${num(route.suggestedLitres ?? 0, 2)} L`,
                            `${(route.kmPerLitre ?? 0) > 0 ? `${num(route.kmPerLitre ?? 0, 1)} km/L` : 'no economy on file'} + ${route.reservePct}%`,
                          ],
                          ['Estimated cost', money(route.estimatedCost ?? 0, { decimals: false }), `at ${money(fuelPrice)}/L`],
                        ]),
                  ].map(([label, value, hint]) => (
                    <div key={label}>
                      <p className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
                      <p className="tabular text-[17px] font-semibold text-ink">{value}</p>
                      <p className="text-[11px] text-ink-3">{hint}</p>
                    </div>
                  ))}
                </div>

                {eta && (
                  <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[12px] text-ink-2">
                    <Clock className="size-3.5 text-ink-3" />
                    Arrives about{' '}
                    <strong className="text-ink">
                      {eta.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}
                    </strong>
                  </p>
                )}

                {route.source === 'straight-line' && (
                  <p className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[11px] leading-relaxed text-warning">
                    {route.note}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------- 3. fuel ---------------------------- */}
      {step === 2 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card space-y-3 p-4">
            <p className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">Purchase order</p>

            <Field label="To (service station)" required>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off" />
            </Field>

            <Field label="Vehicle ownership">
              <div className="flex gap-1.5">
                {OWNERSHIP_CODES.map((code) => (
                  <button
                    key={code.value}
                    type="button"
                    onClick={() => setOwnership(code.value)}
                    title={code.label}
                    aria-pressed={ownership === code.value}
                    className={cn(
                      'flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-semibold transition-colors',
                      ownership === code.value
                        ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-950'
                        : 'border-line text-ink-3 hover:border-brand-300',
                    )}
                  >
                    {code.value}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Purchase order category">
              <Select value={poCategory} onChange={(e) => setPoCategory(e.target.value)}>
                <option value="">Not stated</option>
                {PO_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Unit" hint="Litres for anything pumped; pieces for what comes in a container.">
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {FUEL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="card space-y-3 p-4">
            <Field label="Products" hint="Tick everything this order covers.">
              <div className="space-y-1">
                {FUEL_PRODUCTS.map((product) => {
                  const on = products.includes(product)
                  return (
                    <button
                      key={product}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => setProducts(on ? products.filter((p) => p !== product) : [...products, product])}
                      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[12px] hover:bg-surface-2"
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold',
                          on ? 'border-brand-500 bg-brand-500 text-white' : 'border-line-strong',
                        )}
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span className={on ? 'text-ink' : 'text-ink-2'}>{product}</span>
                    </button>
                  )
                })}
                <Input
                  value={productOther}
                  onChange={(e) => setProductOther(e.target.value)}
                  placeholder="Others…"
                  className="mt-1 h-8 text-[12px]"
                />
              </div>
            </Field>

            <Field label="Reserve" hint="Margin on top, so the truck can divert without running dry.">
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={5}
                  value={reservePct}
                  onChange={(e) => setReservePct(Number(e.target.value))}
                  className="flex-1 accent-[var(--brand-500)]"
                  aria-label="Fuel reserve percentage"
                />
                <span className="tabular w-10 text-right text-[13px] font-medium text-ink">{reservePct}%</span>
              </div>
            </Field>

            {/* Fetched, not typed. A hard-coded price does not fail loudly — it
                just quietly misprices every trip. */}
            <Field label="Fuel price per litre">
              <div className="flex gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step={0.25}
                  value={fuelPrice}
                  onChange={(e) => {
                    setFuelPrice(Number(e.target.value) || 0)
                    setPriceInfo(null)
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Fetch today's price"
                  disabled={priceLoading}
                  onClick={() => void loadPrice(true)}
                >
                  <RefreshCw className={cn('size-3.5', priceLoading && 'animate-spin')} />
                </Button>
              </div>
              {priceInfo ? (
                <p className={cn('mt-1 text-[11px]', priceInfo.stale ? 'text-warning' : 'text-ink-3')}>
                  {priceInfo.note}
                  {priceInfo.fetchedAt && <> Surveyed {fmtDate(priceInfo.fetchedAt)}.</>}
                  {priceInfo.stale && ' That is over a fortnight old — check it against a receipt.'}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-3">Set by hand. Refresh to take today's published price.</p>
              )}
            </Field>
          </div>
        </div>
      )}

      {/* ------------------------------- 4. review --------------------------- */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-[13px] text-ink-2">
            One last look. Anything wrong, tap the step above to go back and change it.
          </p>

          <dl className="card divide-y divide-line text-[13px]">
            {[
              ['Vehicle', `${vehicle?.plate ?? '—'}${vehicle?.model ? ` · ${vehicle.model}` : ''}`],
              ['Driver', employees.find((e) => e.id === driverId)?.fullName ?? 'Not named'],
              ['Business unit', businessUnit || '—'],
              ['Purpose', purpose],
              [
                legs.length > 1 ? 'Route' : 'From',
                legs.length > 1
                  ? legs.map((l) => l.originLabel).concat(legs[legs.length - 1]?.destinationLabel ?? '').join(' → ')
                  : formatAddress(legs[0]?.originParts ?? EMPTY_ADDRESS, legs[0]?.originLabel ?? '') || legs[0]?.originLabel,
              ],
              ...(legs.length === 1
                ? [['To', formatAddress(legs[0].destParts, legs[0].destinationLabel) || legs[0].destinationLabel]]
                : []),
              [
                'Trip',
                route ? `${num(route.distanceKm, 1)} km · ${hoursMinutes(route.durationMinutes)}` : '—',
              ],
              ...(eta ? [['Arrives', eta.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })]] : []),
              ['Products', [...products, productOther].filter(Boolean).join(', ') || '—'],
              ownership === 'PO'
                ? ['Reimbursement', route ? money(route.mileageAmount ?? 0, { decimals: false }) : '—']
                : [
                    'Fuel',
                    route
                      ? `${num(route.suggestedLitres ?? 0, 2)} ${unit} · ${money(route.estimatedCost ?? 0, { decimals: false })}`
                      : '—',
                  ],
              ['Station', supplier],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="shrink-0 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{label}</dt>
                <dd className="text-right break-words text-ink">{value || '—'}</dd>
              </div>
            ))}
          </dl>

          <Field label="Anything else the approver should know?">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Load ready from 5am. Back gate on Rizal St."
              className="min-h-16"
            />
          </Field>
        </div>
      )}

      {/* -------------------------------- footer ----------------------------- */}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-critical/10 px-3 py-2 text-[12px] text-critical ring-1 ring-critical/25 ring-inset"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
        {step > 0 ? (
          <Button variant="secondary" size="lg" onClick={back}>
            <ChevronLeft className="size-4" />
            Back
          </Button>
        ) : (
          <span />
        )}

        {step < STEPS.length - 1 ? (
          <Button variant="primary" size="lg" className="ml-auto" onClick={next}>
            Continue
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="ml-auto" disabled={saving} onClick={() => void submit()}>
            <Send className="size-4" />
            {editId ? 'Save changes' : 'Submit for approval'}
          </Button>
        )}
      </div>
    </div>
  )
}
