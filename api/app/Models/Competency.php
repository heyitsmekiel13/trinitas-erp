<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One skill or behaviour the company rates people against. */
class Competency extends Model
{
    protected $guarded = [];

    public function ratings(): HasMany
    {
        return $this->hasMany(EmployeeCompetency::class);
    }
}
