<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaxFiling extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'due_date' => 'date',
            'filed_on' => 'date',
        ];
    }

    /**
     * A filing goes Overdue on its own, because the BIR does not wait for
     * somebody to remember to change a dropdown.
     */
    protected static function booted(): void
    {
        static::saving(function (TaxFiling $filing) {
            $settled = in_array($filing->status, ['Filed', 'Paid'], true);

            if ($settled) {
                return;
            }

            if ($filing->due_date && CarbonImmutable::parse($filing->due_date)->startOfDay()->isPast()) {
                $filing->status = 'Overdue';
            } elseif ($filing->status === 'Overdue') {
                // The due date moved back into the future — an amended period.
                $filing->status = 'In Preparation';
            }
        });
    }

    /** Negative once the deadline has passed. */
    public function getDaysToDueAttribute(): ?int
    {
        return $this->due_date
            ? (int) CarbonImmutable::now()->startOfDay()->diffInDays(CarbonImmutable::parse($this->due_date), false)
            : null;
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }
}
