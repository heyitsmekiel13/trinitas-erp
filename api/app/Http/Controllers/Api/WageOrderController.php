<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WageOrder;
use App\Services\WageOrderOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WageOrderController extends Controller
{
    public function __construct(private readonly WageOrderOperations $wageOrders) {}

    public function index(): JsonResponse
    {
        $orders = WageOrder::with(['branches', 'createdBy', 'appliedBy'])
            ->withCount('adjustments')
            ->latest('effective_date')
            ->get();

        return response()->json(['data' => $orders->map(fn (WageOrder $o) => $this->presentRow($o))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'label' => 'required|string|max:190',
            'orderNo' => 'nullable|string|max:60',
            'regionLabel' => 'required|string|max:120',
            'dailyRate' => 'required|numeric|min:0',
            'effectiveDate' => 'required|date',
            'notes' => 'nullable|string|max:2000',
            'branchIds' => 'required|array|min:1',
            'branchIds.*' => 'integer|exists:branch_units,id',
        ]);

        $order = $this->wageOrders->create([
            'label' => $data['label'],
            'order_no' => $data['orderNo'] ?? null,
            'region_label' => $data['regionLabel'],
            'daily_rate' => $data['dailyRate'],
            'effective_date' => $data['effectiveDate'],
            'notes' => $data['notes'] ?? null,
        ], $data['branchIds'], $request->user()?->id);

        return response()->json(['data' => $this->presentRow($order)], 201);
    }

    public function preview(WageOrder $wageOrder): JsonResponse
    {
        return response()->json(['data' => $this->wageOrders->preview($wageOrder)]);
    }

    public function apply(Request $request, WageOrder $wageOrder): JsonResponse
    {
        try {
            $result = $this->wageOrders->apply($wageOrder, $request->user()?->id);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $result]);
    }

    private function presentRow(WageOrder $order): array
    {
        return [
            'id' => $order->id,
            'label' => $order->label,
            'orderNo' => $order->order_no,
            'regionLabel' => $order->region_label,
            'dailyRate' => (float) $order->daily_rate,
            'effectiveDate' => optional($order->effective_date)->toDateString(),
            'notes' => $order->notes,
            'branches' => $order->branches->map(fn ($b) => ['id' => $b->id, 'name' => $b->name])->all(),
            'createdBy' => $order->createdBy->name ?? null,
            'appliedAt' => optional($order->applied_at)->toIso8601String(),
            'appliedBy' => $order->appliedBy->name ?? null,
            'adjustmentsCount' => $order->adjustments_count ?? 0,
        ];
    }
}
