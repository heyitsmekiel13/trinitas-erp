<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A payroll complaint, HR's response, and any deduction or retro it resolved to. */
class PayrollDispute extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'raised_on' => 'date',
            'resolved_on' => 'date',
            'deduct_amount' => 'decimal:2',
            'retro_amount' => 'decimal:2',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function payrollPeriod(): BelongsTo
    {
        return $this->belongsTo(PayrollPeriod::class);
    }

    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by_id');
    }
}
