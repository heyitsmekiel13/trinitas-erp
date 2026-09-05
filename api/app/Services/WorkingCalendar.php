<?php

namespace App\Services;

use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * What counts as a working day, and for whom.
 *
 * This exists because the two halves of "late" disagreed. A due date was
 * derived by counting working days forward, and lateness was then measured in
 * calendar days — so work due on a Friday and delivered on the Monday reported
 * three days late when one working day had passed. Every overdue figure,
 * ageing band, scorecard and verdict inherited the error.
 *
 * Weekends were handled and public holidays were not, despite the HR module
 * already owning a holidays table. A five-day deadline raised before Christmas
 * came out roughly two days short.
 *
 * The third thing it knows is leave. A person on approved leave was being
 * chased daily and escalated to their manager on the third day, for a deadline
 * they were not at work to meet. HR holds that fact; nothing in the process
 * office was reading it.
 *
 * Everything is cached per request. A compliance scan asks about the same
 * hundred dates thousands of times, and a query per question turns a two
 * second job into a two minute one.
 */
class WorkingCalendar
{
    /** @var array<string, bool>|null Holiday dates, keyed Y-m-d. */
    private ?array $holidays = null;

    /** @var array<int, array<string, bool>> Leave days per employee id. */
    private array $leave = [];

    /* ------------------------------- Holidays ------------------------------ */

    /**
     * Every holiday on file, as a lookup.
     *
     * Branch-specific holidays are treated as company-wide. Splitting the
     * calendar per branch is defensible, but a task is not attached to a
     * branch — the assignee is — and quietly picking one branch's calendar for
     * a shared project would be worse than treating a local holiday as a day
     * nobody is expected to deliver on.
     *
     * @return array<string, bool>
     */
    private function holidays(): array
    {
        return $this->holidays ??= Holiday::query()
            ->pluck('holiday_date')
            ->mapWithKeys(fn ($date) => [Carbon::parse($date)->toDateString() => true])
            ->all();
    }

    public function isHoliday(Carbon|CarbonImmutable|string $date): bool
    {
        return isset($this->holidays()[$this->key($date)]);
    }

    public function isWorkingDay(Carbon|CarbonImmutable|string $date): bool
    {
        $day = Carbon::parse($this->key($date));

        return ! $day->isWeekend() && ! $this->isHoliday($day);
    }

    /* ------------------------------ Arithmetic ----------------------------- */

    /**
     * The date `$days` working days after `$from`.
     *
     * Zero returns the start date itself rather than the next working day —
     * "due today" has to remain expressible.
     */
    public function addWorkingDays(Carbon|CarbonImmutable|string $from, int $days): Carbon
    {
        $date = Carbon::parse($this->key($from));

        if ($days < 1) {
            return $date;
        }

        $added = 0;
        // Bounded so a pathological holiday table cannot hang a request.
        $guard = 0;

        while ($added < $days && $guard++ < 3650) {
            $date = $date->addDay();

            if ($this->isWorkingDay($date)) {
                $added++;
            }
        }

        return $date;
    }

    /**
     * Working days between two dates, signed.
     *
     * Negative means `$to` is before `$from` — which is how "two days early"
     * is expressed. The start date is excluded and the end date included, so a
     * task due Friday and finished Friday is zero, and finished Monday is one.
     */
    public function workingDaysBetween(Carbon|CarbonImmutable|string $from, Carbon|CarbonImmutable|string $to): int
    {
        $start = Carbon::parse($this->key($from));
        $end = Carbon::parse($this->key($to));

        if ($start->equalTo($end)) {
            return 0;
        }

        $backwards = $end->lessThan($start);

        if ($backwards) {
            [$start, $end] = [$end, $start];
        }

        $days = 0;
        $cursor = $start->copy();
        $guard = 0;

        while ($cursor->lessThan($end) && $guard++ < 3650) {
            $cursor = $cursor->addDay();

            if ($this->isWorkingDay($cursor)) {
                $days++;
            }
        }

        return $backwards ? -$days : $days;
    }

    /* -------------------------------- Leave -------------------------------- */

    /**
     * Days an employee is on approved leave, as a lookup.
     *
     * Only approved leave counts. A filed-but-undecided request is not yet a
     * reason to stop chasing a deadline — if it were, filing leave would be a
     * way to silence a reminder.
     *
     * @return array<string, bool>
     */
    private function leaveDays(int $employeeId): array
    {
        return $this->leave[$employeeId] ??= LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->where('status', 'Approved')
            ->where('end_date', '>=', now()->subYear()->toDateString())
            ->get(['start_date', 'end_date'])
            ->flatMap(function ($row) {
                $days = [];
                $cursor = Carbon::parse($row->start_date);
                $end = Carbon::parse($row->end_date);
                $guard = 0;

                while ($cursor->lessThanOrEqualTo($end) && $guard++ < 400) {
                    $days[$cursor->toDateString()] = true;
                    $cursor = $cursor->addDay();
                }

                return $days;
            })
            ->all();
    }

    /** Whether this person is away on a given day. */
    public function isOnLeave(?User $user, Carbon|CarbonImmutable|string|null $date = null): bool
    {
        $employeeId = $user?->employee_id;

        if (! $employeeId) {
            return false;
        }

        return isset($this->leaveDays($employeeId)[$this->key($date ?? now())]);
    }

    /**
     * Everyone away today, as user ids.
     *
     * One query for the whole company rather than one per person, because the
     * workload screen asks this about forty people at once.
     *
     * @return Collection<int, int>
     */
    public function awayToday(): Collection
    {
        $today = now()->toDateString();

        return LeaveRequest::query()
            ->where('status', 'Approved')
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->join('users', 'users.employee_id', '=', 'leave_requests.employee_id')
            ->pluck('users.id');
    }

    /**
     * Working days a person was on leave inside a window.
     *
     * Used to pause an SLA: a deadline should not consume somebody's annual
     * leave, and a task that sat over a week off is not two weeks late.
     */
    public function leaveDaysBetween(?User $user, Carbon|CarbonImmutable|string $from, Carbon|CarbonImmutable|string $to): int
    {
        $employeeId = $user?->employee_id;

        if (! $employeeId) {
            return 0;
        }

        $days = $this->leaveDays($employeeId);

        if ($days === []) {
            return 0;
        }

        $cursor = Carbon::parse($this->key($from));
        $end = Carbon::parse($this->key($to));
        $count = 0;
        $guard = 0;

        while ($cursor->lessThan($end) && $guard++ < 3650) {
            $cursor = $cursor->addDay();

            if ($this->isWorkingDay($cursor) && isset($days[$cursor->toDateString()])) {
                $count++;
            }
        }

        return $count;
    }

    /* -------------------------------- Detail ------------------------------- */

    private function key(Carbon|CarbonImmutable|string $date): string
    {
        return $date instanceof Carbon || $date instanceof CarbonImmutable
            ? $date->toDateString()
            : Carbon::parse($date)->toDateString();
    }

    /** Clears the per-request caches. For long-running commands. */
    public function flush(): void
    {
        $this->holidays = null;
        $this->leave = [];
    }
}
