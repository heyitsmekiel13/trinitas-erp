<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\EmployeeCase;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Infraction monitoring.
 *
 * Discipline is the part of HR most often run on memory: somebody notices that
 * a person "is always late", and the notice that follows rests on an impression
 * nobody can check. This raises the case from the attendance record instead, so
 * every notice points at the punches behind it and the employee can see the
 * same evidence the officer did.
 *
 * Escalation is by accumulated points rather than by whoever is handling the
 * file that week. The thresholds are stated here in one place so the rule can
 * be argued with — which is the point of writing it down.
 */
class InfractionMonitor
{
    /** Minutes late before the day counts as a tardiness infraction. */
    public const TARDINESS_THRESHOLD_MINUTES = 15;

    /** How far back a scan looks, and the window points are counted over. */
    public const WINDOW_DAYS = 90;

    /** Points each kind of infraction carries. */
    public const POINTS = [
        'Tardiness' => 1,
        'Absence Without Leave' => 3,
        'Policy Violation' => 2,
        'Safety Incident' => 4,
        'Performance' => 2,
        'Grievance' => 0,
    ];

    /**
     * Accumulated points and the action they warrant.
     *
     * Read highest-first: the first threshold met is the action.
     */
    public const ESCALATION = [
        12 => 'Suspension',
        8 => 'Final Warning',
        4 => 'Written Warning',
        1 => 'Verbal Warning',
    ];

    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Scans attendance and raises cases for what it finds.
     *
     * Idempotent: a day that already has a case against it is skipped, so the
     * scan can run nightly without issuing the same notice twice.
     *
     * @return array<string, mixed>
     */
    public function scan(?int $withinDays = null, ?int $employeeId = null): array
    {
        $since = CarbonImmutable::now()->subDays($withinDays ?? self::WINDOW_DAYS)->toDateString();

        $records = AttendanceRecord::query()
            ->with('employee')
            ->whereDate('work_date', '>=', $since)
            ->when($employeeId, fn ($q) => $q->where('employee_id', $employeeId))
            ->where(function ($q) {
                $q->where('late_minutes', '>', self::TARDINESS_THRESHOLD_MINUTES)
                    ->orWhere('status', 'Absent');
            })
            ->orderBy('work_date')
            ->get();

        // Days already answered for, so a re-run is silent.
        $covered = EmployeeCase::query()
            ->whereNotNull('attendance_record_id')
            ->pluck('attendance_record_id')
            ->flip();

        $raised = [];

        foreach ($records as $record) {
            if ($covered->has($record->id) || ! $record->employee) {
                continue;
            }

            $type = $record->status === 'Absent' ? 'Absence Without Leave' : 'Tardiness';

            $detail = $type === 'Tardiness'
                ? sprintf(
                    'Arrived %d minutes late on %s (threshold %d minutes).',
                    (int) $record->late_minutes,
                    CarbonImmutable::parse($record->work_date)->format('d M Y'),
                    self::TARDINESS_THRESHOLD_MINUTES,
                )
                : sprintf(
                    'No time record and no approved leave on %s.',
                    CarbonImmutable::parse($record->work_date)->format('d M Y'),
                );

            $case = $this->raise($record->employee, $type, $detail, $record, automatic: true);
            $raised[] = [
                'no' => $case->case_no,
                'employee' => $record->employee->full_name,
                'employeeNo' => $record->employee->employee_no,
                'type' => $type,
                'date' => CarbonImmutable::parse($record->work_date)->toDateString(),
                'severity' => $case->severity,
                'action' => $case->action,
                'points' => (int) $case->points,
            ];
        }

        if ($raised) {
            $this->audit->log(
                'raised infractions from attendance',
                'EmployeeCase',
                null,
                count($raised).' case(s)',
                'hr',
            );
        }

        return [
            'scanned' => $records->count(),
            'raised' => count($raised),
            'cases' => $raised,
            'since' => $since,
        ];
    }

    /**
     * Opens one case, with the severity and action its history warrants.
     *
     * The employee's running total decides the action: a first lateness is a
     * conversation, a twelfth is a suspension, and the arithmetic is the same
     * for everybody.
     */
    public function raise(
        Employee $employee,
        string $type,
        ?string $details = null,
        ?AttendanceRecord $record = null,
        bool $automatic = false,
        ?int $handledBy = null,
    ): EmployeeCase {
        return DB::transaction(function () use ($employee, $type, $details, $record, $automatic, $handledBy) {
            $points = self::POINTS[$type] ?? 1;
            $runningTotal = $this->pointsFor($employee) + $points;

            $case = EmployeeCase::create([
                'case_no' => $this->nextNumber(),
                'employee_id' => $employee->id,
                'attendance_record_id' => $record?->id,
                'type' => $type,
                'reported_on' => $record
                    ? CarbonImmutable::parse($record->work_date)->toDateString()
                    : now()->toDateString(),
                'severity' => $this->severityFor($runningTotal),
                'points' => $points,
                'action' => $this->actionFor($runningTotal),
                'details' => $details,
                'handled_by' => $handledBy,
                'is_automatic' => $automatic,
                'status' => 'Open',
            ]);

            return $case;
        });
    }

