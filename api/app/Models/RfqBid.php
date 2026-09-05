<?php

namespace App\Models;

use App\Services\ProcurementOperations;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RfqBid extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_awarded' => 'boolean',
        ];
    }

    /**
     * The RFQ's headline figures are derived from its bids, never typed.
     *
     * Response count and best bid are the two numbers a buyer glances at, and
     * they are exactly the two that go stale if kept by hand. Recomputing them
     * whenever a bid lands means the summary can never disagree with the grid.
     */
    protected static function booted(): void
    {
        static::saved(fn (RfqBid $bid) => $bid->refreshRfq());
        static::deleted(fn (RfqBid $bid) => $bid->refreshRfq());
    }

    private function refreshRfq(): void
    {
        if ($rfq = $this->rfq) {
            app(ProcurementOperations::class)->refreshRfqBids($rfq);
        }
    }

    public function rfq(): BelongsTo
    {
        return $this->belongsTo(Rfq::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
