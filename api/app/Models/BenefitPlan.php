<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One thing the company offers — an HMO, a life insurance line, an allowance. */
class BenefitPlan extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'employer_cost' => 'decimal:2',
            'employee_cost' => 'decimal:2',
            'active' => 'boolean',
        ];
    }

    public function enrollments(): HasMany
    {
        return $this->hasMany(EmployeeBenefit::class);
    }
}
