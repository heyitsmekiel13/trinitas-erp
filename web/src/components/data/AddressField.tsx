import * as React from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, MapPin, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import {
  geocodeAddress,
  geocodePasted,
  type GeocodePrecision,
  type GeocodeResult,
} from '@/lib/adminApi'
import { Button, Field, Input } from '@/components/ui/primitives'

/**
 * A delivery address, written the way Philippine addresses are written.
 *
 * This replaces two number boxes asking for latitude and longitude. Those were
 * filled in for almost nobody, which is unsurprising: it asked a sales clerk to
 * open Google Maps, right-click the pin, and copy two ten-digit decimals into a
 * form. The route planner then had nothing to plan with.
 *
 * The coordinates still exist and still matter — they are simply derived from
 * the address now. What the person types is what they already know.
 *
 * Three things the panel is careful about:
 *
 *   - It says what it matched, not just that it succeeded. A lookup that lands
 *     in the right city but the wrong street is common, and the only defence is
 *     showing the reader what came back.
 *   - It says how precise the match is. A rooftop pin and a town centre are
 *     both "found"; only one of them gets a driver to the gate.
 *   - It always offers the manual pin. Plenty of real addresses here are not in
 *     any gazetteer, and pasting a Google Maps link is how somebody who knows
 *     the place fixes it in five seconds.
 */

/** The subset of form values this control owns. */
export type AddressValues = {
  address?: string | null
  barangay?: string | null
  city?: string | null
  province?: string | null
  postalCode?: string | null
  latitude?: number | null
  longitude?: number | null
  geocodeSource?: string | null
  geocodePrecision?: string | null
  geocodeLabel?: string | null
}

const PRECISION_COPY: Record<GeocodePrecision, { label: string; detail: string; tone: 'good' | 'warning' }> = {
  rooftop: {
    label: 'Exact location',
    detail: 'Matched to the building. A driver can navigate straight to it.',
    tone: 'good',
  },
  street: {
    label: 'Street level',
    detail: 'Matched to the road, not the building. Close enough to route, worth a landmark in the notes.',
    tone: 'good',
  },
  locality: {
    label: 'Area only',
    detail: 'Matched to the town, not the street. Good enough to plan a run, not to find the gate.',
    tone: 'warning',
  },
}

/** Reads after the precision, so each phrase completes "Exact location …". */
const SOURCE_COPY: Record<GeocodeResult['source'], string> = {
  google: 'via Google Maps',
  openstreetmap: 'via OpenStreetMap',
  gazetteer: 'from the city list',
  manual: 'pinned by hand',
}

