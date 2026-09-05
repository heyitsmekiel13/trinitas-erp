import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/cn'

/**
 * A real map, with real roads, that costs nothing to run.
 *
 * The tiles come from OpenStreetMap and the route line is drawn from geometry
 * the server fetched — see `App\Services\Router`, which tries Google Directions
 * when a billed key is configured and falls back to OSRM's free service when
 * one is not. That split is the same one the geocoder already makes, and it is
 * the only arrangement that satisfies both halves of "use Google Maps" and
 * "make it work for free": Google's own JavaScript and Directions APIs both
 * require a key attached to a billing account, so a keyless install would show
 * a grey box with "for development purposes only" stamped across it.
 *
 * Leaflet is driven imperatively through a ref rather than wrapped in a
 * React binding. The map owns its own DOM and its own pan/zoom state, and
 * letting React re-render into that is how a map ends up flickering back to
 * its initial view every time a sibling input changes.
 */

/**
 * Leaflet's default marker points at image files bundled by a build step this
 * project does not run, so the icons 404 and every pin renders as a broken
 * image. Drawing them as inline SVG divs avoids the asset pipeline entirely
 * and lets the pins pick up the app's own colours.
 */
const pin = (color: string, label: string) =>
  L.divIcon({
    className: 'route-pin',
    html: `<span style="
      display:flex; align-items:center; justify-content:center;
      width:26px; height:26px; border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${color}; border:2px solid #fff;
      box-shadow:0 2px 6px rgba(0,0,0,.35);
      font:600 11px/1 ui-sans-serif,system-ui,sans-serif; color:#fff;">
      <span style="transform:rotate(45deg)">${label}</span>
    </span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  })

export type LatLng = { lat: number; lng: number }

export function RouteMap({
  origin,
  destination,
  /** Road geometry as [lat, lng] pairs. Falls back to a dashed direct line. */
  polyline,
  /** Which pin the next map click moves. */
  picking,
  onPick,
  onDrag,
  height = 380,
  className,
}: {
  origin: LatLng | null
  destination: LatLng | null
  polyline?: [number, number][]
  picking?: 'origin' | 'destination' | null
  onPick?: (point: LatLng) => void
  onDrag?: (which: 'origin' | 'destination', point: LatLng) => void
  height?: number
  className?: string
}) {
  const holder = React.useRef<HTMLDivElement>(null)
  const map = React.useRef<L.Map | null>(null)
  /**
   * Bumped whenever a map instance is built.
   *
   * The marker and route effects depend on it as well as on their own data.
   * Without that they can run against a map that has since been torn down —
   * which is exactly what happens under React's development double-mount: the
   * map is created, destroyed and created again, while the marker effect's own
   * dependencies never changed, so it never re-ran and every pin was added to
   * the discarded instance. The symptom is a map that draws its tiles happily
   * and refuses to show a single marker.
   */
  const [ready, setReady] = React.useState(0)
  const originMarker = React.useRef<L.Marker | null>(null)
  const destMarker = React.useRef<L.Marker | null>(null)
  const line = React.useRef<L.Polyline | null>(null)

  // Callbacks live in a ref so the click handler is bound once. Re-binding it
  // on every render would stack listeners and fire a pick several times.
  const handlers = React.useRef({ onPick, onDrag, picking })
  handlers.current = { onPick, onDrag, picking }

  /* ------------------------------ create once --------------------------- */
  React.useEffect(() => {
    if (!holder.current || map.current) return

    const instance = L.map(holder.current, {
      // Mindanao, which is where this fleet runs. Overridden the moment there
      // is a route to frame.
      center: [7.0731, 125.6128],
      zoom: 9,
      scrollWheelZoom: true,
      attributionControl: true,
    })

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the OpenStreetMap tile usage policy, and fair.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)

    instance.on('click', (e: L.LeafletMouseEvent) => {
      if (!handlers.current.picking) return
      handlers.current.onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    map.current = instance
    setReady((n) => n + 1)

    // Tiles render grey when the container was sized after the map was built,
    // which is the usual outcome inside a panel that lays out asynchronously.
    const settle = setTimeout(() => instance.invalidateSize(), 120)

    return () => {
      clearTimeout(settle)
      instance.remove()
      map.current = null
      /*
       * The overlay refs have to go with the map.
       *
       * `instance.remove()` destroys the panes but leaves these pointing at
       * markers that belong to a map that no longer exists. The placement
       * helper below treats a non-null ref as "already on the map" and only
       * moves it, so the next instance never gets its pins — a map that draws
       * its route line and shows no markers at all. Only visible where the
       * component mounts with both points already set, which is every
       * read-only view of a saved route.
       */
      originMarker.current = null
      destMarker.current = null
      line.current = null
    }
  }, [])

  /* -------------------------------- markers ------------------------------ */
  React.useEffect(() => {
    const instance = map.current
    if (!instance) return

    const place = (
      ref: React.MutableRefObject<L.Marker | null>,
      point: LatLng | null,
      color: string,
      label: string,
      which: 'origin' | 'destination',
    ) => {
      if (!point) {
        ref.current?.remove()
        ref.current = null
        return
      }
      if (ref.current) {
        ref.current.setLatLng([point.lat, point.lng])
        return
      }
      const marker = L.marker([point.lat, point.lng], {
        icon: pin(color, label),
        draggable: true,
      })
        .addTo(instance)
        .on('dragend', (e) => {
          const { lat, lng } = (e.target as L.Marker).getLatLng()
          handlers.current.onDrag?.(which, { lat, lng })
        })
      ref.current = marker
    }

    place(originMarker, origin, '#0f8a4d', 'A', 'origin')
    place(destMarker, destination, '#c2142b', 'B', 'destination')
  }, [origin, destination, ready])

  /* --------------------------------- route ------------------------------- */
  React.useEffect(() => {
    const instance = map.current
    if (!instance) return

    line.current?.remove()
    line.current = null

    const points: [number, number][] =
      polyline && polyline.length > 1
        ? polyline
        : origin && destination
          ? [
              [origin.lat, origin.lng],
              [destination.lat, destination.lng],
            ]
          : []

    if (points.length > 1) {
      line.current = L.polyline(points, {
        color: '#0a6c8e',
        weight: 5,
        opacity: 0.85,
        // A dashed line says "this is the direct distance, not a route" without
        // needing a caption.
        dashArray: polyline && polyline.length > 1 ? undefined : '8 8',
      }).addTo(instance)
    }

    // Frame whatever exists, with room for the pins.
    const framed = points.length > 1 ? points : origin ? [[origin.lat, origin.lng] as [number, number]] : []
    if (framed.length > 1) {
      instance.fitBounds(L.latLngBounds(framed), { padding: [36, 36], maxZoom: 14 })
    } else if (framed.length === 1) {
      instance.setView(framed[0]!, 13)
    }
  }, [polyline, origin, destination, ready])

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line', className)}>
      <div ref={holder} style={{ height }} className="w-full" />
      {picking && (
        <div className="pointer-events-none absolute top-2 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-[12px] font-medium text-white shadow">
          Click the map to set the {picking === 'origin' ? 'starting point' : 'destination'}
        </div>
      )}
    </div>
  )
}
