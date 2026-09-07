<?php

namespace App\Services;

use App\Models\CycleCount;
use App\Models\InboundShipment;
use App\Models\Item;
use App\Models\PickList;
use App\Models\StockBalance;
use App\Models\StockMovement;
use App\Models\StockTransfer;
use App\Models\Warehouse;
use App\Services\Concerns\ResolvesDashboardWindow;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The Warehouse dashboard, computed from balances and the movement log.
 *
 * Stock value is the sum of what is on the shelf at what it cost; throughput is
 * the movement log counted by day. Both were previously generated numbers, which
 * meant the dashboard could not disagree with reality because it was never
 * looking at it.
 */
class WarehouseAnalytics
{
    use ResolvesDashboardWindow;

    private const DAYS = 30;

    public function __construct(private readonly WarehouseOperations $operations) {}

    public function dashboard(
        string $period = 'mtd',
        ?string $from = null,
        ?string $to = null,
        ?string $grain = null,
    ): array {
        $now = CarbonImmutable::now();

        [$start, $end, $grain, $label, $priorStart, $priorEnd] = $this->resolveWindow(
            $period, $from, $to, $grain, $now,
            fn (CarbonImmutable $now) => CarbonImmutable::parse(StockMovement::min('moved_at') ?? $now->subYear())->startOfDay(),
        );

        // Balances are a snapshot of right now — a stock count has no "as of
        // last quarter" — so the Period filter scopes only the movement log
        // below, not what is currently on the shelf.
        $balances = StockBalance::query()
            ->with('item')
            ->where('on_hand', '>', 0)
            ->get();

        $movements = StockMovement::query()
            ->whereBetween('moved_at', [$start->toDateString(), $end->endOfDay()->toDateTimeString()])
            ->get(['direction', 'reason', 'quantity', 'unit_cost', 'moved_at']);

        return [
            'throughput' => $this->throughput($movements, $grain, $start, $end),
            'statusMix' => $this->statusMix($balances),
            'valueByCategory' => $this->valueByCategory($balances),
            'valueByWarehouse' => $this->valueByWarehouse(),
            'expiring' => $this->operations->expiringStock(60)->take(10)->values()->all(),
            'kpis' => $this->kpis($balances, $movements, $start, $end),
            'generatedAt' => $now->toIso8601String(),
            'window' => [
                'period' => $period,
                'grain' => $grain,
                'from' => $start->toDateString(),
                'to' => $end->toDateString(),
                'label' => $label,
                'days' => $start->diffInDays($end) + 1,
                'compare' => [
                    'from' => $priorStart->toDateString(),
                    'to' => $priorEnd->toDateString(),
                    'label' => $priorStart->format('j M Y').' – '.$priorEnd->format('j M Y'),
                ],
            ],
        ];
    }

    /** Units in and out per bucket, which is what a shift supervisor watches. */
    private function throughput(Collection $movements, string $grain, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $byBucket = $movements->groupBy(fn ($m) => $this->windowBucketKey($grain, CarbonImmutable::parse($m->moved_at)));

        $rows = [];
        $cursor = $this->windowFloorTo($grain, $start);
        $guard = 0;

        while ($cursor->lte($end) && $guard++ < 4000) {
            $bucketRows = $byBucket->get($this->windowBucketKey($grain, $cursor), collect());

            $rows[] = [
                'key' => $this->windowBucketKey($grain, $cursor),
                'day' => $this->windowBucketLabel($grain, $cursor),
                'received' => round($bucketRows->where('direction', 'in')->sum(fn ($m) => (float) $m->quantity), 2),
                'issued' => round($bucketRows->where('direction', 'out')->sum(fn ($m) => (float) $m->quantity), 2),
                'movements' => $bucketRows->count(),
            ];

            $cursor = $this->windowStep($cursor, $grain);
        }

        return $rows;
    }

    /**
     * How much of the stock is healthy.
     *
     * Uses the same rules as the stock list's status column, so the donut and
     * the table cannot tell different stories.
     */
    private function statusMix(Collection $balances): array
    {
        $buckets = ['In Stock' => 0, 'Low Stock' => 0, 'Expiring Soon' => 0, 'Overstock' => 0];

        foreach ($balances as $balance) {
            $reorderPoint = (float) ($balance->item->reorder_point ?? 0);
            $available = (float) $balance->available;

            $status = match (true) {
                $balance->expiry_date
                    && CarbonImmutable::now()->startOfDay()->diffInDays($balance->expiry_date, false) < 60 => 'Expiring Soon',
                $reorderPoint > 0 && $available <= $reorderPoint => 'Low Stock',
                $reorderPoint > 0 && (float) $balance->on_hand > $reorderPoint * 4 => 'Overstock',
                default => 'In Stock',
            };

            $buckets[$status]++;
        }

        return collect($buckets)
            ->filter(fn (int $count) => $count > 0)
            ->map(fn (int $count, string $name) => ['name' => $name, 'value' => $count])
            ->values()
            ->all();
    }

