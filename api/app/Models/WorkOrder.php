<?php

namespace App\Models;

use App\Services\StockLedger;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WorkOrder extends Model
{
    protected $guarded = [];

    /** Stages where the job is still somebody's problem. */
    public const OPEN_STATUSES = ['Open', 'Assigned', 'In Progress', 'On Hold'];

    protected function casts(): array
    {
        return [
            'reported_at' => 'datetime',
            'due_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    /**
     * Completing a work order is the event the whole department turns on.
     *
     * It consumes spare parts off a shelf, costs the job from what those parts
     * actually cost, puts the asset back into service, and rolls the preventive
     * schedule that asked for it forward. None of that should be something a
     * technician has to remember to do in four other screens.
     *
     * Everything here is derived from the lines and reconciled against the
     * movement log, so a job can be completed, corrected, re-opened and
     * completed again without the parts being issued twice.
     */
    protected static function booted(): void
    {
        static::saving(function (WorkOrder $order) {
            if ($order->status === 'Completed') {
                $order->completed_at ??= now();
            }

            // Re-opening a finished job clears the completion stamp — leaving it
            // would put a completion date on an unfinished job.
            if ($order->isDirty('status') && in_array($order->status, self::OPEN_STATUSES, true)) {
                $order->completed_at = null;
            }
        });

        static::saved(function (WorkOrder $order) {
            $order->costParts();
            $order->syncStock();

            if ($order->status === 'Completed') {
                $order->applyToAsset();
                $order->closePmSchedule();
            }
        });

        static::deleted(fn (WorkOrder $order) => app(StockLedger::class)->reverse($order));
    }

    /**
     * Prices the parts from the item master and totals them onto the header.
     *
     * Cost comes from the catalogue rather than the form for the same reason it
     * does everywhere else: a job whose parts cost is typed can be made to look
     * as cheap as anyone likes.
     */
    public function costParts(): void
    {
        $lines = $this->parts()->with('item')->get();

        foreach ($lines as $line) {
            $unitCost = (float) ($line->item->unit_cost ?? 0);
            $lineTotal = round((float) $line->quantity * $unitCost, 2);

            if ((float) $line->unit_cost !== $unitCost || (float) $line->line_total !== $lineTotal) {
                $line->forceFill(['unit_cost' => $unitCost, 'line_total' => $lineTotal])->save();
            }
        }

        $partsCost = round($lines->sum(
            fn (WorkOrderPart $line) => (float) $line->quantity * (float) ($line->item->unit_cost ?? 0),
        ), 2);

        if ((float) $this->parts_cost !== $partsCost) {
            // Written round the model so this does not re-enter `saved`.
            $this->newQuery()->whereKey($this->getKey())->update(['parts_cost' => $partsCost]);
            $this->parts_cost = $partsCost;
        }
    }

    /**
     * Takes the spare parts off the shelf once the job is done.
     *
     * Only a completed job consumes anything — a planned job has reserved
     * nothing, and an abandoned one gives its parts back. Reconciling against
     * the log rather than applying deltas is what makes that reversible.
     */
    public function syncStock(): void
    {
        if (! $this->warehouse_id) {
            return;
        }

        $desired = [];

        if ($this->status === 'Completed') {
            foreach ($this->parts()->get() as $line) {
                $quantity = (float) $line->quantity;
                if ($quantity > 0) {
                    $desired[(int) $line->item_id] = ($desired[(int) $line->item_id] ?? 0) - $quantity;
                }
            }
        }

        app(StockLedger::class)->reconcile(
            reference: $this,
            warehouseId: (int) $this->warehouse_id,
            desired: $desired,
            inReason: 'Return',
            outReason: 'Issue',
        );
    }

    /**
     * Puts the asset back into service and moves its meter and service date.
     *
     * A broken-down asset stays broken until something fixes it; this is that
     * something. The meter only ever moves forward — a technician writing down
     * a lower reading than the asset already has is a typo, not a machine that
     * ran backwards.
     */
    public function applyToAsset(): void
    {
        $asset = $this->asset;

        if (! $asset) {
            return;
        }

        $changes = ['last_service_at' => ($this->completed_at ?? now())->toDateString()];

        if ($this->meter_reading !== null && (float) $this->meter_reading > (float) $asset->meter_reading) {
            $changes['meter_reading'] = (float) $this->meter_reading;
        }

        // Only a job that took the asset out of service puts it back. A
        // completed inspection on a running asset should change nothing.
        if (in_array($asset->status, ['Under Maintenance', 'Breakdown'], true)) {
            $changes['status'] = 'Operational';
        }

        $asset->forceFill($changes)->save();

        $this->applyToVehicle($asset);
    }

    /**
     * Carries a service through to the fleet record.
     *
     * The asset register and the fleet screen describe the same truck, so a job
     * that moves one has to move the other — and "kilometres since service" is
     * zero the moment a service finishes, which is the whole point of the
     * figure.
     */
    private function applyToVehicle(Asset $asset): void
    {
        $vehicle = $asset->vehicle;

        if (! $vehicle) {
            return;
        }

        $changes = ['km_since_service' => 0];

        if ($this->meter_reading !== null && (float) $this->meter_reading > (float) $vehicle->odometer) {
            $changes['odometer'] = (float) $this->meter_reading;
        }

        $vehicle->forceFill($changes)->save();
    }

    /** Rolls the preventive schedule that raised this job to its next date. */
    public function closePmSchedule(): void
    {
        $this->pmSchedule?->markDone(
            ($this->completed_at ?? now())->toDateString(),
            $this->meter_reading !== null ? (float) $this->meter_reading : null,
        );
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function pmSchedule(): BelongsTo
    {
        return $this->belongsTo(PmSchedule::class);
    }

    public function technician(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'technician_id');
    }

    public function parts(): HasMany
    {
        return $this->hasMany(WorkOrderPart::class);
    }

    public function downtimeEvents(): HasMany
    {
        return $this->hasMany(DowntimeEvent::class);
    }

    public function getTotalCostAttribute(): float
    {
        return round((float) $this->labor_cost + (float) $this->parts_cost, 2);
    }
}
