<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Turns a written address into a coordinate.
 *
 * Three providers, tried in order, because no single one is available to
 * everybody:
 *
 *   google      Best results by a distance, and the one people mean when they
 *               say "find it on Google Maps". Needs a billed API key.
 *   nominatim   OpenStreetMap's geocoder. Free and keyless, so the feature
 *               works out of the box; slower and thinner on rural barangays.
 *   gazetteer   The city list already shipped for Geo-IP. Never fails, never
 *               precise — a city centre, honestly labelled as such.
 *
 * Every result carries where it came from and how precise it is, because a
 * rooftop match and a city centre are both "coordinates" and treating them the
 * same is how a truck ends up eight kilometres away.
 *
 * Results are cached on the normalised address. Re-saving a customer without
 * touching their address should not spend a paid lookup.
 */
class Geocoder
{
    /** How long a resolved address stays good. Streets do not move often. */
    private const CACHE_DAYS = 30;

    /** Nominatim's usage policy requires identifying the application. */
    private const USER_AGENT = 'TrinitasERP/1.0 (delivery routing)';

    private const TIMEOUT_SECONDS = 8;

    public function __construct(private readonly Settings $settings) {}

    /**
     * Resolves address parts to a coordinate.
     *
     * @param  array{street?: ?string, barangay?: ?string, city?: ?string, province?: ?string, postalCode?: ?string, region?: ?string}  $parts
     * @return array{latitude: float, longitude: float, label: string, source: string, precision: string}|null
     */
    public function locate(array $parts): ?array
    {
        $candidates = $this->candidates($parts);

        if (! $candidates) {
            return null;
        }

        $key = 'geocode:'.sha1(mb_strtolower($candidates[0]));

        return Cache::remember($key, now()->addDays(self::CACHE_DAYS), function () use ($candidates, $parts) {
            // Google copes with a full, messy address in one go — that is what
            // it is for — so it gets the complete string and nothing else.
            if ($found = $this->viaGoogle($candidates[0])) {
                return $found;
            }

            // OpenStreetMap is literal: a query naming a street, a barangay and
            // a province together matches nothing, while the same address
            // without the barangay matches the street exactly. So the detail is
            // shed a piece at a time until something lands.
            foreach ($candidates as $index => $query) {
                $found = $this->viaNominatim($query);

                if (! $found || ! $this->agreesWithCity($found, $parts)) {
                    continue;
                }

                // Only the query as written can claim a street. The shorter
                // fallbacks deliberately dropped detail, so whatever they
                // matched is a neighbourhood at best however specific the
                // returned label looks.
                if ($index > 0) {
                    $found['precision'] = 'locality';
                }

                unset($found['locality']);

                return $found;
            }

            return $this->viaGazetteer($parts);
        });
    }

    /**
     * The same address written from most to least specific.
     *
     * Capped at three: past that the query has lost the street and is only
     * naming the city, which the gazetteer already answers for free.
     *
     * @return list<string>
     */
    private function candidates(array $parts): array
    {
        $street = trim((string) ($parts['street'] ?? ''));
        $barangay = trim((string) ($parts['barangay'] ?? ''));
        $city = trim((string) ($parts['city'] ?? ''));
        $province = trim((string) ($parts['province'] ?? ''));

        $queries = [
            // Everything, as written.
            $this->compose($parts),
            // Street and city — the shape OpenStreetMap actually indexes.
            $street && $city ? $this->compose(['street' => $street, 'city' => $city, 'province' => $province]) : null,
            // No street: puts the pin in the right barangay at least.
            $barangay && $city ? $this->compose(['barangay' => $barangay, 'city' => $city]) : null,
        ];

        return array_values(array_unique(array_filter($queries, fn ($q) => $q !== null && $q !== '')));
    }

