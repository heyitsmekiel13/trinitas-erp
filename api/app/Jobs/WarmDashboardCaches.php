<?php

namespace App\Jobs;

use App\Services\FinanceAnalytics;
use App\Services\HrAnalytics;
use App\Services\MaintenanceAnalytics;
use App\Services\ProcurementAnalytics;
use App\Services\SalesAnalytics;
use App\Services\WarehouseAnalytics;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Recomputes every module dashboard and drops the result straight into the
 * same cache keys the controllers read from (`Cache::remember`, 60s) — so by
 * the time a signed-in user actually opens Sales, Warehouse, HR or any of
 * the others, the answer is already sitting there instead of being computed
 * in front of them.
 *
 * Dispatched with `->afterResponse()` from the login flow, not queued: the
 * sign-in response goes back to the browser first, and this runs afterwards
 * in the same request's teardown — no queue worker required, and nothing
 * about it can slow a sign-in down. One person's login is enough to warm
 * the shared cache for everybody, since none of this is scoped per-user.
 *
 * A module failing to compute (a bad row, a timeout) is swallowed and
 * logged rather than left to break sign-in or the other five modules — this
 * is a head start, not a requirement.
 */
class WarmDashboardCaches
{
    public function handle(): void
    {
        $this->warm('sales-dashboard', fn () => app(SalesAnalytics::class)->dashboard());
        $this->warm('procurement-dashboard', fn () => app(ProcurementAnalytics::class)->dashboard());
        $this->warm('warehouse-dashboard', fn () => app(WarehouseAnalytics::class)->dashboard());
        $this->warm('maintenance-dashboard', fn () => app(MaintenanceAnalytics::class)->dashboard());
        $this->warm('finance-dashboard', fn () => app(FinanceAnalytics::class)->dashboard());

        // The HR dashboard's cache key also carries the window, so only the
        // screen's own default (year to date, no custom range, auto grain)
        // is worth pre-computing here — matches HrController::dashboard()'s
        // key exactly, or the warm-up would sit under a key nobody reads.
        $hrKey = 'hr-dashboard:'.md5(json_encode(['ytd', null, null, null]));
        $this->warm($hrKey, fn () => app(HrAnalytics::class)->dashboard('ytd', null, null, null));
    }

    private function warm(string $key, \Closure $compute): void
    {
        try {
            Cache::remember($key, 60, $compute);
        } catch (Throwable $e) {
            Log::warning("Dashboard cache warm-up failed for {$key}: {$e->getMessage()}");
        }
    }
}
