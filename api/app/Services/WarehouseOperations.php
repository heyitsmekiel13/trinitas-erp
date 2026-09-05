<?php

namespace App\Services;

use App\Models\CycleCount;
use App\Models\Item;
use App\Models\PickList;
use App\Models\PickWave;
use App\Models\PurchaseRequisition;
use App\Models\StockBalance;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Models\WarehouseBin;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Warehouse actions that decide something.
 *
 * Replenishment is the interesting one: it is the point where the warehouse
 * stops reporting and starts asking Procurement for something. Everything it
 * suggests is derived from stock on hand, real consumption and the item's own
 * lead time — no fixed "suggested quantity" column anywhere.
 */
class WarehouseOperations
{
    /** Consumption is measured over this window to smooth out a quiet week. */
    private const DEMAND_WINDOW_DAYS = 90;

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly ResourceWriter $writer,
    ) {}

    /**
     * What needs reordering, and how much.
     *
     * Cover days — how long the shelf lasts at the current rate — is the figure
     * that actually drives urgency. An item with 400 cases and three days of
     * cover is in more trouble than one with 12 cases and two months of it, and
     * a plain "below reorder point" list cannot tell you that.
     */
    public function replenishment(?int $warehouseId = null): array
    {
        $since = CarbonImmutable::now()->subDays(self::DEMAND_WINDOW_DAYS);

        // Real consumption: what actually left the building, not what was
        // ordered or forecast.
        $issued = StockMovement::query()
            ->where('direction', 'out')
            ->whereIn('reason', ['Issue', 'Transfer Out'])
            ->where('moved_at', '>=', $since)
            ->when($warehouseId, fn ($q) => $q->where('warehouse_id', $warehouseId))
            ->selectRaw('item_id, SUM(quantity) AS total')
            ->groupBy('item_id')
            ->pluck('total', 'item_id');

        $balances = StockBalance::query()
            ->when($warehouseId, fn ($q) => $q->where('warehouse_id', $warehouseId))
            ->selectRaw('item_id, SUM(available) AS available, SUM(on_hand) AS on_hand')
            ->groupBy('item_id')
            ->get()
            ->keyBy('item_id');

        return Item::query()
            ->where('is_active', true)
            ->with('primarySupplier')
            ->get()
            ->map(function (Item $item) use ($balances, $issued) {
                $available = (float) ($balances[$item->id]->available ?? 0);
                $onHand = (float) ($balances[$item->id]->on_hand ?? 0);
                $consumed = (float) ($issued[$item->id] ?? 0);
                $dailyDemand = round($consumed / self::DEMAND_WINDOW_DAYS, 3);

                // No demand and no stock is a catalogue entry nobody is buying,
                // not a shortage. Null cover reads as "unknown", not "zero days".
                $coverDays = $dailyDemand > 0 ? (int) floor($available / $dailyDemand) : null;
                $reorderPoint = (float) $item->reorder_point;
                $leadTime = (int) $item->lead_time_days;

                // Order enough to clear the reorder point and add the reorder
                // quantity on top, so the next order is not due immediately.
                $suggested = max(0, (int) ceil(($reorderPoint - $available) + (float) $item->reorder_qty));

                return [
                    'itemId' => $item->id,
                    'sku' => $item->sku,
                    'name' => $item->name,
                    'category' => $item->category,
                    'uom' => $item->uom,
                    'available' => $available,
                    'onHand' => $onHand,
                    'reorderPoint' => $reorderPoint,
                    'reorderQty' => (float) $item->reorder_qty,
                    'avgDailyDemand' => $dailyDemand,
                    'coverDays' => $coverDays,
                    'leadTimeDays' => $leadTime,
                    'suggestedQty' => $suggested,
                    'unitCost' => (float) $item->unit_cost,
                    'suggestedValue' => round($suggested * (float) $item->unit_cost, 2),
                    'supplier' => $item->primarySupplier->name ?? null,
                    'supplierId' => $item->primary_supplier_id,
                    'abc' => $item->abc_class,
                    'urgency' => $this->urgency($available, $reorderPoint, $coverDays, $leadTime),
                ];
            })
            // Only what actually needs attention. Everything else is noise on a
            // screen whose whole job is to be a short list.
            ->filter(fn (array $row) => $row['urgency'] !== 'None')
            ->sortBy(fn (array $row) => [
                ['Critical' => 0, 'High' => 1, 'Medium' => 2, 'Low' => 3][$row['urgency']],
                $row['coverDays'] ?? PHP_INT_MAX,
            ])
            ->values()
            ->all();
    }

    /**
     * How urgent a shortage is.
     *
     * Out of stock is critical whatever the reorder point says. After that the
     * question is whether the shelf outlasts the supplier's lead time — if it
     * does not, ordering today is already late.
     */
    private function urgency(float $available, float $reorderPoint, ?int $coverDays, int $leadTime): string
    {
        if ($available <= 0) {
            return 'Critical';
        }
        if ($coverDays !== null && $coverDays <= $leadTime) {
            return 'Critical';
        }
        if ($coverDays !== null && $coverDays <= $leadTime * 1.5) {
            return 'High';
        }
        if ($reorderPoint > 0 && $available <= $reorderPoint) {
            return 'Medium';
        }
        if ($reorderPoint > 0 && $available <= $reorderPoint * 1.25) {
            return 'Low';
        }

        return 'None';
    }

    /**
     * Turns a replenishment selection into a purchase requisition.
     *
     * This is the seam between the warehouse and Procurement: the floor knows
     * what is running out, purchasing knows how to buy it. Raising a requisition
     * rather than an order keeps the approval step where it belongs.
     *
     * @param  array<int, array{itemId: int, quantity: float}>  $lines
     *
     * @throws ValidationException
     */
    public function requisitionFromReplenishment(array $lines, ?string $title = null, ?int $departmentId = null): PurchaseRequisition
    {
        $clean = collect($lines)
            ->map(fn ($line) => [
                'itemId' => (int) ($line['itemId'] ?? 0),
                'quantity' => (float) ($line['quantity'] ?? 0),
            ])
            ->filter(fn ($line) => $line['itemId'] > 0 && $line['quantity'] > 0)
            ->values();

        if ($clean->isEmpty()) {
            throw ValidationException::withMessages([
                'lines' => 'Choose at least one item with a quantity to requisition.',
            ]);
        }

        $costs = Item::whereIn('id', $clean->pluck('itemId'))->pluck('unit_cost', 'id');

        return DB::transaction(function () use ($clean, $costs, $title, $departmentId) {
            $requisition = $this->writer->create(
                'procurement/requisitions',
                config('erp.resources.procurement/requisitions'),
                [
                    'title' => $title ?: 'Warehouse replenishment '.CarbonImmutable::now()->format('j M Y'),
                    'date' => CarbonImmutable::now()->toDateString(),
                    'needBy' => CarbonImmutable::now()->addWeeks(2)->toDateString(),
                    'hrDepartmentId' => $departmentId,
                    'justification' => 'Raised from the replenishment list: these SKUs are at or below their reorder point.',
                    'status' => 'Submitted',
                    'lines' => $clean->map(fn ($line) => [
                        'itemId' => $line['itemId'],
                        'quantity' => $line['quantity'],
                        'unitPrice' => (float) ($costs[$line['itemId']] ?? 0),
                    ])->all(),
                ],
            );

            $this->audit->log(
                'raised a replenishment requisition',
                'PurchaseRequisition',
                $requisition->id,
                $requisition->requisition_no.' — '.$clean->count().' item(s)',
                'warehouse',
            );

            return $requisition;
        });
    }

    /**
     * Corrects one stock line, recorded as a single-item cycle count.
     *
     * Deliberately not a direct write to the balance: a correction with no
     * document behind it is exactly what makes stock figures untrustworthy. The
     * count carries who, when and why, and posts through the same ledger as
     * everything else.
     *
     * @throws ValidationException
     */
    public function adjustStock(
        int $itemId,
        int $warehouseId,
        float $countedQuantity,
        ?string $reason = null,
        ?int $countedBy = null,
    ): CycleCount {
        if ($countedQuantity < 0) {
            throw ValidationException::withMessages(['countedQuantity' => 'A counted quantity cannot be negative.']);
        }

        if (! Warehouse::whereKey($warehouseId)->exists()) {
            throw ValidationException::withMessages(['warehouseId' => 'That warehouse does not exist.']);
        }

        return DB::transaction(function () use ($itemId, $warehouseId, $countedQuantity, $reason, $countedBy) {
            $count = CycleCount::create([
                'count_no' => $this->nextCountNumber(),
                'warehouse_id' => $warehouseId,
                'zone' => 'Ad hoc',
                'count_date' => CarbonImmutable::now()->toDateString(),
                'counted_by' => $countedBy,
                'status' => 'In Progress',
            ]);

            $count->items()->create([
                'item_id' => $itemId,
                'counted_quantity' => $countedQuantity,
                'note' => $reason,
            ]);

            // Posting it is what moves the stock and stamps the variance.
            $count->forceFill(['status' => 'Posted'])->save();

            return $count->fresh();
        });
    }

    private function nextCountNumber(): string
    {
        $stem = 'CC-'.date('Y').'-';

        $last = CycleCount::query()
            ->where('count_no', 'like', $stem.'%')
            ->orderByDesc('count_no')
            ->lockForUpdate()
            ->value('count_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }

    /** @return Collection<int, array<string, mixed>> */
    public function expiringStock(int $withinDays = 60): Collection
    {
        return StockBalance::query()
            ->with('item', 'warehouse')
            ->whereNotNull('expiry_date')
            ->where('on_hand', '>', 0)
            ->whereDate('expiry_date', '<=', CarbonImmutable::now()->addDays($withinDays)->toDateString())
            ->orderBy('expiry_date')
            ->get()
            ->map(fn (StockBalance $b) => [
                'sku' => $b->item->sku,
                'name' => $b->item->name,
                'warehouse' => $b->warehouse->name,
                'batch' => $b->batch,
                'expiry' => $b->expiry_date?->toDateString(),
                'daysLeft' => $b->expiry_date
                    ? CarbonImmutable::now()->startOfDay()->diffInDays($b->expiry_date, false)
                    : null,
                'onHand' => (float) $b->on_hand,
                'value' => round((float) $b->on_hand * (float) $b->unit_cost, 2),
            ]);
    }

    /**
     * Recomputes every active item's ABC class from what actually moved.
     *
     * Cumulative-value Pareto, not a fixed count split: the top items making
     * up roughly 80% of 90-day issued value are A, the next 15% are B, the
     * rest are C. A class a manager hand-picks stays exactly as they left it
     * until they run this — `abc_class_computed_at` is how the item screen
     * tells the two apart, since a bare "A" on its own does not say whether
     * it is a fact or a guess.
     *
     * @return array{changed: int, total: int}
     */
    public function recomputeAbcClasses(): array
    {
        $since = CarbonImmutable::now()->subDays(self::DEMAND_WINDOW_DAYS);

        $issued = StockMovement::query()
            ->where('direction', 'out')
            ->whereIn('reason', ['Issue', 'Transfer Out'])
            ->where('moved_at', '>=', $since)
            ->selectRaw('item_id, SUM(quantity) AS total')
            ->groupBy('item_id')
            ->pluck('total', 'item_id');

        $items = Item::query()->where('is_active', true)->get(['id', 'unit_cost', 'abc_class']);

        $ranked = $items
            ->map(fn (Item $item) => [
                'id' => $item->id,
                'currentClass' => $item->abc_class,
                'value' => (float) ($issued[$item->id] ?? 0) * (float) $item->unit_cost,
            ])
            ->sortByDesc('value')
            ->values();

        $totalValue = $ranked->sum('value');
        $changed = 0;
        $now = CarbonImmutable::now();

        if ($totalValue <= 0) {
            // Nothing has moved — leave every class exactly where it was
            // rather than declaring the whole catalogue "C" on no evidence.
            return ['changed' => 0, 'total' => $items->count()];
        }

        $running = 0.0;

        DB::transaction(function () use ($ranked, $totalValue, &$running, &$changed, $now) {
            foreach ($ranked as $row) {
                $running += $row['value'];
                $pct = $running / $totalValue;

                $class = match (true) {
                    $pct <= 0.80 => 'A',
                    $pct <= 0.95 => 'B',
                    default => 'C',
                };

                if ($class !== $row['currentClass']) {
                    $changed++;
                }

                Item::whereKey($row['id'])->update([
                    'abc_class' => $class,
                    'abc_class_computed_at' => $now,
                ]);
            }
        });

        $this->audit->log('recomputed ABC classes', 'Item', 0, "{$changed} of {$items->count()} changed", 'warehouse');

        return ['changed' => $changed, 'total' => $items->count()];
    }

    /**
     * Where to put something away.
     *
     * A suggestion, not a lock — the first active bin tagged for this item's
     * class with room left, ordered so a lower aisle (read as closer to the
     * dock) wins ties. Real constraints the system does not know about —
     * an oversized crate, a damaged-goods hold — will always need an
     * override, so this never refuses a putaway, only proposes one.
     */
    public function suggestBin(int $itemId, int $warehouseId): ?array
    {
        $item = Item::find($itemId);

        if (! $item) {
            return null;
        }

        $bins = WarehouseBin::query()
            ->where('warehouse_id', $warehouseId)
            ->where('is_active', true)
            ->where('preferred_class', $item->abc_class)
            ->withSum('stockBalances as occupied', 'on_hand')
            ->orderBy('aisle')
            ->orderBy('code')
            ->get();

        $bin = $bins->first(fn (WarehouseBin $b) => (float) ($b->occupied ?? 0) < (float) $b->capacity);

        if (! $bin) {
            return null;
        }

        return [
            'binId' => $bin->id,
            'code' => $bin->code,
            'zone' => $bin->zone,
            'aisle' => $bin->aisle,
            'capacity' => (float) $bin->capacity,
            'occupied' => (float) ($bin->occupied ?? 0),
            'reason' => "Tagged for class {$item->abc_class} items",
        ];
    }

    /**
     * Groups pending pick lists into one real, released batch.
     *
     * This is what `pick_lists.wave` was a free-text stand-in for — a person
     * typing "AM-1" was trying to say "these ship together", which a shared
     * `wave_id` says without the typo risk. Only lists still `Released` (not
     * yet started) and not already on a wave are eligible, so building a wave
     * can never quietly re-batch work already in progress.
     *
     * @param  array<int, int>  $pickListIds
     *
     * @throws ValidationException
     */
    public function buildWave(
        int $warehouseId,
        array $pickListIds,
        ?string $zone = null,
        ?string $cutoffAt = null,
        ?int $createdBy = null,
    ): PickWave {
        $lists = PickList::query()
            ->whereKey($pickListIds)
            ->where('warehouse_id', $warehouseId)
            ->where('status', 'Released')
            ->whereNull('wave_id')
            ->get();

        if ($lists->isEmpty()) {
            throw ValidationException::withMessages([
                'pickListIds' => 'Choose at least one released pick list that is not already on a wave.',
            ]);
        }

        return DB::transaction(function () use ($lists, $warehouseId, $zone, $cutoffAt, $createdBy) {
            $wave = PickWave::create([
                'wave_no' => $this->nextWaveNumber(),
                'warehouse_id' => $warehouseId,
                'zone' => $zone,
                'cutoff_at' => $cutoffAt,
                'status' => 'Released',
                'created_by' => $createdBy,
            ]);

            PickList::whereIn('id', $lists->pluck('id'))->update(['wave_id' => $wave->id, 'wave' => $wave->wave_no]);

            $this->audit->log('built a pick wave', 'PickWave', $wave->id, "{$wave->wave_no} — {$lists->count()} pick list(s)", 'warehouse');

            return $wave->fresh('pickLists');
        });
    }

    private function nextWaveNumber(): string
    {
        $stem = 'WAVE-'.date('Y').'-';

        $last = PickWave::query()
            ->where('wave_no', 'like', $stem.'%')
            ->orderByDesc('wave_no')
            ->lockForUpdate()
            ->value('wave_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }
}