    /**
     * Reads a coordinate a person pasted in.
     *
     * Accepts a bare "7.0731, 125.6128" and the two Google Maps URL shapes —
     * the `@lat,lng,zoom` in a browser address bar and the `!3dlat!4dlng` in a
     * share link. This is the escape hatch for the address no geocoder knows,
     * which in this country is a great many of them.
     *
     * @return array{latitude: float, longitude: float, label: string, source: string, precision: string}|null
     */
    public function parsePasted(string $input): ?array
    {
        $input = trim($input);

        $patterns = [
            // Browser URL: /@7.0731,125.6128,17z
            '/@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/',
            // Share link: !3d7.0731!4d125.6128
            '/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/',
            // Plain pair, pasted from the right-click menu.
            '/^\(?\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)?$/',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $input, $m)) {
                $lat = (float) $m[1];
                $lng = (float) $m[2];

                if (! $this->plausible($lat, $lng)) {
                    return null;
                }

                return [
                    'latitude' => $lat,
                    'longitude' => $lng,
                    'label' => 'Pinned manually',
                    'source' => 'manual',
                    'precision' => 'rooftop',
                ];
            }
        }

        return null;
    }

    /* ====================================================================== */
    /* Providers */
    /* ====================================================================== */

    private function viaGoogle(string $query): ?array
    {
        $key = $this->settings->get('maps', 'google_api_key');

        if (! $key) {
            return null;
        }

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->get('https://maps.googleapis.com/maps/api/geocode/json', [
                    'address' => $query,
                    // Bias to the Philippines so "San Jose" does not land in
                    // California — there are dozens of them here.
                    'components' => 'country:PH',
                    'key' => $key,
                ]);

            $body = $response->json();

            if (($body['status'] ?? '') !== 'OK' || empty($body['results'][0])) {
                return null;
            }

            $best = $body['results'][0];
            $location = $best['geometry']['location'];

            return [
                'latitude' => (float) $location['lat'],
                'longitude' => (float) $location['lng'],
                'label' => (string) ($best['formatted_address'] ?? $query),
                'source' => 'google',
                'precision' => match ($best['geometry']['location_type'] ?? '') {
                    'ROOFTOP' => 'rooftop',
                    'RANGE_INTERPOLATED' => 'street',
                    'GEOMETRIC_CENTER' => 'street',
                    default => 'locality',
                },
            ];
        } catch (\Throwable $e) {
            Log::warning('Google geocoding failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    private function viaNominatim(string $query): ?array
    {
        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->withHeaders(['User-Agent' => self::USER_AGENT])
                ->get('https://nominatim.openstreetmap.org/search', [
                    'q' => $query,
                    'countrycodes' => 'ph',
                    'format' => 'json',
                    'limit' => 1,
                    'addressdetails' => 1,
                ]);

            $results = $response->json();

            if (! is_array($results) || empty($results[0])) {
                return null;
            }

            $best = $results[0];

            return [
                'latitude' => (float) $best['lat'],
                'longitude' => (float) $best['lon'],
                'label' => (string) ($best['display_name'] ?? $query),
                'source' => 'openstreetmap',
                // OSM reports what kind of thing it matched; a building is a
                // rooftop, a road is a street, anything larger is a locality.
                'precision' => match ($best['class'] ?? '') {
                    'building', 'shop', 'amenity' => 'rooftop',
                    'highway' => 'street',
                    default => 'locality',
                },
                // The structured breakdown, kept only so the town can be
                // checked. Stripped before the result is returned.
                'locality' => $this->localityOf($best['address'] ?? []),
            ];
        } catch (\Throwable $e) {
            Log::warning('Nominatim geocoding failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * Last resort: the city list already shipped for Geo-IP fencing.
     *
     * Returns the centre of the nearest named city. Precise to a few
     * kilometres and labelled as such, which is enough to sequence a delivery
     * run and not enough to find a gate.
     */
    private function viaGazetteer(array $parts): ?array
    {
        $needle = mb_strtolower(trim((string) ($parts['city'] ?? '')));

        if ($needle === '') {
            return null;
        }

        foreach (self::CITIES as $city) {
            $name = mb_strtolower($city['name']);

            if ($name === $needle || str_contains($name, $needle) || str_contains($needle, $name)) {
                return [
                    'latitude' => $city['latitude'],
                    'longitude' => $city['longitude'],
                    'label' => "{$city['name']}, {$city['region']}",
                    'source' => 'gazetteer',
                    'precision' => 'locality',
                ];
            }
        }

        return null;
    }

    /* ====================================================================== */
    /* Helpers */
    /* ====================================================================== */

    /** The town a result sits in, from OSM's structured breakdown. */
    private function localityOf(array $address): string
    {
        foreach (['city', 'town', 'municipality', 'village', 'county'] as $field) {
            if (! empty($address[$field])) {
                return (string) $address[$field];
            }
        }

        return '';
    }

    /**
     * Rejects a match that landed in a different town.
     *
     * Nominatim always answers with its closest guess rather than admitting a
     * miss, so a Panabo address comes back as a covered court in Tagum — the
     * right region, the wrong city, and twenty kilometres of delivery route
     * between them. A confident wrong pin is worse than no pin.
     *
     * The check is against the structured town field rather than the display
     * name, because the display name of that same wrong match reads
     * "Tagum-Panabo Circumferential Road" and contains the word Panabo.
     */
    private function agreesWithCity(array $found, array $parts): bool
    {
        $wanted = $this->bareCity((string) ($parts['city'] ?? ''));

        if ($wanted === '') {
            return true;
        }

        $got = $this->bareCity((string) ($found['locality'] ?? ''));

        // No town reported at all — the match is too coarse to contradict.
        if ($got === '') {
            return true;
        }

        return str_contains($got, $wanted) || str_contains($wanted, $got);
    }

    /** "Davao City" and "City of Davao" are both indexed as "davao". */
    private function bareCity(string $name): string
    {
        return trim(mb_strtolower(preg_replace('/\b(city|municipality|of)\b/i', '', $name)));
    }

    /** Builds the one-line address a geocoder expects. */
    private function compose(array $parts): string
    {
        $ordered = [
            $parts['street'] ?? null,
            // "Barangay" spelled out helps both providers considerably.
            ($parts['barangay'] ?? null) ? 'Barangay '.$parts['barangay'] : null,
            $parts['city'] ?? null,
            $parts['province'] ?? null,
            $parts['postalCode'] ?? null,
            'Philippines',
        ];

        return implode(', ', array_filter(array_map('trim', array_filter($ordered, fn ($p) => $p !== null && $p !== ''))));
    }

    /** Inside the Philippine bounding box, give or take. */
    private function plausible(float $lat, float $lng): bool
    {
        return $lat >= 4.0 && $lat <= 22.0 && $lng >= 115.0 && $lng <= 128.0;
    }

    /**
     * Major cities, mirroring the Geo-IP presets.
     *
     * @var list<array{name: string, region: string, latitude: float, longitude: float}>
     */
    private const CITIES = [
        ['name' => 'Davao City', 'region' => 'Davao Region', 'latitude' => 7.1907, 'longitude' => 125.4553],
        ['name' => 'Tagum City', 'region' => 'Davao Region', 'latitude' => 7.4478, 'longitude' => 125.8078],
        ['name' => 'Panabo City', 'region' => 'Davao Region', 'latitude' => 7.3081, 'longitude' => 125.6839],
        ['name' => 'Digos City', 'region' => 'Davao Region', 'latitude' => 6.7496, 'longitude' => 125.3572],
        ['name' => 'General Santos', 'region' => 'Soccsksargen', 'latitude' => 6.1164, 'longitude' => 125.1716],
        ['name' => 'Cagayan de Oro', 'region' => 'Northern Mindanao', 'latitude' => 8.4542, 'longitude' => 124.6319],
        ['name' => 'Zamboanga City', 'region' => 'Zamboanga Peninsula', 'latitude' => 6.9214, 'longitude' => 122.0790],
        ['name' => 'Butuan City', 'region' => 'Caraga', 'latitude' => 8.9475, 'longitude' => 125.5406],
        ['name' => 'Cebu City', 'region' => 'Central Visayas', 'latitude' => 10.3157, 'longitude' => 123.8854],
        ['name' => 'Iloilo City', 'region' => 'Western Visayas', 'latitude' => 10.7202, 'longitude' => 122.5621],
        ['name' => 'Bacolod City', 'region' => 'Western Visayas', 'latitude' => 10.6407, 'longitude' => 122.9689],
        ['name' => 'Tacloban City', 'region' => 'Eastern Visayas', 'latitude' => 11.2444, 'longitude' => 125.0048],
        ['name' => 'Metro Manila', 'region' => 'National Capital Region', 'latitude' => 14.5995, 'longitude' => 120.9842],
        ['name' => 'Quezon City', 'region' => 'National Capital Region', 'latitude' => 14.6760, 'longitude' => 121.0437],
        ['name' => 'Baguio City', 'region' => 'Cordillera', 'latitude' => 16.4023, 'longitude' => 120.5960],
        ['name' => 'Angeles City', 'region' => 'Central Luzon', 'latitude' => 15.1450, 'longitude' => 120.5887],
        ['name' => 'Batangas City', 'region' => 'Calabarzon', 'latitude' => 13.7565, 'longitude' => 121.0583],
        ['name' => 'Naga City', 'region' => 'Bicol Region', 'latitude' => 13.6218, 'longitude' => 123.1948],
        ['name' => 'Puerto Princesa', 'region' => 'Mimaropa', 'latitude' => 9.7392, 'longitude' => 118.7353],
        ['name' => 'Laoag City', 'region' => 'Ilocos Region', 'latitude' => 18.1978, 'longitude' => 120.5936],
    ];
}
