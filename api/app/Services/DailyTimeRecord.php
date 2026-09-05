<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\PayrollPeriod;
use Carbon\CarbonImmutable;
use Carbon\CarbonPeriod;

/**
 * The daily time record for one employee over one cut-off.
 *
 * The attendance table already holds every punch. What it does not hold is the
 * shape people actually need: a row for every calendar day in the cut-off,
 * including the days nobody clocked in, because a DTR that silently omits
 * absences is the one document where a gap is the whole point.
 *
 * So the period is walked day by day rather than the records being listed.
 * Every day gets a row, and each is classified from what is — and is not —
 * there: a punch, an approved leave, a rest day, a holiday, or an unexplained
 * absence.
 *
 * The totals are what payroll and DOLE inspections ask for, and they are
 * summed from the rows rather than trusted from anywhere else.
 */
class DailyTimeRecord
{
    /**
     * Builds the record.
     *
     * @return array<string, mixed>
     */
    public function build(Employee $employee, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $employee->loadMissing(['shift', 'hrDepartment', 'position', 'branchUnit']);

        $records = AttendanceRecord::query()
            ->where('employee_id', $employee->id)
            ->whereBetween('work_date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->keyBy(fn ($r) => CarbonImmutable::parse($r->work_date)->toDateString());

        // Approved leave covering any day in the window, so an absence can be
        // told apart from a day somebody properly filed for.
        $leaves = LeaveRequest::query()
            ->with('leaveType')
            ->where('employee_id', $employee->id)
            ->where('status', 'Approved')
            ->where('start_date', '<=', $to->toDateString())
            ->where('end_date', '>=', $from->toDateString())
            ->get();

        $holidays = Holiday::query()
            ->whereBetween('holiday_date', [$from->toDateString(), $to->toDateString()])
            ->get()
            ->keyBy(fn ($h) => CarbonImmutable::parse($h->holiday_date)->toDateString());

        $rows = [];

        foreach (CarbonPeriod::create($from, $to) as $day) {
            $date = CarbonImmutable::parse($day);
            $key = $date->toDateString();

            $record = $records->get($key);
            $holiday = $holidays->get($key);
            $leave = $leaves->first(
                fn (LeaveRequest $l) => $date->betweenIncluded(
                    CarbonImmutable::parse($l->start_date),
                    CarbonImmutable::parse($l->end_date),
                ),
            );

            $rows[] = $this->row($date, $record, $leave, $holiday, $employee);
        }

        return [
            'employee' => [
                'id' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                'position' => $employee->position->title ?? null,
                'department' => $employee->hrDepartment->name ?? null,
                'branch' => $employee->branchUnit->name ?? null,
                'shift' => $employee->shift->name ?? null,
                'shiftHours' => $employee->shift
                    ? substr((string) $employee->shift->starts_at, 0, 5).' – '.substr((string) $employee->shift->ends_at, 0, 5)
                    : null,
            ],
            'period' => [
                'from' => $from->toDateString(),
                'to' => $to->toDateString(),
                'label' => $from->format('j M Y').' – '.$to->format('j M Y'),
            ],
            'days' => $rows,
            'totals' => $this->totals($rows),
        ];
    }

    /** Resolves a payroll period into its cut-off dates. */
    public function periodWindow(PayrollPeriod $period): array
    {
        return [
            CarbonImmutable::parse($period->period_start),
            CarbonImmutable::parse($period->period_end),
        ];
    }

    /* ====================================================================== */

    /**
     * One calendar day, classified.
     *
     * The order of the checks is the order the truth is established: a punch
     * beats everything (they were here), then filed leave, then a holiday,
     * then the roster's rest day, and only what is left over is an absence.
     */
    private function row(
        CarbonImmutable $date,
        ?AttendanceRecord $record,
        ?LeaveRequest $leave,
        ?Holiday $holiday,
        Employee $employee,
    ): array {
        $isRestDay = $this->isRestDay($date, $employee);

        $status = match (true) {
            $record !== null => $record->status ?: 'Present',
            $leave !== null => 'On Leave',
            $holiday !== null => 'Holiday',
            $isRestDay => 'Rest Day',
            // A future day inside the current cut-off has simply not happened.
            $date->isFuture() => 'Scheduled',
            default => 'Absent',
        };

        return [
            'date' => $date->toDateString(),
            'day' => $date->format('D'),
            'isWeekend' => $date->isWeekend(),
            'holiday' => $holiday?->name,
            'holidayType' => $holiday?->type,
            'leaveType' => $leave?->leaveType->name ?? null,
            'timeIn' => $this->clock($record?->clock_in_at ?? $record?->time_in),
            'breakOut' => $this->clock($record?->break_out_at),
            'breakIn' => $this->clock($record?->break_in_at),
            'timeOut' => $this->clock($record?->clock_out_at ?? $record?->time_out),
            'hoursWorked' => (float) ($record?->hours_worked ?? 0),
            'overtimeHours' => (float) ($record?->overtime_hours ?? 0),
            'nightDiffHours' => (float) ($record?->night_diff_hours ?? 0),
            'lateMinutes' => (int) ($record?->late_minutes ?? 0),
            'undertimeMinutes' => (int) ($record?->undertime_minutes ?? 0),
            'breakMinutes' => (int) ($record?->break_minutes ?? 0),
            'status' => $status,
            'remarks' => $record?->remarks,
            // An open shift — clocked in, never out — is the single most common
            // payroll dispute, so it is called out rather than shown as zero.
            'incomplete' => $record !== null
                && $record->clock_in_at !== null
                && $record->clock_out_at === null
                && ! $date->isToday(),
        ];
    }

    /**
     * Whether the roster has this day off.
     *
     * Shifts carry the working days they apply to; without one configured the
     * six-day week common in Philippine distribution is assumed, so only
     * Sunday is a rest day.
     */
    private function isRestDay(CarbonImmutable $date, Employee $employee): bool
    {
        $days = $employee->shift->work_days ?? null;

        if (! $days) {
            return $date->isSunday();
        }

        $working = is_array($days) ? $days : array_map('trim', explode(',', (string) $days));

        return ! in_array($date->format('D'), $working, true)
            && ! in_array($date->format('l'), $working, true);
    }

    private function clock(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->format('H:i') : null;
    }

    /** @param  array<int, array<string, mixed>>  $rows */
    private function totals(array $rows): array
    {
        $count = fn (string $status) => count(array_filter($rows, fn ($r) => $r['status'] === $status));

        return [
            'daysInPeriod' => count($rows),
            'daysPresent' => count(array_filter($rows, fn ($r) => $r['hoursWorked'] > 0)),
            'daysAbsent' => $count('Absent'),
            'daysOnLeave' => $count('On Leave'),
            'restDays' => $count('Rest Day'),
            'holidays' => $count('Holiday'),
            'hoursWorked' => round(array_sum(array_column($rows, 'hoursWorked')), 2),
            'overtimeHours' => round(array_sum(array_column($rows, 'overtimeHours')), 2),
            'nightDiffHours' => round(array_sum(array_column($rows, 'nightDiffHours')), 2),
            'lateMinutes' => array_sum(array_column($rows, 'lateMinutes')),
            'undertimeMinutes' => array_sum(array_column($rows, 'undertimeMinutes')),
            'timesLate' => count(array_filter($rows, fn ($r) => $r['lateMinutes'] > 0)),
            'incompleteDays' => count(array_filter($rows, fn ($r) => $r['incomplete'])),
        ];
    }
}
