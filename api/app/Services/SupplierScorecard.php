<?php

namespace App\Services;

use App\Models\GoodsReceipt;
use App\Models\GoodsReceiptLine;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderLine;
use App\Models\Supplier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Scores suppliers on what they actually did.
 *
 * A scorecard somebody types in is a fiction — it tells you what the buyer
 * thinks of the supplier, which they already knew. Every figure here is derived
 * from documents: delivery dates against promised dates, rejected quantities
 * against received, prices paid against what everyone else charged for the same
 * item. Nothing is editable, and each score can be traced back to the rows that
 * produced it.
 *
 * WHERE A COMPONENT CANNOT BE COMPUTED IT IS EXCLUDED, NOT SCORED ZERO. A
 * supplier onboarded last week has delivered nothing, and ranking them bottom
 * for that would be worse than admitting there is no evidence yet.
 */
class SupplierScorecard
{
    /**
     * Composite weighting. Delivery and quality dominate because a cheap
     * supplier who ships late or short costs more than the discount saves.
     */
    private const WEIGHTS = ['delivery' => 0.40, 'quality' => 0.40, 'price' => 0.20];

    /** Scores below this need a buyer to look at the relationship. */
    public const REVIEW_THRESHOLD = 76;

    /** How far back performance is measured. */
    private const WINDOW_MONTHS = 12;

    /** Recomputes every supplier. Returns a short summary of what changed. */
    public function evaluateAll(): array
    {
        $suppliers = Supplier::all();
        $scored = 0;
        $noEvidence = 0;

        foreach ($suppliers as $supplier) {
            $result = $this->evaluate($supplier);
            $result['sample'] > 0 ? $scored++ : $noEvidence++;
        }

        return [
            'suppliers' => $suppliers->count(),
            'scored' => $scored,
            'noEvidence' => $noEvidence,
            'evaluatedAt' => now()->toIso8601String(),
        ];
    }

    /** Recomputes one supplier and writes the result to their record. */
    public function evaluate(Supplier $supplier): array
    {
        $breakdown = $this->breakdown($supplier);

        // Null, not zero. A supplier with no completed deliveries has no
        // on-time rate; recording 0% would make them indistinguishable from one
        // who is late every time.
        $supplier->forceFill([
            'on_time_rate' => $breakdown['delivery']['rate'],
            'quality_rate' => $breakdown['quality']['rate'],
            'price_index' => $breakdown['price']['index'],
            'scorecard' => $breakdown['score'],
            'scorecard_sample' => $breakdown['sample'],
            'scorecard_updated_at' => now(),
            'ytd_spend' => $breakdown['ytdSpend'],
        ])->save();

        return $breakdown;
    }

    /**
     * The evidence behind a supplier's score.
     *
     * Returned to the screen as well as written to the record, so a buyer can
     * see *why* someone scores 78 rather than being handed the number.
     */
    public function breakdown(Supplier $supplier): array
    {
        $since = CarbonImmutable::now()->startOfMonth()->subMonths(self::WINDOW_MONTHS - 1);

        $orders = PurchaseOrder::query()
            ->where('supplier_id', $supplier->id)
            ->whereNotIn('status', ['Draft', 'Cancelled'])
            ->where('order_date', '>=', $since->toDateString())
            ->get(['id', 'po_no', 'order_date', 'expected_at', 'total', 'status']);

        $delivery = $this->delivery($orders);
        $quality = $this->quality($orders->pluck('id')->all());
        $price = $this->price($supplier, $orders->pluck('id')->all());

        $components = [];
        if ($delivery['rate'] !== null) {
            $components['delivery'] = $delivery['rate'];
        }
        if ($quality['rate'] !== null) {
            $components['quality'] = $quality['rate'];
        }
        if ($price['index'] !== null) {
            // 100 = at market. Every point above market costs two points of
            // score; being cheaper than market is capped at full marks rather
            // than rewarded without limit, because a suspiciously cheap
            // supplier is not automatically a better one.
            $components['price'] = max(0.0, min(100.0, 100 - ($price['index'] - 100) * 2));
        }

        return [
            'supplier' => $supplier->name,
            'code' => $supplier->code,
            'windowMonths' => self::WINDOW_MONTHS,
            'windowFrom' => $since->toDateString(),
            'delivery' => $delivery,
            'quality' => $quality,
            'price' => $price,
            'score' => $this->composite($components),
            'components' => array_map(fn (float $v) => round($v, 1), $components),
            'weights' => self::WEIGHTS,
            'sample' => $delivery['completedOrders'] + $quality['receipts'],
            'ytdSpend' => $this->ytdSpend($supplier),
            'accreditationExpired' => $supplier->accredited_until
                && CarbonImmutable::parse($supplier->accredited_until)->lt(CarbonImmutable::now()->startOfDay()),
            'needsReview' => ($this->composite($components) ?? 100) < self::REVIEW_THRESHOLD,
        ];
    }

