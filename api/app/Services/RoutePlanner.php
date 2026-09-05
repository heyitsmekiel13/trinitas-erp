<?php

namespace App\Services;

/**
 * Distance, drive time and fuel for a delivery run.
 *
 * HOW ACCURATE IS THIS: the distance is a great-circle measurement between two
 * points multiplied by a road-winding factor. It is an estimate, not a routed
 * distance — it does not know about bridges, one-way streets, ferries or the
 * fact that Samal is an island. Expect it to land within roughly 15% of the
 * real road distance on the mainland and to be badly wrong across water.
 *
 * Everything it depends on is a setting rather than a constant, so the numbers
 * can be tuned against real trip sheets until they match: drive a route, put
 * the odometer reading against the estimate, adjust the road factor. That is
 * what makes this honest — it is calibrated from the operator's own data
 * instead of pretending to a precision it has not earned.
 */
class RoutePlanner
{
    private const EARTH_RADIUS_KM = 6371.0088;

    /** Sensible starting points for a Philippine provincial distributor. */
    public const DEFAULTS = [
        // Real roads are longer than the line between two points.
        'roadFactor' => 1.30,
        // Mixed provincial highway and town traffic, including stops.
        'averageSpeedKph' => 35.0,
        // Minutes on site: gate, unload, paperwork, signature.
        'handlingMinutes' => 30,
        'fuelPricePerLitre' => 65.00,
        // Used when the vehicle record has no consumption figure of its own.
        'defaultKmPerLitre' => 5.0,
    ];

    public function __construct(private readonly Settings $settings) {}

    /** Straight-line distance between two coordinates, in kilometres. */
    public function greatCircleKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);

        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLon / 2) ** 2;

        return self::EARTH_RADIUS_KM * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * Plans one run.
     *
     * @param  array{lat: float, lng: float, label: string}  $origin
     * @param  array{lat: float, lng: float, label: string}  $destination
     * @param  float|null  $kmPerLitre  The vehicle's consumption, if known.
     * @param  bool  $roundTrip  Whether the truck comes back — it usually does.
     */
    public function plan(
        array $origin,
        array $destination,
        ?float $kmPerLitre = null,
        bool $roundTrip = true,
    ): array {
        $config = $this->config();

        $straightKm = $this->greatCircleKm($origin['lat'], $origin['lng'], $destination['lat'], $destination['lng']);
        $oneWayKm = round($straightKm * $config['roadFactor'], 2);
        $totalKm = round($roundTrip ? $oneWayKm * 2 : $oneWayKm, 2);

        $drivingMinutes = (int) round(($totalKm / max($config['averageSpeedKph'], 1)) * 60);
        // Handling happens once, at the customer, however many legs are driven.
        $totalMinutes = $drivingMinutes + (int) $config['handlingMinutes'];

        $efficiency = $kmPerLitre && $kmPerLitre > 0 ? $kmPerLitre : $config['defaultKmPerLitre'];
        $litres = round($totalKm / max($efficiency, 0.1), 2);

        return [
            'straightLineKm' => round($straightKm, 2),
            'oneWayKm' => $oneWayKm,
            'distanceKm' => $totalKm,
            'roundTrip' => $roundTrip,
            'drivingMinutes' => $drivingMinutes,
            'handlingMinutes' => (int) $config['handlingMinutes'],
            'etaMinutes' => $totalMinutes,
            'kmPerLitre' => round($efficiency, 2),
            'fuelLitres' => $litres,
            'fuelCost' => round($litres * $config['fuelPricePerLitre'], 2),
            'fuelPricePerLitre' => round($config['fuelPricePerLitre'], 2),
            'roadFactor' => $config['roadFactor'],
            'averageSpeedKph' => $config['averageSpeedKph'],
            'origin' => $origin,
            'destination' => $destination,
            'basis' => 'Great-circle distance × road factor. An estimate, not a routed distance.',
        ];
    }

    /** Logistics settings, falling back to the defaults above. */
    public function config(): array
    {
        $stored = $this->settings->group('logistics');

        return [
            'roadFactor' => (float) ($stored['roadFactor'] ?? self::DEFAULTS['roadFactor']),
            'averageSpeedKph' => (float) ($stored['averageSpeedKph'] ?? self::DEFAULTS['averageSpeedKph']),
            'handlingMinutes' => (int) ($stored['handlingMinutes'] ?? self::DEFAULTS['handlingMinutes']),
            'fuelPricePerLitre' => (float) ($stored['fuelPricePerLitre'] ?? self::DEFAULTS['fuelPricePerLitre']),
            'defaultKmPerLitre' => (float) ($stored['defaultKmPerLitre'] ?? self::DEFAULTS['defaultKmPerLitre']),
        ];
    }
}
