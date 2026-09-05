<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FuelRequestLeg extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'round_trip' => 'boolean',
            'distance_km' => 'decimal:2',
        ];
    }

    public function fuelRequest(): BelongsTo
    {
        return $this->belongsTo(FuelRequest::class);
    }
}
