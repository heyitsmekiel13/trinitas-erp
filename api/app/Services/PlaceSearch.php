<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Finding a place by typing part of its name.
 *
 * The old address lookup returned exactly one result and either hit or missed.
 * That is not how anybody searches for somewhere — Google Maps' real advantage
 * is not its data, it is that it shows you five ranked candidates and lets you
 * recognise the right one. A single-answer geocoder asked for "gaisano toril"
 * has to be right first time, and Nominatim's structured matching frequently
 * is not.
 *
 * So this returns a list, and it uses Photon rather than Nominatim.
 *
 * Photon is Komoot's open geocoder over the same OpenStreetMap data. It is
 * free, needs no key, and is built for exactly this: fuzzy, partial,
 * type-ahead matching biased towards a location. On the queries this fleet
 * actually types it is not close — "gaisano mall toril", "panabo public
 * market", "robinsons tagum" and "petron matina davao" all resolve to the
 * right pin, where the structured lookup returned nothing.
 *
 * Nominatim stays as the second pass because it is better at full postal
 * addresses, which Photon ranks poorly. Between them they cover both ways
 * people describe a destination: by name and by address.
 */
class PlaceSearch
{
    private const TIMEOUT_SECONDS = 8;

    /** Place names do not move. */
    private const CACHE_HOURS = 24;

    /** Nominatim's usage policy requires identifying the application. */
    private const USER_AGENT = 'TrinitasERP/1.0 (fleet trip planning)';

    /**
     * Where to bias results towards.
     *
     * Davao City. Photon ranks by distance from this point, which is what
     * turns "petron" from forty thousand worldwide into the ones down the road.
     */
    private const BIAS_LAT = 7.0731;

    private const BIAS_LNG = 125.6128;

    /**
     * @return array<int, array{label: string, detail: string, latitude: float, longitude: float, kind: string, source: string}>
     */
    public function search(string $query, int $limit = 8): array
    {
        $query = trim($query);

        if (mb_strlen($query) < 3) {
            return [];
        }

        $key = 'places:'.sha1(mb_strtolower($query)).":{$limit}";

        return Cache::remember($key, now()->addHours(self::CACHE_HOURS), function () use ($query, $limit) {
            $results = $this->viaPhoton($query, $limit);

            // Top up with postal matches only when Photon came back thin — two
            // providers returning the same place twice is worse than one
            // provider returning it once.
            if (count($results) < 3) {
                $results = array_merge($results, $this->viaNominatim($query, $limit - count($results)));
            }

            return $this->dedupe($results, $limit);
        });
    }

    /* ---------------------------------------------------------------------- */

    private function viaPhoton(string $query, int $limit): array
    {
        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->withHeaders(['User-Agent' => self::USER_AGENT])
                ->get('https://photon.komoot.io/api/', [
                    'q' => $query,
                    'limit' => max(1, $limit),
                    'lat' => self::BIAS_LAT,
                    'lon' => self::BIAS_LNG,
                    'lang' => 'en',
                ]);

            return collect($response->json('features') ?? [])
                ->map(function (array $feature) {
                    $p = $feature['properties'] ?? [];
                    $coords = $feature['geometry']['coordinates'] ?? null;

                    if (! is_array($coords) || count($coords) < 2) {
                        return null;
                    }

                    // Photon splits the address across keys; the useful line is
                    // the name plus enough context to tell two branches apart.
                    $detail = collect([
                        $p['street'] ?? null,
                        $p['district'] ?? null,
                        $p['city'] ?? $p['county'] ?? null,
                        $p['state'] ?? null,
                    ])->filter()->unique()->implode(', ');

                    return [
                        'label' => $p['name'] ?? $p['street'] ?? $p['city'] ?? $query,
                        'detail' => $detail,
                        'latitude' => (float) $coords[1],
                        'longitude' => (float) $coords[0],
                        'kind' => $p['osm_value'] ?? ($p['type'] ?? 'place'),
                        'source' => 'photon',
                    ];
                })
                ->filter()
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::warning('Photon place search failed', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /** Better at a full written address than at a place name. */
    private function viaNominatim(string $query, int $limit): array
    {
        if ($limit < 1) {
            return [];
        }

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->withHeaders(['User-Agent' => self::USER_AGENT])
                ->get('https://nominatim.openstreetmap.org/search', [
                    'q' => $query,
                    'format' => 'jsonv2',
                    'limit' => $limit,
                    'countrycodes' => 'ph',
                    'addressdetails' => 1,
                ]);

            return collect($response->json() ?? [])
                ->map(function (array $row) {
                    $parts = explode(',', (string) ($row['display_name'] ?? ''));

                    return [
                        'label' => trim($parts[0] ?? ''),
                        'detail' => trim(implode(',', array_slice($parts, 1, 3))),
                        'latitude' => (float) $row['lat'],
                        'longitude' => (float) $row['lon'],
                        'kind' => $row['type'] ?? 'place',
                        'source' => 'openstreetmap',
                    ];
                })
                ->filter(fn ($r) => $r['label'] !== '')
                ->values()
                ->all();
        } catch (\Throwable $e) {
            Log::warning('Nominatim place search failed', ['error' => $e->getMessage()]);

            return [];
        }
    }

    /**
     * Drops repeats.
     *
     * Two providers describing the same shopfront rarely agree to the metre,
     * so identity is a rounded coordinate rather than an exact one — about
     * eleven metres, which is close enough to be the same gate and far enough
     * apart to be two different pumps on the same road.
     */
    private function dedupe(array $results, int $limit): array
    {
        $seen = [];
        $out = [];

        foreach ($results as $row) {
            $key = sprintf('%.4f,%.4f', $row['latitude'], $row['longitude']);

            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $out[] = $row;

            if (count($out) >= $limit) {
                break;
            }
        }

        return $out;
    }
}
