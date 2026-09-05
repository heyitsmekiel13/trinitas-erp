import * as React from 'react'
import { Building2, Crosshair, MapPin, Maximize2, Plus, Radar, ShieldCheck, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import * as api from '@/lib/adminApi'
import { num } from '@/lib/format'
import { Badge, Button, Card, CardHeader, Field, Input, Select, Switch } from '@/components/ui/primitives'
import { EmptyState, useToast } from '@/components/ui/feedback'
import { AccessMap, type MapArea } from './AccessMap'

/**
 * Where the ERP may be reached from, drawn on a map.
 *
 * An area rule is a point and a radius. That is a deliberately coarse tool: the
 * coordinates come from IP geolocation, which resolves to a city or an internet
 * provider's exchange rather than a building. The screen says so plainly rather
 * than letting somebody draw a circle round the office and assume it holds.
 */
export function AccessLocations() {
  const toast = useToast()

  const [rules, setRules] = React.useState<api.GeoRule[]>([])
  const [presets, setPresets] = React.useState<api.GeoPreset[]>([])
  const [connection, setConnection] = React.useState<api.ConnectionInfo | null>(null)
  const [fencingEnabled, setFencingEnabled] = React.useState<boolean | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [settingUpOffice, setSettingUpOffice] = React.useState(false)
  const [focus, setFocus] = React.useState<MapArea | null>(null)

  const [draft, setDraft] = React.useState({
    preset: '',
    name: '',
    latitude: '',
    longitude: '',
    radiusKm: '25',
    effect: 'allow' as 'allow' | 'block',
  })

  const [addressDraft, setAddressDraft] = React.useState({
    kind: 'ip' as 'ip' | 'cidr',
    value: '',
    label: '',
    effect: 'allow' as 'allow' | 'block',
  })
  const [addingAddress, setAddingAddress] = React.useState(false)

  // Guards every setState below that follows an `await` — without it, a
  // response landing after the admin has already navigated away calls
  // setState on an unmounted component (a React warning today, a real bug if
  // this screen is ever embedded somewhere shorter-lived than a full page).
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    // Not just the cleanup: React 18 StrictMode runs this effect's cleanup
    // once synthetically in development, immediately followed by running
    // the setup again, to surface exactly this class of bug. Without
    // re-arming it here, that synthetic cycle leaves `mountedRef.current`
    // permanently false on a component that is, in fact, mounted and
    // interactive — every guarded setState in this file would then silently
    // no-op forever, which looks like every button hanging in its loading
    // state and never completing.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [list, current, options, security] = await Promise.all([
        api.listGeoRules(),
        api.currentConnection(),
        api.listGeoPresets(),
        api.getSecuritySettings(),
      ])
      if (!mountedRef.current) return
      setRules(list)
      setConnection(current)
      setPresets(options)
      setFencingEnabled(security.geo_fencing_enabled)
      // A focused area that no longer exists (just deleted, from this
      // screen or another tab) would otherwise leave the map framed on a
      // circle that is no longer in `areas` and the "Whole country" reset
      // button showing for a focus that can never be found again.
      setFocus((f) => (f && !list.some((r) => r.id === f.id) ? null : f))
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not load access rules', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [toast])

  React.useEffect(() => {
    void load()
  }, [load])

  const areas: MapArea[] = React.useMemo(
    () =>
      rules
        .filter((r) => r.kind === 'area' && r.latitude !== null && r.longitude !== null)
        .map((r) => ({
          id: r.id,
          label: r.label || r.value,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          radiusKm: r.radius_km,
          effect: r.effect,
          active: r.is_active,
        })),
    [rules],
  )

  /** IP and range rules — a point on a map cannot show these, so they get their own list. */
  const addressRules = React.useMemo(() => rules.filter((r) => r.kind === 'ip' || r.kind === 'cidr'), [rules])

  const choosePreset = (name: string) => {
    const preset = presets.find((p) => p.name === name)
    setDraft((d) => ({
      ...d,
      preset: name,
      name: preset ? preset.name : d.name,
      latitude: preset ? String(preset.latitude) : d.latitude,
      longitude: preset ? String(preset.longitude) : d.longitude,
      radiusKm: preset ? String(preset.radiusKm) : d.radiusKm,
    }))
  }

  /** Fences wherever this request is coming from — the safe first rule. */
  const useMyLocation = () => {
    if (connection?.latitude == null || connection?.longitude == null) return
    setDraft((d) => ({
      ...d,
      preset: '',
      name: connection.city ? `${connection.city} office` : 'My location',
      latitude: String(connection.latitude),
      longitude: String(connection.longitude),
    }))
  }

  const add = async () => {
    const lat = Number(draft.latitude)
    const lon = Number(draft.longitude)
    const radius = Number(draft.radiusKm)

    if (!draft.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) return

    // Caught here rather than only on the server's own 422 — typing a
    // longitude where a latitude goes is a mistake worth catching before a
    // round trip, not after one.
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      toast({
        tone: 'error',
        title: 'Coordinates out of range',
        description: 'Latitude must be between -90 and 90, longitude between -180 and 180.',
      })
      return
    }

    setBusy(true)
    try {
      await api.createGeoArea({
        value: draft.name.trim(),
        label: draft.name.trim(),
        latitude: lat,
        longitude: lon,
        radius_km: radius,
        effect: draft.effect,
      })
      if (!mountedRef.current) return
      toast({
        tone: 'success',
        title: `${draft.name.trim()} added`,
        description: `${draft.effect === 'allow' ? 'Access allowed' : 'Access blocked'} within ${radius} km.`,
      })
      setDraft({ preset: '', name: '', latitude: '', longitude: '', radiusKm: '25', effect: 'allow' })
      await load()
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not add that area', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  /** A single IP address or a CIDR range, typed in directly rather than detected. */
  const addAddress = async () => {
    const value = addressDraft.value.trim()
    if (!value) return

    setAddingAddress(true)
    try {
      await api.createGeoRule({
        kind: addressDraft.kind,
        value,
        effect: addressDraft.effect,
        label: addressDraft.label.trim() || undefined,
      })
      if (!mountedRef.current) return
      toast({
        tone: 'success',
        title: `${value} added`,
        description: addressDraft.effect === 'allow' ? 'Sign-in is now allowed from this address.' : 'Sign-in is now blocked from this address.',
      })
      setAddressDraft({ kind: 'ip', value: '', label: '', effect: 'allow' })
      await load()
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not add that address', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setAddingAddress(false)
    }
  }

  /**
   * One-click "this connection is our office" setup: an allow rule for this
   * exact IP, then the master switch. Order matters — the rule has to exist
   * first, or the switch flip would refuse itself (see the API-side
   * self-lockout guard in SettingsController).
   */
  const setUpOfficeNetwork = async () => {
    if (!connection?.ip || connection.isLocal) return
    setSettingUpOffice(true)
    try {
      await api.createGeoRule({
        kind: 'ip',
        value: connection.ip,
        effect: 'allow',
        label: connection.city ? `${connection.city} office (this connection)` : 'Office network (this connection)',
      })
      const saved = await api.saveSecuritySettings({ geo_fencing_enabled: true })
      if (!mountedRef.current) return
      setFencingEnabled(saved.geo_fencing_enabled)
      toast({
        tone: 'success',
        title: 'Sign-in restricted to this network',
        description: `${connection.ip} is now the only address allowed to sign in, unless you add more below.`,
      })
      await load()
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not restrict sign-in', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setSettingUpOffice(false)
    }
  }

  const turnOffRestriction = async () => {
    setSettingUpOffice(true)
    try {
      const saved = await api.saveSecuritySettings({ geo_fencing_enabled: false })
      if (!mountedRef.current) return
      setFencingEnabled(saved.geo_fencing_enabled)
      toast({ tone: 'success', title: 'Sign-in is no longer restricted by location' })
      await load()
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not change that', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setSettingUpOffice(false)
    }
  }

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      if (!mountedRef.current) return
      toast({ tone: 'success', title: message })
      await load()
    } catch (e) {
      if (!mountedRef.current) return
      toast({ tone: 'error', title: 'Could not apply that change', description: (e as Error).message })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  const allowAreas = areas.filter((a) => a.effect === 'allow' && a.active !== false)

  return (
    <div className="space-y-4">
      {/* What this connection is, and whether the rules would let it in. */}
      <Card>
        <CardHeader
          title="This connection"
          subtitle="Where the request you are reading this with appears to come from"
          action={
            connection ? (
              <Badge tone={connection.allowed ? 'good' : 'critical'}>
                {connection.allowed ? 'Allowed' : 'Blocked'}
              </Badge>
            ) : undefined
          }
        />
        <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-4 sm:p-5">
          {[
            ['IP address', connection?.ip ?? '—'],
            ['City', connection?.city ?? (connection?.isLocal ? 'Local network' : '—')],
            ['Region', connection?.region ?? '—'],
            [
              'Coordinates',
              connection?.latitude != null
                ? `${Number(connection.latitude).toFixed(4)}, ${Number(connection.longitude).toFixed(4)}`
                : '—',
            ],
          ].map(([label, value]) => (
            <div key={label as string}>
              <p className="text-[10px] font-medium tracking-wide text-ink-3 uppercase">{label}</p>
              <p className="mt-1 font-mono text-[13px] text-ink">{value}</p>
            </div>
          ))}
        </div>

        {connection?.isLocal && (
          <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">
            You are on a private or loopback address, which always passes. Geo rules only apply to connections
            arriving over the internet.
          </p>
        )}

        {connection?.areas && connection.areas.length > 0 && (
          <div className="divide-y divide-line border-t border-line">
            {connection.areas.map((a) => (
              <div key={a.label} className="flex flex-wrap items-baseline gap-3 px-4 py-2 sm:px-5">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{a.label}</span>
                <span className="tabular text-[12px] text-ink-3">
                  {num(a.distanceKm, 1)} km away · fence {a.radiusKm} km
                </span>
                <Badge tone={a.inside ? 'good' : 'neutral'}>{a.inside ? 'Inside' : 'Outside'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* One-click "this network is the office" setup. */}
      <Card>
        <CardHeader
          title="Restrict sign-in to the office network"
          subtitle="Employees must be connected to an allowed network to sign in — the same effect as a WiFi allow-list, using the connection's public address since a browser cannot report a WiFi network name to a server."
          action={
            fencingEnabled != null && (
              <Badge tone={fencingEnabled ? 'good' : 'neutral'} dot>
                {fencingEnabled ? 'Restriction on' : 'Not restricted'}
              </Badge>
            )
          }
        />
        <div className="flex flex-wrap items-center gap-3 border-t border-line p-4 sm:p-5">
          <div className="flex items-start gap-2.5 text-[12px] text-ink-3">
            <Building2 className="mt-0.5 size-4 shrink-0" />
            <p className="max-w-md leading-relaxed">
              {fencingEnabled
                ? 'Sign-in is restricted to the networks allowed below. Add every office/branch network that should reach the system — remove this one and everyone using it, including you, is locked out.'
                : 'Turns this connection\'s address into an allow rule, then switches Geo-IP restriction on. Anyone signing in from outside an allowed network afterward is refused — add more networks below as needed.'}
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            {fencingEnabled ? (
              <Button variant="secondary" size="sm" loading={settingUpOffice} onClick={turnOffRestriction}>
                Turn off restriction
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                loading={settingUpOffice}
                disabled={!connection?.ip || connection.isLocal}
                onClick={setUpOfficeNetwork}
              >
                <ShieldCheck className="size-3.5" />
                Make this the office network
              </Button>
            )}
          </div>
        </div>
        {!fencingEnabled && connection?.isLocal && (
          <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">
            This connection is on a private or loopback address, so it has no public network to restrict to. Do this
            from a machine on the actual office network.
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The map */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Access map"
            subtitle={
              allowAreas.length > 0
                ? `Access is allowed from ${allowAreas.length} area${allowAreas.length === 1 ? '' : 's'}`
                : 'No area fences yet — location is not restricting access'
            }
            action={
              focus ? (
                <Button variant="secondary" size="xs" onClick={() => setFocus(null)}>
                  <Maximize2 className="size-3" />
                  Whole country
                </Button>
              ) : undefined
            }
          />
          <div className="border-t border-line bg-surface-2" style={{ height: 520 }}>
            <AccessMap
              areas={areas}
              focus={focus}
              onSelect={(a) => setFocus((f) => (f?.id === a.id ? null : a))}
              connection={
                connection?.latitude != null
                  ? {
                      label: connection.city ?? 'This connection',
                      latitude: Number(connection.latitude),
                      longitude: Number(connection.longitude),
                      allowed: connection.allowed,
                    }
                  : null
              }
            />
          </div>
          <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-3 sm:px-5">
            Circles are the areas access is allowed or blocked from; the pulsing dot is your own connection. Click an
            area to zoom to it.
          </p>
        </Card>

        {/* Adding one */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Add an area" subtitle="Pick a city or enter coordinates" />
            <div className="space-y-3 border-t border-line p-4 sm:p-5">
              <Field label="Philippine city">
                <Select value={draft.preset} onChange={(e) => choosePreset(e.target.value)}>
                  <option value="">Choose a city…</option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} — {p.region}
                    </option>
                  ))}
                </Select>
              </Field>

              {connection?.latitude != null && (
                <Button variant="secondary" size="sm" className="w-full" onClick={useMyLocation}>
                  <Crosshair className="size-3.5" />
                  Use where I am now
                </Button>
              )}

              <Field label="Name" required>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value, preset: '' })}
                  placeholder="Davao head office"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude" required>
                  <Input
                    value={draft.latitude}
                    onChange={(e) => setDraft({ ...draft, latitude: e.target.value, preset: '' })}
                    placeholder="7.1907"
                  />
                </Field>
                <Field label="Longitude" required>
                  <Input
                    value={draft.longitude}
                    onChange={(e) => setDraft({ ...draft, longitude: e.target.value, preset: '' })}
                    placeholder="125.4553"
                  />
                </Field>
              </div>

              <Field
                label={`Radius — ${draft.radiusKm} km`}
                hint="Below about 20 km an IP-based fence starts refusing people who are genuinely in the office."
              >
                <input
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={draft.radiusKm}
                  onChange={(e) => setDraft({ ...draft, radiusKm: e.target.value })}
                  className="w-full accent-brand-500"
                />
              </Field>

              <Field label="Effect">
                <Select
                  value={draft.effect}
                  onChange={(e) => setDraft({ ...draft, effect: e.target.value as 'allow' | 'block' })}
                >
                  <option value="allow">Allow access from here</option>
                  <option value="block">Block access from here</option>
                </Select>
              </Field>

              <Button
                variant="primary"
                size="sm"
                className="w-full"
                loading={busy}
                disabled={!draft.name.trim() || !draft.latitude || !draft.longitude}
                onClick={add}
              >
                <Plus className="size-3.5" />
                Add area
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="Add an IP address" subtitle="A single address, or a range — for an office with a fixed connection" />
            <div className="space-y-3 border-t border-line p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <Select
                    value={addressDraft.kind}
                    onChange={(e) => setAddressDraft({ ...addressDraft, kind: e.target.value as 'ip' | 'cidr' })}
                  >
                    <option value="ip">Single IP</option>
                    <option value="cidr">IP range</option>
                  </Select>
                </Field>
                <Field label="Effect">
                  <Select
                    value={addressDraft.effect}
                    onChange={(e) => setAddressDraft({ ...addressDraft, effect: e.target.value as 'allow' | 'block' })}
                  >
                    <option value="allow">Allow</option>
                    <option value="block">Block</option>
                  </Select>
                </Field>
              </div>

              <Field label="Address" required hint={addressDraft.kind === 'cidr' ? 'e.g. 203.0.113.0/24' : 'e.g. 203.0.113.5'}>
                <Input
                  value={addressDraft.value}
                  onChange={(e) => setAddressDraft({ ...addressDraft, value: e.target.value })}
                  placeholder={addressDraft.kind === 'cidr' ? '203.0.113.0/24' : '203.0.113.5'}
                />
              </Field>

              <Field label="Label" hint="Optional note for the next administrator.">
                <Input
                  value={addressDraft.label}
                  onChange={(e) => setAddressDraft({ ...addressDraft, label: e.target.value })}
                  placeholder="Branch office router"
                />
              </Field>

              <Button
                variant="primary"
                size="sm"
                className="w-full"
                loading={addingAddress}
                disabled={!addressDraft.value.trim()}
                onClick={addAddress}
              >
                <Plus className="size-3.5" />
                Add address
              </Button>

              {addressRules.length > 0 && (
                <div className="-mx-4 mt-1 divide-y divide-line border-t border-line sm:-mx-5">
                  {addressRules.map((rule) => (
                    <div key={rule.id} className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-5">
                      <Badge tone={rule.effect === 'allow' ? 'good' : 'critical'}>{rule.effect}</Badge>
                      <span className="font-mono text-[12px] text-ink">{rule.value}</span>
                      {rule.label && <span className="text-[11px] text-ink-3">· {rule.label}</span>}
                      <div className="ml-auto flex items-center gap-2">
                        <Switch
                          checked={rule.is_active}
                          onChange={(on) =>
                            !busy && run(() => api.toggleGeoRule(rule.id, on), on ? 'Rule enabled' : 'Rule disabled')
                          }
                          label="Active"
                          className={busy ? 'pointer-events-none opacity-60' : undefined}
                        />
                        <Button
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={() => run(() => api.deleteGeoRule(rule.id), 'Rule removed')}
                        >
                          <Trash2 className="size-3 text-critical" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Areas"
              subtitle="Click a name to zoom"
              action={<Badge tone="neutral">{num(areas.length)}</Badge>}
            />
            <div className="divide-y divide-line border-t border-line">
              {!loading && areas.length === 0 && (
                <EmptyState
                  icon={MapPin}
                  title="No areas yet"
                  description="Without one, location is not used to decide access."
                />
              )}
              {areas.map((area) => {
                const rule = rules.find((r) => r.id === area.id)
                if (!rule) return null

                return (
                  <div key={area.id} className="px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <button
                        type="button"
                        onClick={() => setFocus((f) => (f?.id === area.id ? null : area))}
                        className={cn(
                          'min-w-0 flex-1 truncate text-left text-[13px] font-medium transition-colors hover:text-brand-600',
                          focus?.id === area.id ? 'text-brand-600' : 'text-ink',
                        )}
                      >
                        {area.label}
                      </button>
                      <Badge tone={area.effect === 'allow' ? 'good' : 'critical'}>{area.effect}</Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {area.latitude.toFixed(4)}, {area.longitude.toFixed(4)} · {area.radiusKm} km
                    </p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <Switch
                        checked={rule.is_active}
                        onChange={(on) =>
                          !busy && run(() => api.toggleGeoRule(area.id as number, on), on ? 'Area enabled' : 'Area disabled')
                        }
                        label="Active"
                        // Disabling only the switch being changed would still
                        // let a second toggle fire on a different row while
                        // the first one's `load()` is still in flight —
                        // whichever response lands second silently overwrites
                        // the first row's fresh state with a stale one. One
                        // change in flight at a time for this whole list is
                        // the simplest way to make that race impossible.
                        className={busy ? 'pointer-events-none opacity-60' : undefined}
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy}
                        onClick={() => run(() => api.deleteGeoRule(area.id as number), 'Area removed')}
                      >
                        <Trash2 className="size-3 text-critical" />
                        Remove
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Said once, plainly, where the decision is actually made. */}
          <Card>
            <div className="flex items-start gap-3 p-4">
              <Radar className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <p className="text-[12px] leading-relaxed text-ink-2">
                Location comes from the visitor's IP address, which is accurate to a city at best and often resolves to
                the internet provider's exchange rather than the building. Use this to keep the system inside a region;
                do not rely on it to fence a single site. Anyone on mobile data or a VPN may appear somewhere else
                entirely.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
