<?php

namespace App\Models;

use App\Services\RoutePlanner;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Delivery extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'scheduled_at' => 'datetime',
            'delivered_at' => 'datetime',
            'pod_received' => 'boolean',
            'round_trip' => 'boolean',
        ];
    }

    /**
     * The route plan is recomputed here rather than accepted from the form.
     *
     * Distance and fuel drive what a run costs, so they follow from the two
     * pins and the vehicle on record — not from whatever a client posts. Every
     * write path gets the same treatment.
     */
    protected static function booted(): void
    {
        static::saving(function (Delivery $delivery) {
            $changed = $delivery->isDirty([
                'origin_warehouse_id', 'sales_order_id', 'vehicle_asset_id', 'round_trip',
            ]);

            if (! $delivery->exists || $changed) {
                $delivery->applyRoutePlan();
            }
        });
    }

    /** Fills the distance, ETA and fuel columns, or blanks them if unplannable. */
    public function applyRoutePlan(): void
    {
        $plan = $this->routePlan();

        $this->distance_km = $plan['distanceKm'] ?? null;
        $this->eta_minutes = $plan['etaMinutes'] ?? null;
        $this->fuel_litres = $plan['fuelLitres'] ?? null;
        $this->fuel_cost = $plan['fuelCost'] ?? null;
    }

    /**
     * The planned run, or null when either end has no coordinates.
     *
     * A missing pin is a normal state — a customer added in a hurry has no
     * latitude yet — so this reports that rather than inventing a distance.
     */
    public function routePlan(): ?array
    {
        // Falls back to the order's own warehouse when no origin was chosen.
        $origin = $this->originWarehouse ?? $this->salesOrder?->warehouse;
        $customer = $this->salesOrder?->customer;

        if (! $origin?->latitude || ! $origin?->longitude) {
            return null;
        }
        if (! $customer?->latitude || ! $customer?->longitude) {
            return null;
        }

        return app(RoutePlanner::class)->plan(
            ['lat' => (float) $origin->latitude, 'lng' => (float) $origin->longitude, 'label' => $origin->name],
            ['lat' => (float) $customer->latitude, 'lng' => (float) $customer->longitude, 'label' => $customer->name],
            $this->vehicleAsset?->km_per_litre !== null ? (float) $this->vehicleAsset->km_per_litre : null,
            $this->round_trip ?? true,
        );
    }

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(SalesOrder::class);
    }

    public function originWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'origin_warehouse_id');
    }

    public function vehicleAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'vehicle_asset_id');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'driver_id');
    }
}
