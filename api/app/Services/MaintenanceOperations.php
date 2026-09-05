<?php

namespace App\Services;

use App\Models\Asset;
use App\Models\DowntimeEvent;
use App\Models\Employee;
use App\Models\PmSchedule;
use App\Models\WorkOrder;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Maintenance actions that decide something.
 *
 * The department's real work is a short list of events: a plan falls due and
 * becomes a job, a machine stops and becomes a job, a job finishes and consumes
 * parts, moves a meter and puts an asset back into service. Each of those is
 * here, and each of them writes a document — nothing changes an asset's state
 * without a record saying who did it and why.
 */
class MaintenanceOperations
{
    /** How far ahead the PM generator looks when nobody says otherwise. */
    public const PM_HORIZON_DAYS = 14;

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Turns preventive schedules that have fallen due into work orders.
     *
     * A plan nobody converts into a job is a spreadsheet. Running this is what
     * makes the PM programme actually reach a technician — and it refuses to
     * raise a second job for a schedule that already has one open, because two
     * technicians turning up to change the same oil is exactly the failure mode
     * an automatic generator invites.
     *
     * @return array<int, array<string, mixed>>
     */
    public function generatePreventiveWorkOrders(?int $withinDays = null, ?int $assetId = null): array
    {
        $horizon = CarbonImmutable::now()->startOfDay()->addDays($withinDays ?? self::PM_HORIZON_DAYS);

        $schedules = PmSchedule::query()
            ->with('asset')
            ->whereNotIn('status', ['Inactive', 'Completed'])
            ->when($assetId, fn ($q) => $q->where('asset_id', $assetId))
            ->get()
            // A date-based plan is due when its date arrives; a meter-based one
            // when the machine has run far enough. Both are "due", and mixing
            // them in one SQL where-clause would only obscure that.
            ->filter(fn (PmSchedule $schedule) => $schedule->frequency === 'Meter'
                ? $schedule->dueByMeter()
                : ($schedule->next_due_at && CarbonImmutable::parse($schedule->next_due_at)->lte($horizon)));

        $created = [];

        foreach ($schedules as $schedule) {
            $alreadyOpen = WorkOrder::query()
                ->where('pm_schedule_id', $schedule->id)
                ->whereIn('status', WorkOrder::OPEN_STATUSES)
                ->exists();

            if ($alreadyOpen || ! $schedule->asset) {
                continue;
            }

            $order = DB::transaction(fn () => WorkOrder::create([
                'wo_no' => $this->nextNumber(WorkOrder::class, 'wo_no', 'WO-'),
                'asset_id' => $schedule->asset_id,
                'pm_schedule_id' => $schedule->id,
                'summary' => $schedule->task,
                'description' => "Raised automatically from preventive schedule {$schedule->code}.",
                'type' => 'Preventive',
                // A plan already overdue is not a routine job any more.
                'priority' => $schedule->status === 'Overdue' ? 'High' : 'Medium',
                'reported_at' => now(),
                'due_at' => $schedule->next_due_at ?? now()->addDays(7),
                'technician_id' => $schedule->assigned_to,
                'status' => $schedule->assigned_to ? 'Assigned' : 'Open',
            ]));

            $created[] = [
                'id' => $order->id,
                'no' => $order->wo_no,
                'asset' => $schedule->asset->code,
                'task' => $schedule->task,
                'schedule' => $schedule->code,
                'due' => optional($order->due_at)->toDateString(),
                'priority' => $order->priority,
            ];
        }

        if ($created) {
            $this->audit->log(
                'generated preventive work orders',
                'WorkOrder',
                null,
                count($created).' job(s) from due schedules',
                'maintenance',
            );
        }

        return $created;
    }

