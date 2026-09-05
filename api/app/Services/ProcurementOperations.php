<?php

namespace App\Services;

use App\Models\GoodsReceipt;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequisition;
use App\Models\Rfq;
use App\Models\RfqBid;
use App\Models\SupplierInvoice;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The procurement chain: requisition → RFQ → award → order → receipt → invoice.
 *
 * Each step here copies the previous document forward rather than asking
 * someone to retype it. That is the whole value of the chain — not the audit
 * trail for its own sake, but that the quantity on the invoice can be traced
 * to the quantity that arrived, which can be traced to the quantity ordered,
 * without anyone reconciling three spreadsheets.
 */
class ProcurementOperations
{
    public function __construct(
        private readonly ResourceWriter $writer,
        private readonly AuditLogger $audit,
    ) {}

    /* ---------------------------- Requisition ---------------------------- */

    /**
     * Opens an RFQ for an approved requisition.
     *
     * The estimated value carries across as the benchmark every bid is later
     * measured against — savings mean nothing without it.
     *
     * @throws ValidationException
     */
    public function requisitionToRfq(PurchaseRequisition $requisition): Rfq
    {
        $requisition->loadMissing('items');

        if ($requisition->status !== 'Approved') {
            throw ValidationException::withMessages([
                'requisition' => "Only an approved requisition can go out to tender. This one is {$requisition->status}.",
            ]);
        }

        if ($requisition->items->isEmpty()) {
            throw ValidationException::withMessages([
                'requisition' => 'This requisition has no line items, so there is nothing to quote.',
            ]);
        }

        if ($existing = Rfq::where('purchase_requisition_id', $requisition->id)->first()) {
            throw ValidationException::withMessages([
                'requisition' => "This requisition is already out as {$existing->rfq_no}.",
            ]);
        }

        return DB::transaction(function () use ($requisition) {
            $rfq = Rfq::create([
                'rfq_no' => $this->nextNumber(Rfq::class, 'rfq_no', 'RFQ-'),
                'purchase_requisition_id' => $requisition->id,
                'title' => $requisition->title,
                'buyer_id' => $requisition->requested_by,
                'issued_at' => now()->toDateString(),
                'closes_at' => $requisition->needed_by
                    // Close the tender a week before the goods are needed, so
                    // there is time left to actually order and deliver them.
                    ? $requisition->needed_by->copy()->subWeek()->toDateString()
                    : now()->addWeeks(2)->toDateString(),
                'estimated_value' => $requisition->amount,
                'status' => 'Open',
            ]);

            $this->audit->log(
                'opened an RFQ from a requisition',
                'Rfq',
                $rfq->id,
                "{$rfq->rfq_no} from {$requisition->requisition_no}",
                'procurement',
            );

            return $rfq;
        });
    }

    /**
     * Creates a purchase order straight from a requisition.
     *
     * The route for goods that do not need competitive tender — a repeat buy
     * from an accredited supplier. Lines carry over at their estimated cost,
     * which the buyer is expected to correct once the supplier confirms.
     *
     * @throws ValidationException
     */
    public function requisitionToOrder(PurchaseRequisition $requisition, int $supplierId): PurchaseOrder
    {
        $requisition->loadMissing('items');

        if ($requisition->status !== 'Approved') {
            throw ValidationException::withMessages([
                'requisition' => "Only an approved requisition can become an order. This one is {$requisition->status}.",
            ]);
        }

        if ($requisition->items->isEmpty()) {
            throw ValidationException::withMessages([
                'requisition' => 'This requisition has no line items, so there is nothing to order.',
            ]);
        }

        return DB::transaction(function () use ($requisition, $supplierId) {
            $order = $this->createOrder(
                $supplierId,
                $requisition->items->map(fn ($line) => [
                    'itemId' => $line->item_id,
                    'quantity' => (float) $line->quantity,
                    'unitPrice' => (float) $line->estimated_cost,
                ])->all(),
            );

            $order->forceFill(['purchase_requisition_id' => $requisition->id])->save();
            $requisition->forceFill(['status' => 'Converted'])->save();

            return $order->refresh();
        });
    }

    /* -------------------------------- RFQ -------------------------------- */