export function AddressField({
  values,
  onPatch,
  errors,
}: {
  values: AddressValues
  /** Writes several form fields at once — an address is not one value. */
  onPatch: (patch: Record<string, unknown>) => void
  errors?: Record<string, string | undefined>
}) {
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  const [pasting, setPasting] = React.useState(false)
  const [pasted, setPasted] = React.useState('')

  const located = values.latitude != null && values.longitude != null
  const precision = (values.geocodePrecision ?? 'locality') as GeocodePrecision
  const copy = PRECISION_COPY[precision] ?? PRECISION_COPY.locality

  /** Enough to look up: a town, at minimum. */
  const canLookUp = Boolean((values.city ?? '').trim())

  const apply = (found: GeocodeResult) => {
    onPatch({
      latitude: found.latitude,
      longitude: found.longitude,
      geocodeSource: found.source,
      geocodePrecision: found.precision,
      geocodeLabel: found.label,
    })
    setProblem('')
    setPasting(false)
    setPasted('')
  }

  const find = async () => {
    setBusy(true)
    setProblem('')
    try {
      apply(
        await geocodeAddress({
          street: values.address ?? undefined,
          barangay: values.barangay ?? undefined,
          city: values.city ?? undefined,
          province: values.province ?? undefined,
          postalCode: values.postalCode ?? undefined,
        }),
      )
    } catch (err) {
      setProblem((err as Error).message)
      // Offer the manual route straight away rather than leaving them stuck.
      setPasting(true)
    } finally {
      setBusy(false)
    }
  }

  const usePasted = async () => {
    setBusy(true)
    setProblem('')
    try {
      apply(await geocodePasted(pasted))
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Where the pin currently sits, for a second opinion in a real map. */
  const mapsUrl = located
    ? `https://www.google.com/maps/search/?api=1&query=${values.latitude},${values.longitude}`
    : null

  const set = (key: keyof AddressValues) => (event: React.ChangeEvent<HTMLInputElement>) => {
    // Any edit to the written address invalidates the pin derived from it.
    onPatch({
      [key]: event.target.value,
      ...(located ? { latitude: null, longitude: null, geocodeSource: null, geocodePrecision: null, geocodeLabel: null } : {}),
    })
  }

  return (
    <section className="sm:col-span-2">
      <h3 className="mb-1 border-b border-line pb-1.5 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
        Delivery address
      </h3>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
        Write it as you would on a parcel — house or building number, then the street. Fill in the
        town and we will find the location on the map for you.
      </p>

      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Field
          label="House / building and street"
          hint="e.g. Unit 4, Gaisano Mall, Quimpo Boulevard"
          error={errors?.address}
          className="sm:col-span-2"
        >
          <Input
            value={values.address ?? ''}
            onChange={set('address')}
            placeholder="Unit 4, Gaisano Mall, Quimpo Boulevard"
            maxLength={255}
          />
        </Field>

        <Field label="Barangay" hint="Name only — no need to write “Barangay”." error={errors?.barangay}>
          <Input value={values.barangay ?? ''} onChange={set('barangay')} placeholder="Matina" maxLength={120} />
        </Field>

        <Field label="City / municipality" required error={errors?.city}>
          <Input value={values.city ?? ''} onChange={set('city')} placeholder="Davao City" maxLength={80} />
        </Field>

        <Field label="Province" error={errors?.province}>
          <Input value={values.province ?? ''} onChange={set('province')} placeholder="Davao del Sur" maxLength={120} />
        </Field>

        <Field label="Postal code" error={errors?.postalCode}>
          <Input
            value={values.postalCode ?? ''}
            onChange={set('postalCode')}
            placeholder="8000"
            inputMode="numeric"
            maxLength={16}
          />
        </Field>
      </div>

      {/* ------------------------------------------------------- the lookup */}
      <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
        {located ? (
          <div className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                copy.tone === 'good' ? 'bg-good/15 text-good' : 'bg-warning/15 text-warning',
              )}
            >
              {copy.tone === 'good' ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">
                {copy.label}
                <span className="ml-1.5 font-normal text-ink-3">
                  · {SOURCE_COPY[(values.geocodeSource ?? 'manual') as GeocodeResult['source']] ?? values.geocodeSource}
                </span>
              </p>

              {values.geocodeLabel && (
                <p className="mt-0.5 text-[11px] leading-snug text-ink-2">Matched: {values.geocodeLabel}</p>
              )}

              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{copy.detail}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <span className="tabular text-[11px] text-ink-3">
                  {Number(values.latitude).toFixed(5)}, {Number(values.longitude).toFixed(5)}
                </span>
                {mapsUrl && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    <ExternalLink className="size-3" />
                    Check it on Google Maps
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPasting((p) => !p)}
                  className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline"
                >
                  Wrong spot?
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <MapPin className="size-3.5 shrink-0" />
              {canLookUp
                ? 'Not located yet — deliveries to this address cannot be routed.'
                : 'Fill in the city, then find the location.'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void find()} disabled={!canLookUp || busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              Find on map
            </Button>
          </div>
        )}

        {located && (
          <div className="mt-2 flex justify-end border-t border-line pt-2">
            <Button type="button" variant="ghost" size="xs" onClick={() => void find()} disabled={busy}>
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
              Look up again
            </Button>
          </div>
        )}

        {problem && (
          <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] text-critical">
            <AlertTriangle className="mt-px size-3 shrink-0" />
            {problem}
          </p>
        )}

        {/* The escape hatch. Plenty of real addresses are in no gazetteer, and
            somebody who knows the place can pin it in five seconds. */}
        {pasting && (
          <div className="mt-2 border-t border-line pt-2">
            <Field
              label="Paste a Google Maps link"
              hint="Open Google Maps, right-click the exact spot, copy the coordinates — or copy the link from the address bar."
            >
              <div className="flex gap-2">
                <Input
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="https://maps.google.com/… or 7.0731, 125.6128"
                  className="flex-1"
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => void usePasted()} disabled={!pasted.trim() || busy}>
                  Use this
                </Button>
              </div>
            </Field>
          </div>
        )}
      </div>
    </section>
  )
}
