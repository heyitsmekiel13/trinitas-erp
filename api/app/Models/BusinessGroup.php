<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BusinessGroup extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    public function branchUnits(): HasMany
    {
        return $this->hasMany(BranchUnit::class);
    }

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }
}
