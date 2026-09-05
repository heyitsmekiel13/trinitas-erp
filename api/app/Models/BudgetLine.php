<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BudgetLine extends Model
{
    protected $guarded = [];

    /**
     * The year-to-date budget is a share of the annual figure, not a number
     * anyone re-keys every month.
     *
     * `ytd_actual` is deliberately left alone here — it is the sum of what has
     * been posted to this account, and the only honest source for it is the
     * ledger. FinanceOperations::refreshBudgets fills it.
     */
    protected static function booted(): void
    {
        static::saving(function (BudgetLine $line) {
            $monthsElapsed = (int) $line->year === (int) date('Y') ? (int) date('n') : 12;

            $line->ytd_budget = round(((float) $line->annual_budget / 12) * $monthsElapsed, 2);
        });
    }

    /** Budget left after what has been spent and what is already committed. */
    public function getRemainingAttribute(): float
    {
        return round((float) $this->annual_budget - (float) $this->ytd_actual - (float) $this->committed, 2);
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}
