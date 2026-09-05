<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskActivity;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Whether the process is getting better, rather than how bad today is.
 *
 * The compliance register answers "what is wrong right now": twenty-three
 * things are late, four deadlines have moved. Useful, and not enough — a
 * process office whose only instrument is a snapshot cannot tell an
 * improvement from a quiet week, and every figure it publishes is arguable
 * because there is nothing to compare it against.
 *
 * These are the four measures that settle that argument, and none of them
 * existed:
 *
 *   - Cycle time: raised to finished. Falling means the machine is faster.
 *   - Lead time: the same thing measured from when somebody actually started,
 *     which separates "we are slow" from "it sat in a queue for a fortnight".
 *   - Throughput: how much finishes per week. Capacity, in plain terms.
 *   - Flow: how much sits in each column over time. Where work piles up.
 *
 * Percentiles rather than averages throughout. One task that took ninety days
 * drags a mean far enough to make it useless, and the honest promise a team
 * can make is not "about six days" but "eight days, five times out of six" —
 * which is what the 85th percentile says.
 */
class ProcessMetrics
{
    public function __construct(private readonly WorkingCalendar $calendar) {}

    /* ------------------------------ Cycle time ----------------------------- */

    /**
     * How long finished work took, over a window.
     *
     * @return array{count:int, median:?float, p85:?float, p95:?float, fastest:?int, slowest:?int, distribution:array}
     */
    public function cycleTime(int $days = 90): array
    {
        $tasks = Task::query()
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', now()->subDays($days))
            ->get(['id', 'created_at', 'completed_at']);

        $values = $tasks
            ->map(fn (Task $t) => $this->calendar->workingDaysBetween($t->created_at, $t->completed_at))
            ->filter(fn ($v) => $v >= 0)
            ->values();

        return $this->describe($values) + ['distribution' => $this->bands($values)];
    }

    /**
     * The same, from first movement rather than from creation.
     *
     * The gap between this and cycle time is queue time — work that existed
     * but nobody had picked up. A team whose cycle time is bad and whose lead
     * time is fine does not have a speed problem, it has a backlog problem,
     * and those need opposite responses.
     */
    public function leadTime(int $days = 90): array
    {
        $tasks = Task::query()
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', now()->subDays($days))
            ->get(['id', 'created_at', 'completed_at']);

        if ($tasks->isEmpty()) {
            return $this->describe(collect());
        }

        // The first time each task moved column, which is the closest thing to
        // "somebody started it" that the trail records.
        $started = TaskActivity::query()
            ->whereIn('task_id', $tasks->pluck('id'))
            ->where('action', 'moved the task')
            ->selectRaw('task_id, MIN(occurred_at) as started_at')
            ->groupBy('task_id')
            ->pluck('started_at', 'task_id');

        $values = $tasks
            ->map(function (Task $t) use ($started) {
                $from = $started->get($t->id);

                return $from
                    ? $this->calendar->workingDaysBetween(Carbon::parse($from), $t->completed_at)
                    : null;
            })
            ->filter(fn ($v) => $v !== null && $v >= 0)
            ->values();

        return $this->describe($values);
    }

    /* ------------------------------ Throughput ----------------------------- */

    /**
     * Tasks finished per week.
     *
     * Weeks rather than days because daily throughput on a team of this size is
     * mostly noise about which afternoon somebody closed three things.
     *
     * @return array<int, array{name:string, value:int}>
     */
    public function throughput(int $weeks = 12): array
    {
        $since = now()->subWeeks($weeks)->startOfWeek();

        $rows = Task::query()
            ->whereNotNull('completed_at')
            ->where('completed_at', '>=', $since)
            ->get(['completed_at'])
            ->groupBy(fn (Task $t) => $t->completed_at->startOfWeek()->toDateString())
            ->map->count();

        $series = [];
        $cursor = $since->copy();

        // Every week in the window, including the empty ones — a gap in a
        // throughput chart reads as "no data", and zero is data.
        while ($cursor->lessThanOrEqualTo(now())) {
            $key = $cursor->toDateString();
            $series[] = ['name' => $cursor->format('j M'), 'value' => (int) ($rows[$key] ?? 0)];
            $cursor = $cursor->addWeek();
        }

        return $series;
    }

    /* --------------------------------- Flow -------------------------------- */

