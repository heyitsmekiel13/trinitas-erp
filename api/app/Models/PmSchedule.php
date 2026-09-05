<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PmSchedule extends Model
{
    protected $guarded = [];

    /** How far ahead of its due date a schedule starts asking to be done. */
    public const DUE_WINDOW_DAYS = 7;

    protected function casts(): array
    {
        return [
            'last_done_at' => 'date',
            'next_due_at' => 'date',
        ];
    }

    /**
     * A schedule works out its own next due date and its own status.
     *
     * Both were columns anyone could type, which meant a plan could claim to be
     * on schedule while being months overdue. The frequency is the rule; the
     * date is what the rule produces; the status is what the date means today.
     */
    protected static function booted(): void
    {
        static::saving(function (PmSchedule $schedule) {
            $schedule->next_due_at ??= $schedule->dueDateFrom($schedule->last_done_at);

            // A meter plan with no target reading can never fall due. Seed it
            // from where the asset stands now plus one interval, which is what
            // "every 250 hours from today" means.
            if ($schedule->frequency === 'Meter' && $schedule->next_due_meter === null && $schedule->meter_interval) {
                $current = (float) ($schedule->last_meter ?? $schedule->asset->meter_reading ?? 0);
                $schedule->next_due_meter = round($current + (float) $schedule->meter_interval, 2);
            }

            $schedule->refreshStatus();
        });

        static::saved(fn (PmSchedule $schedule) => $schedule->syncCompliance());
    }

    /**
     * The date this schedule falls due, counted from when it was last done.
     *
     * A meter-based plan has no calendar answer — it falls due when the machine
     * has run far enough, which `dueByMeter` decides — so this returns null and
     * leaves the date alone rather than inventing one.
     */
    public function dueDateFrom(mixed $from): ?string
    {
        $months = match ($this->frequency) {
            'Weekly' => null,
            'Monthly' => 1,
            'Quarterly' => 3,
            'Semi-annual' => 6,
            'Annual' => 12,
            default => null,
        };

        if ($this->frequency === 'Meter') {
            return null;
        }

        $base = $from ? CarbonImmutable::parse($from) : CarbonImmutable::now();

        return $this->frequency === 'Weekly'
            ? $base->addWeek()->toDateString()
            : ($months ? $base->addMonths($months)->toDateString() : null);
    }

    /** True once the asset's meter has passed what this plan is waiting for. */
    public function dueByMeter(): bool
    {
        if ($this->frequency !== 'Meter' || $this->next_due_meter === null) {
            return false;
        }

        return (float) ($this->asset->meter_reading ?? 0) >= (float) $this->next_due_meter;
    }

    /**
     * Whether this plan is overdue, due soon, or simply scheduled.
     *
     * `Completed` and `Inactive` are decisions somebody made about the plan
     * itself, so they are left alone — only a live plan is judged against the
     * calendar.
     */
    public function refreshStatus(): void
    {
        if (in_array($this->status, ['Completed', 'Inactive'], true)) {
            return;
        }

        $today = CarbonImmutable::now()->startOfDay();

        $this->status = match (true) {
            $this->frequency === 'Meter' => $this->dueByMeter() ? 'Overdue' : 'Scheduled',
            $this->next_due_at === null => 'Scheduled',
            CarbonImmutable::parse($this->next_due_at)->lt($today) => 'Overdue',
            CarbonImmutable::parse($this->next_due_at)->lte($today->addDays(self::DUE_WINDOW_DAYS)) => 'Due',
            default => 'Scheduled',
        };
    }

    /**
     * Records a service against this plan and sets the next one.
     *
     * Called when a preventive work order raised from this schedule completes —
     * so the plan advances because the work happened, not because somebody
     * remembered to edit it.
     */
    public function markDone(string $doneOn, ?float $meterReading = null): void
    {
        $changes = [
            'last_done_at' => $doneOn,
            'next_due_at' => $this->dueDateFrom($doneOn),
            'status' => 'Scheduled',
        ];

        if ($meterReading !== null) {
            $changes['last_meter'] = $meterReading;

            if ($this->meter_interval) {
                $changes['next_due_meter'] = round($meterReading + (float) $this->meter_interval, 2);
            }
        }

        $this->forceFill($changes)->save();
    }

    /**
     * Compliance is the share of this plan's jobs that were finished on time.
     *
     * Derived from the work orders it raised rather than typed: a plan cannot
     * report 98% compliance while its jobs sit open past their due date.
     */
    public function syncCompliance(): void
    {
        $orders = $this->workOrders()->get(['status', 'due_at', 'completed_at']);
        $finished = $orders->where('status', 'Completed');

        if ($finished->isEmpty()) {
            // No history is not the same as failing. An unworked plan keeps
            // whatever it was given rather than being scored zero.
            return;
        }

        $onTime = $finished->filter(
            fn (WorkOrder $order) => ! $order->due_at || ($order->completed_at && $order->completed_at->lte($order->due_at)),
        );

        $compliance = round(($onTime->count() / $finished->count()) * 100, 2);

        if ((float) $this->compliance_pct !== $compliance) {
            $this->newQuery()->whereKey($this->getKey())->update(['compliance_pct' => $compliance]);
            $this->compliance_pct = $compliance;
        }
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'assigned_to');
    }

    public function workOrders(): HasMany
    {
        return $this->hasMany(WorkOrder::class);
    }
}
