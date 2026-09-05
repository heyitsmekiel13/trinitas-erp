<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Asset extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'acquired_on' => 'date',
            'last_service_at' => 'date',
            'next_service_at' => 'date',
        ];
    }

    /**
     * Book value is depreciation, not a field.
     *
     * Straight-line from acquisition cost down to salvage over the useful life,
     * recomputed whenever the asset is saved. An asset with no useful life
     * recorded stays at what it cost — writing something down over a period
     * nobody has stated would be a number with no basis behind it.
     */
    protected static function booted(): void
    {
        static::saving(fn (Asset $asset) => $asset->book_value = $asset->depreciatedValue());
    }

    public function depreciatedValue(): float
    {
        $cost = (float) $this->acquisition_cost;
        $life = (int) ($this->useful_life_years ?? 0);
        $salvage = min((float) $this->salvage_value, $cost);

        if ($life <= 0 || ! $this->acquired_on || $cost <= 0) {
            return round($cost, 2);
        }

        $years = CarbonImmutable::parse($this->acquired_on)->diffInDays(CarbonImmutable::now()) / 365.25;
        $annual = ($cost - $salvage) / $life;

        // Never below salvage, never above cost — an asset with a future
        // acquisition date must not appreciate.
        return round(max($salvage, min($cost, $cost - $annual * max(0, $years))), 2);
    }

    /** Hours or kilometres run since the last completed service. */
    public function meterSinceService(): float
    {
        $lastReading = $this->workOrders()
            ->where('status', 'Completed')
            ->whereNotNull('meter_reading')
            ->orderByDesc('completed_at')
            ->value('meter_reading');

        return round(max(0, (float) $this->meter_reading - (float) ($lastReading ?? 0)), 2);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'assigned_to');
    }

    public function vehicle(): HasOne
    {
        return $this->hasOne(Vehicle::class);
    }

    public function workOrders(): HasMany
    {
        return $this->hasMany(WorkOrder::class);
    }

    public function pmSchedules(): HasMany
    {
        return $this->hasMany(PmSchedule::class);
    }

    public function downtimeEvents(): HasMany
    {
        return $this->hasMany(DowntimeEvent::class);
    }
}
