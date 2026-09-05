<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WageOrderAdjustment extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'old_salary' => 'decimal:4',
            'new_salary' => 'decimal:4',
            'old_daily_rate' => 'decimal:2',
            'new_daily_rate' => 'decimal:2',
        ];
    }

    public function wageOrder(): BelongsTo
    {
        return $this->belongsTo(WageOrder::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
