<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\Customer;
use App\Models\Quotation;
use App\Models\SalesOrder;
use App\Models\Warehouse;
use App\Services\RoutePlanner;
use App\Services\SalesAnalytics;
use App\Services\SalesOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Sales endpoints with behaviour of their own.
 *
 * The registry serves the nine Sales lists; these are the two things it cannot
 * express — reading one customer's whole trading history, and moving a
 * quotation forward into an order.
 */
class SalesController extends Controller
{
    /** One customer's trading history — orders, spend trend and what they buy. */
    public function customerHistory(Customer $customer, SalesAnalytics $analytics): JsonResponse
    {
        return response()->json(['data' => $analytics->customerHistory($customer)]);
    }

    /**
     * The route plan for a delivery that has not been saved yet.
     *
     * The form calls this as the dispatcher changes the origin or the vehicle,
     * so the distance, ETA and fuel on screen are the same figures the server
     * will store — there is no second implementation in the browser to drift.
     */
    public function routePreview(Request $request, RoutePlanner $planner): JsonResponse
    {
        $data = $request->validate([
            'salesOrderId' => 'required|integer|exists:sales_orders,id',
            'originWarehouseId' => 'nullable|integer|exists:warehouses,id',
            'vehicleAssetId' => 'nullable|integer|exists:assets,id',
            'roundTrip' => 'nullable|boolean',
        ]);

        $order = SalesOrder::with('customer', 'warehouse')->findOrFail($data['salesOrderId']);
        $origin = isset($data['originWarehouseId'])
            ? Warehouse::find($data['originWarehouseId'])
            : $order->warehouse;

        $customer = $order->customer;

        $missing = [];
        if (! $origin?->latitude || ! $origin?->longitude) {
            $missing[] = $origin ? "{$origin->name} has no map location" : 'no origin warehouse chosen';
        }
        if (! $customer?->latitude || ! $customer?->longitude) {
            $missing[] = "{$customer?->name} has no map location";
        }

        if ($missing !== []) {
            return response()->json([
                'data' => ['plannable' => false, 'missing' => $missing],
            ]);
        }

        $vehicle = isset($data['vehicleAssetId']) ? Asset::find($data['vehicleAssetId']) : null;

        $plan = $planner->plan(
            ['lat' => (float) $origin->latitude, 'lng' => (float) $origin->longitude, 'label' => $origin->name],
            ['lat' => (float) $customer->latitude, 'lng' => (float) $customer->longitude, 'label' => $customer->name],
            $vehicle?->km_per_litre !== null ? (float) $vehicle->km_per_litre : null,
            (bool) ($data['roundTrip'] ?? true),
        );

        return response()->json(['data' => ['plannable' => true] + $plan]);
    }

    /** Hands a confirmed order to the warehouse as a pick list. */
    public function releaseOrder(SalesOrder $order, SalesOperations $operations): JsonResponse
    {
        $pick = $operations->releaseToWarehouse($order);

        return response()->json([
            'data' => [
                'id' => $pick->id,
                'no' => $pick->pick_no,
                'warehouse' => $pick->warehouse->name ?? '—',
                'lines' => (int) $pick->lines,
            ],
        ], 201);
    }

    /** Turns an accepted quotation into a confirmed sales order. */
    public function convertQuotation(
        Request $request,
        Quotation $quotation,
        SalesOperations $operations,
    ): JsonResponse {
        $order = $operations->convertQuotation($quotation, $request->integer('warehouseId') ?: null);

        return response()->json([
            'data' => [
                'id' => $order->id,
                'no' => $order->order_no,
                'total' => (float) $order->total,
                'marginPct' => (float) $order->margin_pct,
            ],
        ], 201);
    }
}
