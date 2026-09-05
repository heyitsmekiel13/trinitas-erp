<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\DowntimeEvent;
use App\Models\FuelLog;
use App\Models\Item;
use App\Models\PmSchedule;
use App\Models\StockBalance;
use App\Models\Vehicle;
use App\Models\WorkOrder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The Maintenance dashboard, computed from work orders and the downtime log.
 *
 * Every figure here is derived from documents somebody posted. Uptime is the
 * asset register counted by status; cost is labour plus the parts that were
 * actually issued; compliance is the share of preventive jobs finished before
 * their due date. Nothing on this screen can flatter what the department did,
 * because nothing on it is typed.
 */
class MaintenanceAnalytics
{
    /** Trend and cost figures cover a rolling year. */
    private const MONTHS = 12;

    /** Registration and insurance inside this many days want attention. */
    private const EXPIRY_WINDOW_DAYS = 60;

    public function __construct(private readonly MaintenanceOperations $operations) {}

    public function dashboard(): array
    {
        $now = CarbonImmutable::now();
        $from = $now->startOfMonth()->subMonths(self::MONTHS - 1);

        $orders = WorkOrder::query()->with('asset')->get();
        $downtime = DowntimeEvent::query()->where('occurred_at', '>=', $from)->get();
        $schedules = PmSchedule::query()->with('asset', 'assignee')->get();
        $assets = Asset::query()->where('status', '!=', 'Retired')->get();

        return [
            'kpis' => $this->kpis($orders, $downtime, $schedules, $assets, $from),
            'trend' => $this->trend($orders, $downtime, $now),
            'costByCategory' => $this->costByCategory($orders),
            'statusMix' => $this->statusMix($assets),
            'worstAssets' => $this->worstAssets($orders, $from),
            'technicians' => $this->operations->technicianLoad(),
            'upcoming' => $this->upcoming($schedules),
            'fleetAlerts' => $this->fleetAlerts(),
            'generatedAt' => $now->toIso8601String(),
        ];
    }

    /* ---------------------------------------------------------------------- */

    private function kpis(
        Collection $orders,
        Collection $downtime,
        Collection $schedules,
        Collection $assets,
        CarbonImmutable $from,
    ): array {
        $open = $orders->whereIn('status', WorkOrder::OPEN_STATUSES);
        $completed = $orders->where('status', 'Completed');
        $completedInWindow = $completed->filter(
            fn (WorkOrder $o) => $o->completed_at && $o->completed_at->gte($from),
        );

        $withDuration = $completed->filter(fn (WorkOrder $o) => (float) $o->downtime_hours > 0);
        $live = $schedules->whereNotIn('status', ['Inactive', 'Completed']);
        $pmJobs = $completed->whereNotNull('pm_schedule_id');
        $onTimePm = $pmJobs->filter(
            fn (WorkOrder $o) => ! $o->due_at || ($o->completed_at && $o->completed_at->lte($o->due_at)),
        );

        $vehicles = Vehicle::query()->where('status', '!=', 'Retired')->get();
        $operational = $assets->where('status', 'Operational')->count();

        return [
            // Uptime here is availability: the share of the register that is fit
            // to use right now. Retired assets are excluded — they are not
            // downtime, they are gone.
            'assetUptime' => $assets->isEmpty() ? null : round(($operational / $assets->count()) * 100, 1),
            'assetsInService' => $assets->count(),
            'openWorkOrders' => $open->count(),
            'overdueWorkOrders' => $open->filter(fn (WorkOrder $o) => $o->due_at && $o->due_at->isPast())->count(),
            'criticalOpen' => $open->whereIn('priority', ['Critical', 'High'])->count(),
            // Null until a preventive job has actually been finished. Zero
            // would read as a department that never does any.
            'pmCompliance' => $pmJobs->isEmpty() ? null : round(($onTimePm->count() / $pmJobs->count()) * 100, 1),
            'pmSchedules' => $live->count(),
            'overduePm' => $live->where('status', 'Overdue')->count(),
            'duePm' => $live->where('status', 'Due')->count(),
            'mttrHours' => $withDuration->isEmpty()
                ? null
                : round($withDuration->avg(fn (WorkOrder $o) => (float) $o->downtime_hours), 1),
            'downtimeHours' => round($downtime->sum(fn (DowntimeEvent $e) => (float) $e->hours), 1),
            'downtimeEvents' => $downtime->count(),
            'downtimeCost' => round($downtime->sum(fn (DowntimeEvent $e) => (float) $e->cost_impact), 2),
            'maintenanceCost' => round($completedInWindow->sum(
                fn (WorkOrder $o) => (float) $o->labor_cost + (float) $o->parts_cost,
            ), 2),
            'partsCost' => round($completedInWindow->sum(fn (WorkOrder $o) => (float) $o->parts_cost), 2),
            'jobsCompleted' => $completedInWindow->count(),
            'breakdowns' => $assets->where('status', 'Breakdown')->count(),
            'underMaintenance' => $assets->where('status', 'Under Maintenance')->count(),
            'fleetSize' => $vehicles->count(),
            'vehiclesAvailable' => $vehicles->whereIn('status', ['Available', 'On Trip'])->count(),
            'documentsExpiring' => $vehicles->filter(function (Vehicle $vehicle) {
                $days = $vehicle->daysToNextExpiry();

                return $days !== null && $days <= self::EXPIRY_WINDOW_DAYS;
            })->count(),
            'flaggedFuel' => FuelLog::where('is_flagged', true)
                ->where('logged_at', '>=', $from)
                ->count(),
            'sparePartsShort' => $this->sparePartsShort(),
        ];
    }

