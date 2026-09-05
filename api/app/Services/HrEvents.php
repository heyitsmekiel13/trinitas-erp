<?php

namespace App\Services;

use App\Models\Announcement;
use App\Models\Employee;
use App\Models\Holiday;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The company calendar HR actually cares about — who is turning up on a
 * birthday or hire anniversary this month, and what holiday is next —
 * merged into one list instead of three unrelated screens.
 *
 * Birthdays and anniversaries are computed, never stored: the source of
 * truth is still the 201 file's `birth_date`/`date_hired`, so an employee
 * edit never has to remember to update a second copy of the date anywhere.
 */
class HrEvents
{
    /**
     * Every birthday, hire anniversary and holiday landing within the next
     * `$days` days, nearest first.
     *
     * @return list<array<string, mixed>>
     */
    public function upcoming(int $days = 30): array
    {
        $today = CarbonImmutable::today();
        $end = $today->addDays($days);

        $employees = Employee::query()
            ->with('hrDepartment')
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->get(['id', 'employee_no', 'first_name', 'last_name', 'suffix', 'birth_date', 'date_hired', 'hr_department_id']);

        $events = [];

        foreach ($employees as $employee) {
            if ($employee->birth_date) {
                $next = $this->nextOccurrence($employee->birth_date, $today);

                if ($next && $next->lte($end)) {
                    $events[] = [
                        'type' => 'birthday',
                        'date' => $next->toDateString(),
                        'daysUntil' => $today->diffInDays($next),
                        'employeeId' => $employee->id,
                        'employeeNo' => $employee->employee_no,
                        'name' => $employee->full_name,
                        'department' => $employee->hrDepartment->name ?? null,
                        'detail' => null,
                    ];
                }
            }

            // A hire anniversary only means something from the first
            // year onward — day one is not an anniversary of anything yet.
            if ($employee->date_hired && $employee->date_hired->lt($today)) {
                $next = $this->nextOccurrence($employee->date_hired, $today);

                if ($next && $next->lte($end) && $next->year > $employee->date_hired->year) {
                    $events[] = [
                        'type' => 'anniversary',
                        'date' => $next->toDateString(),
                        'daysUntil' => $today->diffInDays($next),
                        'employeeId' => $employee->id,
                        'employeeNo' => $employee->employee_no,
                        'name' => $employee->full_name,
                        'department' => $employee->hrDepartment->name ?? null,
                        'detail' => ($next->year - $employee->date_hired->year).' year'
                            .($next->year - $employee->date_hired->year === 1 ? '' : 's'),
                    ];
                }
            }
        }

        $holidays = Holiday::whereBetween('holiday_date', [$today->toDateString(), $end->toDateString()])->get();

        foreach ($holidays as $holiday) {
            $events[] = [
                'type' => 'holiday',
                'date' => $holiday->holiday_date->toDateString(),
                'daysUntil' => $today->diffInDays($holiday->holiday_date),
                'employeeId' => null,
                'employeeNo' => null,
                'name' => $holiday->name,
                'department' => null,
                'detail' => $holiday->type,
            ];
        }

        usort($events, fn ($a, $b) => $a['daysUntil'] <=> $b['daysUntil']);

        return $events;
    }

    /**
     * The next calendar date `$anniversary`'s month/day falls on, from
     * `$from` onward (today counts). A February 29 anniversary in a
     * non-leap year lands on March 1 rather than erroring — the same
     * "nearest real date" rule most payroll/HR systems apply to it.
     */
    private function nextOccurrence(CarbonInterface $anniversary, CarbonImmutable $from): ?CarbonImmutable
    {
        try {
            $this_year = $from->setDate($from->year, $anniversary->month, $anniversary->day);
        } catch (\Throwable) {
            return null;
        }

        return $this_year->lt($from) ? $this_year->addYear() : $this_year;
    }

    /**
     * Announcements a given employee (or nobody, for a public/company-wide
     * view) is currently in the audience for — published, not yet expired,
     * pinned first then newest.
     */
    public function activeAnnouncements(?Employee $employee): \Illuminate\Support\Collection
    {
        $now = CarbonImmutable::now();

        return Announcement::query()
            ->where('published_at', '<=', $now)
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>=', $now))
            ->where(fn ($q) => $q->whereNull('hr_department_id')
                ->when($employee?->hr_department_id, fn ($q2) => $q2->orWhere('hr_department_id', $employee->hr_department_id)))
            ->orderByDesc('pinned')
            ->orderByDesc('published_at')
            ->get();
    }
}
