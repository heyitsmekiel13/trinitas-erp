<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\WarehouseAnalytics;
use App\Services\WarehouseOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Warehouse endpoints with behaviour of their own.
 *
 * The registry serves the lists; these are the two things it cannot express —
 * the dashboard, and replenishment, which is a calculation over stock and
 * consumption rather than a table anyone maintains.
 */
class WarehouseController extends Controller
{
    public function dashboard(WarehouseAnalytics $analytics): JsonResponse
    {
        return response()->json([
            'data' => Cache::remember('warehouse-dashboard', 60, fn () => $analytics->dashboard()),
        ]);
    }

    /** SKUs at or below reorder point, with cover days and a suggested quantity. */
    public function replenishment(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $warehouseId = $request->integer('warehouseId') ?: null;

        return response()->json(['data' => $operations->replenishment($warehouseId)]);
    }

    /** Raises a purchase requisition for the chosen replenishment lines. */
    public function requisition(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'lines' => 'required|array|min:1',
            'lines.*.itemId' => 'required|integer|exists:items,id',
            'lines.*.quantity' => 'required|numeric|min:0.01',
            'title' => 'nullable|string|max:190',
            'departmentId' => 'nullable|integer|exists:hr_departments,id',
        ]);

        $requisition = $operations->requisitionFromReplenishment(
            $data['lines'],
            $data['title'] ?? null,
            $data['departmentId'] ?? null,
        );

        return response()->json([
            'data' => [
                'id' => $requisition->id,
                'no' => $requisition->requisition_no,
                'lines' => (int) $requisition->lines,
                'amount' => (float) $requisition->amount,
            ],
        ], 201);
    }

    /** Corrects one stock line, recorded as a single-item cycle count. */
    public function adjust(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'itemId' => 'required|integer|exists:items,id',
            'warehouseId' => 'required|integer|exists:warehouses,id',
            'countedQuantity' => 'required|numeric|min:0',
            'reason' => 'nullable|string|max:190',
            'countedBy' => 'nullable|integer|exists:employees,id',
        ]);

        $count = $operations->adjustStock(
            $data['itemId'],
            $data['warehouseId'],
            (float) $data['countedQuantity'],
            $data['reason'] ?? null,
            $data['countedBy'] ?? null,
        );

        return response()->json([
            'data' => [
                'id' => $count->id,
                'no' => $count->count_no,
                'valueVariance' => (float) $count->value_variance,
                'variances' => (int) $count->variances,
            ],
        ], 201);
    }

    /** Stock approaching its expiry date. */
    public function expiring(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $within = max(1, min(365, $request->integer('withinDays') ?: 60));

        return response()->json(['data' => $operations->expiringStock($within)]);
    }

    /** Recomputes every active item's ABC class from 90-day issued value. */
    public function recomputeAbc(WarehouseOperations $operations): JsonResponse
    {
        return response()->json(['data' => $operations->recomputeAbcClasses()]);
    }

    /** A bin to put an item away in, based on its ABC class and what has room. */
    public function suggestBin(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'itemId' => 'required|integer|exists:items,id',
            'warehouseId' => 'required|integer|exists:warehouses,id',
        ]);

        $suggestion = $operations->suggestBin($data['itemId'], $data['warehouseId']);

        return response()->json(['data' => $suggestion]);
    }

    /** Groups the chosen pick lists into one released wave. */
    public function buildWave(Request $request, WarehouseOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'warehouseId' => 'required|integer|exists:warehouses,id',
            'pickListIds' => 'required|array|min:1',
            'pickListIds.*' => 'integer|exists:pick_lists,id',
            'zone' => 'nullable|string|max:32',
            'cutoffAt' => 'nullable|date',
        ]);

        $wave = $operations->buildWave(
            $data['warehouseId'],
            $data['pickListIds'],
            $data['zone'] ?? null,
            $data['cutoffAt'] ?? null,
            $request->user()->id,
        );

        return response()->json([
            'data' => [
                'id' => $wave->id,
                'waveNo' => $wave->wave_no,
                'pickListCount' => $wave->pickLists->count(),
            ],
        ], 201);
    }
}
