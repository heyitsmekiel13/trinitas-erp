<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** The monthly range a position's salary is judged against, not stored on. */
class SalaryBand extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'min_monthly' => 'decimal:2',
            'mid_monthly' => 'decimal:2',
            'max_monthly' => 'decimal:2',
        ];
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }
}
