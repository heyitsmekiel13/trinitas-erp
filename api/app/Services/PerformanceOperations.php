<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\PerformanceReview;
use Carbon\CarbonImmutable;

/**
 * Performance reviews: the cycle, and the rating that comes out of it.
 *
 * Two things were missing and both mattered.
 *
 * The rating was a free-text band sitting next to a score, with nothing
 * connecting them — so a 4.8 could be filed as "Needs Improvement" and the
 * system would keep it. The band is now derived from the score at the moment
 * the review is completed, which is the only way the two can agree.
 *
 * And a review moved through its stages by somebody typing the next status.
 * The cycle now advances one step at a time, so a review cannot be completed
 * without having been scored, and an employee sees their own result rather
 * than hearing about it second-hand.
 */
class PerformanceOperations
{
    /** The cycle, in order. */
    public const STAGES = [
        'Not Started',
        'Self-Assessment',
        'Manager Review',
        'Calibration',
        'Completed',
    ];

    /**
     * Score bands.
     *
     * Read as "at least this score earns this band", highest first. Kept in
     * one place so a rating printed on a review, shown on a dashboard and used
     * in a calibration all mean the same thing.
     */
    public const BANDS = [
        ['from' => 4.5, 'rating' => 'Outstanding'],
        ['from' => 3.5, 'rating' => 'Exceeds Expectations'],
        ['from' => 2.5, 'rating' => 'Meets Expectations'],
        ['from' => 1.5, 'rating' => 'Needs Improvement'],
        ['from' => 0.0, 'rating' => 'Unsatisfactory'],
    ];

    /** The band a score falls in. Null in, null out — an unscored review has no rating. */
    public function ratingFor(?float $score): ?string
    {
        if ($score === null) {
            return null;
        }

        foreach (self::BANDS as $band) {
            if ($score >= $band['from']) {
                return $band['rating'];
            }
        }

        return 'Unsatisfactory';
    }

    /**
     * Which stages this review may move to next.
     *
     * @return list<string>
     */
    public function allowedMoves(PerformanceReview $review): array
    {
        $index = array_search($review->status, self::STAGES, true);

        if ($index === false || $review->status === 'Completed') {
            return [];
        }

        $moves = [];

        $next = self::STAGES[$index + 1] ?? null;
        if ($next !== null) {
            $moves[] = $next;
        }

        if ($index > 0) {
            $moves[] = self::STAGES[$index - 1];
        }

        return $moves;
    }

    /**
     * Advances the review.
     *
     * Completing requires a score, because completing without one produces a
     * review with no rating — a record that says an assessment happened and
     * cannot say what it concluded.
     *
     * @throws \RuntimeException
     */
    public function moveTo(PerformanceReview $review, string $status): PerformanceReview
    {
        if (! in_array($status, $this->allowedMoves($review), true)) {
            throw new \RuntimeException(
                $review->status === 'Completed'
                    ? 'This review is already complete.'
                    : "A review at {$review->status} cannot move straight to {$status}.",
            );
        }

        if ($status === 'Completed' && $review->score === null) {
            throw new \RuntimeException('Score the review before completing it.');
        }

        $review->update([
            'status' => $status,
            // The band is settled when the review closes, from the score on it.
            'rating' => $status === 'Completed'
                ? $this->ratingFor((float) $review->score)
                : $review->rating,
        ]);

        return $review->fresh();
    }

    /** Records the score and, where already completed, re-derives the band. */
    public function score(PerformanceReview $review, float $score, ?string $strengths, ?string $developmentAreas): PerformanceReview
    {
        $review->update([
            'score' => $score,
            'strengths' => $strengths ?? $review->strengths,
            'development_areas' => $developmentAreas ?? $review->development_areas,
            'rating' => $review->status === 'Completed' ? $this->ratingFor($score) : $review->rating,
        ]);

        return $review->fresh();
    }

