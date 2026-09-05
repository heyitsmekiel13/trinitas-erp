<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Validation\ValidationException;

class InboundShipment extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'arrival_at' => 'datetime',
        ];
    }

    /**
     * An ASN inherits from the purchase order it announces.
     *
     * Supplier, destination warehouse, PO number and expected line count are
     * all facts the order already knows. Re-keying them at the receiving dock
     * is how a shipment ends up booked against the wrong supplier, so the
     * receiver picks the PO and everything else follows.
     */
    protected static function booted(): void
    {
        static::saving(function (InboundShipment $shipment) {
            if (! $shipment->isDirty('purchase_order_id') || ! $shipment->purchase_order_id) {
                return;
            }

            $order = PurchaseOrder::withCount('lines')->find($shipment->purchase_order_id);

            if (! $order) {
                return;
            }

            $shipment->supplier_id = $order->supplier_id;
            $shipment->warehouse_id = $shipment->warehouse_id ?: $order->warehouse_id;
            $shipment->reference = $order->po_no;

            // An order raised from a tender has no destination until the buyer
            // sets one. Say so, rather than letting a NOT NULL constraint
            // surface as a database error at the receiving dock.
            if (! $shipment->warehouse_id) {
                throw ValidationException::withMessages([
                    'warehouseId' => "{$order->po_no} has no delivery warehouse set. Choose one here, or set it on the order.",
                ]);
            }
            // Expected count, so putaway progress has a denominator on arrival.
            $shipment->lines_total = $shipment->lines_total ?: (int) $order->lines_count;
        });
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }
}