    /**
     * Points an employee has accumulated inside the rolling window.
     *
     * Older infractions fall out of the count on purpose — a warning from two
     * years ago should not decide today's action.
     */
    public function pointsFor(Employee $employee, ?int $windowDays = null): int
    {
        $since = CarbonImmutable::now()->subDays($windowDays ?? self::WINDOW_DAYS)->toDateString();

        return (int) EmployeeCase::query()
            ->where('employee_id', $employee->id)
            ->whereDate('reported_on', '>=', $since)
            // A dismissed case carries no weight.
            ->whereNot('status', 'Closed')
            ->sum('points');
    }

    /** Employees carrying the most weight, worst first. */
    public function watchlist(int $limit = 10): array
    {
        $since = CarbonImmutable::now()->subDays(self::WINDOW_DAYS)->toDateString();

        return EmployeeCase::query()
            ->with('employee.hrDepartment')
            ->whereDate('reported_on', '>=', $since)
            ->whereNot('status', 'Closed')
            ->get()
            ->groupBy('employee_id')
            ->map(function ($cases) {
                $employee = $cases->first()->employee;
                $points = (int) $cases->sum('points');

                return [
                    'employeeId' => $employee?->id,
                    'name' => $employee?->full_name,
                    'employeeNo' => $employee?->employee_no,
                    'department' => $employee?->hrDepartment?->code,
                    'cases' => $cases->count(),
                    'points' => $points,
                    'openCases' => $cases->whereIn('status', ['Open', 'Notice Issued', 'Hearing Scheduled'])->count(),
                    'standing' => $this->actionFor($points),
                    'lastIncident' => optional($cases->max('reported_on'))
                        ? CarbonImmutable::parse($cases->max('reported_on'))->toDateString()
                        : null,
                ];
            })
            ->sortByDesc('points')
            ->take($limit)
            ->values()
            ->all();
    }

    /** Everything on one employee's record, for the self-service screen. */
    public function recordFor(Employee $employee): array
    {
        $cases = EmployeeCase::query()
            ->with('handler')
            ->where('employee_id', $employee->id)
            ->orderByDesc('reported_on')
            ->get();

        $points = $this->pointsFor($employee);

        return [
            'points' => $points,
            'standing' => $points === 0 ? 'Clear' : $this->actionFor($points),
            'windowDays' => self::WINDOW_DAYS,
            'open' => $cases->whereIn('status', ['Open', 'Notice Issued', 'Hearing Scheduled'])->count(),
            'cases' => $cases->map(fn (EmployeeCase $case) => [
                'id' => $case->id,
                'no' => $case->case_no,
                'type' => $case->type,
                'reported' => optional($case->reported_on)->toDateString(),
                'severity' => $case->severity,
                'action' => $case->action,
                'points' => (int) $case->points,
                'details' => $case->details,
                'handler' => $case->handler->full_name ?? null,
                'hearingOn' => optional($case->hearing_on)->toDateString(),
                'acknowledgedAt' => optional($case->acknowledged_at)->toIso8601String(),
                'automatic' => (bool) $case->is_automatic,
                'status' => $case->status,
            ])->all(),
        ];
    }

    /** The employee has seen the notice. Not an admission, just receipt. */
    public function acknowledge(EmployeeCase $case): EmployeeCase
    {
        if (! $case->acknowledged_at) {
            $case->forceFill(['acknowledged_at' => now()])->save();

            $this->audit->log('acknowledged an infraction notice', 'EmployeeCase', $case->id, $case->case_no, 'hr');
        }

        return $case->fresh();
    }

    /* ---------------------------------------------------------------------- */

    private function severityFor(int $points): string
    {
        return match (true) {
            $points >= 12 => 'Grave',
            $points >= 8 => 'Major',
            $points >= 4 => 'Moderate',
            default => 'Minor',
        };
    }

    private function actionFor(int $points): string
    {
        foreach (self::ESCALATION as $threshold => $action) {
            if ($points >= $threshold) {
                return $action;
            }
        }

        return 'Under Review';
    }

    private function nextNumber(): string
    {
        $stem = 'ER-'.date('Y').'-';

        $last = EmployeeCase::query()
            ->where('case_no', 'like', $stem.'%')
            ->orderByDesc('case_no')
            ->lockForUpdate()
            ->value('case_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
