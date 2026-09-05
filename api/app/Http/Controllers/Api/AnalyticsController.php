<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SalesAnalytics;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;

/**
 * Dashboard aggregates.
 *
 * List endpoints come from the registry; a dashboard cannot, because it is not
 * one table — it is a dozen roll-ups that have to agree with each other. Each
 * department gets one method here backed by a service that owns the arithmetic.
 */
class AnalyticsController extends Controller
{
    public function sales(SalesAnalytics $analytics): JsonResponse
    {
        return response()->json([
            'data' => Cache::remember('sales-dashboard', 60, fn () => $analytics->dashboard()),
        ]);
    }
}