    private function valueByCategory(Collection $balances): array
    {
        return $balances
            ->groupBy(fn (StockBalance $b) => $b->item->category ?: 'Uncategorised')
            ->map(fn (Collection $rows) => round($rows->sum(
                fn (StockBalance $b) => (float) $b->on_hand * (float) $b->unit_cost,
            ), 2))
            ->sortDesc()
            ->take(8)
            ->map(fn (float $value, string $name) => ['name' => $name, 'value' => $value])
            ->values()
            ->all();
    }

    /** Value and pallet occupancy per site. */
    private function valueByWarehouse(): array
    {
        return Warehouse::query()
            ->withCount('bins')
            ->get()
            ->map(function (Warehouse $warehouse) {
                $value = StockBalance::query()
                    ->where('warehouse_id', $warehouse->id)
                    ->selectRaw('SUM(on_hand * unit_cost) AS total')
                    ->value('total');

                $capacity = (int) $warehouse->capacity_pallets;
                $used = (int) $warehouse->used_pallets;

                return [
                    'name' => $warehouse->name,
                    'code' => $warehouse->code,
                    'value' => round((float) $value, 2),
                    'skus' => StockBalance::where('warehouse_id', $warehouse->id)->where('on_hand', '>', 0)->count(),
                    'bins' => (int) $warehouse->bins_count,
                    'capacityPallets' => $capacity,
                    'usedPallets' => $used,
                    // Null rather than zero when capacity has not been recorded:
                    // an unknown occupancy is not an empty warehouse.
                    'utilisation' => $capacity > 0 ? round(($used / $capacity) * 100, 1) : null,
                ];
            })
            ->sortByDesc('value')
            ->values()
            ->all();
    }

    private function kpis(Collection $balances, Collection $movements, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $stockValue = round($balances->sum(fn (StockBalance $b) => (float) $b->on_hand * (float) $b->unit_cost), 2);

        $counts = CycleCount::where('status', 'Posted')->get(['accuracy', 'variances', 'value_variance']);
        $replenishment = $this->operations->replenishment();

        $windowDays = max($start->diffInDays($end) + 1, 1);

        // Cost of goods issued over the window, annualised against the stock
        // value on hand — the standard inventory turn calculation.
        $issuedValue = round($movements
            ->where('direction', 'out')
            ->whereIn('reason', ['Issue', 'Transfer Out'])
            ->sum(fn ($m) => (float) $m->quantity * (float) $m->unit_cost), 2);

        return [
            'stockValue' => $stockValue,
            'skusHeld' => $balances->pluck('item_id')->unique()->count(),
            'unitsOnHand' => round($balances->sum(fn (StockBalance $b) => (float) $b->on_hand), 2),
            'unitsReceived' => round($movements->where('direction', 'in')->sum(fn ($m) => (float) $m->quantity), 2),
            'unitsIssued' => round($movements->where('direction', 'out')->sum(fn ($m) => (float) $m->quantity), 2),
            'movements' => $movements->count(),
            // Null until there is stock to turn over — a rate of zero would
            // read as a warehouse that never ships.
            'inventoryTurns' => $stockValue > 0
                ? round(($issuedValue * (365 / $windowDays)) / $stockValue, 2)
                : null,
            'countAccuracy' => $counts->isEmpty() ? null : round($counts->avg('accuracy'), 1),
            'countVariances' => (int) $counts->sum('variances'),
            'countValueVariance' => round($counts->sum(fn ($c) => (float) $c->value_variance), 2),
            'openPicks' => PickList::whereIn('status', PickList::OPEN_STATUSES)->count(),
            'expectedInbound' => InboundShipment::whereIn('status', ['Expected', 'Receiving', 'In Inspection'])->count(),
            'transfersInTransit' => StockTransfer::where('status', 'In Transit')->count(),
            'replenishmentLines' => count($replenishment),
            'replenishmentCritical' => count(array_filter($replenishment, fn ($r) => $r['urgency'] === 'Critical')),
            'expiringSoon' => $this->operations->expiringStock(60)->count(),
            'activeSkus' => Item::where('is_active', true)->count(),
        ];
    }
}
