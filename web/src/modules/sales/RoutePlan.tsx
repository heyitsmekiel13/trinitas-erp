import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Fuel, Info, MapPin, Route, Timer, Warehouse } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api'
import { liveApi } from '@/lib/adminApi'
import { money, num } from '@/lib/format'
import { Skeleton } from '@/components/ui/feedback'

/**
 * The delivery run, costed before the truck leaves.
 *
 * The arithmetic lives on the server so the figures shown here are the same
 * ones that get stored — there is no second implementation in the browser to
 * drift out of step. This component only asks and draws.
 */

export type RoutePlan = {
  plannable: boolean
  missing?: string[]
  straightLineKm: number
  oneWayKm: number
  distanceKm: number
  roundTrip: boolean
  drivingMinutes: number
  handlingMinutes: number
  etaMinutes: number
  kmPerLitre: number
  fuelLitres: number
  fuelCost: number
  fuelPricePerLitre: number
  roadFactor: number
  averageSpeedKph: number
  origin: { lat: number; lng: number; label: string }
  destination: { lat: number; lng: number; label: string }
  basis: string
}

function useRoutePlan(params: {
  salesOrderId?: number
  originWarehouseId?: number
  vehicleAssetId?: number
  roundTrip: boolean
}) {
  const enabled = liveApi() && Boolean(params.salesOrderId)

  return useQuery({
    queryKey: ['route-plan', params],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<RoutePlan> => {
      const token = (() => {
        try {
          return JSON.parse(localStorage.getItem('trinitas.auth') ?? '{}')?.state?.token
        } catch {
          return null
        }
      })()

      const query = new URLSearchParams({
        salesOrderId: String(params.salesOrderId),
        roundTrip: params.roundTrip ? '1' : '0',
      })
      if (params.originWarehouseId) query.set('originWarehouseId', String(params.originWarehouseId))
      if (params.vehicleAssetId) query.set('vehicleAssetId', String(params.vehicleAssetId))

      const response = await fetch(`${API_BASE_URL}/sales/deliveries/route-preview?${query}`, {
        headers: {
          Accept: 'application/json',
          ...(token && token !== 'bootstrap-session' ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (!response.ok) throw new Error(`Could not plan the route (${response.status}).`)
      return (await response.json()).data as RoutePlan
    },
  })
}

/** "4h 15m" reads faster than "255 minutes" when you are planning a day. */
function duration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`
}

/* -------------------------------------------------------------------------- */

/**
 * A schematic of the run, not a street map.
 *
 * Drawing real tiles would mean an external map service on every form open.
 * This places the two pins on their true relative bearing and distance, which
 * is what a dispatcher actually reads off it — is this north or south, and is
 * it near or far. It never pretends to show roads.
 */
function RouteSketch({ plan }: { plan: RoutePlan }) {
  const { origin, destination } = plan

  // Longitude compresses towards the poles; at 7°N the correction is small but
  // applying it keeps the bearing honest.
  const scaleX = Math.cos((((origin.lat + destination.lat) / 2) * Math.PI) / 180)
  const dx = (destination.lng - origin.lng) * scaleX
  const dy = origin.lat - destination.lat // SVG y grows downward

  const span = Math.max(Math.abs(dx), Math.abs(dy)) || 1
  const pad = 34
  const w = 300
  const h = 150
  const cx = w / 2
  const cy = h / 2
  // Half the usable box, so the two pins sit symmetrically about the centre.
  const k = Math.min(cx - pad, cy - pad) / span

  const ax = cx - (dx / 2) * k
  const ay = cy - (dy / 2) * k
  const bx = cx + (dx / 2) * k
  const by = cy + (dy / 2) * k

  const compass = (() => {
    const ns = destination.lat > origin.lat ? 'N' : destination.lat < origin.lat ? 'S' : ''
    const ew = destination.lng > origin.lng ? 'E' : destination.lng < origin.lng ? 'W' : ''
    return `${ns}${ew}` || '—'
  })()

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[150px] w-full" role="img" aria-label="Route schematic">
      <defs>
        <pattern id="route-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 L0 0 0 20" fill="none" stroke="var(--color-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#route-grid)" />

      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="var(--color-brand-500)"
        strokeWidth="2"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />

      <g>
        <circle cx={ax} cy={ay} r="6" fill="var(--color-brand-500)" />
        <circle cx={ax} cy={ay} r="11" fill="none" stroke="var(--color-brand-500)" strokeWidth="1.5" opacity="0.35" />
      </g>
      <g>
        <circle cx={bx} cy={by} r="6" fill="var(--color-ink)" />
        <circle cx={bx} cy={by} r="11" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" opacity="0.25" />
      </g>

      <text x={ax} y={ay - 16} textAnchor="middle" className="fill-[var(--color-ink-3)] text-[9px]">
        ORIGIN
      </text>
      <text x={bx} y={by + 24} textAnchor="middle" className="fill-[var(--color-ink-3)] text-[9px]">
        {compass} · {num(plan.oneWayKm)} km
      </text>
    </svg>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-ink-3 uppercase">
        <Icon className="size-3" />
        {label}
      </p>
      <p className="tabular mt-1 text-[15px] leading-tight font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

export function RoutePlanPanel({ values }: { values: Record<string, unknown> }) {
  const salesOrderId = Number(values.salesOrderId) || undefined
  const originWarehouseId = Number(values.originWarehouseId) || undefined
  const vehicleAssetId = Number(values.vehicleAssetId) || undefined
  const roundTrip = values.roundTrip !== false

  const { data, isLoading, error } = useRoutePlan({ salesOrderId, originWarehouseId, vehicleAssetId, roundTrip })

  if (!liveApi()) return null

  return (
    <section className="rounded-xl border border-line bg-surface-2 p-3.5">
      <h3 className="mb-2.5 flex items-center gap-1.5 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
        <Route className="size-3.5" />
        Route plan
      </h3>

      {!salesOrderId && (
        <p className="py-3 text-center text-xs text-ink-3">Choose a sales order to plan the run.</p>
      )}

      {salesOrderId && isLoading && <Skeleton className="h-40 rounded-xl" />}

      {salesOrderId && error && (
        <p className="py-3 text-center text-xs text-critical">{(error as Error).message}</p>
      )}

      {data && !data.plannable && (
        <div className="rounded-lg bg-warning/10 p-3 text-xs text-ink-2 ring-1 ring-warning/30 ring-inset">
          <p className="font-medium text-ink">Not enough map data to plan this run.</p>
          <ul className="mt-1.5 list-inside list-disc text-ink-3">
            {data.missing?.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="mt-2 text-ink-3">
            Add a latitude and longitude on the customer and the warehouse, then reopen this form.
          </p>
        </div>
      )}

      {data?.plannable && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              icon={Route}
              label="Distance"
              value={`${num(data.distanceKm)} km`}
              hint={data.roundTrip ? `${num(data.oneWayKm)} km each way` : 'One way'}
            />
            <Metric
              icon={Timer}
              label="Round trip"
              value={duration(data.etaMinutes)}
              hint={`${duration(data.drivingMinutes)} driving + ${data.handlingMinutes}m on site`}
            />
            <Metric
              icon={Fuel}
              label="Fuel needed"
              value={`${num(data.fuelLitres, 1)} L`}
              hint={`at ${num(data.kmPerLitre, 1)} km/L`}
            />
            <Metric
              icon={Fuel}
              label="Fuel cost"
              value={money(data.fuelCost, { decimals: false })}
              hint={`${money(data.fuelPricePerLitre)}/L`}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-2 text-[13px]">
              <p className="flex items-start gap-2">
                <Warehouse className="mt-0.5 size-3.5 shrink-0 text-brand-500" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{data.origin.label}</span>
                  <span className="tabular text-[11px] text-ink-3">
                    {data.origin.lat.toFixed(4)}, {data.origin.lng.toFixed(4)}
                  </span>
                </span>
              </p>
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{data.destination.label}</span>
                  <span className="tabular text-[11px] text-ink-3">
                    {data.destination.lat.toFixed(4)}, {data.destination.lng.toFixed(4)}
                  </span>
                </span>
              </p>
            </div>

            <div className="w-full overflow-hidden rounded-lg border border-line bg-surface sm:w-[300px]">
              <RouteSketch plan={data} />
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <Info className="mt-0.5 size-3 shrink-0" />
            <span>
              Estimate, not a routed distance: {num(data.straightLineKm)} km straight line × {data.roadFactor} road
              factor, at {num(data.averageSpeedKph)} km/h average. Tune those in Admin → System Settings → Logistics
              once you have compared a few trips against the odometer.
            </span>
          </p>
        </div>
      )}
    </section>
  )
}
