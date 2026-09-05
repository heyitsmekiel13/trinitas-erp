<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * How far it is by road, and how long it takes.
 *
 * The same three-provider shape as the Geocoder next door, and for the same
 * reason — no single routing service is available to everybody:
 *
 *   google          Google Directions. What people mean by "check it on Google
 *                   Maps". Needs the billed API key set in Admin → Maps; the
 *                   same key the geocoder uses.
 *   osrm            The Open Source Routing Machine's public server. Free,
 *                   keyless, real road distances. This is what makes the
 *                   feature work out of the box.
 *   straight-line   Haversine. Never fails, never right — the crow's distance
 *                   between two pins. Padded by a road factor and labelled
 *                   honestly, because a straight line approved as though it
 *                   were a route under-fuels the truck.
 *
 * The source travels with every result. A form that shows "142 km" without
 * saying whether that is a road or a ruler is asking somebody to sign for the
 * difference.
 */
class Router
{
    private const TIMEOUT_SECONDS = 8;

    /** Routes change less often than traffic; this is a distance cache, not an ETA one. */
    private const CACHE_HOURS = 12;

    /**
     * Philippine roads are not straight.
     *
     * 1.35 is the ratio between road distance and great-circle distance that
     * the archipelago's road network actually produces — mountain provinces
     * run higher, Metro Manila lower. It is only ever used when both real
     * providers are unavailable, and the result is labelled as an estimate so
     * nobody mistakes it for a route.
     */
    private const ROAD_FACTOR = 1.35;

    /** A loaded truck through provincial traffic, in km/h. */
    private const ASSUMED_SPEED_KPH = 38;

    public function __construct(private readonly Settings $settings) {}

    /**
     * @return array{distanceKm: float, durationMinutes: int, source: string, polyline: array<int, array{0: float, 1: float}>, note: string}
     */
    public function route(float $fromLat, float $fromLng, float $toLat, float $toLng): array
    {
        $key = sprintf('route:%.5f,%.5f:%.5f,%.5f', $fromLat, $fromLng, $toLat, $toLng);

        return Cache::remember($key, now()->addHours(self::CACHE_HOURS), function () use ($fromLat, $fromLng, $toLat, $toLng) {
            if ($found = $this->viaGoogle($fromLat, $fromLng, $toLat, $toLng)) {
                return $found;
            }

            if ($found = $this->viaOsrm($fromLat, $fromLng, $toLat, $toLng)) {
                return $found;
            }

            return $this->straightLine($fromLat, $fromLng, $toLat, $toLng);
        });
    }

    /* ---------------------------------------------------------------------- */

    private function viaGoogle(float $fromLat, float $fromLng, float $toLat, float $toLng): ?array
    {
        $key = $this->settings->get('maps', 'google_api_key');

        if (! $key) {
            return null;
        }

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->get('https://maps.googleapis.com/maps/api/directions/json', [
                    'origin' => "{$fromLat},{$fromLng}",
                    'destination' => "{$toLat},{$toLng}",
                    'mode' => 'driving',
                    'region' => 'ph',
                    'key' => $key,
                ]);

            $leg = $response->json('routes.0.legs.0');

            if (! $leg) {
                return null;
            }

            return [
                'distanceKm' => round(((float) $leg['distance']['value']) / 1000, 2),
                'durationMinutes' => (int) round(((float) $leg['duration']['value']) / 60),
                'source' => 'google',
                'polyline' => $this->decodePolyline((string) $response->json('routes.0.overview_polyline.points', '')),
                'note' => 'Road route from Google Directions.',
            ];
        } catch (\Throwable $e) {
            Log::warning('Google directions failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * OSRM's public demo server.
     *
     * Free and keyless, which is the only reason the map works on a fresh
     * install. Its own usage policy asks for light, non-commercial traffic, so
     * results are cached and a fleet that runs this in anger should point the
     * setting at a self-hosted instance — that is one URL, not a rewrite.
     */
    private function viaOsrm(float $fromLat, float $fromLng, float $toLat, float $toLng): ?array
    {
        $base = $this->settings->get('maps', 'osrm_url') ?: 'https://router.project-osrm.org';

        try {
            $response = Http::timeout(self::TIMEOUT_SECONDS)
                ->get("{$base}/route/v1/driving/{$fromLng},{$fromLat};{$toLng},{$toLat}", [
                    'overview' => 'full',
                    'geometries' => 'geojson',
                ]);

            $route = $response->json('routes.0');

            if (! $route) {
                return null;
            }

            // GeoJSON is [lng, lat]; the rest of the app speaks [lat, lng].
            $polyline = collect($route['geometry']['coordinates'] ?? [])
                ->map(fn ($pair) => [(float) $pair[1], (float) $pair[0]])
                ->all();

            return [
                'distanceKm' => round(((float) $route['distance']) / 1000, 2),
                'durationMinutes' => (int) round(((float) $route['duration']) / 60),
                'source' => 'osrm',
                'polyline' => $polyline,
                'note' => 'Road route from OpenStreetMap routing.',
            ];
        } catch (\Throwable $e) {
            Log::warning('OSRM routing failed', ['error' => $e->getMessage()]);

            return null;
        }
    }

    private function straightLine(float $fromLat, float $fromLng, float $toLat, float $toLng): array
    {
        $direct = $this->haversineKm($fromLat, $fromLng, $toLat, $toLng);
        $distance = round($direct * self::ROAD_FACTOR, 2);

        return [
            'distanceKm' => $distance,
            'durationMinutes' => (int) round(($distance / self::ASSUMED_SPEED_KPH) * 60),
            'source' => 'straight-line',
            'polyline' => [[$fromLat, $fromLng], [$toLat, $toLng]],
            'note' => 'No routing service reachable — this is the direct distance padded for roads, not a route. '
                .'Treat the litres as a rough guide.',
        ];
    }

    private function haversineKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earth = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return $earth * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /** Google returns its geometry as an encoded polyline rather than GeoJSON. */
    private function decodePolyline(string $encoded): array
    {
        $points = [];
        $index = 0;
        $lat = 0;
        $lng = 0;
        $length = strlen($encoded);

        while ($index < $length) {
            foreach (['lat', 'lng'] as $axis) {
                $shift = 0;
                $result = 0;

                do {
                    if ($index >= $length) {
                        return $points;
                    }
                    $byte = ord($encoded[$index++]) - 63;
                    $result |= ($byte & 0x1F) << $shift;
                    $shift += 5;
                } while ($byte >= 0x20);

                $delta = ($result & 1) ? ~($result >> 1) : ($result >> 1);
                $axis === 'lat' ? $lat += $delta : $lng += $delta;
            }

            $points[] = [$lat / 1e5, $lng / 1e5];
        }

        return $points;
    }

    /**
     * The litres a trip should need.
     *
     * Distance over the vehicle's own measured economy, plus a reserve. The
     * reserve is not padding for its own sake: a truck that arrives empty
     * cannot divert, and the alternative to a 10% margin is a driver buying
     * fuel out of pocket and claiming it later.
     *
     * Falls back to a conservative 6 km/L when the vehicle has no measured
     * economy yet — under-estimating economy over-estimates fuel, which is the
     * safe direction to be wrong in.
     */
    public function suggestLitres(float $distanceKm, float $kmPerLitre, int $reservePct = 10): float
    {
        $economy = $kmPerLitre > 0 ? $kmPerLitre : 6.0;

        return round(($distanceKm / $economy) * (1 + $reservePct / 100), 2);
    }
}
