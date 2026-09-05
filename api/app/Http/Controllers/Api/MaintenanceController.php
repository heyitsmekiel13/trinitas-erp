<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Asset;
use App\Models\DowntimeEvent;
use App\Models\WorkOrder;
use App\Services\MaintenanceAnalytics;
use App\Services\MaintenanceOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Maintenance endpoints with behaviour of their own.
 *
 * The registry serves the lists. These are the four things it cannot express:
 * the dashboard, turning due schedules into jobs, finishing a job, and raising
 * one from a breakdown — each of which changes something rather than reporting
 * it.
 */
class MaintenanceController extends Controller
{
    public function dashboard(MaintenanceAnalytics $analytics): JsonResponse
    {
        return response()->json([
            'data' => Cache::remember('maintenance-dashboard', 60, fn () => $analytics->dashboard()),
        ]);
    }

    /** Preventive schedules that have fallen due, turned into work orders. */
    public function generatePreventive(Request $request, MaintenanceOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'withinDays' => 'nullable|integer|min:0|max:180',
            'assetId' => 'nullable|integer|exists:assets,id',
        ]);

        $created = $operations->generatePreventiveWorkOrders(
            $data['withinDays'] ?? null,
            $data['assetId'] ?? null,
        );

        return response()->json([
            'data' => ['created' => count($created), 'workOrders' => $created],
        ], count($created) ? 201 : 200);
    }

    /** Finishes a job: labour, parts off the shelf, meter and downtime. */
    public function completeWorkOrder(
        Request $request,
        WorkOrder $workOrder,
        MaintenanceOperations $operations,
    ): JsonResponse {
        $data = $request->validate([
            'warehouseId' => 'nullable|integer|exists:warehouses,id',
            'technicianId' => 'nullable|integer|exists:employees,id',
            'laborCost' => 'nullable|numeric|min:0',
            'downtimeHours' => 'nullable|numeric|min:0|max:9999',
            'meterReading' => 'nullable|numeric|min:0',
            'notes' => 'nullable|string|max:2000',
            'parts' => 'nullable|array',
            'parts.*.itemId' => 'required|integer|exists:items,id',
            'parts.*.quantity' => 'required|numeric|min:0.01',
        ]);

        $order = $operations->completeWorkOrder($workOrder, $data);

        return response()->json([
            'data' => [
                'id' => $order->id,
                'no' => $order->wo_no,
                'asset' => $order->asset->code ?? null,
                'assetStatus' => $order->asset->status ?? null,
                'partsCost' => (float) $order->parts_cost,
                'laborCost' => (float) $order->labor_cost,
                'totalCost' => $order->total_cost,
                'partsIssued' => $order->parts->count(),
                'completedAt' => optional($order->completed_at)->toIso8601String(),
            ],
        ]);
    }

    /** Raises a corrective job against a logged breakdown. */
    public function workOrderFromBreakdown(
        Request $request,
        DowntimeEvent $downtimeEvent,
        MaintenanceOperations $operations,
    ): JsonResponse {
        $data = $request->validate([
            'technicianId' => 'nullable|integer|exists:employees,id',
            'priority' => 'nullable|in:Critical,High,Medium,Low',
        ]);

        $order = $operations->workOrderFromBreakdown($downtimeEvent, $data);

        return response()->json([
            'data' => [
                'id' => $order->id,
                'no' => $order->wo_no,
                'asset' => $order->asset->code ?? null,
                'priority' => $order->priority,
                'due' => optional($order->due_at)->toIso8601String(),
                'technician' => $order->technician->full_name ?? null,
            ],
        ], 201);
    }

    /** Everything one asset has had done to it, and what it has cost. */
    public function assetHistory(Asset $asset, MaintenanceOperations $operations): JsonResponse
    {
        return response()->json(['data' => $operations->assetHistory($asset)]);
    }

    /** Job load per technician, for deciding who gets the next one. */
    public function technicianLoad(MaintenanceOperations $operations): JsonResponse
    {
        return response()->json(['data' => $operations->technicianLoad()]);
    }
}
