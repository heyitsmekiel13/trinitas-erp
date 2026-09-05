<?php

namespace App\Console\Commands;

use App\Models\Employee;
use App\Models\PerformanceReview;
use App\Services\HrAnalytics;
use App\Services\NotificationDispatcher;
use Illuminate\Console\Command;

/**
 * Six months on probation resolves itself under Philippine labor law — an
 * employee allowed to keep working past that mark without a decision is
 * regular whether or not anyone updated a system to say so. This is what
 * makes the system agree with the law automatically instead of an employee's
 * status quietly falling out of step with their actual legal standing.
 *
 * The one case it refuses to decide on its own: a recent review rated
 * Unsatisfactory or Needs Improvement. Auto-regularising past a documented
 * performance problem would be reckless, and so would silently ending a
 * contract nobody in HR has looked at — so that case is flagged for a human
 * decision (regularise anyway, extend, or End of Contract via Offboarding)
 * rather than acted on either way.
 *
 *   php artisan hr:regularization-check
 */
class RegularizationCheck extends Command
{
    protected $signature = 'hr:regularization-check';

    protected $description = 'Auto-regularises probationary employees past six months, or flags them for HR if a recent review holds them back';

    public function handle(NotificationDispatcher $dispatcher): int
    {
        $due = Employee::where('employment_status', HrAnalytics::STATUS_PROBATION)
            ->whereNotNull('date_hired')
            ->whereDate('date_hired', '<=', now()->subMonths(6)->toDateString())
            ->with('position')
            ->get();

        if ($due->isEmpty()) {
            $this->info('Nobody due.');

            return self::SUCCESS;
        }

        $flagged = [];
        $regularized = 0;

        foreach ($due as $employee) {
            $poorReview = PerformanceReview::where('employee_id', $employee->id)
                ->where('status', 'Completed')
                ->whereIn('rating', ['Unsatisfactory', 'Needs Improvement'])
                ->where('updated_at', '>=', now()->subDays(60))
                ->latest('updated_at')
                ->first();

            if ($poorReview) {
                $flagged[] = [
                    'employee' => $employee->full_name,
                    'employeeNo' => $employee->employee_no,
                    'hired' => optional($employee->date_hired)->toDateString(),
                    'rating' => $poorReview->rating,
                ];

                continue;
            }

            $employee->update(['employment_status' => HrAnalytics::STATUS_REGULAR]);
            $regularized++;

            if ($employee->email) {
                $dispatcher->dispatchDirect(
                    event: 'hr.regularization-auto',
                    to: $employee->email,
                    subject: 'You are now a regular employee',
                    view: 'emails.regularization-auto',
                    data: [
                        'employee' => $employee,
                        'position' => $employee->position->title ?? null,
                        'regularizedOn' => now()->format('j F Y'),
                    ],
                    referenceType: 'Employee',
                    referenceId: $employee->id,
                );
            }
        }

        if ($flagged !== []) {
            $dispatcher->dispatch(
                event: 'hr.regularization-review-needed',
                subject: count($flagged).' regularisation decision(s) needed',
                view: 'emails.regularization-review-needed',
                data: ['rows' => $flagged],
            );
        }

        $this->info(sprintf('%d regularised · %d flagged for HR review.', $regularized, count($flagged)));

        return self::SUCCESS;
    }
}
