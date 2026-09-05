<?php

namespace App\Services;

use App\Models\Customer;
use App\Models\Delivery;
use App\Models\Lead;
use App\Models\Quotation;
use App\Models\SalesOrder;
use App\Models\SalesOrderLine;
use App\Models\SalesReturn;
use App\Models\SalesTarget;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The Sales dashboard, computed from the documents themselves.
 *
 * Every figure here traces back to a row a user can open: revenue is the sum of
 * order totals, margin is order total less the cost captured from the item
 * master at save time, pipeline is the open leads. Nothing is denormalised and
 * nothing is estimated — if a chart and a list page disagree, one of them is a
 * bug, and this is the side that decides.
 *
 * Aggregation happens in PHP rather than SQL on purpose: the installation runs
 * on both SQLite and MySQL, and month bucketing is the one thing their date
 * functions spell differently. A year of orders is a few thousand rows.
 */
class SalesAnalytics
{
    private const MONTHS = 12;

    /** Orders in these states have not sold anything yet, or never will. */
    private const DEAD_ORDER_STATES = ['Draft', 'Cancelled'];

    private const OPEN_STAGES = ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation'];

    public function dashboard(): array
    {
        $now = CarbonImmutable::now();
        $windowStart = $now->startOfMonth()->subMonths(self::MONTHS - 1);

        $orders = $this->orders($windowStart);
        $trend = $this->trend($orders, $now);
        $pipeline = $this->pipeline();

        return [
            'trend' => $trend,
            'channels' => $this->groupTop($orders, 'channel', 8),
            'regions' => $this->groupTop($orders, 'region', 4),
            'customers' => $this->groupTop($orders, 'customer', 8),
            'pipeline' => $pipeline,
            'targets' => $this->targets($now),
            'kpis' => $this->kpis($orders, $trend, $pipeline, $now),
            'generatedAt' => $now->toIso8601String(),
        ];
    }

    /**
     * Billed orders in the window, flattened to the few columns the charts read.
     *
     * @return Collection<int, array{month:string,total:float,cost:float,channel:string,region:string,customer:string}>
     */
    private function orders(CarbonImmutable $windowStart): Collection
    {
        return SalesOrder::query()
            ->whereNotIn('sales_orders.status', self::DEAD_ORDER_STATES)
            ->where('sales_orders.order_date', '>=', $windowStart->toDateString())
            ->join('customers', 'customers.id', '=', 'sales_orders.customer_id')
            ->get([
                'sales_orders.order_date',
                'sales_orders.total',
                'sales_orders.cost_total',
                'customers.channel',
                'customers.region',
                'customers.name as customer_name',
            ])
            ->map(fn ($row) => [
                'month' => CarbonImmutable::parse($row->order_date)->format('Y-m'),
                'total' => (float) $row->total,
                'cost' => (float) $row->cost_total,
                'channel' => (string) $row->channel,
                'region' => (string) $row->region,
                'customer' => (string) $row->customer_name,
            ]);
    }

    /**
     * Revenue, cost and gross profit by month, against the quota set for the
     * period. The target is what the business committed to, never a multiple of
     * what it actually did — a target derived from actuals is always met.
     */
    private function trend(Collection $orders, CarbonImmutable $now): array
    {
        $byMonth = $orders->groupBy('month');
        $targets = $this->monthlyTargets($now);

        $months = [];
        for ($i = self::MONTHS - 1; $i >= 0; $i--) {
            $month = $now->startOfMonth()->subMonths($i);
            $key = $month->format('Y-m');
            $rows = $byMonth->get($key, collect());

            $revenue = round($rows->sum('total'), 2);
            $cost = round($rows->sum('cost'), 2);

            $months[] = [
                'key' => $key,
                'month' => $month->format('M'),
                'revenue' => $revenue,
                'cost' => $cost,
                'grossProfit' => round($revenue - $cost, 2),
                'target' => $targets[$key] ?? 0.0,
                'orders' => $rows->count(),
            ];
        }

        return $months;
    }

    /**
     * Quota per calendar month, keyed `YYYY-MM`.
     *
     * A target row with `period` 1–12 is that month's quota outright. A row with
     * period 0 is an annual quota, which is spread evenly across the year — but
     * only over months the monthly rows did not already claim, so the two ways
     * of setting a quota never double-count.
     */
    private function monthlyTargets(CarbonImmutable $now): array
    {
        $years = [$now->year, $now->startOfMonth()->subMonths(self::MONTHS - 1)->year];

        $rows = SalesTarget::query()
            ->whereIn('year', array_unique($years))
            ->get(['year', 'period', 'quota']);

        $monthly = [];
        foreach ($rows->where('period', '>', 0) as $row) {
            $key = sprintf('%04d-%02d', $row->year, $row->period);
            $monthly[$key] = round(($monthly[$key] ?? 0) + (float) $row->quota, 2);
        }

        foreach ($rows->where('period', 0)->groupBy('year') as $year => $annual) {
            $claimed = 0;
            for ($m = 1; $m <= 12; $m++) {
                if (isset($monthly[sprintf('%04d-%02d', $year, $m)])) {
                    $claimed++;
                }
            }
            $remaining = 12 - $claimed;
            if ($remaining === 0) {
                continue;
            }

            $share = round($annual->sum(fn ($row) => (float) $row->quota) / $remaining, 2);
            for ($m = 1; $m <= 12; $m++) {
                $key = sprintf('%04d-%02d', $year, $m);
                if (! isset($monthly[$key])) {
                    $monthly[$key] = $share;
                }
            }
        }

        return $monthly;
    }

