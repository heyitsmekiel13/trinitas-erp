<?php

namespace App\Models;

use App\Services\StockLedger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GoodsReceipt extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'received_at' => 'date',
        ];
    }

    /**
     * Receiving is what moves a purchase order forward.
     *
     * Only a *posted* receipt counts. A draft is somebody still counting boxes
     * on the dock, and letting that update the order would mean the order's
     * progress moved backwards when they corrected a miscount. Every recount
     * re-derives the order's position from all its posted receipts rather than
     * adding a delta, so a correction lands correctly.
     */
    protected static function booted(): void
    {
        static::saved(function (GoodsReceipt $grn) {
            $grn->syncPurchaseOrder();
            $grn->syncStock();
        });

        static::deleted(function (GoodsReceipt $grn) {
            $grn->syncPurchaseOrder();
            // Deleting a posted receipt has to give the stock back.
            app(StockLedger::class)->reverse($grn);
        });
    }

    /**
     * Puts the received goods into stock, once.
     *
     * The goods receipt is the document that moves stock, not the inbound ASN:
     * the ASN announces what is coming and tracks putaway progress, the receipt
     * records what actually arrived and at what quantity. Posting from both
     * would double the inventory.
     *
     * Idempotent by checking the movement log — a receipt saved twice, or edited
     * after posting, must not add the stock again.
     */
    public function syncStock(): void
    {
        // A draft receipt should have moved nothing, so it reconciles to an
        // empty position — which reverses a previous posting if there was one.
        $desired = [];

        if ($this->status === 'Posted') {
            foreach ($this->items()->get() as $line) {
                // Rejected quantities never enter stock — they sit on the dock
                // waiting to go back to the supplier.
                $quantity = (float) $line->quantity_received;
                if ($quantity > 0) {
                    $desired[(int) $line->item_id] = ($desired[(int) $line->item_id] ?? 0) + $quantity;
                }
            }
        }

        app(StockLedger::class)->reconcile(
            reference: $this,
            warehouseId: (int) $this->warehouse_id,
            desired: $desired,
            inReason: 'Receipt',
            outReason: 'Adjustment',
        );
    }

    /** Re-derives the order's received quantities from every posted receipt. */
    public function syncPurchaseOrder(): void
    {
        $order = $this->purchaseOrder()->with('lines')->first();

        if (! $order) {
            return;
        }

        $postedLines = GoodsReceiptLine::query()
            ->whereHas('goodsReceipt', fn ($q) => $q
                ->where('purchase_order_id', $order->id)
                ->where('status', 'Posted'))
            ->get(['purchase_order_line_id', 'quantity_received']);

        $receivedByLine = $postedLines
            ->groupBy('purchase_order_line_id')
            ->map(fn ($rows) => (float) $rows->sum('quantity_received'));

        $ordered = 0.0;
        $received = 0.0;

        foreach ($order->lines as $line) {
            $got = (float) ($receivedByLine[$line->id] ?? 0);

            // Over-delivery is recorded but never counts as more than ordered,
            // or a single generous supplier would push the order past 100%.
            $line->forceFill(['quantity_received' => $got])->save();

            $ordered += (float) $line->quantity;
            $received += min($got, (float) $line->quantity);
        }

        $percent = $ordered > 0 ? (int) round(($received / $ordered) * 100) : 0;

        $order->forceFill([
            'received_pct' => min(100, $percent),
            'status' => match (true) {
                in_array($order->status, ['Draft', 'Cancelled'], true) => $order->status,
                $percent >= 100 => 'Completed',
                $percent > 0 => 'Partial',
                default => $order->status,
            },
        ])->save();
    }

    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function receiver(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'received_by');
    }

    /**
     * Named `items` rather than `lines` on purpose: the table already has a
     * `lines` column holding the count, and an attribute always shadows a
     * relation of the same name — `$model->lines` would silently hand back an
     * integer where a collection was expected.
     */
    public function items(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class);
    }
}