    /**
     * An employee's own reviews.
     *
     * Only completed ones carry a rating: telling somebody their draft score
     * mid-calibration is how a review process loses its credibility.
     */
    public function reviewsFor(Employee $employee): array
    {
        return PerformanceReview::query()
            ->with('reviewer')
            ->where('employee_id', $employee->id)
            ->orderByDesc('due_date')
            ->limit(12)
            ->get()
            ->map(function (PerformanceReview $r) {
                $done = $r->status === 'Completed';

                return [
                    'id' => $r->id,
                    'period' => $r->period,
                    'reviewer' => $r->reviewer->full_name ?? null,
                    'dueDate' => optional($r->due_date)->toDateString(),
                    'status' => $r->status,
                    // Withheld until the cycle closes — see above.
                    'score' => $done && $r->score !== null ? (float) $r->score : null,
                    'rating' => $done ? $r->rating : null,
                    'strengths' => $done ? $r->strengths : null,
                    'developmentAreas' => $done ? $r->development_areas : null,
                ];
            })
            ->all();
    }

    /**
     * Opens a review cycle for a whole population in one step.
     *
     * Reviews were creatable only one at a time, employee by employee, with
     * the reviewer looked up and keyed by hand each time. For a hundred-odd
     * staff that is several hours of transcription whose only output is a row
     * the system could have written itself — and every one of those lookups is
     * a chance to point a review at the wrong manager.
     *
     * So the cycle is opened for a department or for everyone, the reviewer is
     * taken from the reporting line already on the 201 file, and anybody who
     * already has a review for the period is skipped rather than duplicated.
     * Re-running it is therefore safe: it only fills the gaps, which is what
     * you want when somebody joins mid-cycle.
     *
     * @return array{created: int, skipped: int, noReviewer: int, period: string}
     */
    public function openCycle(string $period, ?string $dueDate, ?int $departmentId): array
    {
        $employees = Employee::query()
            ->whereNull('date_separated')
            ->when($departmentId, fn ($q, $id) => $q->where('hr_department_id', $id))
            ->get(['id', 'reports_to_id']);

        // One query rather than one per employee: on a full-company cycle the
        // per-row existence check was the whole cost of the operation.
        $existing = PerformanceReview::query()
            ->where('period', $period)
            ->pluck('employee_id')
            ->all();
        $existing = array_flip($existing);

        $created = 0;
        $skipped = 0;
        $noReviewer = 0;
        $rows = [];
        $now = CarbonImmutable::now();

        foreach ($employees as $employee) {
            if (isset($existing[$employee->id])) {
                $skipped++;

                continue;
            }

            // A review with nobody to conduct it is still worth creating — it
            // is the reporting-line gap made visible, and HR can assign one.
            // Silently skipping these is how people go unreviewed for a year.
            if (! $employee->reports_to_id) {
                $noReviewer++;
            }

            $rows[] = [
                'employee_id' => $employee->id,
                'period' => $period,
                'reviewer_id' => $employee->reports_to_id,
                'due_date' => $dueDate,
                'status' => 'Not Started',
                'score' => null,
                'rating' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            $created++;
        }

        foreach (array_chunk($rows, 500) as $chunk) {
            PerformanceReview::insert($chunk);
        }

        return [
            'created' => $created,
            'skipped' => $skipped,
            'noReviewer' => $noReviewer,
            'period' => $period,
        ];
    }

    /** Cycle health, for the HR dashboard. */
    public function summary(): array
    {
        $reviews = PerformanceReview::query()->get();
        $today = CarbonImmutable::now();

        $completed = $reviews->where('status', 'Completed');

        return [
            'total' => $reviews->count(),
            'completed' => $completed->count(),
            'inProgress' => $reviews->whereNotIn('status', ['Completed', 'Not Started'])->count(),
            'notStarted' => $reviews->where('status', 'Not Started')->count(),
            'overdue' => $reviews
                ->where('status', '!=', 'Completed')
                ->filter(fn (PerformanceReview $r) => $r->due_date && CarbonImmutable::parse($r->due_date)->lt($today))
                ->count(),
            'averageScore' => $completed->whereNotNull('score')->avg('score')
                ? round((float) $completed->whereNotNull('score')->avg('score'), 2)
                : null,
            'byRating' => collect(self::BANDS)
                ->pluck('rating')
                ->mapWithKeys(fn ($band) => [$band => $completed->where('rating', $band)->count()])
                ->all(),
        ];
    }
}
