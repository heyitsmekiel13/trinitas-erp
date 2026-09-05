<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Holiday extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'holiday_date' => 'date',
        ];
    }

    public function branchUnit(): BelongsTo
    {
        return $this->belongsTo(BranchUnit::class);
    }
}
