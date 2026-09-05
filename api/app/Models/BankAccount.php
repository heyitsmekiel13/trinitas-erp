<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BankAccount extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['last_reconciled_at' => 'date'];
    }

    /**
     * The balance is the sum of the statement lines, and the unreconciled count
     * is how many of them nobody has ticked off yet.
     *
     * Both were stored figures. A bank balance that does not equal its own
     * transactions is the one number in an ERP nobody can argue with being
     * wrong — the bank will say so.
     */
    public function syncFromTransactions(): void
    {
        $totals = $this->transactions()
            ->selectRaw('COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit')
            ->first();

        // Debit increases a bank asset; credit reduces it.
        $balance = round((float) $totals->debit - (float) $totals->credit, 2);
        $unreconciled = $this->transactions()->where('is_reconciled', false)->count();

        if ((float) $this->balance !== $balance || (int) $this->unreconciled_count !== $unreconciled) {
            $this->newQuery()->whereKey($this->getKey())->update([
                'balance' => $balance,
                'unreconciled_count' => $unreconciled,
            ]);
            $this->balance = $balance;
            $this->unreconciled_count = $unreconciled;
        }
    }

    public function glAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'gl_account_id');
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(BankTransaction::class);
    }
}
