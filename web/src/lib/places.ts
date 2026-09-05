import * as React from 'react'
import { searchPlacesViaApi, type PlaceHit } from '@/lib/adminApi'

/**
 * Places: finding them, naming them, and the company's own.
 *
 * Shared by After-Sales and Maintenance because both ask the same question —
 * where is this — and were answering it two different ways. A client booking a
 * repair and a driver planning a fuel run should get the same search, the same
 * address fields and the same company sites.
 *
 * Search runs through Photon (Komoot's open geocoder over OpenStreetMap data:
 * free, no key, and built for fuzzy type-ahead) rather than Nominatim's
 * structured matcher, which is built for postal addresses and is poor at
 * Philippine place names. It is called straight from the browser — Photon
 * sends `Access-Control-Allow-Origin: *` — so it runs on the user's own
 * network and costs no server hop. The API route stays as a fallback.
 */

const PHOTON_SEARCH = 'https://photon.komoot.io/api/'
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse'

/** Davao. Photon ranks by distance from here, which is what makes "petron"
 *  return the ones down the road rather than forty thousand worldwide. */
const BIAS = { lat: 7.0731, lng: 125.6128 }

export type LatLng = { lat: number; lng: number }

/* -------------------------------------------------------------------------- */
/* The company's own sites                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Where trips actually start.
 *
 * Nearly every fuel run leaves from the office or the warehouse, and nearly
 * every service call is dispatched from one of them. Making somebody search
 * for their own workplace on every form is the kind of small friction that
 * gets a form abandoned — so these are one tap, and the office is where the
 * map opens.
 *
 * Coordinates are the pins from the company's own Google Maps entries.
 */
export const PKE_SITES = [
  {
    id: 'office',
    label: 'Premium Kitchen Equipment',
    detail: 'Angliongto Road, Cabantian, Davao City',
    point: { lat: 7.1063172, lng: 125.6326981 },
  },
  {
    id: 'warehouse',
    label: 'PKE Warehouse',
    detail: 'Davao City',
    point: { lat: 7.1588107, lng: 125.6543426 },
  },
] as const

/** Where a fresh map opens, and the default start of a trip. */
export const HOME_SITE = PKE_SITES[0]

/* -------------------------------------------------------------------------- */
/* Structured address                                                         */
/* -------------------------------------------------------------------------- */

/**
 * An address in the parts Philippine forms actually ask for.
 *
 * A single free-text line is fine for a map pin and useless for everything
 * else — you cannot group deliveries by city, check a service area by
 * province, or print a courier label from it. The pin still comes first; these
 * are filled in from it and stay editable, because a geocoder knows the
 * street and not which gate to use.
 */
export type AddressParts = {
  /** House or building number and street, or a landmark. */
  street: string
  barangay: string
  city: string
  province: string
  postalCode: string
}

export const EMPTY_ADDRESS: AddressParts = {
  street: '',
  barangay: '',
  city: '',
  province: '',
  postalCode: '',
}

/** One line, for a label or a printed form. Skips the parts that are blank. */
export const formatAddress = (parts: AddressParts, name?: string) =>
  [name, parts.street, parts.barangay, parts.city, parts.province, parts.postalCode]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(', ')

export const hasAddress = (parts: AddressParts) =>
  Boolean(parts.street.trim() || parts.barangay.trim() || parts.city.trim())

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

type PhotonProps = Record<string, string | undefined>
type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: [number, number] } }

/**
 * Photon spreads an address across several keys and not always the same ones.
 *
 * `district` is usually the barangay and `locality` sometimes is; `state`
 * carries the province. Taking the first that is present, in that order, is
 * what stops a Davao address arriving with an empty barangay and the barangay
 * name sitting in a field nobody reads.
 */
function partsFrom(p: PhotonProps): AddressParts {
  return {
    street: [p.housenumber, p.street ?? p.name].filter(Boolean).join(' ').trim(),
    barangay: p.district ?? p.locality ?? '',
    city: p.city ?? p.county ?? '',
    province: p.state ?? '',
    postalCode: p.postcode ?? '',
  }
}

function hitFrom(feature: PhotonFeature, fallback: string): (PlaceHit & { parts: AddressParts }) | null {
  const p = feature.properties ?? {}
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null

  const detail = [p.street, p.district, p.city ?? p.county, p.state]
    .filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i)
    .join(', ')

  return {
    label: p.name || p.street || p.city || fallback,
    detail,
    latitude: coords[1],
    longitude: coords[0],
    kind: p.osm_value || p.type || 'place',
    source: 'photon',
    parts: partsFrom(p),
  }
}

export type PlaceResult = PlaceHit & { parts: AddressParts }

export async function searchPlaces(query: string, limit = 8, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const url = `${PHOTON_SEARCH}?q=${encodeURIComponent(q)}&limit=${limit}&lat=${BIAS.lat}&lon=${BIAS.lng}&lang=en`

  try {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(String(response.status))

    const body = (await response.json()) as { features?: PhotonFeature[] }
    const hits = (body.features ?? [])
      .map((f) => hitFrom(f, q))
      .filter((h): h is PlaceResult => h !== null)

    if (hits.length) return hits
  } catch (error) {
    // An abort is the previous keystroke being cancelled, not a failure —
    // falling back to the server for it would fire a request already moot.
    if ((error as Error)?.name === 'AbortError') return []
  }

  try {
    const viaApi = await searchPlacesViaApi(q, limit)
    return viaApi.map((h) => ({ ...h, parts: EMPTY_ADDRESS }))
  } catch {
    return []
  }
}

/**
 * The address at a coordinate.
 *
 * Called whenever a pin moves, so the written address follows the map rather
 * than being typed twice. Returns blanks rather than throwing — a pin with no
 * known address is normal in a subdivision, and the fields stay editable.
 */
export async function reverseGeocode(point: LatLng, signal?: AbortSignal): Promise<AddressParts> {
  try {
    const response = await fetch(`${PHOTON_REVERSE}?lat=${point.lat}&lon=${point.lng}&lang=en`, { signal })
    if (!response.ok) return EMPTY_ADDRESS

    const body = (await response.json()) as { features?: PhotonFeature[] }
    const first = body.features?.[0]?.properties
    return first ? partsFrom(first) : EMPTY_ADDRESS
  } catch {
    return EMPTY_ADDRESS
  }
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Debounced type-ahead over `searchPlaces`.
 *
 * The in-flight request is aborted whenever the query moves on, which stops a
 * slow answer for "gais" landing after a fast one for "gaisano mall" and
 * replacing the better list with a worse one.
 */
export function usePlaceSearch(query: string, enabled = true) {
  const [results, setResults] = React.useState<PlaceResult[]>([])
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    if (!enabled || query.trim().length < 3) {
      setResults([])
      setSearching(false)
      return
    }

    const controller = new AbortController()
    let live = true
    setSearching(true)

    const timer = setTimeout(async () => {
      const hits = await searchPlaces(query, 8, controller.signal)
      if (!live) return
      setResults(hits)
      setSearching(false)
    }, 300)

    return () => {
      live = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, enabled])

  return { results, searching }
}