    /**
     * Awards a bid and turns it into a purchase order.
     *
     * The order is priced from the winning bid, spread across the requisition's
     * lines in proportion to their estimated cost — a supplier quotes one
     * number for the package, and this is what turns that back into lines
     * without pretending to a per-item breakdown nobody gave us.
     *
     * @throws ValidationException
     */
    public function awardBid(RfqBid $bid): PurchaseOrder
    {
        $rfq = $bid->rfq()->with('requisition.items')->firstOrFail();

        if ($rfq->status === 'Awarded') {
            throw ValidationException::withMessages([
                'rfq' => "{$rfq->rfq_no} has already been awarded.",
            ]);
        }

        $lines = $rfq->requisition?->items ?? collect();

        if ($lines->isEmpty()) {
            throw ValidationException::withMessages([
                'rfq' => 'This RFQ is not linked to a requisition with line items, so there is nothing to order. Raise the order manually.',
            ]);
        }

        $estimated = (float) $lines->sum(fn ($l) => (float) $l->line_total);

        return DB::transaction(function () use ($bid, $rfq, $lines, $estimated) {
            // Scale every line by the same factor the supplier moved the total.
            $factor = $estimated > 0 ? (float) $bid->amount / $estimated : 1.0;

            $order = $this->createOrder(
                $bid->supplier_id,
                $lines->map(fn ($line) => [
                    'itemId' => $line->item_id,
                    'quantity' => (float) $line->quantity,
                    'unitPrice' => round((float) $line->estimated_cost * $factor, 2),
                ])->all(),
            );

            $order->forceFill([
                'rfq_id' => $rfq->id,
                'purchase_requisition_id' => $rfq->purchase_requisition_id,
            ])->save();

            RfqBid::where('rfq_id', $rfq->id)->update(['is_awarded' => false]);
            $bid->forceFill(['is_awarded' => true])->save();

            $rfq->forceFill([
                'status' => 'Awarded',
                'awarded_supplier_id' => $bid->supplier_id,
                // `best_bid` deliberately stays the lowest quote received, not
                // the one awarded. The cheapest bid is often rightly passed
                // over for lead time or quality — overwriting it here would
                // erase the evidence that a cheaper option existed, which is
                // exactly what an auditor will ask about.
                'savings' => round(max(0, (float) $rfq->estimated_value - (float) $bid->amount), 2),
            ])->save();

            $this->audit->log(
                'awarded an RFQ',
                'Rfq',
                $rfq->id,
                "{$rfq->rfq_no} to {$bid->supplier->name} — {$order->po_no}",
                'procurement',
            );

            return $order->refresh();
        });
    }

    /** Keeps an RFQ's headline bid figures true to the bids beneath it. */
    public function refreshRfqBids(Rfq $rfq): void
    {
        $bids = RfqBid::where('rfq_id', $rfq->id)->get(['amount']);

        $rfq->forceFill([
            'responses_received' => $bids->count(),
            'best_bid' => $bids->isEmpty() ? 0 : round((float) $bids->min('amount'), 2),
            'suppliers_invited' => max((int) $rfq->suppliers_invited, $bids->count()),
        ])->save();
    }

    /* ------------------------------ Invoices ----------------------------- */

    /**
     * Three-way match: order, receipt, invoice.
     *
     * Compares what was billed against the value of what actually arrived,
     * priced at the rates on the order. A supplier who ships short and bills
     * full shows as a quantity variance; one who ships right and bills high
     * shows as a price variance. Neither is blocked here — the point is that
     * whoever approves the payment is told before they approve it.
     */
    public function matchInvoice(SupplierInvoice $invoice): array
    {
        $order = $invoice->purchaseOrder()->with('lines')->first();

        if (! $order) {
            $invoice->forceFill(['match_status' => 'Unmatched'])->save();

            return [
                'match' => 'Unmatched',
                'detail' => 'No purchase order is linked to this invoice.',
            ];
        }

        $ordered = round((float) $order->total, 2);
        $billed = round((float) $invoice->amount, 2);

        // Value of the goods actually received, at order prices.
        $receivedValue = round($order->lines->sum(
            fn ($line) => min((float) $line->quantity_received, (float) $line->quantity) * (float) $line->unit_cost,
        ), 2);

        $hasReceipt = GoodsReceipt::where('purchase_order_id', $order->id)
            ->where('status', 'Posted')
            ->exists();

        // A peso either way is rounding, not a dispute.
        $tolerance = 1.00;

        $match = match (true) {
            ! $hasReceipt => '2-way only',
            abs($billed - $receivedValue) <= $tolerance => 'Matched',
            abs($ordered - $billed) > $tolerance && abs($receivedValue - $ordered) <= $tolerance => 'Price variance',
            default => 'Qty variance',
        };

        $invoice->forceFill(['match_status' => $match])->save();

        return [
            'match' => $match,
            'orderedValue' => $ordered,
            'receivedValue' => $receivedValue,
            'billed' => $billed,
            'variance' => round($billed - $receivedValue, 2),
            'hasReceipt' => $hasReceipt,
            'detail' => match ($match) {
                'Matched' => 'The invoice agrees with what was received, at order prices.',
                '2-way only' => 'Nothing has been received against this order yet, so only the order and the invoice could be compared.',
                'Price variance' => 'The quantities agree but the money does not — the supplier has billed at different rates.',
                default => 'The billed amount does not match the value of what arrived.',
            },
        ];
    }

    /* ------------------------------ Helpers ------------------------------ */

    /**
     * Creates a purchase order through the registry writer, so it gets its
     * number, validation, line totals and audit entry by the same path as a
     * hand-keyed one.
     */
    private function createOrder(int $supplierId, array $lines): PurchaseOrder
    {
        return $this->writer->create('procurement/orders', config('erp.resources.procurement/orders'), [
            'supplierId' => $supplierId,
            'date' => now()->toDateString(),
            'expected' => now()->addWeeks(2)->toDateString(),
            'status' => 'Draft',
            'lines' => $lines,
        ]);
    }

    /** Next sequential document number, locked against concurrent saves. */
    private function nextNumber(string $model, string $column, string $prefix): string
    {
        $stem = $prefix.date('Y').'-';

        $last = $model::query()
            ->where($column, 'like', $stem.'%')
            ->orderByDesc($column)
            ->lockForUpdate()
            ->value($column);

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