    /**
     * Weighted average of whatever could be measured.
     *
     * The weights are renormalised over the present components, so a supplier
     * with deliveries but no price comparison is scored out of delivery and
     * quality alone rather than penalised for the missing third.
     */
    private function composite(array $components): ?float
    {
        if ($components === []) {
            return null;
        }

        $weighted = 0.0;
        $weight = 0.0;

        foreach ($components as $key => $value) {
            $w = self::WEIGHTS[$key];
            $weighted += $value * $w;
            $weight += $w;
        }

        return round($weighted / $weight, 1);
    }

    /**
     * Delivery reliability: completed orders that arrived by the promised date.
     *
     * Measured on the last posted receipt, because an order is only delivered
     * when the final line arrives — a supplier who ships 90% on time and the
     * remainder three weeks late has not delivered on time.
     */
    private function delivery(Collection $orders): array
    {
        $completed = $orders->filter(fn ($o) => $o->status === 'Completed' && $o->expected_at);

        if ($completed->isEmpty()) {
            return [
                'rate' => null,
                'completedOrders' => 0,
                'onTime' => 0,
                'late' => 0,
                'avgDaysLate' => null,
                'openPastDue' => $this->openPastDue($orders),
                'note' => 'No completed orders with an expected date in the window.',
            ];
        }

        $lastReceipt = GoodsReceipt::query()
            ->whereIn('purchase_order_id', $completed->pluck('id'))
            ->where('status', 'Posted')
            ->get(['purchase_order_id', 'received_at'])
            ->groupBy('purchase_order_id')
            ->map(fn (Collection $rows) => $rows->max('received_at'));

        $onTime = 0;
        $late = 0;
        $daysLate = [];

        foreach ($completed as $order) {
            $arrived = $lastReceipt[$order->id] ?? null;
            if (! $arrived) {
                continue;   // Completed without a posted receipt — nothing to judge.
            }

            $days = CarbonImmutable::parse($order->expected_at)->startOfDay()
                ->diffInDays(CarbonImmutable::parse($arrived)->startOfDay(), false);

            if ($days <= 0) {
                $onTime++;
            } else {
                $late++;
                $daysLate[] = $days;
            }
        }

        $judged = $onTime + $late;

        return [
            'rate' => $judged > 0 ? round(($onTime / $judged) * 100, 1) : null,
            'completedOrders' => $judged,
            'onTime' => $onTime,
            'late' => $late,
            'avgDaysLate' => $daysLate === [] ? null : round(array_sum($daysLate) / count($daysLate), 1),
            'openPastDue' => $this->openPastDue($orders),
            'note' => $judged > 0
                ? "{$onTime} of {$judged} completed orders arrived on or before the expected date."
                : 'Completed orders have no posted receipts, so arrival cannot be dated.',
        ];
    }

    /** Orders still open and already past their expected date. */
    private function openPastDue(Collection $orders): int
    {
        $today = CarbonImmutable::now()->startOfDay();

        return $orders
            ->filter(fn ($o) => in_array($o->status, ['Approved', 'Partial'], true)
                && $o->expected_at
                && CarbonImmutable::parse($o->expected_at)->lt($today))
            ->count();
    }

    /**
     * Quality acceptance: the share of delivered goods that passed inspection.
     *
     * @param  array<int, int>  $orderIds
     */
    private function quality(array $orderIds): array
    {
        if ($orderIds === []) {
            return ['rate' => null, 'receipts' => 0, 'received' => 0.0, 'rejected' => 0.0, 'note' => 'Nothing received in the window.'];
        }

        $lines = GoodsReceiptLine::query()
            ->whereHas('goodsReceipt', fn ($q) => $q
                ->whereIn('purchase_order_id', $orderIds)
                ->where('status', 'Posted'))
            ->get(['goods_receipt_id', 'quantity_received', 'quantity_rejected']);

        $received = round($lines->sum(fn ($l) => (float) $l->quantity_received), 2);
        $rejected = round($lines->sum(fn ($l) => (float) $l->quantity_rejected), 2);
        $presented = $received + $rejected;

        return [
            'rate' => $presented > 0 ? round(($received / $presented) * 100, 1) : null,
            'receipts' => $lines->pluck('goods_receipt_id')->unique()->count(),
            'received' => $received,
            'rejected' => $rejected,
            'note' => $presented > 0
                ? ($rejected > 0
                    ? number_format($rejected, 2).' of '.number_format($presented, 2).' units were rejected on inspection.'
                    : 'Everything delivered passed inspection.')
                : 'Nothing received in the window.',
        ];
    }

