import * as React from 'react'
import { MapPin, Search } from 'lucide-react'
import {
  EMPTY_ADDRESS,
  PKE_SITES,
  formatAddress,
  reverseGeocode,
  usePlaceSearch,
  type AddressParts,
  type LatLng,
} from '@/lib/places'
import { Field, Input } from '@/components/ui/primitives'

/**
 * Choosing a place, three ways, all writing to the same address.
 *
 * Search it, tap a company site, or drop the pin on the map — whichever the
 * person finds easier. Whatever they use, the structured fields underneath are
 * filled in from the coordinate and stay editable, so the record ends up with
 * a barangay and a city rather than one free-text line nobody can group by.
 *
 * The pin leads and the text follows, never the reverse. A written address
 * that disagrees with the pin sends a truck to the wrong gate, and it is the
 * pin the route is measured from.
 */

export function PlaceSearchBox({
  value,
  point,
  placeholder = 'Search a place, branch or address…',
  onPick,
  compact,
}: {
  /** Human label for whatever is currently chosen. */
  value: string
  point: LatLng | null
  placeholder?: string
  onPick: (point: LatLng, label: string, parts: AddressParts) => void
  compact?: boolean
}) {
  const [typed, setTyped] = React.useState('')
  const [open, setOpen] = React.useState(false)
  const box = React.useRef<HTMLDivElement>(null)

  const { results, searching } = usePlaceSearch(typed, open)

  React.useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  return (
    <div className="relative" ref={box}>
      {point && !open && value && (
        <p className="mb-1.5 truncate text-[12.5px] font-medium text-ink" title={value}>
          {value}
        </p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
        <Input
          value={open ? typed : ''}
          onChange={(e) => {
            setTyped(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={point ? 'Search for somewhere else…' : placeholder}
          // Chrome fills these with a saved street address, which leaves the
          // pin where it was and the label describing somewhere else entirely.
          autoComplete="off"
          className="h-9 pl-8"
        />
      </div>

      {/* Ranked candidates rather than one answer — recognising the right place
          in a list is the thing that makes a place search usable at all. */}
      {open && typed.trim().length >= 3 && (
        <div className="absolute inset-x-0 z-[700] mt-1 max-h-60 overflow-y-auto rounded-xl border border-line-strong bg-surface shadow-lg">
          {searching && results.length === 0 && <p className="px-3 py-2.5 text-[12px] text-ink-3">Looking…</p>}
          {!searching && results.length === 0 && (
            <p className="px-3 py-2.5 text-[12px] text-ink-3">
              Nothing found. Try fewer words, or drop the pin on the map instead.
            </p>
          )}
          {results.map((hit) => (
            <button
              key={`${hit.latitude},${hit.longitude},${hit.label}`}
              type="button"
              onClick={() => {
                onPick(
                  { lat: hit.latitude, lng: hit.longitude },
                  [hit.label, hit.detail].filter(Boolean).join(', '),
                  hit.parts,
                )
                setTyped('')
                setOpen(false)
              }}
              className="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left last:border-0 hover:bg-surface-2"
            >
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">{hit.label}</span>
                {hit.detail && <span className="block truncate text-[11px] text-ink-3">{hit.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">Our sites</span>
          {PKE_SITES.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => onPick(site.point, site.label, EMPTY_ADDRESS)}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2 hover:border-brand-400 hover:text-ink"
            >
              {site.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * The written address, in the parts a form actually needs.
 *
 * Filled in from the pin and then left alone. The geocoder is good at the
 * street and knows nothing about which gate deliveries use, so the fields are
 * ordinary inputs rather than a read-only echo of the map.
 */
export function AddressFields({
  parts,
  onChange,
  disabled,
}: {
  parts: AddressParts
  onChange: (next: AddressParts) => void
  disabled?: boolean
}) {
  const set = <K extends keyof AddressParts>(key: K, value: string) => onChange({ ...parts, [key]: value })

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="House / building & street" className="sm:col-span-2">
        <Input
          value={parts.street}
          onChange={(e) => set('street', e.target.value)}
          disabled={disabled}
          placeholder="2nd floor, Gaisano Mall, J. Catolico Ave"
          autoComplete="off"
        />
      </Field>
      <Field label="Barangay">
        <Input value={parts.barangay} onChange={(e) => set('barangay', e.target.value)} disabled={disabled} autoComplete="off" />
      </Field>
      <Field label="City / municipality">
        <Input value={parts.city} onChange={(e) => set('city', e.target.value)} disabled={disabled} autoComplete="off" />
      </Field>
      <Field label="Province">
        <Input value={parts.province} onChange={(e) => set('province', e.target.value)} disabled={disabled} autoComplete="off" />
      </Field>
      <Field label="Postal code">
        <Input
          value={parts.postalCode}
          onChange={(e) => set('postalCode', e.target.value)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
        />
      </Field>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Keeps the written address following the pin.
 *
 * Only overwrites fields the person has not typed into — moving a pin should
 * correct the city, not wipe the "use the back gate on Rizal St" somebody
 * added to the street line. Skips the lookup entirely while a request for an
 * earlier pin is still in flight.
 */
export function useAddressForPoint(
  point: LatLng | null,
  parts: AddressParts,
  onChange: (next: AddressParts) => void,
  enabled = true,
) {
  const touched = React.useRef(false)
  const lastKey = React.useRef('')

  // Anything the person types marks the address as theirs.
  const handleChange = React.useCallback(
    (next: AddressParts) => {
      touched.current = true
      onChange(next)
    },
    [onChange],
  )

  React.useEffect(() => {
    if (!enabled || !point) return

    const key = `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`
    if (key === lastKey.current) return
    lastKey.current = key

    const controller = new AbortController()

    reverseGeocode(point, controller.signal).then((found) => {
      if (controller.signal.aborted) return
      onChange({
        // A field the person has filled in wins over the lookup; an empty one
        // takes whatever the pin knows.
        street: parts.street.trim() && touched.current ? parts.street : found.street,
        barangay: parts.barangay.trim() && touched.current ? parts.barangay : found.barangay,
        city: parts.city.trim() && touched.current ? parts.city : found.city,
        province: parts.province.trim() && touched.current ? parts.province : found.province,
        postalCode: parts.postalCode.trim() && touched.current ? parts.postalCode : found.postalCode,
      })
    })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng, enabled])

  return handleChange
}

export { formatAddress }
