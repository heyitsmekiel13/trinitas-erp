<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskRecurrence;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Raises the tasks that are supposed to exist again.
 *
 * A compliance office runs the same checks every month and had no way to say
 * so — somebody was going to copy a task by hand twelve times a year, or more
 * likely not do it in March and not notice until June.
 *
 * Two properties matter more than the scheduling arithmetic:
 *
 *   - It never raises the same occurrence twice. `last_run_on` is written in
 *     the same transaction as the task, and a rule whose next date is in the
 *     future is skipped — so a cron that fires twice, or a scan run by hand
 *     after one, produces nothing extra.
 *   - It never raises a backlog. A rule that has not run for three months
 *     produces one task, dated from today, not thirteen. Catching up on a
 *     missed monthly check by filling somebody's board with twelve overdue
 *     copies of it is not catching up.
 */
class RecurrenceRunner
{
    public function __construct(
        private readonly TaskService $tasks,
        private readonly WorkingCalendar $calendar,
    ) {}

    /**
     * Runs every rule that is due.
     *
     * @return array{raised: int, skipped: int, closed: int}
     */
    public function run(?Carbon $on = null): array
    {
        $today = ($on ?? now())->startOfDay();

        $raised = 0;
        $skipped = 0;
        $closed = 0;

        $rules = TaskRecurrence::query()
            ->where('is_active', true)
            ->where('starts_on', '<=', $today->toDateString())
            ->with('project', 'section')
            ->get();

        foreach ($rules as $rule) {
            // Past its end date: retire it rather than checking it for ever.
            if ($rule->ends_on && $rule->ends_on->lt($today)) {
                $rule->update(['is_active' => false, 'next_run_on' => null]);
                $closed++;

                continue;
            }

            $due = $rule->next_run_on ?? $this->firstRun($rule, $today);

            if ($due->gt($today)) {
                $rule->update(['next_run_on' => $due->toDateString()]);
                $skipped++;

                continue;
            }

            // Already produced something today; the guard that makes a second
            // run in the same day a no-op.
            if ($rule->last_run_on && $rule->last_run_on->toDateString() === $today->toDateString()) {
                $skipped++;

                continue;
            }

            $this->raise($rule, $today);
            $raised++;
        }

        return ['raised' => $raised, 'skipped' => $skipped, 'closed' => $closed];
    }

    /** Creates one occurrence and advances the rule. */
    private function raise(TaskRecurrence $rule, Carbon $today): void
    {
        DB::transaction(function () use ($rule, $today) {
            $creator = $rule->created_by ? User::find($rule->created_by) : null;

            $task = $this->tasks->createTask(
                $rule->project,
                [
                    'title' => $rule->title,
                    'description' => $rule->description,
                    'section_id' => $rule->section_id,
                    'priority' => $rule->priority,
                    'assignee_id' => $rule->assignee_id,
                    'estimate_hours' => $rule->estimate_hours,
                    // Its own date, from the rule — not the project SLA, which
                    // would make a daily check due in a week.
                    'due_date' => $this->calendar->addWorkingDays($today, max($rule->due_in_days, 0))->toDateString(),
                ],
                $creator ?? $rule->assignee ?? User::where('is_super_admin', true)->first(),
            );

            $task->forceFill(['recurrence_id' => $rule->id])->saveQuietly();

            $rule->update([
                'last_run_on' => $today->toDateString(),
                'next_run_on' => $this->nextAfter($rule, $today)->toDateString(),
                'times_raised' => $rule->times_raised + 1,
            ]);
        });
    }

    /* ------------------------------ Scheduling ------------------------------ */

    /** The first date a rule should fire on or after today. */
    private function firstRun(TaskRecurrence $rule, Carbon $today): Carbon
    {
        $from = $rule->starts_on->copy();

        return $from->gte($today) ? $from : $this->nextAfter($rule, $today->copy()->subDay());
    }

    /**
     * The next date after a given day.
     *
     * Everything lands on a working day. A month-end check that falls on a
     * Sunday is not a month-end check anybody will do, and a rule that quietly
     * generates weekend deadlines produces overdue flags for days nobody was
     * at work.
     */
    private function nextAfter(TaskRecurrence $rule, Carbon $after): Carbon
    {
        $date = match ($rule->frequency) {
            'Daily' => $this->calendar->addWorkingDays($after, 1),
            'Weekly' => $this->nextWeekday($after, $rule->weekday ?? 1, 1),
            'Fortnightly' => $this->nextWeekday($after, $rule->weekday ?? 1, 2),
            'Monthly' => $this->nextMonthly($after, $rule->day_of_month ?? 1),
            'Quarterly' => $this->nextQuarter($after),
            'Yearly' => $after->copy()->addYear()->startOfYear(),
            default => $after->copy()->addDay(),
        };

        // Nudge forward off a weekend or holiday rather than back, so a rule
        // never fires earlier than the date it names.
        $guard = 0;
        while (! $this->calendar->isWorkingDay($date) && $guard++ < 30) {
            $date = $date->addDay();
        }

        return $date;
    }

    private function nextWeekday(Carbon $after, int $weekday, int $everyWeeks): Carbon
    {
        $date = $after->copy()->addDay();

        $guard = 0;
        while ($date->dayOfWeekIso !== $weekday && $guard++ < 14) {
            $date = $date->addDay();
        }

        return $everyWeeks > 1 ? $date->addWeeks($everyWeeks - 1) : $date;
    }

    /**
     * Day zero means the last working day of the month.
     *
     * The comparison has to be made against the *resolved* date, not the raw
     * end of the month. An earlier version compared 31 August against a cursor
     * already sitting on the 28th — the last working day — decided it was
     * still in the future, and returned the 28th again. The preview showed the
     * same occurrence three times and the rule would never have advanced.
     */
    private function nextMonthly(Carbon $after, int $day): Carbon
    {
        $resolve = function (Carbon $month) use ($day): Carbon {
            if ($day !== 0) {
                return $month->copy()->startOfMonth()
                    ->addDays(min($day, $month->copy()->endOfMonth()->day) - 1);
            }

            // Walking back is the one place a date may move earlier: "the
            // 31st" on a Sunday means the Friday before it, not the Monday
            // after the month has already ended.
            $candidate = $month->copy()->endOfMonth();
            $guard = 0;

            while (! $this->calendar->isWorkingDay($candidate) && $guard++ < 10) {
                $candidate = $candidate->subDay();
            }

            return $candidate;
        };

        $candidate = $resolve($after);

        return $candidate->gt($after)
            ? $candidate
            : $resolve($after->copy()->addMonthNoOverflow()->startOfMonth());
    }

    private function nextQuarter(Carbon $after): Carbon
    {
        $quarterStart = $after->copy()->firstOfQuarter();

        return $quarterStart->lte($after) ? $after->copy()->addQuarterNoOverflow()->firstOfQuarter() : $quarterStart;
    }

    /* -------------------------------- Reading ------------------------------- */

    /** What a rule will do next, for a screen that has to explain itself. */
    public function preview(TaskRecurrence $rule, int $occurrences = 3): array
    {
        $dates = [];
        $cursor = $rule->next_run_on ?? $this->firstRun($rule, now()->startOfDay());

        for ($i = 0; $i < $occurrences; $i++) {
            if ($rule->ends_on && $cursor->gt($rule->ends_on)) {
                break;
            }

            $dates[] = [
                'raisedOn' => $cursor->toDateString(),
                'dueOn' => $this->calendar->addWorkingDays($cursor, max($rule->due_in_days, 0))->toDateString(),
            ];

            $cursor = $this->nextAfter($rule, $cursor);
        }

        return $dates;
    }
}
