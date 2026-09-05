<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Shift extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_night_shift' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    /** Everybody rostered on this shift. */
    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }
}