    /**
     * Where work sat, day by day.
     *
     * A cumulative flow diagram: one band per column, stacked. A band that
     * widens over time is a queue forming, and it is visible weeks before the
     * overdue count reacts — which is the whole reason to look at flow rather
     * than at lateness.
     *
     * Reconstructed from the activity trail rather than stored daily, so it
     * works on history that predates anybody thinking to record it.
     *
     * @return array{sections: array<int,string>, series: array}
     */
    public function cumulativeFlow(int $days = 30): array
    {
        $tasks = Task::query()
            ->with('section:id,name')
            ->where(function ($q) use ($days) {
                $q->whereNull('completed_at')->orWhere('completed_at', '>=', now()->subDays($days));
            })
            ->get(['id', 'section_id', 'created_at', 'completed_at']);

        if ($tasks->isEmpty()) {
            return ['sections' => [], 'series' => []];
        }

        $moves = TaskActivity::query()
            ->whereIn('task_id', $tasks->pluck('id'))
            ->where('field', 'section')
            ->orderBy('occurred_at')
            ->get(['task_id', 'to_value', 'occurred_at']);

        $sections = $tasks->pluck('section.name')->filter()
            ->merge($moves->pluck('to_value')->filter())
            ->unique()->values();

        $series = [];

        for ($offset = $days; $offset >= 0; $offset--) {
            $day = now()->subDays($offset)->endOfDay();
            $counts = array_fill_keys($sections->all(), 0);

            foreach ($tasks as $task) {
                if ($task->created_at->greaterThan($day)) {
                    continue;
                }

                if ($task->completed_at && $task->completed_at->lessThan($day)) {
                    continue;
                }

                // The last column it had moved into by that day, falling back
                // to where it sits now for a task that has never moved.
                $where = $moves
                    ->where('task_id', $task->id)
                    ->filter(fn ($m) => Carbon::parse($m->occurred_at)->lessThanOrEqualTo($day))
                    ->last()?->to_value ?? $task->section?->name;

                if ($where && array_key_exists($where, $counts)) {
                    $counts[$where]++;
                }
            }

            $series[] = ['label' => $day->format('j M')] + $counts;
        }

        return ['sections' => $sections->all(), 'series' => $series];
    }

    /* -------------------------------- Trend -------------------------------- */

    /**
     * On-time delivery, month by month.
     *
     * The figure the dashboard already showed for the current month, given a
     * history — so "82%" can be read as recovering or sliding rather than as a
     * number with no context.
     *
     * @return array<int, array{name:string, onTime:int, late:int, value:?float}>
     */
    public function onTimeTrend(int $months = 6): array
    {
        $since = now()->subMonths($months - 1)->startOfMonth();

        $tasks = Task::query()
            ->whereNotNull('completed_at')
            ->whereNotNull('due_date')
            ->where('completed_at', '>=', $since)
            ->get(['due_date', 'completed_at', 'assignee_id']);

        $series = [];
        $cursor = $since->copy();

        while ($cursor->lessThanOrEqualTo(now())) {
            $month = $cursor->format('Y-m');

            $inMonth = $tasks->filter(fn (Task $t) => $t->completed_at->format('Y-m') === $month);

            $onTime = $inMonth->filter(
                fn (Task $t) => $this->calendar->workingDaysBetween($t->due_date, $t->completed_at) <= 0
            )->count();

            $series[] = [
                'name' => $cursor->format('M Y'),
                'onTime' => $onTime,
                'late' => $inMonth->count() - $onTime,
                'value' => $inMonth->count() > 0 ? round(($onTime / $inMonth->count()) * 100, 1) : null,
            ];

            $cursor = $cursor->addMonth();
        }

        return $series;
    }

    /* -------------------------------- Shaping ------------------------------- */

    /**
     * Percentiles for a set of durations.
     *
     * @param  Collection<int, int>  $values
     */
    private function describe(Collection $values): array
    {
        if ($values->isEmpty()) {
            return ['count' => 0, 'median' => null, 'p85' => null, 'p95' => null, 'fastest' => null, 'slowest' => null];
        }

        $sorted = $values->sort()->values();

        return [
            'count' => $sorted->count(),
            'median' => $this->percentile($sorted, 50),
            // The number a team can actually promise on: right five times in six.
            'p85' => $this->percentile($sorted, 85),
            'p95' => $this->percentile($sorted, 95),
            'fastest' => (int) $sorted->first(),
            'slowest' => (int) $sorted->last(),
        ];
    }

    /** @param Collection<int, int> $sorted */
    private function percentile(Collection $sorted, int $p): float
    {
        $index = ($p / 100) * ($sorted->count() - 1);
        $low = (int) floor($index);
        $high = (int) ceil($index);

        if ($low === $high) {
            return round((float) $sorted[$low], 1);
        }

        // Interpolated, so a set of four values does not report the same
        // number for the 50th and the 85th percentile.
        return round($sorted[$low] + (($sorted[$high] - $sorted[$low]) * ($index - $low)), 1);
    }

    /**
     * Cycle times in bands, for a histogram.
     *
     * @param  Collection<int, int>  $values
     */
    private function bands(Collection $values): array
    {
        $bands = ['Same day' => 0, '1–2 days' => 0, '3–5 days' => 0, '1–2 weeks' => 0, '2–4 weeks' => 0, 'Over a month' => 0];

        foreach ($values as $value) {
            $key = match (true) {
                $value <= 0 => 'Same day',
                $value <= 2 => '1–2 days',
                $value <= 5 => '3–5 days',
                $value <= 10 => '1–2 weeks',
                $value <= 20 => '2–4 weeks',
                default => 'Over a month',
            };

            $bands[$key]++;
        }

        return collect($bands)->map(fn ($v, $k) => ['name' => $k, 'value' => $v])->values()->all();
    }
}
