<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Vehicle extends Model
{
    protected $guarded = [];

    /** The same three ownership boxes a trip ticket prints. Kept in sync with FuelRequest::OWNERSHIP. */
    public const OWNERSHIP = ['CO', 'PO', 'R&C'];

    public const TYPES = ['Sedan', 'Pickup', 'Van', 'Truck', 'Motorcycle'];

    /**
     * A vehicle's own fill-up history is always the first choice for its fuel
     * economy (`FuelLog::baseline()` keeps `fuel_efficiency` current from real
     * odometer deltas). This only matters for a vehicle with no history yet —
     * a type-appropriate guess beats guessing every unrated vehicle gets the
     * same mileage regardless of whether it's a tricycle or a 6-wheeler.
     */
    public const DEFAULT_ECONOMY = [
        'Motorcycle' => 35.0,
        'Sedan' => 12.0,
        'Van' => 9.0,
        'Pickup' => 8.0,
        'Truck' => 5.0,
    ];

    /** The economy to price a trip on: real history/rating first, a type-shaped guess otherwise. */
    public function effectiveEconomy(): float
    {
        if ((float) $this->fuel_efficiency > 0) {
            return (float) $this->fuel_efficiency;
        }

        return self::DEFAULT_ECONOMY[$this->vehicle_type] ?? 6.0;
    }

    protected function casts(): array
    {
        return [
            'registration_expiry' => 'date',
            'insurance_expiry' => 'date',
        ];
    }

    /**
     * A vehicle is the road-going half of an asset, not a separate thing.
     *
     * The asset register is where maintenance history, book value and criticality
     * live; the vehicle row adds the plate, the driver and the statutory papers.
     * Keeping the odometer and the service state on both, in step, is what stops
     * the fleet screen and the asset screen contradicting each other.
     */
    protected static function booted(): void
    {
        static::saved(fn (Vehicle $vehicle) => $vehicle->syncAsset());
    }

    public function syncAsset(): void
    {
        $asset = $this->asset;

        if (! $asset) {
            return;
        }

        $changes = [];

        if ($asset->meter_unit === 'km' && (float) $this->odometer > (float) $asset->meter_reading) {
            $changes['meter_reading'] = (float) $this->odometer;
        }

        // Only the two states that mean the same thing on both records are
        // mirrored. "On Trip" is a fleet concept the asset register has no
        // opinion about, and mapping it would just be noise.
        $mirrored = match ($this->status) {
            'Under Maintenance' => 'Under Maintenance',
            'Breakdown' => 'Breakdown',
            'Retired' => 'Retired',
            default => null,
        };

        if ($mirrored && $asset->status !== $mirrored) {
            $changes['status'] = $mirrored;
        } elseif (! $mirrored && in_array($asset->status, ['Under Maintenance', 'Breakdown'], true)) {
            $changes['status'] = 'Operational';
        }

        if ($changes) {
            $asset->forceFill($changes)->save();
        }
    }

    /** Days until the earlier of registration and insurance runs out. */
    public function daysToNextExpiry(): ?int
    {
        $dates = collect([$this->registration_expiry, $this->insurance_expiry])->filter();

        if ($dates->isEmpty()) {
            return null;
        }

        return (int) round(CarbonImmutable::now()->startOfDay()->diffInDays(
            $dates->map(fn ($d) => CarbonImmutable::parse($d))->min(),
            false,
        ));
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'driver_id');
    }

    public function ownerEmployee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'owner_employee_id');
    }

    public function fuelLogs(): HasMany
    {
        return $this->hasMany(FuelLog::class);
    }
}
