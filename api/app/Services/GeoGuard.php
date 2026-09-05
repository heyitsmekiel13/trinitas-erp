<?php

namespace App\Services;

use App\Models\GeoRule;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Geo-IP fencing.
 *
 * Decides whether a request's source address may reach the ERP at all.
 * Evaluation order matters:
 *
 *   0. Off by default — see `enabled()`. `Admin → System Settings → Security`
 *      has to turn this on deliberately, the same way `LoginWindowGuard`
 *      does, because a wrong rule can lock out a whole workforce at once.
 *   1. Loopback and private ranges always pass — otherwise a misconfigured
 *      rule locks the administrator out of their own office network.
 *   2. An explicit block on the IP or its range wins over everything.
 *   3. An explicit allow on the IP or its range passes.
 *   4. If any country allow-rules exist, the country must be on the list.
 *   5. Otherwise allow.
 *
 * A "fail open on lookup failure" policy is deliberate: an outage at the
 * geolocation provider must not take down the business.
 */
class GeoGuard
{
    private const LOOKUP_TTL = 86400;

    public function __construct(private readonly Settings $settings) {}

    public function enabled(): bool
    {
        return (bool) $this->settings->get('security', 'geo_fencing_enabled', false);
    }

    public function allows(?string $ip): bool
    {
        return ! $this->enabled() || $this->wouldAllow($ip);
    }

    /**
     * What {@see allows()} would answer if the feature were switched on right
     * now, regardless of whether it actually is.
     *
     * Exists so `SettingsController` can refuse to flip the switch on when
     * doing so would lock out the very administrator flipping it — the same
     * self-lockout guard `GeoRuleController` already applies to individual
     * rule changes, extended to the master switch itself now that it does
     * something.
     */
    public function wouldAllow(?string $ip): bool
    {
        if (! $ip || $this->isLocal($ip)) {
            return true;
        }

        $rules = $this->rules();

        foreach ($rules->where('effect', 'block') as $rule) {
            if ($this->matches($rule, $ip)) {
                return false;
            }
        }

        foreach ($rules->where('effect', 'allow')->whereIn('kind', ['ip', 'cidr', 'area']) as $rule) {
            if ($this->matches($rule, $ip)) {
                return true;
            }
        }

        // An area allow-list is as binding as a country one: once somebody has
        // said "only these places", being outside all of them is a refusal.
        $areas = $rules->where('effect', 'allow')->where('kind', 'area');

        if ($areas->isNotEmpty()) {
            $location = $this->locate($ip);

            // Fail open on an address that will not resolve, for the same
            // reason the country check does: a provider outage must not shut
            // the office out of its own system.
            if (! $location || $location['latitude'] === null) {
                Log::warning('GeoGuard: location lookup failed, allowing request.', ['ip' => $ip]);

                return true;
            }

            return false;
        }

        $allowedCountries = $rules->where('effect', 'allow')->where('kind', 'country')->pluck('value');

        if ($allowedCountries->isEmpty()) {
            return true;
        }

        $country = $this->countryFor($ip);

        // Unknown country with an allow-list configured: let it through but
        // leave a trail, so a provider outage is visible rather than silent.
        if (! $country) {
            Log::warning('GeoGuard: country lookup failed, allowing request.', ['ip' => $ip]);

            return true;
        }

        return $allowedCountries->contains(strtoupper($country));
    }

    /** Two-letter ISO country code for an address, or null if unknown. */
    public function countryFor(?string $ip): ?string
    {
        if (! $ip || $this->isLocal($ip)) {
            return null;
        }

        return Cache::remember("geoip.{$ip}", self::LOOKUP_TTL, function () use ($ip) {
            try {
                $response = Http::timeout(3)->get("http://ip-api.com/json/{$ip}", ['fields' => 'status,countryCode']);

                if ($response->successful() && $response->json('status') === 'success') {
                    return $response->json('countryCode');
                }
            } catch (\Throwable $e) {
                Log::warning('GeoGuard lookup failed.', ['ip' => $ip, 'error' => $e->getMessage()]);
            }

            return null;
        });
    }

    /** Everything the Admin screen needs to describe the current connection. */
    public function describe(?string $ip): array
    {
        $local = $ip ? $this->isLocal($ip) : false;
        $location = $local ? null : $this->locate($ip);

        return [
            'ip' => $ip,
            'country' => $location['country'] ?? $this->countryFor($ip),
            'city' => $location['city'] ?? null,
            'region' => $location['region'] ?? null,
            'latitude' => $location['latitude'] ?? null,
            'longitude' => $location['longitude'] ?? null,
            'isLocal' => $local,
            'allowed' => $this->allows($ip),
            // Distance to each area, so the screen can say *why* a connection
            // was refused rather than only that it was.
            'areas' => $this->areaDistances($location),
        ];
    }

