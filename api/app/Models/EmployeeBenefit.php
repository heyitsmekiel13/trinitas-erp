<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One employee's enrollment in one benefit plan. */
class EmployeeBenefit extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'enrolled_on' => 'date',
            'ended_on' => 'date',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function benefitPlan(): BelongsTo
    {
        return $this->belongsTo(BenefitPlan::class);
    }
}