    /**
     * Finishes a job: labour, parts, downtime and the meter it was left at.
     *
     * Completing through this rather than by editing the status means the
     * technician is asked for the four things only they know, once, and every
     * consequence — parts off the shelf, asset back in service, schedule rolled
     * forward — follows from saving it.
     *
     * @param  array<int, array{itemId: int, quantity: float}>  $parts
     *
     * @throws ValidationException
     */
    public function completeWorkOrder(WorkOrder $order, array $data): WorkOrder
    {
        if ($order->status === 'Cancelled') {
            throw ValidationException::withMessages([
                'status' => 'A cancelled work order cannot be completed. Re-open it first.',
            ]);
        }

        return DB::transaction(function () use ($order, $data) {
            $parts = $data['parts'] ?? [];

            if ($parts && empty($data['warehouseId']) && ! $order->warehouse_id) {
                throw ValidationException::withMessages([
                    'warehouseId' => 'Say which warehouse the spare parts came from.',
                ]);
            }

            if (array_key_exists('parts', $data)) {
                $order->parts()->delete();

                foreach ($parts as $part) {
                    $order->parts()->create([
                        'item_id' => $part['itemId'],
                        'quantity' => $part['quantity'],
                    ]);
                }
            }

            $order->fill(array_filter([
                'warehouse_id' => $data['warehouseId'] ?? $order->warehouse_id,
                'technician_id' => $data['technicianId'] ?? $order->technician_id,
                'labor_cost' => $data['laborCost'] ?? null,
                'downtime_hours' => $data['downtimeHours'] ?? null,
                'meter_reading' => $data['meterReading'] ?? null,
                'description' => $data['notes'] ?? null,
            ], fn ($value) => $value !== null));

            $order->status = 'Completed';
            $order->completed_at = now();
            // Saving is what issues the parts, moves the asset and rolls the
            // schedule — see WorkOrder::booted.
            $order->save();

            $this->audit->log(
                'completed a work order',
                'WorkOrder',
                $order->id,
                $order->wo_no,
                'maintenance',
            );

            return $order->fresh(['asset', 'technician', 'parts']);
        });
    }

    /**
     * Raises a corrective job from a logged breakdown.
     *
     * The downtime log is where a failure is recorded; the work order is where
     * somebody is asked to fix it. Linking the two is what lets the department
     * later ask how long its own breakdowns take to answer.
     *
     * @throws ValidationException
     */
    public function workOrderFromBreakdown(DowntimeEvent $event, array $data = []): WorkOrder
    {
        if ($event->work_order_id) {
            throw ValidationException::withMessages([
                'workOrderId' => "This breakdown is already on work order {$event->workOrder?->wo_no}.",
            ]);
        }

        return DB::transaction(function () use ($event, $data) {
            $order = WorkOrder::create([
                'wo_no' => $this->nextNumber(WorkOrder::class, 'wo_no', 'WO-'),
                'asset_id' => $event->asset_id,
                'summary' => $event->cause,
                'description' => $event->root_cause
                    ? "Breakdown on {$event->occurred_at->toDateString()}. Root cause noted: {$event->root_cause}."
                    : "Breakdown on {$event->occurred_at->toDateString()}.",
                'type' => 'Corrective',
                // A stopped line or a cold chain at risk is not a medium job.
                'priority' => $data['priority'] ?? match ($event->impact) {
                    'Line stopped', 'Cold chain risk' => 'Critical',
                    'Deliveries delayed' => 'High',
                    default => 'Medium',
                },
                'reported_at' => $event->occurred_at,
                'due_at' => now()->addDay(),
                'technician_id' => $data['technicianId'] ?? null,
                'downtime_hours' => (float) $event->hours,
                'status' => isset($data['technicianId']) ? 'Assigned' : 'Open',
            ]);

            $event->forceFill(['work_order_id' => $order->id])->save();

            // The asset is being worked on now, and the register should say so
            // rather than continuing to claim it is operational.
            $event->asset?->forceFill(['status' => 'Under Maintenance'])->save();

            $this->audit->log(
                'raised a work order from a breakdown',
                'WorkOrder',
                $order->id,
                $order->wo_no,
                'maintenance',
            );

            return $order->fresh(['asset', 'technician']);
        });
    }

