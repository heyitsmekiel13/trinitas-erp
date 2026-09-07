<?php

namespace App\Services;

use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\PurchaseRequisition;
use App\Models\Rfq;
use App\Models\Supplier;
use App\Models\SupplierContract;
use App\Models\SupplierInvoice;
use App\Services\Concerns\ResolvesDashboardWindow;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The Procurement dashboard, computed from the documents themselves.
 *
 * Spend is the sum of committed purchase orders; savings are what tenders
 * actually saved against their own estimates; the matching figures come from
 * the invoices. Nothing here is denormalised, so a chart and a list page
 * cannot disagree.
 */
class ProcurementAnalytics
{
    use ResolvesDashboardWindow;

    private const MONTHS = 12;

    /** Orders in these states have not committed any money. */
    private const DEAD_ORDER_STATES = ['Draft', 'Cancelled'];

    public function dashboard(
        string $period = 'last_12m',
        ?string $from = null,
        ?string $to = null,
        ?string $grain = null,
    ): array {
        $now = CarbonImmutable::now();

        [$start, $end, $grain, $label, $priorStart, $priorEnd] = $this->resolveWindow(
            $period, $from, $to, $grain, $now,
            fn (CarbonImmutable $now) => CarbonImmutable::parse(PurchaseOrder::min('order_date') ?? $now->subYear())->startOfDay(),
        );

        $orders = $this->orders($start, $end);
        $priorOrders = $this->orders($priorStart, $priorEnd);
        $trend = $this->trend($orders, $grain, $start, $end);

        return [
            'trend' => $trend,
            'categories' => $this->groupTop($orders, 'category', 8),
            'suppliers' => $this->groupTop($orders, 'supplier', 8),
            'pipeline' => $this->pipeline(),
            'kpis' => $this->kpis($orders, $priorOrders, $now),
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

    /**
     * Committed orders in the window, flattened to what the charts read.
     *
     * @return Collection<int, array{month:string,total:float,category:string,supplier:string,receivedPct:int,status:string,expected:?string}>
     */
    private function orders(CarbonImmutable $start, CarbonImmutable $end): Collection
    {
        return PurchaseOrder::query()
            ->whereNotIn('purchase_orders.status', self::DEAD_ORDER_STATES)
            ->whereBetween('purchase_orders.order_date', [$start->toDateString(), $end->toDateString()])
            ->join('suppliers', 'suppliers.id', '=', 'purchase_orders.supplier_id')
            ->get([
                'purchase_orders.order_date',
                'purchase_orders.expected_at',
                'purchase_orders.total',
                'purchase_orders.received_pct',
                'purchase_orders.status',
                'suppliers.category',
                'suppliers.name as supplier_name',
            ])
            ->map(fn ($row) => [
                'bucket' => $row->order_date,
                'total' => (float) $row->total,
                'category' => (string) ($row->category ?: 'Uncategorised'),
                'supplier' => (string) $row->supplier_name,
                'receivedPct' => (int) $row->received_pct,
                'status' => (string) $row->status,
                'expected' => $row->expected_at,
            ]);
    }

    /** Committed spend bucketed at the resolved grain, against what was received. */
    private function trend(Collection $orders, string $grain, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $byBucket = $orders->groupBy(fn ($row) => $this->windowBucketKey($grain, CarbonImmutable::parse($row['bucket'])));

        $rows = [];
        $cursor = $this->windowFloorTo($grain, $start);
        $guard = 0;

        while ($cursor->lte($end) && $guard++ < 4000) {
            $bucketRows = $byBucket->get($this->windowBucketKey($grain, $cursor), collect());

            $committed = round($bucketRows->sum('total'), 2);
            // Value actually delivered, using each order's received share.
            $received = round($bucketRows->sum(fn ($o) => $o['total'] * min(100, $o['receivedPct']) / 100), 2);

            $rows[] = [
                'key' => $this->windowBucketKey($grain, $cursor),
                'month' => $this->windowBucketLabel($grain, $cursor),
                'committed' => $committed,
                'received' => $received,
                'orders' => $bucketRows->count(),
            ];

            $cursor = $this->windowStep($cursor, $grain);
        }

        return $rows;
    }

    /** Spend share by one dimension of the order, largest first. */
    private function groupTop(Collection $orders, string $field, int $limit): array
    {
        return $orders
            ->groupBy($field)
            ->map(fn (Collection $rows) => round($rows->sum('total'), 2))
            ->sortDesc()
            ->take($limit)
            ->map(fn (float $value, string $name) => ['name' => $name ?: '—', 'value' => $value])
            ->values()
            ->all();
    }

    /**
     * Where work is sitting in the chain.
     *
     * This is the stage-by-stage view that tells a purchasing manager whether
     * the queue is at their end or somebody else's.
     */
    private function pipeline(): array
    {
        $requisitions = PurchaseRequisition::query()
            ->whereIn('status', ['Submitted', 'For Approval', 'Approved'])
            ->get(['amount']);

        $rfqs = Rfq::query()
            ->whereIn('status', ['Open', 'Under Evaluation'])
            ->get(['estimated_value']);

        $awaitingApproval = PurchaseOrder::query()
            ->whereIn('status', ['Draft', 'For Approval'])
            ->get(['total']);

        $awaitingDelivery = PurchaseOrder::query()
            ->whereIn('status', ['Approved', 'Partial'])
            ->get(['total', 'received_pct']);

        return [
            [
                'stage' => 'Requisitions',
                'count' => $requisitions->count(),
                'value' => round($requisitions->sum(fn ($r) => (float) $r->amount), 2),
            ],
            [
                'stage' => 'Out to tender',
                'count' => $rfqs->count(),
                'value' => round($rfqs->sum(fn ($r) => (float) $r->estimated_value), 2),
            ],
            [
                'stage' => 'Awaiting approval',
                'count' => $awaitingApproval->count(),
                'value' => round($awaitingApproval->sum(fn ($o) => (float) $o->total), 2),
            ],
            [
                'stage' => 'Awaiting delivery',
                'count' => $awaitingDelivery->count(),
                // Only the part not yet delivered is still outstanding.
                'value' => round($awaitingDelivery->sum(
                    fn ($o) => (float) $o->total * (1 - min(100, (int) $o->received_pct) / 100),
                ), 2),
            ],
        ];
    }

    /**
     * The headline tiles.
     *
     * `onTimeDelivery` is null rather than zero when nothing has been fully
     * received against an expected date — an empty system has no record, and
     * 0% would read as a failure that never happened.
     */
    private function kpis(Collection $orders, Collection $priorOrders, CarbonImmutable $now): array
    {
        $spend = $orders->sum('total');
        $priorSpend = $priorOrders->sum('total');

        $rfqs = Rfq::where('status', 'Awarded')->get(['estimated_value', 'best_bid', 'savings']);
        $invoices = SupplierInvoice::query()->get(['match_status', 'status', 'due_date', 'amount']);

        $matched = $invoices->where('match_status', 'Matched')->count();

        return [
            'spendMtd' => round($spend, 2),
            'spendChange' => $priorSpend > 0
                ? round((($spend - $priorSpend) / $priorSpend) * 100, 1)
                : 0.0,
            'periodSpend' => round($spend, 2),
            'ordersThisMonth' => $orders->count(),
            'avgOrderValue' => $orders->count() > 0 ? round($spend / $orders->count(), 2) : 0.0,
            'activeSuppliers' => Supplier::where('status', 'Active')->count(),
            'openRequisitions' => PurchaseRequisition::whereIn('status', ['Submitted', 'For Approval', 'Approved'])->count(),
            'openRfqs' => Rfq::whereIn('status', ['Open', 'Under Evaluation'])->count(),
            'savings' => round($rfqs->sum(fn ($r) => (float) $r->savings), 2),
            'savingsRate' => $rfqs->sum(fn ($r) => (float) $r->estimated_value) > 0
                ? round(($rfqs->sum(fn ($r) => (float) $r->savings) / $rfqs->sum(fn ($r) => (float) $r->estimated_value)) * 100, 1)
                : 0.0,
            'invoicesMatched' => $matched,
            'matchRate' => $invoices->count() > 0 ? round(($matched / $invoices->count()) * 100, 1) : null,
            'invoicesOverdue' => $invoices
                ->filter(fn ($i) => ! in_array($i->status, ['Paid', 'Rejected'], true)
                    && $i->due_date && CarbonImmutable::parse($i->due_date)->lt($now->startOfDay()))
                ->count(),
            'payablesOutstanding' => round($invoices
                ->filter(fn ($i) => ! in_array($i->status, ['Paid', 'Rejected'], true))
                ->sum(fn ($i) => (float) $i->amount), 2),
            'onTimeDelivery' => $this->onTimeDelivery(),
            'contractsExpiring' => SupplierContract::query()
                ->whereIn('status', ['Active', 'Expiring'])
                ->whereBetween('end_date', [$now->toDateString(), $now->addDays(90)->toDateString()])
                ->count(),
        ];
    }

    /** Share of completed orders that arrived on or before the expected date. */
    private function onTimeDelivery(): ?float
    {
        $rows = PurchaseOrder::query()
            ->where('purchase_orders.status', 'Completed')
            ->whereNotNull('purchase_orders.expected_at')
            ->join('goods_receipts', 'goods_receipts.purchase_order_id', '=', 'purchase_orders.id')
            ->where('goods_receipts.status', 'Posted')
            ->get([
                'purchase_orders.id',
                'purchase_orders.expected_at',
                'goods_receipts.received_at',
            ])
            // The last posted receipt is when the order was actually complete.
            ->groupBy('id')
            ->map(fn (Collection $rows) => [
                'expected' => $rows->first()->expected_at,
                'completed' => $rows->max('received_at'),
            ]);

        if ($rows->isEmpty()) {
            return null;
        }

        $onTime = $rows->filter(
            fn ($r) => CarbonImmutable::parse($r['completed'])->startOfDay()
                <= CarbonImmutable::parse($r['expected'])->startOfDay()
        )->count();

        return round(($onTime / $rows->count()) * 100, 1);
    }

    /* ---------------------------------------------------------------------- */

    /**
     * One supplier's trading history — the mirror of the customer view.
     *
     * Answers what a buyer asks before renewing: what have we spent, are they
     * delivering on time, are their invoices clean, and what are we tied into.
     */
    public function supplierHistory(Supplier $supplier): array
    {
        $orders = PurchaseOrder::query()
            ->where('supplier_id', $supplier->id)
            ->with('warehouse')
            ->orderByDesc('order_date')
            ->orderByDesc('id')
            ->get();

        $committed = $orders->reject(fn ($o) => in_array($o->status, self::DEAD_ORDER_STATES, true));
        $spend = round($committed->sum(fn ($o) => (float) $o->total), 2);

        $invoices = SupplierInvoice::where('supplier_id', $supplier->id)->get();
        $contracts = SupplierContract::where('supplier_id', $supplier->id)
            ->orderByDesc('end_date')
            ->get(['contract_no', 'title', 'type', 'start_date', 'end_date', 'value', 'status']);

        return [
            'summary' => [
                'orders' => $committed->count(),
                'draftOrders' => $orders->count() - $committed->count(),
                'spend' => $spend,
                'avgOrderValue' => $committed->count() > 0 ? round($spend / $committed->count(), 2) : 0.0,
                'firstOrder' => $committed->min('order_date')?->format('Y-m-d'),
                'lastOrder' => $committed->max('order_date')?->format('Y-m-d'),
                'invoices' => $invoices->count(),
                'invoicesMatched' => $invoices->where('match_status', 'Matched')->count(),
                'payablesOutstanding' => round($invoices
                    ->filter(fn ($i) => ! in_array($i->status, ['Paid', 'Rejected'], true))
                    ->sum(fn ($i) => (float) $i->amount), 2),
                'onTimeRate' => (float) $supplier->on_time_rate,
                'qualityRate' => (float) $supplier->quality_rate,
                'scorecard' => (int) $supplier->scorecard,
            ],
            'monthly' => $this->supplierMonthly($committed),
            'orders' => $orders->map(fn ($o) => [
                'id' => $o->id,
                'no' => $o->po_no,
                'date' => $o->order_date?->format('Y-m-d'),
                'expected' => $o->expected_at?->format('Y-m-d'),
                'warehouse' => $o->warehouse->name ?? '—',
                'amount' => (float) $o->total,
                'receivedPct' => (int) $o->received_pct,
                'status' => $o->status,
            ])->all(),
            'items' => $this->supplierItems($committed->pluck('id')->all()),
            'contracts' => $contracts->map(fn ($c) => [
                'no' => $c->contract_no,
                'title' => $c->title,
                'type' => $c->type,
                'start' => $c->start_date?->format('Y-m-d'),
                'end' => $c->end_date?->format('Y-m-d'),
                'value' => (float) $c->value,
                'status' => $c->status,
            ])->all(),
        ];
    }

    private function supplierMonthly(Collection $committed): array
    {
        $now = CarbonImmutable::now();
        $byMonth = $committed
            ->filter(fn ($o) => $o->order_date >= $now->startOfMonth()->subMonths(self::MONTHS - 1))
            ->groupBy(fn ($o) => CarbonImmutable::parse($o->order_date)->format('Y-m'));

        $months = [];
        for ($i = self::MONTHS - 1; $i >= 0; $i--) {
            $month = $now->startOfMonth()->subMonths($i);
            $rows = $byMonth->get($month->format('Y-m'), collect());
            $months[] = [
                'month' => $month->format('M'),
                'spend' => round($rows->sum(fn ($o) => (float) $o->total), 2),
            ];
        }

        return $months;
    }

    /** @param array<int, int> $orderIds */
    private function supplierItems(array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        return PurchaseOrderLine::query()
            ->whereIn('purchase_order_lines.purchase_order_id', $orderIds)
            ->join('items', 'items.id', '=', 'purchase_order_lines.item_id')
            ->get([
                'items.sku',
                'items.name',
                'purchase_order_lines.quantity',
                'purchase_order_lines.line_total',
            ])
            ->groupBy('sku')
            ->map(fn (Collection $rows, string $sku) => [
                'sku' => $sku,
                'name' => (string) $rows->first()->name,
                'quantity' => round($rows->sum(fn ($r) => (float) $r->quantity), 2),
                'value' => round($rows->sum(fn ($r) => (float) $r->line_total), 2),
            ])
            ->sortByDesc('value')
            ->take(10)
            ->values()
            ->all();
    }
}
