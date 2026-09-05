<?php

namespace App\Models;

use App\Services\StockLedger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PickList extends Model
{
    protected $guarded = [];

    /** Stages before the goods have left the building. */
    public const OPEN_STATUSES = ['Released', 'Picking', 'Packed', 'Staged'];

    protected function casts(): array
    {
        return [
            'cutoff_at' => 'datetime',
            'packed_at' => 'datetime',
            'dispatched_at' => 'datetime',
        ];
    }

    /**
     * Warehouse progress is pushed back onto the order it came from.
     *
     * An order's fulfilment percentage is not something anyone should type —
     * it is what the floor has actually picked. Stamping the packed and
     * dispatched times here too means the timeline is recorded by the act of
     * moving the list along, not by remembering to fill in a date.
     */
    protected static function booted(): void
    {
        static::saving(function (PickList $pick) {
            if (! $pick->isDirty('status')) {
                return;
            }

            if ($pick->status === 'Packed' && ! $pick->packed_at) {
                $pick->packed_at = now();
            }

            if ($pick->status === 'Dispatched') {
                $pick->dispatched_at ??= now();
                // Dispatch means it all went, whatever the counter said.
                $pick->lines_picked = $pick->lines;
            }
        });

        static::saved(function (PickList $pick) {
            $pick->syncSalesOrder();
            $pick->syncStock();
        });

        static::deleted(function (PickList $pick) {
            $pick->syncSalesOrder();
            app(StockLedger::class)->reverse($pick);
        });
    }

    /**
     * Dispatch is what takes stock out.
     *
     * The lines come from the sales order this list fulfils — a pick list
     * records how many lines were picked, not which items, so the order is the
     * only place that knows what physically left. Anything not linked to an
     * order cannot move stock, and says so rather than guessing.
     *
     * Idempotent against the movement log: dispatching twice, or editing a
     * dispatched list, must not issue the goods again.
     */
    public function syncStock(): void
    {
        $desired = [];

        if ($this->status === 'Dispatched' && $this->sales_order_id) {
            $order = $this->salesOrder()->with('lines')->first();

            foreach ($order?->lines ?? [] as $line) {
                $quantity = (float) $line->quantity;
                if ($quantity > 0) {
                    $desired[(int) $line->item_id] = ($desired[(int) $line->item_id] ?? 0) + $quantity;
                }
            }
        }

        // Issues are negative movements, so the desired position is negative:
        // reconcile receives when it needs to give stock back and issues when
        // it needs to take more out.
        app(StockLedger::class)->reconcile(
            reference: $this,
            warehouseId: (int) $this->warehouse_id,
            desired: array_map(fn (float $q) => -$q, $desired),
            inReason: 'Return',
            outReason: 'Issue',
        );
    }

    /** Recomputes the parent order's fulfilment from every pick list on it. */
    public function syncSalesOrder(): void
    {
        $order = $this->salesOrder;

        if (! $order) {
            return;
        }

        $picks = static::where('sales_order_id', $order->id)
            ->where('status', '!=', 'On Hold')
            ->get(['lines', 'lines_picked', 'status']);

        $lines = (int) $picks->sum('lines');
        $picked = (int) $picks->sum('lines_picked');

        $percent = $lines > 0 ? (int) round(($picked / $lines) * 100) : 0;
        $allDispatched = $picks->isNotEmpty() && $picks->every(fn ($p) => $p->status === 'Dispatched');

        $order->forceFill([
            'fulfilled_pct' => min(100, $percent),
            // A confirmed order becomes Partial the moment picking starts and
            // Delivered once every list has left the building. Draft, on-hold
            // and cancelled orders are left alone — the floor does not
            // overrule a decision made in the office.
            'status' => match (true) {
                in_array($order->status, ['Draft', 'On Hold', 'Cancelled'], true) => $order->status,
                $allDispatched => 'Delivered',
                $percent > 0 => 'Partial',
                default => $order->status,
            },
        ])->save();
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(SalesOrder::class);
    }

    public function picker(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'picker_id');
    }

    public function pickWave(): BelongsTo
    {
        return $this->belongsTo(PickWave::class, 'wave_id');
    }
}
