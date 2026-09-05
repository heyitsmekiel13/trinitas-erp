import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/cn'
import { stageIndex, type Dispatch } from '@/data/warehouse'

/**
 * Where the load is going, and roughly how far along it is — on a real map.
 *
 * This used to be a hand-drawn outline of the Philippines with a schematic
 * curve between two dots. It read as a diagram, not a place: no streets, no
 * scale, no way to tell Panabo from Tagum apart. Real OpenStreetMap tiles —
 * the same free source `RouteMap` already uses for the sales route planner —
 * fix that for nothing, since OSM has no billing account to attach a key to.
 *
 * The truck marker is still placed by *stage*, not by GPS — the ERP has no
 * telemetry feed, and a marker that pretended to would be worse than one
 * that is honest about being a progress indicator. What changes is that it
 * now sits on real roads-adjacent ground instead of an abstract outline.
 *
 * Leaflet is driven imperatively, the same way `RouteMap` does it: the map
 * owns its own pan/zoom state, and letting React re-render into that is how
 * a map ends up snapping back to its start view on every unrelated update.
 * Markers are cleared and redrawn on every change rather than diffed — this
 * view is read-only (nothing here is dragged), so the simpler approach costs
 * nothing and there is no marker identity to preserve across a redraw.
 */

/** Fraction of the way along the route each stage represents. */
const STAGE_PROGRESS: Record<string, number> = {
  Open: 0,
  Picking: 0,
  Packed: 0,
  'Out for Delivery': 0.55,
  Delivered: 1,
  Completed: 1,
}

const pin = (color: string, glyph: string) =>
  L.divIcon({
    className: 'delivery-pin',
    html: `<span style="
      display:flex; align-items:center; justify-content:center;
      width:24px; height:24px; border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${color}; border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
      font:600 11px/1 ui-sans-serif,system-ui,sans-serif; color:#fff;">
      <span style="transform:rotate(45deg)">${glyph}</span>
    </span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24],
  })

const truckIcon = L.divIcon({
  className: 'delivery-truck',
  html: `<span style="
    display:flex; align-items:center; justify-content:center;
    width:20px; height:20px; border-radius:50%;
    background:#fff; border:2px solid var(--color-brand-500, #c2142b);
    box-shadow:0 1px 4px rgba(0,0,0,.35);">
    <span style="width:6px;height:6px;border-radius:50%;background:var(--color-brand-500, #c2142b)"></span>
  </span>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

export function DeliveryRouteMap({
  dispatches,
  /** Highlighted run. The rest are drawn faintly for context. */
  focusId,
  onSelect,
  height = 340,
  className,
}: {
  dispatches: Dispatch[]
  focusId?: string | null
  onSelect?: (dispatch: Dispatch) => void
  height?: number
  className?: string
}) {
  const holder = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<L.Map | null>(null)
  const layers = React.useRef<L.LayerGroup | null>(null)
  const [ready, setReady] = React.useState(0)

  // The click handler is rebound every draw, so it always closes over the
  // dispatch it was attached to rather than a stale one from an earlier list.
  const handlers = React.useRef(onSelect)
  handlers.current = onSelect

  /* ------------------------------ create once --------------------------- */
  React.useEffect(() => {
    if (!holder.current || map.current) return

    const instance = L.map(holder.current, {
      center: [7.0731, 125.6128],
      zoom: 9,
      scrollWheelZoom: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)

    layers.current = L.layerGroup().addTo(instance)
    map.current = instance
    setReady((n) => n + 1)

    // Tiles render grey when the container was sized after the map was
    // built, which is the usual outcome inside a panel that lays out
    // asynchronously (a modal, a card that streams its data in).
    const settle = setTimeout(() => instance.invalidateSize(), 120)

    return () => {
      clearTimeout(settle)
      instance.remove()
      map.current = null
      layers.current = null
    }
  }, [])

  /* -------------------------------- draw ---------------------------------- */
  React.useEffect(() => {
    const instance = map.current
    const group = layers.current
    if (!instance || !group) return

    group.clearLayers()

    const focused = dispatches.find((d) => d.id === focusId) ?? null
    const shown = focused ? [focused] : dispatches
    const framePoints: L.LatLngExpression[] = []

    for (const dispatch of shown) {
      const a: L.LatLngExpression = [dispatch.origin.lat, dispatch.origin.lng]
      const b: L.LatLngExpression = [dispatch.destination.lat, dispatch.destination.lng]
      framePoints.push(a, b)

      const done = stageIndex(dispatch.stage) >= stageIndex('Delivered')
      const dimmed = Boolean(focusId) && focusId !== dispatch.id
      const opacity = dimmed ? 0.35 : 1

      const line = L.polyline([a, b], {
        color: done ? 'var(--color-good, #0f8a4d)' : 'var(--color-brand-500, #c2142b)',
        weight: dimmed ? 2.5 : 4,
        opacity,
        dashArray: done ? undefined : '7 6',
      }).addTo(group)

      const originMarker = L.marker(a, { icon: pin('#1f2937', 'A'), opacity }).addTo(group)
      const destMarker = L.marker(b, {
        icon: pin(done ? 'var(--color-good, #0f8a4d)' : 'var(--color-brand-500, #c2142b)', 'B'),
        opacity,
      }).addTo(group)

      if (!dimmed) {
        originMarker.bindTooltip(dispatch.origin.label, { direction: 'top', offset: [0, -22] })
        destMarker.bindTooltip(`${dispatch.destination.label} · ${dispatch.destination.city}`, {
          direction: 'top',
          offset: [0, -22],
        })
      }

      const select = () => handlers.current?.(dispatch)
      line.on('click', select)
      originMarker.on('click', select)
      destMarker.on('click', select)

      // Where the load is, by stage — a real coordinate on the line between
      // origin and destination, never a GPS fix.
      const progress = STAGE_PROGRESS[dispatch.stage] ?? 0
      if (progress > 0 && progress < 1) {
        const at: L.LatLngExpression = [
          dispatch.origin.lat + (dispatch.destination.lat - dispatch.origin.lat) * progress,
          dispatch.origin.lng + (dispatch.destination.lng - dispatch.origin.lng) * progress,
        ]
        L.marker(at, { icon: truckIcon, opacity, zIndexOffset: 1000 }).addTo(group).on('click', select)
      }
    }

    if (framePoints.length > 1) {
      instance.fitBounds(L.latLngBounds(framePoints), { padding: [36, 36], maxZoom: 13 })
    } else if (framePoints.length === 1) {
      instance.setView(framePoints[0]!, 12)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatches, focusId, ready])

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line', className)}>
      <div ref={holder} style={{ height }} className="w-full" />
    </div>
  )
}
