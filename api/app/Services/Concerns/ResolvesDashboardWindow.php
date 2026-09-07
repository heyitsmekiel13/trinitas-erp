<?php

namespace App\Services\Concerns;

use Carbon\CarbonImmutable;

/**
 * The reporting window every dashboard's "Period" + "Bucket" filter resolves
 * to, shared so a preset means the same date range and a window of the same
 * length always buckets the same way, in every module. Extracted from the
 * HR dashboard, which was the first to move this off the browser: a named
 * period goes in, and the window, its label, its bucket size and the
 * equivalent window immediately before it all come back from one place,
 * so the caption above a chart and the numbers in it cannot disagree.
 */
trait ResolvesDashboardWindow
{
    /** Reporting periods, in the order they are offered. */
    public const WINDOW_PERIODS = ['today', 'wtd', 'mtd', 'last_month', 'qtd', 'ytd', 'last_12m', 'all', 'custom'];

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable, 2: string, 3: string, 4: CarbonImmutable, 5: CarbonImmutable}
     *   [start, end, grain, label, priorStart, priorEnd]
     */
    private function resolveWindow(
        string $period,
        ?string $from,
        ?string $to,
        ?string $grain,
        CarbonImmutable $now,
        \Closure $earliest,
    ): array {
        [$start, $end] = $this->windowBounds($period, $from, $to, $now, $earliest);
        $grain = $grain && in_array($grain, ['day', 'month', 'year'], true)
            ? $grain
            : $this->windowGrainFor($start, $end);

        $span = $start->diffInDays($end);
        $priorEnd = $start->subDay();
        $priorStart = $priorEnd->subDays($span);

        return [$start, $end, $grain, $this->windowLabel($period, $start, $end), $priorStart, $priorEnd];
    }

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} */
    private function windowBounds(string $period, ?string $from, ?string $to, CarbonImmutable $now, \Closure $earliest): array
    {
        $today = $now->startOfDay();

        return match ($period) {
            'today' => [$today, $today],
            'wtd' => [$today->startOfWeek(), $today],
            'mtd' => [$today->startOfMonth(), $today],
            'last_month' => [$today->subMonth()->startOfMonth(), $today->subMonth()->endOfMonth()],
            'qtd' => [$today->startOfQuarter(), $today],
            'ytd' => [$today->startOfYear(), $today],
            'last_12m' => [$today->subMonths(11)->startOfMonth(), $today],
            'all' => [$earliest($now), $today],
            default => [
                $from ? CarbonImmutable::parse($from)->startOfDay() : $today->subMonths(11)->startOfMonth(),
                $to ? CarbonImmutable::parse($to)->startOfDay() : $today,
            ],
        };
    }

    /**
     * How finely to bucket a window, chosen from its length so a year never
     * renders as 365 unreadable columns and a single week never renders as
     * one. Overridable by an explicit `grain`.
     */
    private function windowGrainFor(CarbonImmutable $start, CarbonImmutable $end): string
    {
        $days = $start->diffInDays($end);

        return match (true) {
            $days <= 62 => 'day',
            $days <= 1100 => 'month',
            default => 'year',
        };
    }

    private function windowLabel(string $period, CarbonImmutable $start, CarbonImmutable $end): string
    {
        return match ($period) {
            'today' => 'Today, '.$start->format('j M Y'),
            'wtd' => 'Week to date',
            'mtd' => $start->format('F Y').' to date',
            'last_month' => $start->format('F Y'),
            'qtd' => 'Q'.$start->quarter.' '.$start->year.' to date',
            'ytd' => $start->year.' to date',
            'last_12m' => 'Last 12 months',
            'all' => 'All time (from '.$start->format('M Y').')',
            default => $start->format('j M Y').' – '.$end->format('j M Y'),
        };
    }

    private function windowFloorTo(string $grain, CarbonImmutable $date): CarbonImmutable
    {
        return match ($grain) {
            'day' => $date->startOfDay(),
            'year' => $date->startOfYear(),
            default => $date->startOfMonth(),
        };
    }

    /** Steps a cursor forward one bucket at $grain, formatted as its bucket key and chart label. */
    private function windowBucketKey(string $grain, CarbonImmutable $cursor): string
    {
        return $cursor->format(match ($grain) {
            'day' => 'Y-m-d',
            'year' => 'Y',
            default => 'Y-m',
        });
    }

    private function windowBucketLabel(string $grain, CarbonImmutable $cursor): string
    {
        return $cursor->format(match ($grain) {
            'day' => 'j M',
            'year' => 'Y',
            default => 'M Y',
        });
    }

    private function windowBucketEnd(string $grain, CarbonImmutable $cursor): CarbonImmutable
    {
        return match ($grain) {
            'day' => $cursor->endOfDay(),
            'year' => $cursor->endOfYear(),
            default => $cursor->endOfMonth(),
        };
    }

    /** The SQL `DATE_FORMAT` mask and step method for grouping a query by bucket. */
    private function windowSqlFormat(string $grain): string
    {
        return match ($grain) {
            'day' => '%Y-%m-%d',
            'year' => '%Y',
            default => '%Y-%m',
        };
    }

    private function windowStep(CarbonImmutable $cursor, string $grain): CarbonImmutable
    {
        return match ($grain) {
            'day' => $cursor->addDay(),
            'year' => $cursor->addYear(),
            default => $cursor->addMonth(),
        };
    }
}