    /**
     * Price competitiveness against what other suppliers charged.
     *
     * For each item this supplier sold us, their weighted average unit cost is
     * compared with the weighted average every supplier charged for the same
     * item over the same window. 100 means at market; below 100 is cheaper.
     *
     * Items only ever bought from this one supplier are skipped — there is no
     * market to compare against, and including them would just measure the
     * supplier against themselves and always return exactly 100.
     *
     * @param  array<int, int>  $orderIds
     */
    private function price(Supplier $supplier, array $orderIds): array
    {
        if ($orderIds === []) {
            return ['index' => null, 'itemsCompared' => 0, 'items' => [], 'note' => 'Nothing purchased in the window.'];
        }

        $since = CarbonImmutable::now()->startOfMonth()->subMonths(self::WINDOW_MONTHS - 1)->toDateString();

        // Every line for every supplier, so "market" means the real market.
        $market = PurchaseOrderLine::query()
            ->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_lines.purchase_order_id')
            ->join('items', 'items.id', '=', 'purchase_order_lines.item_id')
            ->whereNotIn('purchase_orders.status', ['Draft', 'Cancelled'])
            ->where('purchase_orders.order_date', '>=', $since)
            ->get([
                'purchase_order_lines.item_id',
                'purchase_order_lines.quantity',
                'purchase_order_lines.unit_cost',
                'purchase_orders.supplier_id',
                'items.sku',
                'items.name',
            ]);

        $mine = 0.0;
        $benchmark = 0.0;
        $items = [];

        foreach ($market->groupBy('item_id') as $lines) {
            $ours = $lines->where('supplier_id', $supplier->id);
            $theirs = $lines->where('supplier_id', '!=', $supplier->id);

            if ($ours->isEmpty() || $theirs->isEmpty()) {
                continue;
            }

            $ourQty = (float) $ours->sum('quantity');
            $theirQty = (float) $theirs->sum('quantity');
            if ($ourQty <= 0 || $theirQty <= 0) {
                continue;
            }

            $ourAvg = $ours->sum(fn ($l) => (float) $l->quantity * (float) $l->unit_cost) / $ourQty;
            $marketAvg = $theirs->sum(fn ($l) => (float) $l->quantity * (float) $l->unit_cost) / $theirQty;

            // Weighted by our own volume: the price of what we buy a lot of
            // matters more than the price of a one-off.
            $mine += $ourAvg * $ourQty;
            $benchmark += $marketAvg * $ourQty;

            $items[] = [
                'sku' => (string) $lines->first()->sku,
                'name' => (string) $lines->first()->name,
                'ourPrice' => round($ourAvg, 2),
                'marketPrice' => round($marketAvg, 2),
                'variancePct' => $marketAvg > 0 ? round((($ourAvg - $marketAvg) / $marketAvg) * 100, 1) : 0.0,
            ];
        }

        if ($benchmark <= 0) {
            return [
                'index' => null,
                'itemsCompared' => 0,
                'items' => [],
                'note' => 'No item was bought from more than one supplier, so there is nothing to compare prices against.',
            ];
        }

        $index = round(($mine / $benchmark) * 100, 1);

        return [
            'index' => $index,
            'itemsCompared' => count($items),
            'items' => $items,
            'note' => $index <= 100
                ? sprintf('%.1f%% cheaper than the market average on comparable items.', 100 - $index)
                : sprintf('%.1f%% more expensive than the market average on comparable items.', $index - 100),
        ];
    }

    /** Committed spend with this supplier so far this calendar year. */
    private function ytdSpend(Supplier $supplier): float
    {
        return round((float) PurchaseOrder::query()
            ->where('supplier_id', $supplier->id)
            ->whereNotIn('status', ['Draft', 'Cancelled'])
            ->whereYear('order_date', CarbonImmutable::now()->year)
            ->sum('total'), 2);
    }
}