    /** Revenue share by one dimension of the order, largest first. */
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

    /** Open opportunity value by stage, with the probability-weighted forecast. */
    private function pipeline(): array
    {
        $leads = Lead::query()
            ->whereIn('stage', self::OPEN_STAGES)
            ->get(['stage', 'value', 'probability'])
            ->groupBy('stage');

        return collect(self::OPEN_STAGES)
            ->map(function (string $stage) use ($leads) {
                $rows = $leads->get($stage, collect());

                return [
                    'stage' => $stage,
                    'count' => $rows->count(),
                    'value' => round($rows->sum(fn ($l) => (float) $l->value), 2),
                    'weighted' => round($rows->sum(fn ($l) => (float) $l->value * (int) $l->probability / 100), 2),
                ];
            })
            ->all();
    }

    /** Quota attainment per representative for the current year. */
    private function targets(CarbonImmutable $now): array
    {
        return SalesTarget::query()
            ->with('employee')
            ->where('year', $now->year)
            ->orderByDesc('actual')
            ->get()
            ->map(function (SalesTarget $row) {
                $quota = (float) $row->quota;
                $attainment = $quota > 0 ? round(((float) $row->actual / $quota) * 100, 1) : 0.0;

                return [
                    'id' => $row->id,
                    'rep' => $row->employee->full_name ?? 'Unassigned',
                    'territory' => $row->territory ?? '—',
                    'quota' => $quota,
                    'actual' => (float) $row->actual,
                    'attainment' => $attainment,
                    'deals' => (int) $row->deals,
                    'commissionRate' => (float) $row->commission_rate,
                    'commission' => (float) $row->commission,
                    'status' => match (true) {
                        $attainment >= 100 => 'Achieved',
                        $attainment >= 85 => 'On Track',
                        $attainment >= 65 => 'At Risk',
                        default => 'Behind',
                    },
                ];
            })
            ->all();
    }

    /**
     * The headline tiles.
     *
     * `onTimeDelivery` is null rather than zero when nothing has been delivered
     * with both a promised and an actual date — an empty system has no record,
     * and showing 0% would read as a failure that never happened.
     */
    private function kpis(Collection $orders, array $trend, array $pipeline, CarbonImmutable $now): array
    {
        $thisMonth = $trend[count($trend) - 1];
        $lastMonth = $trend[count($trend) - 2] ?? ['revenue' => 0.0];

        $won = Lead::where('stage', 'Closed Won')->count();
        $lost = Lead::where('stage', 'Closed Lost')->count();

        $revenue = $orders->sum('total');

        return [
            'revenueMtd' => $thisMonth['revenue'],
            'revenueChange' => $lastMonth['revenue'] > 0
                ? round((($thisMonth['revenue'] - $lastMonth['revenue']) / $lastMonth['revenue']) * 100, 1)
                : 0.0,
            'grossMargin' => $thisMonth['revenue'] > 0
                ? round(($thisMonth['grossProfit'] / $thisMonth['revenue']) * 100, 1)
                : 0.0,
            'openPipeline' => round(array_sum(array_column($pipeline, 'value')), 2),
            'openOpportunities' => array_sum(array_column($pipeline, 'count')),
            'weightedForecast' => round(array_sum(array_column($pipeline, 'weighted')), 2),
            'winRate' => $won + $lost > 0 ? round(($won / ($won + $lost)) * 100, 1) : 0.0,
            'avgOrderValue' => $orders->count() > 0 ? round($revenue / $orders->count(), 2) : 0.0,
            'activeCustomers' => Customer::where('status', 'Active')->count(),
            'openQuotes' => Quotation::whereIn('status', ['Draft', 'Submitted', 'Approved'])->count(),
            'ordersThisMonth' => $thisMonth['orders'],
            'onTimeDelivery' => $this->onTimeDelivery(),
            'periodRevenue' => round($revenue, 2),
        ];
    }

