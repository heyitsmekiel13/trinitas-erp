<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WithholdingBracket extends Model
{
    protected $guarded = [];

    public function statutorySetting(): BelongsTo
    {
        return $this->belongsTo(StatutorySetting::class);
    }
}
