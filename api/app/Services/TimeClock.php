<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\Holiday;
use App\Models\LeaveRequest;
use App\Models\Shift;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The employee punch clock.
 *
 * Four presses make a day: in, out to break, back from break, out. The order is
 * enforced, because a day that records a break-in with no break-out cannot be
 * costed and a second clock-in silently overwriting the first is how a payroll
 * dispute starts.
 *
 * Everything the payroll cares about — hours worked, late minutes, undertime,
 * the status word — is derived from the punches and the employee's shift. None
 * of it is typed, so a timesheet cannot disagree with the clock behind it.
 */
class TimeClock
{
    /** The presses, in the only order they are allowed to happen. */
    public const ACTIONS = ['in', 'break-out', 'break-in', 'out', 'ot-in', 'ot-out'];

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly PunchGuard $guard,
    ) {}

    /**
     * Records one press for an employee.
     *
     * @throws ValidationException
     */
    public function punch(
        Employee $employee,
        string $action,
        ?string $at = null,
        array $context = [],
    ): AttendanceRecord {
        if (! in_array($action, self::ACTIONS, true)) {
            throw ValidationException::withMessages(['action' => "Unknown clock action [{$action}]."]);
        }

        $now = $at ? CarbonImmutable::parse($at) : CarbonImmutable::now();

        // Who and where, before anything is written. A punch that fails either
        // check leaves no record beyond the audit line for the failure.
        if ($context !== []) {
            $this->guard->verifyPin($employee, $context['pin'] ?? null);
            $this->guard->verifyLocation($context['ip'] ?? null);
        }

        return DB::transaction(function () use ($employee, $action, $now, $context) {
            $record = $this->openRecordFor($employee, $now);

            $this->guardSequence($record, $action);

            $column = match ($action) {
                'in' => 'clock_in_at',
                'break-out' => 'break_out_at',
                'break-in' => 'break_in_at',
                'out' => 'clock_out_at',
                'ot-in' => 'ot_clock_in_at',
                'ot-out' => 'ot_clock_out_at',
            };

            $record->{$column} = $now;
            $record->source = 'Self Service';
            $record->recorded_by = auth()->id();

            $this->recompute($record, $employee);

            $record->save();

            // Every press is written down with the device behind it, which is
            // what makes one phone clocking in six people visible later.
            if ($context !== []) {
                $this->guard->record(
                    $employee,
                    $record,
                    $action,
                    $context['deviceId'] ?? null,
                    $context['ip'] ?? null,
                    $context['userAgent'] ?? null,
                );
            }

            $this->audit->log(
                'clocked '.str_replace('-', ' ', $action),
                'AttendanceRecord',
                $record->id,
                $employee->full_name.' — '.$now->format('d M Y H:i'),
                'hr',
            );

            return $record->fresh(['employee', 'shift']);
        });
    }

    /**
     * The day's record, created on the first press.
     *
     * A night shift that started yesterday and has not been clocked out of is
     * still today's business, so it is picked up rather than starting a second
     * day the employee never began.
     */
    public function openRecordFor(Employee $employee, CarbonImmutable $now): AttendanceRecord
    {
        $carried = AttendanceRecord::query()
            ->where('employee_id', $employee->id)
            ->whereNotNull('clock_in_at')
            ->whereNull('clock_out_at')
            ->where('work_date', '>=', $now->subDay()->toDateString())
            ->orderByDesc('work_date')
            ->first();

        if ($carried) {
            return $carried;
        }

        return AttendanceRecord::firstOrNew([
            'employee_id' => $employee->id,
            'work_date' => $now->toDateString(),
        ]);
    }

    /**
     * What the employee may press right now.
     *
     * Returned to the screen so the buttons that cannot be used are disabled
     * rather than offered and then refused.
     *
     * @return array<string, mixed>
     */
    public function state(Employee $employee, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $record = $this->openRecordFor($employee, $now);

        $in = $record->clock_in_at;
        $breakOut = $record->break_out_at;
        $breakIn = $record->break_in_at;
        $out = $record->clock_out_at;
        $otIn = $record->ot_clock_in_at;
        $otOut = $record->ot_clock_out_at;

        // 'done' covers both "finished the regular shift" and "finished an
        // overtime stint on top of it" — the screen only needs a third state
        // for the moment overtime is actually open, not for every way the
        // day can end.
        $stage = match (true) {
            $otIn !== null && $otOut === null => 'on-overtime',
            $out !== null => 'done',
            $breakOut !== null && $breakIn === null => 'on-break',
            $in !== null => 'working',
            default => 'off',
        };

        $shift = $this->shiftFor($employee);

        return [
            'stage' => $stage,
            'workDate' => $record->work_date
                ? CarbonImmutable::parse($record->work_date)->toDateString()
                : $now->toDateString(),
            'clockIn' => optional($in)->toIso8601String(),
            'breakOut' => optional($breakOut)->toIso8601String(),
            'breakIn' => optional($breakIn)->toIso8601String(),
            'clockOut' => optional($out)->toIso8601String(),
            'otClockIn' => optional($otIn)->toIso8601String(),
            'otClockOut' => optional($otOut)->toIso8601String(),
            'hoursWorked' => (float) $record->hours_worked,
            'breakMinutes' => (int) $record->break_minutes,
            'lateMinutes' => (int) $record->late_minutes,
            'undertimeMinutes' => (int) $record->undertime_minutes,
            'overtimeHours' => (float) $record->overtime_hours,
            // True when `overtimeHours` came from the explicit ot-in/ot-out
            // pair rather than the automatic past-shift-end calculation — the
            // screen reads this to label the number correctly instead of
            // implying every overtime hour was logged the same way.
            'overtimeIsLogged' => $otIn !== null && $otOut !== null,
            'status' => $record->status ?? 'Present',
            'shift' => $shift ? [
                'name' => $shift->name,
                'startsAt' => substr((string) $shift->starts_at, 0, 5),
                'endsAt' => substr((string) $shift->ends_at, 0, 5),
                'graceMinutes' => (int) $shift->grace_minutes,
                'breakMinutes' => (int) $shift->break_minutes,
            ] : null,
            // What the four buttons switch on. These mirror `guardSequence`
            // exactly — a button the screen offers must never be refused, so
            // the break is a once-a-day press rather than merely "while
            // working", which would come back after the employee returns.
            'can' => [
                'in' => $stage === 'off',
                'break-out' => $stage === 'working' && $breakOut === null,
                'break-in' => $stage === 'on-break',
                'out' => in_array($stage, ['working', 'on-break'], true),
                // Overtime only opens once the regular shift is actually
                // closed out, and only once per day — a second stint the
                // same day is the automatic, "stayed straight through" case,
                // not this one.
                'ot-in' => $stage === 'done' && $otIn === null,
                'ot-out' => $stage === 'on-overtime',
            ],
            'serverTime' => $now->toIso8601String(),
            // What the punch screen has to collect before it may submit.
            'pinRequired' => $this->guard->pinRequired(),
            'pinSet' => $this->guard->hasPin($employee),
            'pinLength' => (int) $this->guard->config()['pin_length'],
        ];
    }

    /* ---------------------------------------------------------------------- */

    /** @throws ValidationException */
    private function guardSequence(AttendanceRecord $record, string $action): void
    {
        $message = match ($action) {
            'in' => $record->clock_in_at ? 'You are already clocked in for today.' : null,
            'break-out' => match (true) {
                ! $record->clock_in_at => 'Clock in before starting a break.',
                (bool) $record->break_out_at => 'You have already taken your break.',
                (bool) $record->clock_out_at => 'You have already clocked out for today.',
                default => null,
            },
            'break-in' => match (true) {
                ! $record->break_out_at => 'You are not on a break.',
                (bool) $record->break_in_at => 'You are already back from your break.',
                default => null,
            },
            'out' => match (true) {
                ! $record->clock_in_at => 'Clock in before clocking out.',
                (bool) $record->clock_out_at => 'You have already clocked out for today.',
                // Leaving mid-break would leave the day uncostable.
                $record->break_out_at && ! $record->break_in_at => 'End your break before clocking out.',
                default => null,
            },
            'ot-in' => match (true) {
                ! $record->clock_out_at => 'Clock out of your regular shift before starting overtime.',
                (bool) $record->ot_clock_in_at => 'You have already started overtime today.',
                default => null,
            },
            'ot-out' => match (true) {
                ! $record->ot_clock_in_at => 'You have not started overtime yet.',
                (bool) $record->ot_clock_out_at => 'You have already ended overtime for today.',
                default => null,
            },
        };

        if ($message) {
            throw ValidationException::withMessages(['action' => $message]);
        }
    }

    /**
     * Derives everything the payroll reads from the punches and the shift.
     *
     * Late and undertime are measured against the shift the employee is on. No
     * shift means no schedule to be late against, so both stay zero rather than
     * being invented from a default nobody agreed to.
     */
    private function recompute(AttendanceRecord $record, Employee $employee): void
    {
        $shift = $this->shiftFor($employee);
        $record->shift_id = $shift?->id;

        $in = $record->clock_in_at ? CarbonImmutable::parse($record->clock_in_at) : null;
        $out = $record->clock_out_at ? CarbonImmutable::parse($record->clock_out_at) : null;
        $breakOut = $record->break_out_at ? CarbonImmutable::parse($record->break_out_at) : null;
        $breakIn = $record->break_in_at ? CarbonImmutable::parse($record->break_in_at) : null;

        // Keep the clock-time columns the existing reports read in step.
        $record->time_in = $in?->format('H:i:s');
        $record->time_out = $out?->format('H:i:s');
        $record->work_date ??= ($in ?? CarbonImmutable::now())->toDateString();

        $breakMinutes = $breakOut && $breakIn ? max(0, $breakOut->diffInMinutes($breakIn)) : 0;
        $record->break_minutes = (int) round($breakMinutes);

        if ($in && $out) {
            $gross = max(0, $in->diffInMinutes($out));
            $worked = max(0, $gross - $breakMinutes);
            $record->hours_worked = round($worked / 60, 2);
        } else {
            $record->hours_worked = 0;
        }

        $record->late_minutes = 0;
        $record->undertime_minutes = 0;
        $record->overtime_hours = 0;

        if ($shift && $in) {
            // `work_date` is a date cast, so it stringifies with a time of its
            // own — take the date part explicitly or the parse sees two times.
            $day = CarbonImmutable::parse($record->work_date)->toDateString();
            $scheduledStart = CarbonImmutable::parse($day.' '.$shift->starts_at);
            $grace = (int) $shift->grace_minutes;

            $lateBy = $scheduledStart->diffInMinutes($in, false);
            $record->late_minutes = (int) max(0, round($lateBy - $grace));

            if ($out) {
                $scheduledEnd = CarbonImmutable::parse($day.' '.$shift->ends_at);
                if ($shift->is_night_shift && $scheduledEnd->lte($scheduledStart)) {
                    $scheduledEnd = $scheduledEnd->addDay();
                }

                $record->undertime_minutes = (int) max(0, round($out->diffInMinutes($scheduledEnd, false)));

                // Overtime only counts past the scheduled end. Arriving early
                // and leaving on time is not overtime.
                $extra = $scheduledEnd->diffInMinutes($out, false);
                $record->overtime_hours = round(max(0, $extra) / 60, 2);
            }
        }

        // A logged overtime session is authoritative over the automatic
        // guess above — an employee who clocked out, left, and came back for
        // a separate stint told the system exactly how long that stint was,
        // which is more accurate than "however long after shift-end the
        // regular clock-out happened to be" and should replace it rather
        // than add to it (the regular clock-out already happened at or
        // before the scheduled end in this case, so the automatic figure is
        // typically zero anyway — but this makes the precedence explicit
        // rather than relying on that coincidence).
        $otIn = $record->ot_clock_in_at ? CarbonImmutable::parse($record->ot_clock_in_at) : null;
        $otOut = $record->ot_clock_out_at ? CarbonImmutable::parse($record->ot_clock_out_at) : null;

        if ($otIn && $otOut) {
            $record->overtime_hours = round(max(0, $otIn->diffInMinutes($otOut)) / 60, 2);
        }

        $record->status = $this->statusFor($record, $employee);
    }

    /**
     * The word that describes the day.
     *
     * A holiday or an approved leave outranks the punches: somebody who came in
     * on a rest day is still on a rest day, and payroll needs to know that.
     */
    private function statusFor(AttendanceRecord $record, Employee $employee): string
    {
        $date = CarbonImmutable::parse($record->work_date);

        if (Holiday::whereDate('holiday_date', $date)->exists()) {
            return 'Holiday';
        }

        $onLeave = LeaveRequest::query()
            ->where('employee_id', $employee->id)
            ->where('status', 'Approved')
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->exists();

        if ($onLeave) {
            return 'On Leave';
        }

        if (! $record->clock_in_at) {
            return 'Absent';
        }

        return $record->late_minutes > 0 ? 'Late' : 'Present';
    }

    /** The employee's own shift, falling back to the active default. */
    public function shiftFor(Employee $employee): ?Shift
    {
        if ($employee->shift_id) {
            return $employee->shift;
        }

        return Shift::where('is_active', true)->orderBy('id')->first();
    }
}
