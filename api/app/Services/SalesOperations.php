<?php

namespace App\Services;

use App\Models\PickList;
use App\Models\Quotation;
use App\Models\SalesOrder;
use App\Models\Warehouse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sales actions that move a document to the next stage.
 *
 * These are the steps that make the department a workflow rather than nine
 * unrelated tables: a quotation the customer accepted becomes an order, and
 * the order carries the quoted prices forward so nobody retypes them.
 */
class SalesOperations
{
    public function __construct(
        private readonly ResourceWriter $writer,
        private readonly AuditLogger $audit,
    ) {}

    /**
     * Turns an accepted quotation into a confirmed sales order.
     *
     * The lines are copied at their quoted prices — that is what the customer
     * agreed to — but unit cost is re-read from the item master by the writer,
     * so the order's margin reflects today's cost rather than a stale figure.
     *
     * @throws ValidationException
     */
    public function convertQuotation(Quotation $quotation, ?int $warehouseId = null): SalesOrder
    {
        $quotation->loadMissing('lines');

        if ($quotation->lines->isEmpty()) {
            throw ValidationException::withMessages([
                'quotation' => 'This quotation has no line items, so there is nothing to order.',
            ]);
        }

        if ($existing = SalesOrder::where('quotation_id', $quotation->id)->first()) {
            throw ValidationException::withMessages([
                'quotation' => "This quotation was already converted into {$existing->order_no}.",
            ]);
        }

        $warehouseId ??= Warehouse::query()->orderBy('id')->value('id');

        if (! $warehouseId) {
            throw ValidationException::withMessages([
                'warehouseId' => 'Create a warehouse before converting a quotation into an order.',
            ]);
        }

        return DB::transaction(function () use ($quotation, $warehouseId) {
            // Going through the writer rather than creating the model directly
            // means the order gets its number, its validation, its line costs
            // and its audit entry by exactly the same path as a hand-keyed one.
            $order = $this->writer->create('sales/orders', config('erp.resources.sales/orders'), [
                'customerId' => $quotation->customer_id,
                'warehouseId' => $warehouseId,
                'salesRepId' => $quotation->owner_id,
                'date' => now()->toDateString(),
                'status' => 'Confirmed',
                'lines' => $quotation->lines->map(fn ($line) => [
                    'itemId' => $line->item_id,
                    'quantity' => (float) $line->quantity,
                    'unitPrice' => (float) $line->unit_price,
                    'discountPct' => (float) $line->discount_pct,
                ])->all(),
            ]);

            $order->forceFill(['quotation_id' => $quotation->id])->save();
            $quotation->forceFill(['status' => 'Won'])->save();

            return $order->refresh();
        });
    }

    /**
     * Hands a confirmed order to the warehouse as a pick list.
     *
     * This is the seam between selling and shipping. From here the floor owns
     * the order's progress: as the list moves Released → Picking → Packed →
     * Staged → Dispatched, the order's fulfilment percentage follows it, and
     * nobody in Sales has to type a number in.
     *
     * @throws ValidationException
     */
    public function releaseToWarehouse(SalesOrder $order): PickList
    {
        $order->loadCount('lines');

        if ($order->lines_count === 0) {
            throw ValidationException::withMessages([
                'order' => 'This order has no line items, so there is nothing to pick.',
            ]);
        }

        if (in_array($order->status, ['Draft', 'Cancelled'], true)) {
            throw ValidationException::withMessages([
                'order' => "A {$order->status} order cannot be released. Confirm it first.",
            ]);
        }

        if ($existing = PickList::where('sales_order_id', $order->id)->first()) {
            throw ValidationException::withMessages([
                'order' => "This order is already with the warehouse as {$existing->pick_no}.",
            ]);
        }

        return DB::transaction(function () use ($order) {
            $pick = PickList::create([
                'pick_no' => $this->nextPickNumber(),
                'warehouse_id' => $order->warehouse_id,
                'sales_order_id' => $order->id,
                'sales_order_no' => $order->order_no,
                // The promised date is the deadline the floor works back from.
                'cutoff_at' => $order->promised_date,
                'lines' => $order->lines_count,
                'lines_picked' => 0,
                'status' => 'Released',
            ]);

            $this->audit->log(
                'released an order to the warehouse',
                'PickList',
                $pick->id,
                "{$pick->pick_no} for {$order->order_no}",
                'warehouse',
            );

            return $pick;
        });
    }

    /** PICK-2026-0001 and so on, locked so two releases cannot collide. */
    private function nextPickNumber(): string
    {
        $stem = 'PICK-'.date('Y').'-';

        $last = PickList::query()
            ->where('pick_no', 'like', $stem.'%')
            ->orderByDesc('pick_no')
            ->lockForUpdate()
            ->value('pick_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