    /**
     * One customer's trading history.
     *
     * Answers the questions someone actually asks before picking up the phone:
     * how much have they bought, are they buying more or less than they were,
     * what do they buy, and are they paying. Drafts are shown in the order list
     * — a pending order is worth knowing about — but excluded from the spend
     * totals, because a draft has not sold anything.
     */
    public function customerHistory(Customer $customer): array
    {
        $orders = SalesOrder::query()
            ->where('customer_id', $customer->id)
            ->with('warehouse')
            ->orderByDesc('order_date')
            ->orderByDesc('id')
            ->get();

        $billed = $orders->reject(fn (SalesOrder $o) => in_array($o->status, self::DEAD_ORDER_STATES, true));

        $spend = round($billed->sum(fn (SalesOrder $o) => (float) $o->total), 2);
        $cost = round($billed->sum(fn (SalesOrder $o) => (float) $o->cost_total), 2);

        $returns = SalesReturn::where('customer_id', $customer->id)->get(['amount', 'quantity']);

        return [
            'summary' => [
                'orders' => $billed->count(),
                'draftOrders' => $orders->count() - $billed->count(),
                'spend' => $spend,
                'cost' => $cost,
                'grossProfit' => round($spend - $cost, 2),
                'marginPct' => $spend > 0 ? round((($spend - $cost) / $spend) * 100, 1) : 0.0,
                'avgOrderValue' => $billed->count() > 0 ? round($spend / $billed->count(), 2) : 0.0,
                'firstOrder' => $billed->min('order_date')?->format('Y-m-d'),
                'lastOrder' => $billed->max('order_date')?->format('Y-m-d'),
                'returnsValue' => round($returns->sum(fn ($r) => (float) $r->amount), 2),
                'returnsCount' => $returns->count(),
                'balance' => (float) $customer->balance,
                'creditLimit' => (float) $customer->credit_limit,
                'creditUsedPct' => (float) $customer->credit_limit > 0
                    ? round(((float) $customer->balance / (float) $customer->credit_limit) * 100, 1)
                    : null,
            ],
            'monthly' => $this->customerMonthly($billed),
            'orders' => $orders->map(fn (SalesOrder $o) => [
                'id' => $o->id,
                'no' => $o->order_no,
                'date' => $o->order_date?->format('Y-m-d'),
                'promisedDate' => $o->promised_date?->format('Y-m-d'),
                'warehouse' => $o->warehouse->name ?? '—',
                'amount' => (float) $o->total,
                'margin' => (float) $o->margin_pct,
                'fulfilled' => (int) $o->fulfilled_pct,
                'status' => $o->status,
            ])->all(),
            'items' => $this->customerItems($billed->pluck('id')->all()),
        ];
    }

    /** Spend by month over the trailing year, for the history sparkline. */
    private function customerMonthly(Collection $billed): array
    {
        $now = CarbonImmutable::now();
        $byMonth = $billed
            ->filter(fn (SalesOrder $o) => $o->order_date >= $now->startOfMonth()->subMonths(self::MONTHS - 1))
            ->groupBy(fn (SalesOrder $o) => CarbonImmutable::parse($o->order_date)->format('Y-m'));

        $months = [];
        for ($i = self::MONTHS - 1; $i >= 0; $i--) {
            $month = $now->startOfMonth()->subMonths($i);
            $rows = $byMonth->get($month->format('Y-m'), collect());
            $months[] = [
                'month' => $month->format('M'),
                'spend' => round($rows->sum(fn (SalesOrder $o) => (float) $o->total), 2),
            ];
        }

        return $months;
    }

    /**
     * What this customer actually buys, by value.
     *
     * @param  array<int, int>  $orderIds
     */
    private function customerItems(array $orderIds): array
    {
        if ($orderIds === []) {
            return [];
        }

        return SalesOrderLine::query()
            ->whereIn('sales_order_lines.sales_order_id', $orderIds)
            ->join('items', 'items.id', '=', 'sales_order_lines.item_id')
            ->get([
                'items.sku',
                'items.name',
                'sales_order_lines.quantity',
                'sales_order_lines.line_total',
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

    /** Share of completed deliveries that arrived on or before the promise. */
    private function onTimeDelivery(): ?float
    {
        $rows = Delivery::query()
            ->where('deliveries.status', 'Delivered')
            ->whereNotNull('deliveries.delivered_at')
            ->join('sales_orders', 'sales_orders.id', '=', 'deliveries.sales_order_id')
            ->whereNotNull('sales_orders.promised_date')
            ->get(['deliveries.delivered_at', 'sales_orders.promised_date']);

        if ($rows->isEmpty()) {
            return null;
        }

        $onTime = $rows->filter(
            fn ($row) => CarbonImmutable::parse($row->delivered_at)->startOfDay()
                <= CarbonImmutable::parse($row->promised_date)->startOfDay()
        )->count();

        return round(($onTime / $rows->count()) * 100, 1);
    }
}
