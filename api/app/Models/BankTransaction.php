<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankTransaction extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'transaction_date' => 'date',
            'is_reconciled' => 'boolean',
        ];
    }

    /**
     * Every change to a statement line re-derives the account it belongs to,
     * so the bank balance on the Banking screen is never a separate opinion
     * from the lines beneath it.
     */
    protected static function booted(): void
    {
        static::saved(fn (BankTransaction $row) => $row->bankAccount?->syncFromTransactions());
        static::deleted(fn (BankTransaction $row) => $row->bankAccount?->syncFromTransactions());
    }

    public function bankAccount(): BelongsTo
    {
        return $this->belongsTo(BankAccount::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }
}