    /**
     * Current job load per maintenance technician.
     *
     * Open jobs first, because that is what decides who gets the next one. The
     * average repair time is history, and history is what says whether the
     * queue is long because the work is hard or because it is stuck.
     */
    public function technicianLoad(): array
    {
        $employees = Employee::query()
            ->whereHas('hrDepartment', fn ($q) => $q->where('code', 'MAINTENANCE'))
            ->where('employment_status', '!=', 'Resigned')
            ->with('position')
            ->get();

        $orders = WorkOrder::query()
            ->whereNotNull('technician_id')
            ->get(['technician_id', 'status', 'downtime_hours', 'labor_cost', 'parts_cost', 'due_at', 'completed_at'])
            ->groupBy('technician_id');

        return $employees
            ->map(function (Employee $employee) use ($orders) {
                $jobs = $orders->get($employee->id, collect());
                $completed = $jobs->where('status', 'Completed');
                $open = $jobs->whereIn('status', WorkOrder::OPEN_STATUSES);

                return [
                    'id' => $employee->id,
                    'code' => $employee->employee_no,
                    'name' => $employee->full_name,
                    'position' => $employee->position->title ?? null,
                    'openJobs' => $open->count(),
                    'completedJobs' => $completed->count(),
                    'overdueJobs' => $open->filter(
                        fn ($o) => $o->due_at && $o->due_at->isPast(),
                    )->count(),
                    'hoursLogged' => round($jobs->sum(fn ($o) => (float) $o->downtime_hours), 1),
                    'avgRepairHours' => $completed->isEmpty()
                        ? null
                        : round($completed->avg(fn ($o) => (float) $o->downtime_hours), 1),
                    // Nine open jobs is roughly a fortnight of work for one
                    // technician; past that the queue is the problem.
                    'availability' => match (true) {
                        $open->count() > 9 => 'Overloaded',
                        $open->count() > 5 => 'Busy',
                        default => 'Available',
                    },
                ];
            })
            ->sortByDesc('openJobs')
            ->values()
            ->all();
    }

    /** Everything one asset has ever had done to it, newest first. */
    public function assetHistory(Asset $asset): array
    {
        $orders = $asset->workOrders()->with('technician', 'parts.item')->orderByDesc('reported_at')->get();
        $downtime = $asset->downtimeEvents()->orderByDesc('occurred_at')->get();

        return [
            'asset' => [
                'id' => $asset->id,
                'code' => $asset->code,
                'name' => $asset->name,
                'category' => $asset->category,
                'status' => $asset->status,
                'criticality' => $asset->criticality,
                'condition' => $asset->condition,
                'meterReading' => (float) $asset->meter_reading,
                'meterUnit' => $asset->meter_unit,
                'meterSinceService' => $asset->meterSinceService(),
                'acquisitionCost' => (float) $asset->acquisition_cost,
                'bookValue' => (float) $asset->book_value,
                'lastService' => optional($asset->last_service_at)->toDateString(),
                'nextService' => optional($asset->next_service_at)->toDateString(),
            ],
            'workOrders' => $orders->map(fn (WorkOrder $order) => [
                'id' => $order->id,
                'no' => $order->wo_no,
                'summary' => $order->summary,
                'type' => $order->type,
                'priority' => $order->priority,
                'reported' => optional($order->reported_at)->toIso8601String(),
                'completed' => optional($order->completed_at)->toIso8601String(),
                'technician' => $order->technician->full_name ?? null,
                'downtimeHours' => (float) $order->downtime_hours,
                'laborCost' => (float) $order->labor_cost,
                'partsCost' => (float) $order->parts_cost,
                'totalCost' => $order->total_cost,
                'parts' => $order->parts->map(fn ($part) => [
                    'sku' => $part->item->sku ?? null,
                    'name' => $part->item->name ?? null,
                    'quantity' => (float) $part->quantity,
                    'lineTotal' => (float) $part->line_total,
                ])->all(),
                'status' => $order->status,
            ])->all(),
            'downtime' => $downtime->map(fn (DowntimeEvent $event) => [
                'id' => $event->id,
                'date' => optional($event->occurred_at)->toIso8601String(),
                'cause' => $event->cause,
                'hours' => (float) $event->hours,
                'impact' => $event->impact,
                'rootCause' => $event->root_cause,
                'costImpact' => (float) $event->cost_impact,
                'status' => $event->status,
            ])->all(),
            'totals' => [
                'jobs' => $orders->count(),
                'openJobs' => $orders->whereIn('status', WorkOrder::OPEN_STATUSES)->count(),
                'maintenanceCost' => round($orders->sum(
                    fn (WorkOrder $order) => (float) $order->labor_cost + (float) $order->parts_cost,
                ), 2),
                'downtimeHours' => round($downtime->sum(fn (DowntimeEvent $e) => (float) $e->hours), 1),
                // What the asset has cost to keep, against what it cost to buy.
                // Past 100% the cheapest repair is a replacement.
                'costRatio' => (float) $asset->acquisition_cost > 0
                    ? round(($orders->sum(fn (WorkOrder $o) => (float) $o->labor_cost + (float) $o->parts_cost)
                        / (float) $asset->acquisition_cost) * 100, 1)
                    : null,
            ],
        ];
    }

    /* ---------------------------------------------------------------------- */

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
