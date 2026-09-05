<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CycleCountLine extends Model
{
    protected $guarded = [];

    /** Positive means more on the shelf than the system believed. */
    public function getVarianceAttribute(): float
    {
        return round((float) $this->counted_quantity - (float) $this->system_quantity, 2);
    }

    public function cycleCount(): BelongsTo
    {
        return $this->belongsTo(CycleCount::class);
    }

    public function item(): BelongsTo
    {
        return $this->belongsTo(Item::class);
    }
}
