<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StatutorySetting extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'config' => 'array',
            'effective_from' => 'date',
            'effective_to' => 'date',
            'is_active' => 'boolean',
        ];
    }

    public function withholdingBrackets(): HasMany
    {
        return $this->hasMany(WithholdingBracket::class);
    }

    public function sssBrackets(): HasMany
    {
        return $this->hasMany(SssBracket::class);
    }
}
