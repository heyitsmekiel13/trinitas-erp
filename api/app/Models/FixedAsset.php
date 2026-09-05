<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FixedAsset extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'acquired_on' => 'date',
            'disposed_on' => 'date',
            'depreciated_to' => 'date',
        ];
    }

    /**
     * Depreciation is arithmetic, and net book value is what is left.
     *
     * The monthly charge and the NBV were both typed columns, which allowed an
     * asset to depreciate at a rate its own cost and useful life do not support.
     * Accumulated depreciation is the exception: it is what has actually been
     * posted to the ledger, so it moves only when a depreciation run happens.
     */
    protected static function booted(): void
    {
        static::saving(function (FixedAsset $asset) {
            $asset->monthly_depreciation = $asset->monthlyCharge();

            $accumulated = min((float) $asset->accumulated_depreciation, $asset->depreciableBase());
            $asset->accumulated_depreciation = round($accumulated, 2);
            $asset->net_book_value = round((float) $asset->cost - $accumulated, 2);

            // Disposal outranks everything; otherwise an asset that has given up
            // all its value says so rather than continuing to depreciate.
            if ($asset->status !== 'Disposed' && $asset->status !== 'Impaired') {
                $asset->status = $asset->net_book_value <= (float) $asset->salvage_value + 0.005
                    ? 'Fully Depreciated'
                    : 'In Service';
            }
        });
    }

    /** Cost less what will still be there at the end of its life. */
    public function depreciableBase(): float
    {
        return round(max(0, (float) $this->cost - (float) $this->salvage_value), 2);
    }

    /**
     * The charge for one month.
     *
     * Straight line spreads the base evenly. Declining balance takes a fixed
     * share of what is left, so it never quite reaches zero — which is why it
     * is floored at the salvage value in `depreciateFor`.
     */
    public function monthlyCharge(): float
    {
        $life = (int) $this->useful_life_years;

        if ($life <= 0) {
            return 0.0;
        }

        if ($this->method === 'Declining Balance') {
            $nbv = (float) $this->cost - (float) $this->accumulated_depreciation;
            // Double-declining: twice the straight-line rate on the book value.
            return round(($nbv * (2 / $life)) / 12, 2);
        }

        return round($this->depreciableBase() / ($life * 12), 2);
    }

    /**
     * What may still be charged this month without over-depreciating.
     *
     * Returns zero once the asset has given up its depreciable base, which is
     * what stops a depreciation run driving book value below salvage.
     */
    public function chargeableFor(CarbonImmutable $month): float
    {
        if (in_array($this->status, ['Disposed', 'Impaired'], true)) {
            return 0.0;
        }

        if ($this->acquired_on && CarbonImmutable::parse($this->acquired_on)->startOfMonth()->gt($month)) {
            return 0.0;
        }

        // Already run for this month or later.
        if ($this->depreciated_to && CarbonImmutable::parse($this->depreciated_to)->startOfMonth()->gte($month)) {
            return 0.0;
        }

        $remaining = round($this->depreciableBase() - (float) $this->accumulated_depreciation, 2);

        return round(max(0, min($this->monthlyCharge(), $remaining)), 2);
    }

    /** The maintenance asset this capitalised record belongs to, if any. */
    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }
}