    /**
     * Downtime and spend month by month.
     *
     * Two different measures on two different scales, returned together but
     * never plotted on one chart with two axes — that is a picture that can be
     * made to say anything.
     */
    private function trend(Collection $orders, Collection $downtime, CarbonImmutable $now): array
    {
        $hours = $downtime->groupBy(fn (DowntimeEvent $e) => CarbonImmutable::parse($e->occurred_at)->format('Y-m'));
        $cost = $orders
            ->where('status', 'Completed')
            ->filter(fn (WorkOrder $o) => $o->completed_at)
            ->groupBy(fn (WorkOrder $o) => $o->completed_at->format('Y-m'));

        $months = [];
        for ($i = self::MONTHS - 1; $i >= 0; $i--) {
            $month = $now->startOfMonth()->subMonths($i);
            $key = $month->format('Y-m');
            $jobs = $cost->get($key, collect());

            $months[] = [
                'key' => $key,
                'month' => $month->format('M y'),
                'downtimeHours' => round($hours->get($key, collect())->sum(fn ($e) => (float) $e->hours), 1),
                'maintenanceCost' => round($jobs->sum(
                    fn (WorkOrder $o) => (float) $o->labor_cost + (float) $o->parts_cost,
                ), 2),
                'jobsCompleted' => $jobs->count(),
            ];
        }

        return $months;
    }

    /** Where the maintenance money goes, by the kind of asset it went on. */
    private function costByCategory(Collection $orders): array
    {
        return $orders
            ->where('status', 'Completed')
            ->groupBy(fn (WorkOrder $o) => $o->asset->category ?? 'Unassigned')
            ->map(fn (Collection $rows) => round($rows->sum(
                fn (WorkOrder $o) => (float) $o->labor_cost + (float) $o->parts_cost,
            ), 2))
            ->filter(fn (float $value) => $value > 0)
            ->sortDesc()
            ->take(8)
            ->map(fn (float $value, string $name) => ['name' => $name, 'value' => $value])
            ->values()
            ->all();
    }

    private function statusMix(Collection $assets): array
    {
        return $assets
            ->groupBy('status')
            ->map(fn (Collection $rows, string $status) => ['name' => $status, 'value' => $rows->count()])
            ->sortByDesc('value')
            ->values()
            ->all();
    }

