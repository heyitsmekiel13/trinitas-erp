<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GeoRule extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
