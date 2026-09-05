import { cn } from '@/lib/cn'
import { haversineKm } from '@/lib/phGeo'
import { num } from '@/lib/format'
import { Flag, MapPin, Truck, Warehouse } from 'lucide-react'
import { DISPATCH_STAGES, stageIndex, type Dispatch } from '@/data/warehouse'

/**
 * The route summarised in words, next to the map.
 *
 * Straight-line distance with a road factor, stated as an estimate — the same
 * honesty the sales route planner applies, because a warehouse supervisor
 * planning a cut-off needs to know this is not a routed distance.
 */
export function RouteSummary({ dispatch, className }: { dispatch: Dispatch; className?: string }) {
  const straight = haversineKm(
    [dispatch.origin.lat, dispatch.origin.lng],
    [dispatch.destination.lat, dispatch.destination.lng],
  )
  const road = straight * 1.35
  const minutes = Math.round((road / 38) * 60) + 30
  const stage = stageIndex(dispatch.stage)

  return (
    <div className={cn('space-y-2.5', className)}>
      <p className="flex items-start gap-2 text-[13px]">
        <Warehouse className="mt-0.5 size-4 shrink-0 text-ink-3" />
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Origin</span>
          <span className="block truncate font-medium text-ink">{dispatch.origin.label}</span>
        </span>
      </p>

      <p className="flex items-start gap-2 text-[13px]">
        <MapPin className="mt-0.5 size-4 shrink-0 text-brand-500" />
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Destination</span>
          <span className="block truncate font-medium text-ink">{dispatch.destination.label}</span>
          <span className="block truncate text-[11px] text-ink-3">{dispatch.destination.city}</span>
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
          <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Distance</p>
          <p className="tabular mt-0.5 text-[15px] font-semibold text-ink">{num(road)} km</p>
          <p className="text-[10px] text-ink-3">{num(straight)} km straight line</p>
        </div>
        <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
          <p className="text-[10px] font-semibold tracking-wider text-ink-3 uppercase">Est. run</p>
          <p className="tabular mt-0.5 text-[15px] font-semibold text-ink">
            {Math.floor(minutes / 60)}h {minutes % 60}m
          </p>
          <p className="text-[10px] text-ink-3">incl. 30m on site</p>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
        {stage >= stageIndex('Delivered') ? (
          <>
            <Flag className="size-3 text-good" />
            Arrived — the route is history now.
          </>
        ) : stage >= stageIndex('Out for Delivery') ? (
          <>
            <Truck className="size-3 text-brand-500" />
            On the road. The marker shows the stage, not a GPS fix.
          </>
        ) : (
          <>
            <Truck className="size-3" />
            Still in the building — {DISPATCH_STAGES[stage]?.toLowerCase()}.
          </>
        )}
      </p>
    </div>
  )
}
