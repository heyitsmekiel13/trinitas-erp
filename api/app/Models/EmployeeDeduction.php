<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One deduction arrangement against one employee.
 *
 * The outstanding balance is deliberately not a column. It is the principal
 * less what has actually been collected, and what has been collected is the
 * sum of the payslip lines pointing here — so deleting a run's payslips, which
 * is what recomputing does, gives the balance back automatically.
 */
class EmployeeDeduction extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'principal' => 'decimal:2',
            'amount_per_cutoff' => 'decimal:2',
            'starts_on' => 'date',
            'ends_on' => 'date',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function deductionType(): BelongsTo
    {
        return $this->belongsTo(DeductionType::class);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(PayslipLine::class);
    }

    /** Everything collected so far, across every payslip that still exists. */
    public function collected(): float
    {
        return round((float) $this->lines()->sum('amount'), 2);
    }

    /**
     * What is still owed. Null for an open-ended arrangement, which has no
     * principal and therefore no end.
     */
    public function outstanding(): ?float
    {
        if ($this->principal === null) {
            return null;
        }

        return round(max(0, (float) $this->principal - $this->collected()), 2);
    }

    public function isSettled(): bool
    {
        return $this->principal !== null && $this->outstanding() <= 0;
    }

    /** Active, in date, and still owing something. */
    public function scopeCollectableOn(Builder $query, string $from, string $to): Builder
    {
        return $query->where('status', 'Active')
            ->whereDate('starts_on', '<=', $to)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhereDate('ends_on', '>=', $from));
    }
}
