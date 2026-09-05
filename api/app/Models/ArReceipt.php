<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Money in from a customer.
 *
 * A receipt is a document rather than a `paid` figure on an invoice, because
 * the questions asked later are when, into which bank, against which invoices
 * and on whose authority — none of which a column can answer.
 */
class ArReceipt extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['receipt_date' => 'date'];
    }

    protected static function booted(): void
    {
        static::saved(function (ArReceipt $receipt) {
            $receipt->syncUnapplied();
            // Every invoice this receipt touches recomputes its own balance,
            // ageing and status from the allocations.
            $receipt->refreshInvoices();
        });

        static::deleted(fn (ArReceipt $receipt) => $receipt->refreshInvoices());
    }

    /** What has been received but not yet put against an invoice. */
    public function syncUnapplied(): void
    {
        $applied = round((float) $this->allocations()->sum('amount'), 2);
        $unapplied = round((float) $this->amount - $applied, 2);

        if ((float) $this->unapplied !== $unapplied) {
            $this->newQuery()->whereKey($this->getKey())->update(['unapplied' => $unapplied]);
            $this->unapplied = $unapplied;
        }
    }

    public function refreshInvoices(): void
    {
        foreach ($this->allocations()->with('invoice')->get() as $allocation) {
            $allocation->invoice?->save();
        }
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function bankAccount(): BelongsTo
    {
        return $this->belongsTo(BankAccount::class);
    }

    public function receivedBy(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'received_by');
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(ArReceiptAllocation::class);
    }
}
