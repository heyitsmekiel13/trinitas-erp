<?php

namespace App\Models;

use App\Services\StockLedger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StockTransfer extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'transfer_date' => 'date',
            'eta' => 'date',
        ];
    }

    /**
     * A transfer moves stock in two steps, because it physically does.
     *
     * `In Transit` takes the goods off the source shelf — they have left, and
     * the source branch cannot sell them any more. `Received` puts them on the
     * destination shelf. Between those two the stock is legitimately in neither
     * place, which is the honest representation of a truck on the road.
     *
     * Both legs reconcile from the movement log rather than applying deltas, so
     * a transfer can be corrected, reversed and re-posted without drifting.
     */
    protected static function booted(): void
    {
        static::saved(fn (StockTransfer $transfer) => $transfer->syncStock());
        static::deleted(fn (StockTransfer $transfer) => app(StockLedger::class)->reverse($transfer));
    }

    public function syncStock(): void
    {
        $ledger = app(StockLedger::class);
        $lines = $this->items()->get();

        // Draft and Approved have not moved anything yet; Cancelled unwinds.
        $gone = in_array($this->status, ['In Transit', 'Received'], true);
        $arrived = $this->status === 'Received';

        $out = [];
        $in = [];

        foreach ($lines as $line) {
            $quantity = (float) $line->quantity;
            if ($quantity <= 0) {
                continue;
            }

            $itemId = (int) $line->item_id;
            if ($gone) {
                $out[$itemId] = ($out[$itemId] ?? 0) - $quantity;
            }
            if ($arrived) {
                $in[$itemId] = ($in[$itemId] ?? 0) + $quantity;
            }
        }

        // The two warehouses are reconciled independently, which is what lets
        // the goods sit in transit between them.
        $ledger->reconcile($this, (int) $this->from_warehouse_id, $out, 'Transfer In', 'Transfer Out');
        $ledger->reconcile($this, (int) $this->to_warehouse_id, $in, 'Transfer In', 'Transfer Out');
    }

    public function fromWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'from_warehouse_id');
    }

    public function toWarehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class, 'to_warehouse_id');
    }

    /**
     * Named `items` rather than `lines`: the table has a `lines` column holding
     * the count, and an attribute always shadows a relation of the same name.
     */
    public function items(): HasMany
    {
        return $this->hasMany(StockTransferLine::class);
    }
}
