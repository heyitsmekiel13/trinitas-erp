<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PurchaseRequisition;
use App\Models\RfqBid;
use App\Models\Supplier;
use App\Models\SupplierInvoice;
use App\Services\ProcurementAnalytics;
use App\Services\ProcurementOperations;
use App\Services\SupplierScorecard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Procurement endpoints with behaviour of their own.
 *
 * The registry serves the eight Procurement lists; these are the steps that
 * move a document to the next stage, plus the two read models the registry
 * cannot express — the dashboard and one supplier's trading history.
 */
class ProcurementController extends Controller
{
    public function dashboard(Request $request, ProcurementAnalytics $analytics): JsonResponse
    {
        $period = (string) $request->query('period', 'last_12m');
        $from = $request->query('from');
        $to = $request->query('to');
        $grain = $request->query('grain');
        $key = 'procurement-dashboard:'.md5(implode('|', [$period, $from, $to, $grain]));

        return response()->json([
            'data' => Cache::remember($key, 60, fn () => $analytics->dashboard($period, $from, $to, $grain)),
        ]);
    }

    public function supplierHistory(Supplier $supplier, ProcurementAnalytics $analytics): JsonResponse
    {
        return response()->json(['data' => $analytics->supplierHistory($supplier)]);
    }

    /** The evidence behind one supplier's score, without recomputing it. */
    public function supplierScorecard(Supplier $supplier, SupplierScorecard $scorecard): JsonResponse
    {
        return response()->json(['data' => $scorecard->breakdown($supplier)]);
    }

    /** Re-scores every supplier from the documents. */
    public function evaluateSuppliers(SupplierScorecard $scorecard): JsonResponse
    {
        return response()->json(['data' => $scorecard->evaluateAll()]);
    }

    /** Re-scores one supplier. */
    public function evaluateSupplier(Supplier $supplier, SupplierScorecard $scorecard): JsonResponse
    {
        return response()->json(['data' => $scorecard->evaluate($supplier)]);
    }

    /** Opens a competitive tender for an approved requisition. */
    public function requisitionToRfq(PurchaseRequisition $requisition, ProcurementOperations $ops): JsonResponse
    {
        $rfq = $ops->requisitionToRfq($requisition);

        return response()->json([
            'data' => ['id' => $rfq->id, 'no' => $rfq->rfq_no, 'closes' => $rfq->closes_at?->toDateString()],
        ], 201);
    }

    /** Raises a purchase order directly, skipping tender. */
    public function requisitionToOrder(
        Request $request,
        PurchaseRequisition $requisition,
        ProcurementOperations $ops,
    ): JsonResponse {
        $data = $request->validate(['supplierId' => 'required|integer|exists:suppliers,id']);

        $order = $ops->requisitionToOrder($requisition, $data['supplierId']);

        return response()->json([
            'data' => ['id' => $order->id, 'no' => $order->po_no, 'total' => (float) $order->total],
        ], 201);
    }

    /** Awards a bid and turns it into a purchase order. */
    public function awardBid(RfqBid $bid, ProcurementOperations $ops): JsonResponse
    {
        $order = $ops->awardBid($bid);

        return response()->json([
            'data' => [
                'id' => $order->id,
                'no' => $order->po_no,
                'total' => (float) $order->total,
                'bidAmount' => (float) $bid->amount,
                // Spreading one quoted figure across several lines at two
                // decimal places rarely lands exactly on it. The order total is
                // the sum of its lines — that invariant matters more than
                // matching the bid to the centavo — so any residual is reported
                // rather than hidden.
                'roundingDifference' => round((float) $order->total - (float) $bid->amount, 2),
            ],
        ], 201);
    }

    /** Three-way match: order against receipts against the invoice. */
    public function matchInvoice(SupplierInvoice $invoice, ProcurementOperations $ops): JsonResponse
    {
        return response()->json(['data' => $ops->matchInvoice($invoice)]);
    }
}
