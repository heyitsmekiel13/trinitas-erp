<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Validation\ValidationException;

class JournalEntry extends Model
{
    protected $guarded = [];

    /**
     * Statuses that count as being in the ledger.
     *
     * A reversed entry still counts. It genuinely happened, and its reversal
     * carries the opposite amounts — leaving it out would drop one side of the
     * pair and leave every account it touched wrong by the whole amount, in the
     * opposite direction. `Reversed` is a label for the reader, not an eraser.
     */
    public const IN_LEDGER = ['Posted', 'Reversed'];

    protected function casts(): array
    {
        return [
            'entry_date' => 'date',
            'posted_at' => 'datetime',
        ];
    }

    /**
     * A journal's totals are the sum of its lines, and a posted one is frozen.
     *
     * Both rules exist for the same reason: the ledger is the book of record.
     * A header that disagrees with its lines makes the trial balance a work of
     * fiction, and an editable posted entry means last month's accounts can
     * change after they were reported.
     */
    protected static function booted(): void
    {
        static::updating(function (JournalEntry $entry) {
            $wasPosted = $entry->getOriginal('status') === 'Posted';

            // The Ledger is allowed to move a posted entry to Reversed, and to
            // stamp the posting itself. Nothing else may touch it.
            $allowed = ['status', 'posted_by', 'posted_at', 'total_debit', 'total_credit', 'updated_at', 'memo'];

            if ($wasPosted && array_diff(array_keys($entry->getDirty()), $allowed)) {
                throw ValidationException::withMessages([
                    'status' => "{$entry->journal_no} is posted and cannot be edited. Reverse it and post a correction.",
                ]);
            }
        });

        static::deleting(function (JournalEntry $entry) {
            if (in_array($entry->status, ['Posted', 'Reversed'], true)) {
                throw ValidationException::withMessages([
                    'status' => "{$entry->journal_no} is part of the ledger and cannot be deleted. Reverse it instead.",
                ]);
            }
        });

        static::saved(function (JournalEntry $entry) {
            if ($entry->status !== 'Posted') {
                $entry->syncTotals();
            }
        });
    }

    /** Header totals, recomputed from the lines. */
    public function syncTotals(): void
    {
        $totals = $this->lines()
            ->selectRaw('COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit')
            ->first();

        $debit = round((float) $totals->debit, 2);
        $credit = round((float) $totals->credit, 2);

        if ((float) $this->total_debit !== $debit || (float) $this->total_credit !== $credit) {
            $this->newQuery()->whereKey($this->getKey())->update([
                'total_debit' => $debit,
                'total_credit' => $credit,
            ]);
            $this->total_debit = $debit;
            $this->total_credit = $credit;
        }
    }

    /** How far out of balance the entry is. Zero means it can be posted. */
    public function getOutOfBalanceAttribute(): float
    {
        return round((float) $this->total_debit - (float) $this->total_credit, 2);
    }

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }

    public function preparedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'prepared_by');
    }

    public function postedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'posted_by');
    }

    /** The entry this one undoes, when it is a reversal. */
    public function reverses(): BelongsTo
    {
        return $this->belongsTo(static::class, 'reverses_id');
    }
}
