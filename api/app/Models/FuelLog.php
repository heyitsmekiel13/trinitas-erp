<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FuelLog extends Model
{
    protected $guarded = [];

    /**
     * How far below its own baseline a fill has to run before it is flagged.
     *
     * Set loose enough that traffic, load and a hilly route do not trigger it —
     * a flag every week is a flag nobody reads.
     */
    public const ANOMALY_THRESHOLD = 0.75;

    protected function casts(): array
    {
        return [
            'logged_at' => 'date',
            'is_flagged' => 'boolean',
        ];
    }

    /**
     * Fuel economy is arithmetic on two odometer readings, not a typed figure.
     *
     * Distance comes from the previous fill on the same vehicle, so km/L is
     * checkable — which is the entire point of asking drivers to write the
     * odometer down. A fill well under the vehicle's own running average is
     * flagged: that pattern is either a leak or a siphon, and both are worth
     * someone's attention.
     */
    protected static function booted(): void
    {
        static::saving(function (FuelLog $log) {
            $previous = static::query()
                ->where('vehicle_id', $log->vehicle_id)
                ->when($log->exists, fn ($q) => $q->whereKeyNot($log->getKey()))
                ->where('odometer', '<=', $log->odometer)
                ->orderByDesc('odometer')
                ->first(['odometer']);

            $distance = $previous ? round((float) $log->odometer - (float) $previous->odometer, 2) : 0.0;
            $litres = (float) $log->litres;

            $log->distance_km = max(0, $distance);
            // The first fill on a vehicle has nothing to measure against, so it
            // reports no efficiency rather than a made-up one.
            $log->km_per_litre = $distance > 0 && $litres > 0 ? round($distance / $litres, 2) : 0;
            $log->is_flagged = $log->km_per_litre > 0 && $log->km_per_litre < $log->baseline() * self::ANOMALY_THRESHOLD;
        });

        static::saved(fn (FuelLog $log) => $log->pushOdometer());
    }

    /**
     * What this vehicle normally achieves.
     *
     * Its own history first, because a loaded ten-wheeler and a pickup are not
     * comparable; the asset's rated economy is the fallback until there is any
     * history to average.
     */
    public function baseline(): float
    {
        $history = static::query()
            ->where('vehicle_id', $this->vehicle_id)
            ->when($this->exists, fn ($q) => $q->whereKeyNot($this->getKey()))
            ->where('km_per_litre', '>', 0)
            ->orderByDesc('logged_at')
            ->limit(10)
            ->avg('km_per_litre');

        if ($history > 0) {
            return (float) $history;
        }

        $vehicle = $this->vehicle()->with('asset')->first();

        return (float) ($vehicle?->fuel_efficiency ?: $vehicle?->asset?->km_per_litre ?: 0);
    }

    /**
     * Carries the odometer back onto the vehicle and its asset record.
     *
     * A fill is the most frequent moment anyone reads a truck's odometer, so it
     * is the natural place for the fleet register to learn the current figure
     * rather than waiting for a service.
     */
    public function pushOdometer(): void
    {
        $vehicle = $this->vehicle;

        if (! $vehicle || (float) $this->odometer <= (float) $vehicle->odometer) {
            return;
        }

        $vehicle->forceFill([
            'odometer' => (float) $this->odometer,
            'km_since_service' => round((float) $vehicle->km_since_service + $this->distance_km, 2),
            'fuel_efficiency' => round($this->baseline() ?: (float) $vehicle->fuel_efficiency, 2),
        ])->save();
    }

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'driver_id');
    }
}
