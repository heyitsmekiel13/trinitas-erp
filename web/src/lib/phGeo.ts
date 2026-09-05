/**
 * The Philippines, drawn rather than tiled.
 *
 * Two screens need a map — the Geo-IP fence in Administration and the delivery
 * run in Warehouse — and a tile service would make both a blank grey square the
 * first time the office internet hiccups. The outlines are simplified: roughly
 * forty points per island, enough to place Davao against Luzon at a glance,
 * never a survey.
 *
 * Everything is projected from real latitude and longitude, so a pin sits where
 * the coordinate actually is rather than where it was eyeballed.
 */

/** The bounding box the projection maps onto the viewBox. */
export const BOUNDS = { minLon: 116.0, maxLon: 127.0, minLat: 4.5, maxLat: 21.5 }
export const VIEW = { width: 440, height: 620 }

/** Equirectangular projection. Adequate over a span this small. */
export function project(lat: number, lon: number) {
  const x = ((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * VIEW.width
  // SVG y grows downward; latitude grows north, so it is flipped.
  const y = VIEW.height - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW.height
  return { x, y }
}

/** Kilometres to projected units, for drawing a radius honestly. */
export function kmToUnits(km: number) {
  const degrees = km / 111 // one degree of latitude ≈ 111 km
  return (degrees / (BOUNDS.maxLat - BOUNDS.minLat)) * VIEW.height
}

/** Great-circle distance, for costing a run before the truck leaves. */
export function haversineKm(a: [number, number], b: [number, number]) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const [lat1, lon1] = a
  const [lat2, lon2] = b
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Island outlines as [lat, lon] rings. */
const ISLANDS: [number, number][][] = [
  // Luzon
  [
    [18.65, 120.75], [18.5, 121.35], [18.25, 122.15], [17.6, 122.35], [16.9, 122.25],
    [16.35, 122.15], [15.85, 121.65], [15.3, 121.65], [14.8, 121.9], [14.35, 121.9],
    [14.0, 122.2], [13.85, 122.95], [13.6, 123.55], [13.15, 123.9], [12.8, 123.75],
    [13.05, 123.3], [13.35, 122.75], [13.55, 122.35], [13.75, 121.6], [13.9, 121.05],
    [14.2, 120.6], [14.75, 120.35], [15.5, 119.9], [16.1, 119.85], [16.6, 120.3],
    [17.2, 120.4], [17.9, 120.4], [18.35, 120.55], [18.65, 120.75],
  ],
  // Mindoro
  [
    [13.5, 120.65], [13.35, 121.3], [12.9, 121.5], [12.35, 121.2], [12.25, 120.75],
    [12.7, 120.5], [13.2, 120.45], [13.5, 120.65],
  ],
  // Panay
  [
    [11.85, 122.05], [11.6, 122.6], [11.1, 122.9], [10.5, 122.6], [10.35, 122.15],
    [10.75, 121.9], [11.35, 121.85], [11.85, 122.05],
  ],
  // Negros
  [
    [10.9, 123.15], [10.55, 123.4], [10.0, 123.25], [9.4, 123.25], [9.05, 122.9],
    [9.6, 122.6], [10.2, 122.75], [10.7, 122.9], [10.9, 123.15],
  ],
  // Cebu
  [
    [11.3, 123.9], [10.9, 124.05], [10.2, 123.95], [9.75, 123.5], [10.1, 123.35],
    [10.7, 123.55], [11.15, 123.75], [11.3, 123.9],
  ],
  // Bohol
  [
    [10.15, 124.0], [10.0, 124.6], [9.6, 124.5], [9.55, 124.05], [9.85, 123.85], [10.15, 124.0],
  ],
  // Leyte + Samar
  [
    [12.55, 125.0], [12.2, 125.5], [11.6, 125.6], [11.2, 125.35], [11.15, 124.95],
    [10.9, 125.0], [10.35, 124.95], [10.15, 124.75], [10.6, 124.5], [11.1, 124.4],
    [11.5, 124.35], [11.9, 124.4], [12.25, 124.6], [12.55, 125.0],
  ],
  // Palawan
  [
    [11.15, 119.4], [10.4, 119.05], [9.6, 118.5], [8.95, 117.75], [8.4, 117.2],
    [8.55, 117.05], [9.2, 117.75], [9.9, 118.4], [10.6, 118.9], [11.35, 119.25], [11.15, 119.4],
  ],
  // Mindanao
  [
    [9.85, 124.75], [9.6, 125.5], [9.15, 126.05], [8.6, 126.35], [7.8, 126.6],
    [7.15, 126.6], [6.55, 126.2], [6.0, 125.65], [5.6, 125.35], [5.9, 125.05],
    [6.35, 124.75], [6.05, 124.2], [6.35, 123.85], [6.9, 122.05], [7.3, 122.0],
    [7.55, 122.55], [7.85, 123.35], [8.15, 123.75], [8.5, 124.2], [8.95, 124.5],
    [9.4, 124.6], [9.85, 124.75],
  ],
]

function ringPath(ring: [number, number][]) {
  return (
    ring
      .map(([lat, lon], i) => {
        const { x, y } = project(lat, lon)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ') + ' Z'
  )
}

/** Projected once at module load — the geometry never changes. */
export const ISLAND_PATHS: string[] = ISLANDS.map(ringPath)