    /**
     * Full location for an address: country, city, region and coordinates.
     *
     * One lookup rather than one per field — the provider returns all of it in
     * the same response, and asking four times would burn the rate limit.
     *
     * @return array{country: ?string, city: ?string, region: ?string, latitude: ?float, longitude: ?float}|null
     */
    public function locate(?string $ip): ?array
    {
        if (! $ip || $this->isLocal($ip)) {
            return null;
        }

        return Cache::remember("geoip.full.{$ip}", self::LOOKUP_TTL, function () use ($ip) {
            try {
                $response = Http::timeout(3)->get("http://ip-api.com/json/{$ip}", [
                    'fields' => 'status,countryCode,regionName,city,lat,lon',
                ]);

                if ($response->successful() && $response->json('status') === 'success') {
                    return [
                        'country' => $response->json('countryCode'),
                        'city' => $response->json('city'),
                        'region' => $response->json('regionName'),
                        'latitude' => $response->json('lat'),
                        'longitude' => $response->json('lon'),
                    ];
                }
            } catch (\Throwable $e) {
                Log::warning('GeoGuard location lookup failed.', ['ip' => $ip, 'error' => $e->getMessage()]);
            }

            return null;
        });
    }

    /** Whether the address resolves inside the rule's circle. */
    private function withinArea(GeoRule $rule, string $ip): bool
    {
        if ($rule->latitude === null || $rule->longitude === null) {
            return false;
        }

        $location = $this->locate($ip);

        if (! $location || $location['latitude'] === null) {
            return false;
        }

        return $this->distanceKm(
            (float) $location['latitude'],
            (float) $location['longitude'],
            (float) $rule->latitude,
            (float) $rule->longitude,
        ) <= (float) $rule->radius_km;
    }

    /**
     * Great-circle distance in kilometres.
     *
     * Haversine: accurate enough over these distances, and it needs no
     * geospatial extension in the database.
     */
    public function distanceKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $earthRadius = 6371.0;

        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return round($earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a)), 2);
    }

    /**
     * How far a connection sits from each configured area.
     *
     * @return array<int, array<string, mixed>>
     */
    private function areaDistances(?array $location): array
    {
        if (! $location || $location['latitude'] === null) {
            return [];
        }

        return $this->rules()
            ->where('kind', 'area')
            ->map(function (GeoRule $rule) use ($location) {
                $distance = $this->distanceKm(
                    (float) $location['latitude'],
                    (float) $location['longitude'],
                    (float) $rule->latitude,
                    (float) $rule->longitude,
                );

                return [
                    'label' => $rule->label ?: $rule->value,
                    'effect' => $rule->effect,
                    'distanceKm' => $distance,
                    'radiusKm' => (int) $rule->radius_km,
                    'inside' => $distance <= (float) $rule->radius_km,
                ];
            })
            ->sortBy('distanceKm')
            ->values()
            ->all();
    }

    private function rules()
    {
        return Cache::remember('erp.geo_rules', 300, fn () => GeoRule::where('is_active', true)->get());
    }

    private function matches(GeoRule $rule, string $ip): bool
    {
        return match ($rule->kind) {
            'ip' => $rule->value === $ip,
            'cidr' => $this->inCidr($ip, $rule->value),
            'country' => strtoupper((string) $this->countryFor($ip)) === strtoupper($rule->value),
            'area' => $this->withinArea($rule, $ip),
            default => false,
        };
    }

    private function isLocal(string $ip): bool
    {
        if ($ip === '127.0.0.1' || $ip === '::1') {
            return true;
        }

        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) === false;
    }

    private function inCidr(string $ip, string $cidr): bool
    {
        if (! str_contains($cidr, '/')) {
            return $ip === $cidr;
        }

        [$subnet, $bits] = explode('/', $cidr, 2);
        $bits = (int) $bits;

        $ipLong = ip2long($ip);
        $subnetLong = ip2long($subnet);

        if ($ipLong === false || $subnetLong === false || $bits < 0 || $bits > 32) {
            return false;
        }

        $mask = $bits === 0 ? 0 : -1 << (32 - $bits);

        return ($ipLong & $mask) === ($subnetLong & $mask);
    }
}
