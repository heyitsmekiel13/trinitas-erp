<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Account extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_postable' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    /** The UI shows a status word, the table stores a flag. */
    public function getStatusLabelAttribute(): string
    {
        return $this->is_active ? 'Active' : 'Inactive';
    }

    /**
     * Assets and expenses increase on the debit side, everything else on the
     * credit side. Derived rather than chosen, because an account whose normal
     * balance disagrees with its type reports its own balance backwards.
     */
    public function getDerivedNormalBalanceAttribute(): string
    {
        return in_array($this->type, ['Asset', 'Expense'], true) ? 'Debit' : 'Credit';
    }

    protected static function booted(): void
    {
        static::saving(fn (Account $account) => $account->normal_balance = $account->derived_normal_balance);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(static::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(static::class, 'parent_id');
    }

    public function journalLines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }
}