    /**
     * The assets that cost the most to keep running.
     *
     * Ranked by money rather than by job count, because ten cheap jobs are not
     * the problem — and shown against acquisition cost, which is the number
     * that turns "repair it again" into "replace it".
     */
    private function worstAssets(Collection $orders, CarbonImmutable $from): array
    {
        return $orders
            ->where('status', 'Completed')
            ->filter(fn (WorkOrder $o) => $o->asset && $o->completed_at && $o->completed_at->gte($from))
            ->groupBy('asset_id')
            ->map(function (Collection $rows) {
                $asset = $rows->first()->asset;
                $cost = round($rows->sum(fn (WorkOrder $o) => (float) $o->labor_cost + (float) $o->parts_cost), 2);

                return [
                    'code' => $asset->code,
                    'name' => "{$asset->code} — {$asset->name}",
                    'category' => $asset->category,
                    'jobs' => $rows->count(),
                    'downtimeHours' => round($rows->sum(fn (WorkOrder $o) => (float) $o->downtime_hours), 1),
                    'value' => $cost,
                    'costRatio' => (float) $asset->acquisition_cost > 0
                        ? round(($cost / (float) $asset->acquisition_cost) * 100, 1)
                        : null,
                ];
            })
            ->sortByDesc('value')
            ->take(8)
            ->values()
            ->all();
    }

    /** Preventive plans that are overdue or fall due shortly. */
    private function upcoming(Collection $schedules): array
    {
        $today = CarbonImmutable::now()->startOfDay();

        return $schedules
            ->whereIn('status', ['Overdue', 'Due'])
            ->map(function (PmSchedule $schedule) use ($today) {
                $daysLeft = $schedule->next_due_at
                    ? (int) round($today->diffInDays(CarbonImmutable::parse($schedule->next_due_at), false))
                    : null;

                return [
                    'id' => $schedule->id,
                    'code' => $schedule->code,
                    'asset' => $schedule->asset->code ?? null,
                    'assetName' => $schedule->asset->name ?? null,
                    'task' => $schedule->task,
                    'frequency' => $schedule->frequency,
                    'due' => optional($schedule->next_due_at)->toDateString(),
                    'daysLeft' => $daysLeft,
                    'assignedTo' => $schedule->assignee->full_name ?? null,
                    'status' => $schedule->status,
                ];
            })
            ->sortBy(fn (array $row) => $row['daysLeft'] ?? PHP_INT_MAX)
            ->take(12)
            ->values()
            ->all();
    }

    /**
     * Vehicle papers about to run out.
     *
     * A truck with expired registration is off the road whatever its mechanical
     * condition, so this belongs beside the breakdown list rather than in a
     * compliance folder nobody opens.
     */
    private function fleetAlerts(): array
    {
        $today = CarbonImmutable::now()->startOfDay();

        return Vehicle::query()
            ->with('asset')
            ->where('status', '!=', 'Retired')
            ->get()
            ->flatMap(function (Vehicle $vehicle) use ($today) {
                $rows = [];

                foreach (['Registration' => $vehicle->registration_expiry, 'Insurance' => $vehicle->insurance_expiry] as $kind => $date) {
                    if (! $date) {
                        continue;
                    }

                    $daysLeft = (int) round($today->diffInDays(CarbonImmutable::parse($date), false));

                    if ($daysLeft > self::EXPIRY_WINDOW_DAYS) {
                        continue;
                    }

                    $rows[] = [
                        'plate' => $vehicle->plate_no,
                        'code' => $vehicle->asset->code ?? null,
                        'model' => $vehicle->model,
                        'kind' => $kind,
                        'expires' => CarbonImmutable::parse($date)->toDateString(),
                        'daysLeft' => $daysLeft,
                    ];
                }

                return $rows;
            })
            ->sortBy('daysLeft')
            ->values()
            ->all();
    }

    /**
     * Spare parts at or below their reorder point.
     *
     * A repair blocked waiting on a part is downtime the maintenance department
     * cannot fix with a technician, which is why it belongs on this dashboard
     * rather than only on the warehouse's.
     */
    private function sparePartsShort(): int
    {
        $available = StockBalance::query()
            ->selectRaw('item_id, SUM(available) AS available')
            ->groupBy('item_id')
            ->pluck('available', 'item_id');

        return Item::query()
            ->where('is_spare_part', true)
            ->where('is_active', true)
            ->where('reorder_point', '>', 0)
            ->get(['id', 'reorder_point'])
            ->filter(fn (Item $item) => (float) ($available[$item->id] ?? 0) <= (float) $item->reorder_point)
            ->count();
    }
}
