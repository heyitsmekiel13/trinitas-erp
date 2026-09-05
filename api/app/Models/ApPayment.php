<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Money out to a supplier.
 *
 * The mirror of a customer receipt: one cheque routinely settles several bills,
 * so the allocation is the document rather than an afterthought.
 */
class ApPayment extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['payment_date' => 'date'];
    }

    protected static function booted(): void
    {
        static::saved(function (ApPayment $payment) {
            $payment->syncUnapplied();
            $payment->refreshBills();
        });

        static::deleted(fn (ApPayment $payment) => $payment->refreshBills());
    }

    public function syncUnapplied(): void
    {
        $applied = round((float) $this->allocations()->sum('amount'), 2);
        $unapplied = round((float) $this->amount - $applied, 2);

        if ((float) $this->unapplied !== $unapplied) {
            $this->newQuery()->whereKey($this->getKey())->update(['unapplied' => $unapplied]);
            $this->unapplied = $unapplied;
        }
    }

    public function refreshBills(): void
    {
        foreach ($this->allocations()->with('bill')->get() as $allocation) {
            $allocation->bill?->save();
        }
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function bankAccount(): BelongsTo
    {
        return $this->belongsTo(BankAccount::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(ApPaymentAllocation::class);
    }
}
