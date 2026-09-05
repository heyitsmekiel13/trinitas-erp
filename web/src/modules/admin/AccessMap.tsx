import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/cn'

/**
 * A real map of the Philippines showing where the ERP may be reached from.
 *
 * Tiles come from OpenStreetMap, the same free source `RouteMap` already uses
 * elsewhere in the app — see that component for why (a keyless Google Maps
 * embed shows a "for development purposes only" banner; OSM tiles do not).
 * Driven imperatively through a ref for the same reason as `RouteMap`: the
 * map owns its own pan/zoom state, and letting React re-render into it is how
 * a map ends up snapping back to its initial view on every unrelated change.
 */

export type MapArea = {
  id: number | string
  label: string
  latitude: number
  longitude: number
  radiusKm: number
  effect: 'allow' | 'block'
  active?: boolean
}

export type MapPin = {
  label: string
  latitude: number
  longitude: number
  allowed: boolean
}

const ALLOW = '#10b981'
const BLOCK = '#f43f5e'

/** A small pulsing dot, in plain CSS — Leaflet has no built-in animated marker. */
const pulsingDot = (color: string) =>
  L.divIcon({
    className: 'access-map-pulse',
    html: `<span style="position:relative; display:block; width:14px; height:14px;">
      <span style="position:absolute; inset:0; border-radius:50%; background:${color}; opacity:0.35;
        animation: access-map-ping 2.4s cubic-bezier(0,0,0.2,1) infinite;"></span>
      <span style="position:absolute; inset:3px; border-radius:50%; background:${color};
        border:1.5px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4);"></span>
    </span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })

export function AccessMap({
  areas,
  connection,
  focus,
  onSelect,
  className,
}: {
  areas: MapArea[]
  /** Where the current request is coming from, when it could be resolved. */
  connection?: MapPin | null
  /** Zooms to one area. Null shows the whole archipelago. */
  focus?: MapArea | null
  onSelect?: (area: MapArea) => void
  className?: string
}) {
  const holder = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<L.Map | null>(null)
  const [ready, setReady] = React.useState(0)
  const circles = React.useRef<Map<string | number, L.Circle>>(new Map())
  const connMarker = React.useRef<L.Marker | null>(null)

  const handlers = React.useRef({ onSelect })
  handlers.current = { onSelect }

  React.useEffect(() => {
    if (!holder.current || map.current) return

    const instance = L.map(holder.current, {
      // The whole archipelago, roughly framed.
      center: [12.5, 122.5],
      zoom: 6,
      scrollWheelZoom: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)

    map.current = instance
    setReady((n) => n + 1)

    const settle = setTimeout(() => instance.invalidateSize(), 120)

    return () => {
      clearTimeout(settle)
      instance.remove()
      map.current = null
      circles.current.clear()
      connMarker.current = null
    }
  }, [])

  /* Fences. */
  React.useEffect(() => {
    const instance = map.current
    if (!instance) return

    const seen = new Set(areas.map((a) => a.id))
    for (const [id, circle] of circles.current) {
      if (!seen.has(id)) {
        circle.remove()
        circles.current.delete(id)
      }
    }

    for (const area of areas) {
      const color = area.effect === 'allow' ? ALLOW : BLOCK
      const opacity = area.active === false ? 0.35 : 0.85
      const existing = circles.current.get(area.id)

      if (existing) {
        existing.setLatLng([area.latitude, area.longitude])
        existing.setRadius(area.radiusKm * 1000)
        existing.setStyle({ color, fillColor: color, opacity, fillOpacity: opacity * 0.18, dashArray: area.active === false ? '4 4' : undefined })
        continue
      }

      const circle = L.circle([area.latitude, area.longitude], {
        radius: area.radiusKm * 1000,
        color,
        fillColor: color,
        weight: 1.5,
        opacity,
        fillOpacity: opacity * 0.18,
        dashArray: area.active === false ? '4 4' : undefined,
      })
        .addTo(instance)
        .bindTooltip(area.label, { direction: 'top', className: 'access-map-tooltip' })
        .on('click', () => handlers.current.onSelect?.(area))

      circles.current.set(area.id, circle)
    }
  }, [areas, ready])

  /* Where this request is coming from. */
  React.useEffect(() => {
    const instance = map.current
    if (!instance) return

    if (!connection) {
      connMarker.current?.remove()
      connMarker.current = null
      return
    }

    const color = connection.allowed ? '#2563eb' : BLOCK
    if (connMarker.current) {
      connMarker.current.setLatLng([connection.latitude, connection.longitude])
      connMarker.current.setIcon(pulsingDot(color))
    } else {
      connMarker.current = L.marker([connection.latitude, connection.longitude], {
        icon: pulsingDot(color),
        interactive: false,
      })
        .addTo(instance)
        .bindTooltip(connection.label, { direction: 'bottom', className: 'access-map-tooltip', permanent: false })
    }
  }, [connection, ready])

  /* Focus / whole-country framing. */
  React.useEffect(() => {
    const instance = map.current
    if (!instance) return

    // `fitBounds`/`setView` compute a zoom level from the container's pixel
    // size, and that size is only correct once Leaflet has actually
    // measured the DOM — normally handled by the `invalidateSize()` in the
    // creation effect, but that one runs on a timer, so a framing call that
    // lands before it fires (the very first area added, clicked the moment
    // the map has just mounted) works from a stale or zero size. Forcing a
    // synchronous re-measure here, right before asking Leaflet to compute
    // anything from that size, closes the race instead of guessing how long
    // it takes to lose it.
    try {
      instance.invalidateSize({ animate: false })
    } catch {
      // Nothing to frame against yet — the calls below will fail safely too.
    }

    try {
      if (focus) {
        // A bounding box around a kilometre radius, worked out directly
        // rather than via `L.circle(...).getBounds()` on a circle that was
        // never added to the map — that throws, because `getBounds()` reads
        // the layer's own projected position, which only exists once
        // `onAdd` has run. About 111km to a degree of latitude everywhere,
        // and that same 111km per degree of longitude scaled down by how
        // narrow the degrees of longitude get this far from the equator.
        const radiusKm = Math.max(focus.radiusKm, 5)
        const latDelta = radiusKm / 111
        const lonDelta = radiusKm / (111 * Math.cos((focus.latitude * Math.PI) / 180))
        const bounds = L.latLngBounds(
          [focus.latitude - latDelta, focus.longitude - lonDelta],
          [focus.latitude + latDelta, focus.longitude + lonDelta],
        )
        instance.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
      } else if (areas.length > 0) {
        const bounds = L.latLngBounds(areas.map((a) => [a.latitude, a.longitude] as [number, number]))
        instance.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 })
      } else {
        instance.setView([12.5, 122.5], 6)
      }
    } catch (e) {
      // A map that fails to re-frame stays on whatever it last showed —
      // visibly stale, but a stale map beats a screen the error boundary
      // just tore down and rebuilt from an empty state.
      console.warn('AccessMap could not frame the requested view.', e)
    }
    // areas is read once per focus change so the map doesn't re-frame on every unrelated area edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready])

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <div ref={holder} className="h-full w-full" />
      <style>{`
        @keyframes access-map-ping {
          0% { transform: scale(1); opacity: 0.35; }
          75%, 100% { transform: scale(2.6); opacity: 0; }
        }
        .access-map-tooltip { font-size: 11px; font-weight: 500; }
      `}</style>
    </div>
  )
}
