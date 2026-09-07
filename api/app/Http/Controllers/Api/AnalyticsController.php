<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SalesAnalytics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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
    public function sales(Request $request, SalesAnalytics $analytics): JsonResponse
    {
        $period = (string) $request->query('period', 'last_12m');
        $from = $request->query('from');
        $to = $request->query('to');
        $grain = $request->query('grain');

        // Cached per window, not one shared key — a fixed key meant every
        // period and every user saw whatever the first request that minute
        // happened to ask for.
        $key = 'sales-dashboard:'.md5(implode('|', [$period, $from, $to, $grain]));

        return response()->json([
            'data' => Cache::remember($key, 60, fn () => $analytics->dashboard($period, $from, $to, $grain)),
        ]);
    }
}
