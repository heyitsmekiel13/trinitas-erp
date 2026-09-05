<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WageOrder extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'effective_date' => 'date',
            'daily_rate' => 'decimal:2',
            'applied_at' => 'datetime',
        ];
    }

    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(BranchUnit::class, 'wage_order_branches');
    }

    public function adjustments(): HasMany
    {
        return $this->hasMany(WageOrderAdjustment::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function appliedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'applied_by');
    }
}
