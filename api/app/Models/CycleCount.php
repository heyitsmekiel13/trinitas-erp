<?php

namespace App\Models;

use App\Services\StockLedger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CycleCount extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'count_date' => 'date',
        ];
    }

    /**
     * Posting a count corrects the books to what was physically found.
     *
     * The count sheet is the authority — that is the whole point of counting.
     * Only `Posted` adjusts anything; a count in progress or awaiting approval
     * is somebody's clipboard, not a decision.
     *
     * Accuracy and variance figures on the header are derived from the lines
     * rather than typed, so the headline cannot flatter the detail.
     */
    protected static function booted(): void
    {
        static::saved(function (CycleCount $count) {
            // Order matters: capture what the system believed *before* the
            // adjustment moves it, or the variance would always read zero.
            $count->hydrateLines();
            $count->syncTotals();

            if ($count->status === 'Posted') {
                $count->postAdjustments();
            }
        });
    }

    /**
     * Fills in what the system believed and what the stock is worth.
     *
     * A counter should only have to enter the item and what they found — asking
     * them to type the system figure invites them to copy it, which defeats the
     * count. Both are read from the balance instead.
     *
     * Frozen once posted: a posted count is a historical record of a variance,
     * and refreshing its system figure from the now-corrected balance would
     * erase the evidence that anything was ever wrong.
     */
    public function hydrateLines(): void
    {
        // Frozen once the books have been corrected. Checking for movements
        // rather than the status is what makes this safe for a count created
        // already-Posted: the status is set before any adjustment happens, so
        // the status alone would skip hydration and leave the cost at zero.
        $alreadyPosted = StockMovement::query()
            ->where('reference_type', 'CycleCount')
            ->where('reference_id', $this->id)
            ->exists();

        if ($alreadyPosted) {
            return;
        }

        $balances = StockBalance::query()
            ->where('warehouse_id', $this->warehouse_id)
            ->whereIn('item_id', $this->items()->pluck('item_id'))
            ->get()
            ->keyBy('item_id');

        foreach ($this->items()->get() as $line) {
            $balance = $balances[$line->item_id] ?? null;

            $line->forceFill([
                'system_quantity' => (float) ($balance->on_hand ?? 0),
                'unit_cost' => (float) ($balance->unit_cost
                    ?? Item::whereKey($line->item_id)->value('unit_cost')
                    ?? 0),
            ])->save();
        }
    }

    /** Recomputes SKUs counted, variance count and accuracy from the lines. */
    public function syncTotals(): void
    {
        $lines = $this->items()->get();

        if ($lines->isEmpty()) {
            return;
        }

        $variances = $lines->filter(fn ($l) => abs($l->variance) > 0.001);
        $valueVariance = round($lines->sum(fn ($l) => $l->variance * (float) $l->unit_cost), 2);

        $this->newQuery()->whereKey($this->getKey())->update([
            'skus_counted' => $lines->count(),
            'variances' => $variances->count(),
            // Accuracy is the share of lines that matched, which is the figure
            // a warehouse manager is actually measured on.
            'accuracy' => round((($lines->count() - $variances->count()) / $lines->count()) * 100, 2),
            'value_variance' => $valueVariance,
        ]);
    }

    /**
     * Adjusts every counted line to its counted quantity.
     *
     * Uses the ledger's `adjustTo` rather than a delta: the counter knows what
     * they found, not what the difference was, and re-posting a corrected sheet
     * must land on the new figure rather than compounding.
     */
    public function postAdjustments(): void
    {
        $ledger = app(StockLedger::class);

        foreach ($this->items()->get() as $line) {
            $ledger->adjustTo(
                itemId: (int) $line->item_id,
                warehouseId: (int) $this->warehouse_id,
                countedQuantity: (float) $line->counted_quantity,
                reference: $this,
            );
        }
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function counter(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'counted_by');
    }

    public function items(): HasMany
    {
        return $this->hasMany(CycleCountLine::class);
    }
}
