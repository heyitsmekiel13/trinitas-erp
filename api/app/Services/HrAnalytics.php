<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\EmployeeCase;
use App\Models\JobRequisition;
use App\Models\LeaveRequest;
use App\Models\PayrollRun;
use App\Models\PerformanceReview;
use App\Models\TrainingRecord;
use App\Models\TrainingSession;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The HR dashboard, computed from the people record and the clock.
 *
 * Attendance figures come from punches rather than from a summary anybody
 * maintains, so the headline and the timesheet behind it cannot differ.
 *
 * Two things changed here, both for the same reason — a dashboard is only
 * worth reading if you can trust what it is measuring and see all of it.
 *
 * The reporting window is now resolved on the server from a named period.
 * The client used to hold a grain and two loose dates and post them, which
 * meant the label above the numbers was computed in one place and the numbers
 * in another; they could and did disagree. A period name goes in, and the
 * window, its label, its grain and the comparable window before it all come
 * back from the same calculation.
 *
 * And the dashboard reported headcount, attendance, leave and discipline
 * while payroll, compensation, recruitment, performance, training and
 * statutory coverage — most of what HR is actually accountable for — were
 * not on it at all. They are now.
 */
class HrAnalytics
{
    private const MONTHS = 12;

    /**
     * The masterfile's own employment vocabulary.
     *
     * Named constants because they were previously written out by hand at each
     * call site — and one of them was written as "Probationary", which matches
     * nothing, so the dashboard reported nobody on probation while
     * three-quarters of the workforce was.
     */
    public const STATUS_REGULAR = 'REGULAR';

    public const STATUS_PROBATION = 'PROBATION';

    public const STATUS_RESIGNED = 'RESIGNED';

    public const STATUS_TERMINATED = 'TERMINATED';

    /** No longer on the payroll, however they left. */
    public const STATUS_INACTIVE = [self::STATUS_RESIGNED, self::STATUS_TERMINATED];

    /** Reporting periods, in the order they are offered. */
    public const PERIODS = ['today', 'wtd', 'mtd', 'last_month', 'qtd', 'ytd', 'last_12m', 'all', 'custom'];

    public function __construct(
        private readonly InfractionMonitor $infractions,
        private readonly EmployeeDocumentChecklist $documents,
        private readonly OnboardingTasks $onboardingTasks,
        private readonly OffboardingOperations $offboarding,
    ) {}

    /**
     * Everybody actually employed on a given day.
     *
     * "Not resigned" alone was not the same question, and the two answers
     * differed: a masterfile carrying a hire date in the future counted
     * towards headcount in the headline while the trend beneath it — which
     * correctly waits for somebody to start — did not. One of them had to
     * move, and it is the headline, because a person who starts in October is
     * not part of August's headcount. Future starters are reported separately
     * rather than hidden, since a joiner nobody has prepared for is worth
     * seeing.
     */
    private function employedOn(CarbonImmutable $on)
    {
        return Employee::query()
            ->whereNotIn('employment_status', self::STATUS_INACTIVE)
            ->whereNotNull('date_hired')
            ->whereDate('date_hired', '<=', $on->toDateString());
    }

    /**
     * The dashboard, over a chosen window and bucketed at a chosen grain.
     *
     * `$period` names the window. `custom` is the only one that reads the
     * explicit dates; every other value derives them, so a preset cannot be
     * shown alongside a range that does not match it.
     */
    public function dashboard(
        string $period = 'last_12m',
        ?string $from = null,
        ?string $to = null,
        ?string $grain = null,
    ): array {
        $now = CarbonImmutable::now();

        [$start, $end] = $this->resolve($period, $from, $to, $now);
        $grain = $grain && in_array($grain, ['day', 'month', 'year'], true)
            ? $grain
            : $this->grainFor($start, $end);

        // The same span immediately before, so every windowed figure can be
        // read against what it did last time rather than in isolation.
        $span = $start->diffInDays($end);
        $priorEnd = $start->subDay();
        $priorStart = $priorEnd->subDays($span);

        return [
            'kpis' => $this->kpis($now, $start, $end, $priorStart, $priorEnd),
            'trend' => $this->trend($grain, $start, $end),
            'workforce' => $this->workforce($now),
            'compensation' => $this->compensation(),
            'payroll' => $this->payroll($start, $end, $priorStart, $priorEnd),
            'leave' => $this->leave($now, $start, $end),
            'discipline' => [
                'byType' => $this->infractionsByType(),
                'watchlist' => $this->infractions->watchlist(8),
            ],
            'recruitment' => $this->recruitment($start, $end),
            'performance' => $this->performance($now),
            'training' => $this->training($now, $start, $end),
            'compliance' => $this->compliance(),

            // Benchmarked against what a standard HRIS reports: turnover
            // split by whether the person chose to leave, how long a hire
            // actually takes, and what fraction of offers land — none of
            // which "attritionPct" or the recruitment funnel above answer.
            'lifecycle' => $this->lifecycle($start, $end),
            // The 201 file as paper (Phase 1's vault), not just fields —
            // `compliance()` above already covers the fields.
            'documentVault' => $this->documents->orgWideCompletion(),
            // Cross-cutting: what actually needs a person to act today,
            // pulled from the same services that feed the bell so the
            // dashboard and the notification feed can never disagree.
            'alerts' => $this->alerts(),

            // Kept at the top level: the existing screen reads these directly
            // and they are the two lists HR opens the dashboard to action.
            'byDepartment' => $this->headcountBy('hrDepartment'),
            'infractionsByType' => $this->infractionsByType(),
            'watchlist' => $this->infractions->watchlist(8),
            'pendingLeave' => $this->pendingLeave(),
            'onLeaveToday' => $this->onLeaveToday($now),

            'window' => [
                'period' => $period,
                'grain' => $grain,
                'from' => $start->toDateString(),
                'to' => $end->toDateString(),
                'label' => $this->label($period, $start, $end),
                'days' => $span + 1,
                'compare' => [
                    'from' => $priorStart->toDateString(),
                    'to' => $priorEnd->toDateString(),
                    'label' => $priorStart->format('j M Y').' – '.$priorEnd->format('j M Y'),
                ],
            ],
            'generatedAt' => $now->toIso8601String(),
        ];
    }

    /* ---------------------------------------------------------------------- */
    /* The window */
    /* ---------------------------------------------------------------------- */

    /** @return array{0: CarbonImmutable, 1: CarbonImmutable} */
    private function resolve(string $period, ?string $from, ?string $to, CarbonImmutable $now): array
    {
        $today = $now->startOfDay();

        return match ($period) {
            'today' => [$today, $today],
            'wtd' => [$today->startOfWeek(), $today],
            'mtd' => [$today->startOfMonth(), $today],
            'last_month' => [$today->subMonth()->startOfMonth(), $today->subMonth()->endOfMonth()],
            'qtd' => [$today->startOfQuarter(), $today],
            'ytd' => [$today->startOfYear(), $today],
            'last_12m' => [$today->subMonths(self::MONTHS - 1)->startOfMonth(), $today],
            'all' => [$this->earliest($now), $today],
            default => [
                $from ? CarbonImmutable::parse($from)->startOfDay() : $today->subMonths(self::MONTHS - 1)->startOfMonth(),
                $to ? CarbonImmutable::parse($to)->startOfDay() : $today,
            ],
        };
    }

    /**
     * The first day anything happened.
     *
     * Taken from the earliest hire and the earliest punch rather than hire
     * dates alone — an imported masterfile can carry attendance that predates
     * the oldest `date_hired` on it, and "all time" that starts after some of
     * the data is not all time.
     */
    private function earliest(CarbonImmutable $now): CarbonImmutable
    {
        $dates = array_filter([
            Employee::min('date_hired'),
            AttendanceRecord::min('work_date'),
        ]);

        return $dates
            ? CarbonImmutable::parse(min($dates))->startOfDay()
            : $now->subYear()->startOfDay();
    }

    /**
     * How finely to bucket a window.
     *
     * Chosen from its length so a year never renders as 365 unreadable
     * columns, and a single week never renders as one. Overridable, because
     * the caller sometimes wants the coarse view of a short window.
     */
    private function grainFor(CarbonImmutable $start, CarbonImmutable $end): string
    {
        $days = $start->diffInDays($end);

        return match (true) {
            $days <= 62 => 'day',
            $days <= 1100 => 'month',
            default => 'year',
        };
    }

    private function label(string $period, CarbonImmutable $start, CarbonImmutable $end): string
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

    /* ---------------------------------------------------------------------- */
    /* Trend */
    /* ---------------------------------------------------------------------- */

    /**
     * The trend, bucketed at the requested grain.
     *
     * Headcount and attendance come back on one series rather than two,
     * because every chart on the dashboard is read against the same buckets
     * and keeping them apart meant two queries that could disagree about which
     * months existed.
     */
    private function trend(string $grain, CarbonImmutable $start, CarbonImmutable $end): array
    {
        [$sqlFormat, $step, $label] = match ($grain) {
            'day' => ['%Y-%m-%d', 'addDay', 'j M'],
            'year' => ['%Y', 'addYear', 'Y'],
            default => ['%Y-%m', 'addMonth', 'M Y'],
        };

        $attendance = AttendanceRecord::query()
            ->whereBetween('work_date', [$start->toDateString(), $end->toDateString()])
            ->selectRaw("DATE_FORMAT(work_date, '{$sqlFormat}') AS bucket")
            ->selectRaw('COUNT(*) AS days')
            ->selectRaw('SUM(CASE WHEN late_minutes > 0 THEN 1 ELSE 0 END) AS late')
            ->selectRaw("SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) AS absent")
            ->selectRaw('SUM(hours_worked) AS hours')
            ->selectRaw('SUM(overtime_hours) AS overtime')
            ->groupBy('bucket')
            ->get()
            ->keyBy('bucket');

        $employees = Employee::query()
            ->whereNotNull('date_hired')
            ->get(['date_hired', 'date_separated', 'employment_status']);

        $rows = [];
        $cursor = $this->floorTo($grain, $start);
        $guard = 0;

        while ($cursor->lte($end) && $guard++ < 4000) {
            $key = $cursor->format(match ($grain) {
                'day' => 'Y-m-d',
                'year' => 'Y',
                default => 'Y-m',
            });

            $bucketEnd = match ($grain) {
                'day' => $cursor->endOfDay(),
                'year' => $cursor->endOfYear(),
                default => $cursor->endOfMonth(),
            };

            $row = $attendance->get($key);

            $rows[] = [
                'key' => $key,
                'label' => $cursor->format($label),
                'headcount' => $employees->filter(
                    fn ($e) => $e->date_hired <= $bucketEnd
                        && (! $e->date_separated || $e->date_separated > $bucketEnd),
                )->count(),
                'hires' => $employees->filter(
                    fn ($e) => $e->date_hired >= $cursor && $e->date_hired <= $bucketEnd,
                )->count(),
                'exits' => $employees->filter(
                    fn ($e) => $e->date_separated && $e->date_separated >= $cursor && $e->date_separated <= $bucketEnd,
                )->count(),
                'days' => (int) ($row->days ?? 0),
                'late' => (int) ($row->late ?? 0),
                'absent' => (int) ($row->absent ?? 0),
                'hours' => round((float) ($row->hours ?? 0), 1),
                'overtime' => round((float) ($row->overtime ?? 0), 1),
            ];

            $cursor = $cursor->{$step}();
        }

        return $rows;
    }

    private function floorTo(string $grain, CarbonImmutable $date): CarbonImmutable
    {
        return match ($grain) {
            'day' => $date->startOfDay(),
            'year' => $date->startOfYear(),
            default => $date->startOfMonth(),
        };
    }

    /* ---------------------------------------------------------------------- */
    /* KPIs */
    /* ---------------------------------------------------------------------- */

    private function kpis(
        CarbonImmutable $now,
        CarbonImmutable $start,
        CarbonImmutable $end,
        CarbonImmutable $priorStart,
        CarbonImmutable $priorEnd,
    ): array {
        $active = $this->employedOn($now);
        $headcount = (clone $active)->count();

        $monthStart = $now->startOfMonth();
        $today = $now->toDateString();

        $windowAttendance = AttendanceRecord::query()
            ->whereBetween('work_date', [$start->toDateString(), $end->toDateString()])
            ->get(['status', 'late_minutes', 'hours_worked', 'overtime_hours']);

        $priorAttendance = AttendanceRecord::query()
            ->whereBetween('work_date', [$priorStart->toDateString(), $priorEnd->toDateString()])
            ->get(['status', 'late_minutes', 'hours_worked', 'overtime_hours']);

        $todayRecords = AttendanceRecord::query()->whereDate('work_date', $today)->get(['status', 'clock_out_at']);

        $infractionWindow = $now->subDays(InfractionMonitor::WINDOW_DAYS)->toDateString();

        $hired = Employee::whereBetween('date_hired', [$start->toDateString(), $end->toDateString()])->count();
        $hiredPrior = Employee::whereBetween('date_hired', [$priorStart->toDateString(), $priorEnd->toDateString()])->count();
        $exits = Employee::whereBetween('date_separated', [$start->toDateString(), $end->toDateString()])->count();
        $exitsPrior = Employee::whereBetween('date_separated', [$priorStart->toDateString(), $priorEnd->toDateString()])->count();

        return [
            'headcount' => $headcount,
            'regular' => (clone $active)->where('employment_status', self::STATUS_REGULAR)->count(),
            'probationary' => (clone $active)->where('employment_status', self::STATUS_PROBATION)->count(),
            'newThisMonth' => Employee::whereDate('date_hired', '>=', $monthStart->toDateString())->count(),
            'hiredInWindow' => $hired,
            'hiredInWindowPrior' => $hiredPrior,
            'exitsInWindow' => $exits,
            'exitsInWindowPrior' => $exitsPrior,
            'netHeadcountChange' => $hired - $exits,
            'resigned' => Employee::whereIn('employment_status', self::STATUS_INACTIVE)->count(),
            // Accepted, dated, and not started yet.
            'futureHires' => Employee::whereNotIn('employment_status', self::STATUS_INACTIVE)
                ->whereDate('date_hired', '>', $now->toDateString())->count(),

            // Leavers over the window against average headcount, annualised.
            // Null rather than zero when there is nobody to divide by.
            'attritionPct' => $headcount > 0 ? round(($exits / $headcount) * 100, 1) : null,

            'presentToday' => $todayRecords->whereIn('status', ['Present', 'Late'])->count(),
            'stillClockedIn' => $todayRecords->whereNull('clock_out_at')->count(),
            'lateToday' => $todayRecords->where('status', 'Late')->count(),
            'onLeaveToday' => $todayRecords->where('status', 'On Leave')->count(),

            'daysRecordedThisMonth' => $windowAttendance->count(),
            'hoursThisMonth' => round($windowAttendance->sum(fn ($r) => (float) $r->hours_worked), 1),
            'hoursPrior' => round($priorAttendance->sum(fn ($r) => (float) $r->hours_worked), 1),
            'overtimeThisMonth' => round($windowAttendance->sum(fn ($r) => (float) $r->overtime_hours), 1),
            'overtimePrior' => round($priorAttendance->sum(fn ($r) => (float) $r->overtime_hours), 1),
            'lateInstancesThisMonth' => $windowAttendance->where('late_minutes', '>', 0)->count(),

            // Null until something has been recorded — zero would read as a
            // workforce that never turns up.
            'punctualityPct' => $windowAttendance->isEmpty()
                ? null
                : round(($windowAttendance->where('late_minutes', 0)->count() / $windowAttendance->count()) * 100, 1),
            'punctualityPctPrior' => $priorAttendance->isEmpty()
                ? null
                : round(($priorAttendance->where('late_minutes', 0)->count() / $priorAttendance->count()) * 100, 1),
            'absencesInWindow' => $windowAttendance->where('status', 'Absent')->count(),

            'pendingLeave' => LeaveRequest::where('status', 'For Approval')->count(),
            'approvedLeaveThisMonth' => LeaveRequest::where('status', 'Approved')
                ->whereDate('start_date', '>=', $monthStart->toDateString())->count(),

            'openCases' => EmployeeCase::whereIn('status', ['Open', 'Notice Issued', 'Hearing Scheduled'])->count(),
            'casesThisWindow' => EmployeeCase::whereDate('reported_on', '>=', $infractionWindow)->count(),
            'automaticCases' => EmployeeCase::where('is_automatic', true)
                ->whereDate('reported_on', '>=', $infractionWindow)->count(),
            'unacknowledgedCases' => EmployeeCase::whereNull('acknowledged_at')
                ->whereIn('status', ['Open', 'Notice Issued', 'Hearing Scheduled'])->count(),

            // This counted applicants and called them requisitions, so the
            // dashboard reported open vacancies it did not have. Both figures
            // are now here, each measuring what its name says.
            'openRequisitions' => JobRequisition::whereIn('status', ['Approved', 'Sourcing'])->count(),
            'seatsToFill' => (int) JobRequisition::whereIn('status', ['Approved', 'Sourcing'])
                ->selectRaw('COALESCE(SUM(GREATEST(headcount - filled, 0)), 0) AS seats')
                ->value('seats'),
            'activeApplicants' => Applicant::whereNotIn('stage', ['Hired', 'Rejected'])->count(),

            'expiringCertifications' => TrainingRecord::whereNotNull('expires_on')
                ->whereDate('expires_on', '<=', $now->addDays(60)->toDateString())
                ->whereDate('expires_on', '>=', $today)
                ->count(),

            'withoutSignIn' => (clone $active)->whereDoesntHave('user')->count(),
        ];
    }

    /* ---------------------------------------------------------------------- */
    /* Workforce shape */
    /* ---------------------------------------------------------------------- */

    /** Active headcount grouped by a belongsTo relation, biggest first. */
    private function headcountBy(string $relation, string $attribute = 'name'): array
    {
        return $this->employedOn(CarbonImmutable::now())
            ->with($relation)
            ->get()
            ->groupBy(fn (Employee $e) => $e->{$relation}->{$attribute} ?? 'Unassigned')
            ->map(fn ($rows, $name) => ['name' => $name, 'value' => $rows->count()])
            ->sortByDesc('value')
            ->values()
            ->all();
    }

    private function workforce(CarbonImmutable $now): array
    {
        $active = $this->employedOn($now)
            ->get(['birth_date', 'date_hired', 'civil_status', 'employment_status', 'per_hour', 'salary']);

        $band = function (array $buckets, callable $value) use ($active) {
            $out = array_fill_keys(array_keys($buckets), 0);
            foreach ($active as $e) {
                $v = $value($e);
                if ($v === null) {
                    continue;
                }
                foreach ($buckets as $name => $max) {
                    if ($v < $max) {
                        $out[$name]++;
                        break;
                    }
                }
            }

            return array_map(fn ($k, $v) => ['name' => $k, 'value' => $v], array_keys($out), $out);
        };

        return [
            'byDepartment' => $this->headcountBy('hrDepartment'),
            'byBranch' => $this->headcountBy('branchUnit', 'code'),
            'byBusinessGroup' => $this->headcountBy('businessGroup', 'code'),
            'byPayrollGroup' => $this->headcountBy('payrollGroup'),
            'byPosition' => array_slice($this->headcountBy('position', 'title'), 0, 12),

            'byStatus' => $active->groupBy('employment_status')
                ->map(fn ($rows, $status) => ['name' => $status, 'value' => $rows->count()])
                ->sortByDesc('value')->values()->all(),

            'byCivilStatus' => $active->groupBy(fn ($e) => match ($e->civil_status) {
                'S' => 'Single', 'M' => 'Married', 'D' => 'Divorced/Separated', 'W' => 'Widowed',
                default => 'Not stated',
            })->map(fn ($rows, $name) => ['name' => $name, 'value' => $rows->count()])
                ->sortByDesc('value')->values()->all(),

            // Tenure and age in years, banded. The bands are what HR plans
            // against — regularisation at six months, retirement at sixty.
            'byTenure' => $band(
                ['Under 6 months' => 0.5, '6–12 months' => 1, '1–3 years' => 3, '3–5 years' => 5, 'Over 5 years' => INF],
                fn ($e) => $e->date_hired ? $e->date_hired->diffInDays($now) / 365.25 : null,
            ),
            'byAge' => $band(
                ['Under 25' => 25, '25–34' => 35, '35–44' => 45, '45–54' => 55, '55 and over' => INF],
                fn ($e) => $e->birth_date ? $e->birth_date->diffInDays($now) / 365.25 : null,
            ),

            'headcount' => $active->count(),
            // Regularisation due inside 30 days: probationary staff whose six
            // months are nearly up. Missing this date is a legal problem, not
            // an administrative one — silence regularises them by default.
            'regularisationDue' => Employee::where('employment_status', self::STATUS_PROBATION)
                ->whereNotNull('date_hired')
                ->whereDate('date_hired', '<=', $now->subMonths(5)->toDateString())
                ->with(['position', 'hrDepartment'])
                ->orderBy('date_hired')
                ->limit(10)
                ->get()
                ->map(function (Employee $e) {
                    // Same check `hr:regularization-check` runs — shown here
                    // so the reason a name is not simply going to auto-flip
                    // is visible before the command ever runs, not after.
                    $poorReview = PerformanceReview::where('employee_id', $e->id)
                        ->where('status', 'Completed')
                        ->whereIn('rating', ['Unsatisfactory', 'Needs Improvement'])
                        ->where('updated_at', '>=', now()->subDays(60))
                        ->exists();

                    return [
                        'employeeId' => $e->id,
                        'employee' => $e->full_name,
                        'employeeNo' => $e->employee_no,
                        'position' => $e->position->title ?? null,
                        'department' => $e->hrDepartment->code ?? null,
                        'hired' => optional($e->date_hired)->toDateString(),
                        'dueOn' => optional($e->date_hired)?->addMonths(6)->toDateString(),
                        'flagged' => $poorReview,
                        'flagReason' => $poorReview
                            ? 'A recent review rated them Unsatisfactory or Needs Improvement — will not auto-regularise.'
                            : null,
                    ];
                })
                ->all(),
        ];
    }

    /* ---------------------------------------------------------------------- */
    /* Money */
    /* ---------------------------------------------------------------------- */

    /**
     * What the workforce costs, from the masterfile rather than from a run.
     *
     * Hourly staff are converted at the same 313/12 factor the payroll engine
     * uses, so the planning figure here and the computed figure on a payslip
     * are the same arithmetic rather than two guesses.
     */
    private function compensation(): array
    {
        $active = $this->employedOn(CarbonImmutable::now())
            ->with(['payrollGroup', 'hrDepartment'])
            ->get(['id', 'salary', 'per_hour', 'payroll_group_id', 'hr_department_id', 'minimum_wage_earner']);

        $monthly = fn (Employee $e) => $e->per_hour
            ? (float) $e->salary * 8 * (313 / 12)
            : (float) $e->salary;

        $total = $active->sum($monthly);

        $bandsOf = function ($rows) use ($monthly) {
            $buckets = ['Under ₱15k' => 15000, '₱15–20k' => 20000, '₱20–30k' => 30000,
                '₱30–45k' => 45000, '₱45k and over' => INF];
            $out = array_fill_keys(array_keys($buckets), 0);
            foreach ($rows as $e) {
                foreach ($buckets as $name => $max) {
                    if ($monthly($e) < $max) {
                        $out[$name]++;
                        break;
                    }
                }
            }

            return array_map(fn ($k, $v) => ['name' => $k, 'value' => $v], array_keys($out), $out);
        };

        return [
            'monthlyCost' => round($total, 2),
            'annualisedCost' => round($total * 12, 2),
            'averageMonthly' => $active->isEmpty() ? null : round($total / $active->count(), 2),
            'medianMonthly' => $active->isEmpty() ? null : round($active->map($monthly)->sort()->values()
                ->get((int) floor($active->count() / 2)) ?? 0, 2),
            'hourlyPaid' => $active->where('per_hour', true)->count(),
            'monthlyPaid' => $active->where('per_hour', false)->count(),
            'minimumWageEarners' => $active->where('minimum_wage_earner', true)->count(),
            'salaryBands' => $bandsOf($active),
            'costByDepartment' => $active
                ->groupBy(fn (Employee $e) => $e->hrDepartment->code ?? 'Unassigned')
                ->map(fn ($rows, $name) => ['name' => $name, 'value' => round($rows->sum($monthly), 2)])
                ->sortByDesc('value')->values()->all(),
            'costByPayrollGroup' => $active
                ->groupBy(fn (Employee $e) => $e->payrollGroup->name ?? 'Unassigned')
                ->map(fn ($rows, $name) => ['name' => $name, 'value' => round($rows->sum($monthly), 2)])
                ->sortByDesc('value')->values()->all(),
        ];
    }

    /** What payroll actually paid out inside the window. */
    private function payroll(
        CarbonImmutable $start,
        CarbonImmutable $end,
        CarbonImmutable $priorStart,
        CarbonImmutable $priorEnd,
    ): array {
        $computed = ['Computed', 'Approved', 'Released'];

        $inWindow = fn ($from, $to) => PayrollRun::query()
            ->whereIn('status', $computed)
            ->whereHas('payrollPeriod', fn ($q) => $q->whereBetween('pay_date', [$from, $to]));

        $runs = $inWindow($start->toDateString(), $end->toDateString())->with('payrollPeriod')->get();
        $prior = $inWindow($priorStart->toDateString(), $priorEnd->toDateString())->get();

        return [
            'runs' => $runs->count(),
            'headcountPaid' => (int) $runs->sum('headcount'),
            'gross' => round((float) $runs->sum('gross_pay'), 2),
            'net' => round((float) $runs->sum('net_pay'), 2),
            'netPrior' => round((float) $prior->sum('net_pay'), 2),
            'statutoryEmployee' => round((float) $runs->sum('statutory_employee'), 2),
            'statutoryEmployer' => round((float) $runs->sum('statutory_employer'), 2),
            'withholdingTax' => round((float) $runs->sum('withholding_tax'), 2),
            'totalDeductions' => round((float) $runs->sum('total_deductions'), 2),
            'employerCost' => round((float) $runs->sum('employer_cost'), 2),
            'awaitingApproval' => PayrollRun::where('status', 'Computed')->count(),
            'approvedNotReleased' => PayrollRun::where('status', 'Approved')->count(),
            'byPeriod' => $runs
                ->groupBy(fn (PayrollRun $r) => $r->payrollPeriod->code ?? '—')
                ->map(fn ($rows, $code) => [
                    'name' => $rows->first()->payrollPeriod->label ?? $code,
                    'gross' => round((float) $rows->sum('gross_pay'), 2),
                    'net' => round((float) $rows->sum('net_pay'), 2),
                    'employerCost' => round((float) $rows->sum('employer_cost'), 2),
                ])
                ->values()->all(),
        ];
    }

    /* ---------------------------------------------------------------------- */
    /* Leave, discipline, hiring, development */
    /* ---------------------------------------------------------------------- */

    private function leave(CarbonImmutable $now, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $requests = LeaveRequest::query()
            ->with('leaveType')
            ->whereBetween('start_date', [$start->toDateString(), $end->toDateString()])
            ->get();

        $balances = DB::table('leave_balances')
            ->join('leave_types', 'leave_types.id', '=', 'leave_balances.leave_type_id')
            ->where('leave_balances.year', $now->year)
            ->selectRaw('leave_types.name AS name')
            ->selectRaw('SUM(leave_balances.credits) AS credits')
            ->selectRaw('SUM(leave_balances.used) AS used')
            ->selectRaw('SUM(leave_balances.balance) AS balance')
            ->groupBy('leave_types.name')
            ->get();

        return [
            'filedInWindow' => $requests->count(),
            'daysTaken' => round((float) $requests->where('status', 'Approved')->sum('days'), 1),
            'pending' => LeaveRequest::where('status', 'For Approval')->count(),
            'byType' => $requests
                ->groupBy(fn (LeaveRequest $r) => $r->leaveType->name ?? 'Unspecified')
                ->map(fn ($rows, $name) => ['name' => $name, 'value' => $rows->count()])
                ->sortByDesc('value')->values()->all(),
            'byStatus' => $requests
                ->groupBy('status')
                ->map(fn ($rows, $status) => ['name' => $status, 'value' => $rows->count()])
                ->values()->all(),
            'balances' => $balances->map(fn ($r) => [
                'name' => $r->name,
                'credits' => round((float) $r->credits, 1),
                'used' => round((float) $r->used, 1),
                'balance' => round((float) $r->balance, 1),
                // What proportion of the entitlement has been taken. The
                // number HR is asked for at year end, when unused credits
                // either convert or lapse.
                'utilisationPct' => (float) $r->credits > 0
                    ? round(((float) $r->used / (float) $r->credits) * 100, 1)
                    : null,
            ])->all(),
        ];
    }

    private function recruitment(CarbonImmutable $start, CarbonImmutable $end): array
    {
        $applicants = Applicant::query()->with('position')->get();
        $inWindow = $applicants->filter(
            fn (Applicant $a) => $a->applied_on
                && $a->applied_on >= $start && $a->applied_on <= $end,
        );

        $stages = ['Applied', 'Screening', 'Interview', 'Assessment', 'Final Interview', 'Offer'];
        $active = $applicants->whereNotIn('stage', ['Hired', 'Rejected']);

        $hired = $applicants->where('stage', 'Hired');

        return [
            'openRequisitions' => JobRequisition::whereIn('status', ['Approved', 'Sourcing'])->count(),
            'seatsToFill' => (int) JobRequisition::whereIn('status', ['Approved', 'Sourcing'])
                ->selectRaw('COALESCE(SUM(GREATEST(headcount - filled, 0)), 0) AS seats')->value('seats'),
            'activeApplicants' => $active->count(),
            'appliedInWindow' => $inWindow->count(),
            'hiredInWindow' => $hired->filter(
                fn (Applicant $a) => $a->updated_at >= $start && $a->updated_at <= $end->endOfDay(),
            )->count(),
            'rejectedInWindow' => $applicants->where('stage', 'Rejected')->filter(
                fn (Applicant $a) => $a->updated_at >= $start && $a->updated_at <= $end->endOfDay(),
            )->count(),
            // The funnel, in pipeline order rather than by size — a funnel
            // sorted by volume is not a funnel.
            'funnel' => array_map(
                fn ($s) => ['name' => $s, 'value' => $active->where('stage', $s)->count()],
                $stages,
            ),
            'bySource' => $applicants
                ->groupBy(fn (Applicant $a) => $a->source ?: 'Unspecified')
                ->map(fn ($rows, $name) => ['name' => $name, 'value' => $rows->count()])
                ->sortByDesc('value')->values()->all(),
            'byPosition' => $active
                ->groupBy(fn (Applicant $a) => $a->position->title ?? 'Unspecified')
                ->map(fn ($rows, $name) => ['name' => $name, 'value' => $rows->count()])
                ->sortByDesc('value')->take(8)->values()->all(),
        ];
    }

    /**
     * The lifecycle figures a standard HRIS reports and this one did not:
     * turnover split by whether it was the person's choice, how long a hire
     * actually takes end to end, how often an offer is accepted, and how
     * many people who finished probation were kept on.
     */
    private function lifecycle(CarbonImmutable $start, CarbonImmutable $end): array
    {
        $active = (clone $this->employedOn(CarbonImmutable::now()))->count();

        $exitsInWindow = Employee::whereBetween('date_separated', [$start->toDateString(), $end->toDateString()])
            ->get(['employment_status']);
        $voluntary = $exitsInWindow->where('employment_status', self::STATUS_RESIGNED)->count();
        $involuntary = $exitsInWindow->where('employment_status', self::STATUS_TERMINATED)->count();

        // Annualised the same way `attritionPct` already is, so the two read
        // consistently against each other rather than on different scales.
        $days = max($start->diffInDays($end), 1);
        $annualise = fn (int $count) => $active > 0
            ? round(($count / $active) * (365 / $days) * 100, 1)
            : null;

        $hires = Employee::query()
            ->whereBetween('date_hired', [$start->toDateString(), $end->toDateString()])
            ->whereNotNull('hired_from_applicant_id')
            ->with('hiredFromApplicant')
            ->get()
            ->filter(fn (Employee $e) => $e->hiredFromApplicant?->applied_on);

        $timeToHireDays = $hires->isEmpty()
            ? null
            : round($hires->avg(
                fn (Employee $e) => CarbonImmutable::parse($e->hiredFromApplicant->applied_on)
                    ->diffInDays(CarbonImmutable::parse($e->date_hired)),
            ), 1);

        $offersAnswered = Applicant::whereNotNull('offer_sent_at')->whereNotNull('offer_response')->get(['offer_response']);
        $offerAcceptanceRate = $offersAnswered->isEmpty()
            ? null
            : round(($offersAnswered->where('offer_response', 'Accepted')->count() / $offersAnswered->count()) * 100, 1);

        // Everybody whose probation would be resolved by now — hired more
        // than six months ago — split by whether they made it to Regular or
        // left while still on probation. Employees still within their first
        // six months are excluded: their probation has not been decided yet,
        // and counting them as neither pass nor fail would understate both.
        $probationCutoff = CarbonImmutable::now()->subMonths(6)->toDateString();
        $resolved = Employee::query()
            ->whereDate('date_hired', '<=', $probationCutoff)
            ->whereNotNull('date_hired')
            ->get(['employment_status']);
        $converted = $resolved->where('employment_status', self::STATUS_REGULAR)->count();

        return [
            'voluntaryExitsInWindow' => $voluntary,
            'involuntaryExitsInWindow' => $involuntary,
            'voluntaryTurnoverPct' => $annualise($voluntary),
            'involuntaryTurnoverPct' => $annualise($involuntary),
            'timeToHireDays' => $timeToHireDays,
            'offersAnswered' => $offersAnswered->count(),
            'offerAcceptanceRate' => $offerAcceptanceRate,
            'probationResolved' => $resolved->count(),
            'probationConvertedToRegular' => $converted,
            'probationConversionRate' => $resolved->isEmpty() ? null : round(($converted / $resolved->count()) * 100, 1),
        ];
    }

    /**
     * What actually needs a person to act today, drawn from the same
     * services that feed the bell — a document expiring, an onboarding task
     * gone overdue, a separation waiting on clearance. The dashboard version
     * carries counts and a link; the bell carries the same underlying rows
     * worded as a notice.
     *
     * @return list<array{id: string, tone: string, title: string, count: int, link: string}>
     */
    private function alerts(): array
    {
        $items = [];

        $docRows = $this->documents->outstanding(200);
        $missingDocs = $docRows->sum('missing');
        $expiringDocs = $docRows->sum('expiringSoon');

        if ($missingDocs > 0) {
            $items[] = ['id' => 'documents-missing', 'tone' => 'warning',
                'title' => 'Required 201-file documents missing or unverified', 'count' => $missingDocs, 'link' => '/hr/documents'];
        }

        if ($expiringDocs > 0) {
            $items[] = ['id' => 'documents-expiring', 'tone' => 'warning',
                'title' => '201-file documents expiring within 30 days', 'count' => $expiringDocs, 'link' => '/hr/documents'];
        }

        $onboardingOverdue = $this->onboardingTasks->outstanding(200)->sum('overdue');

        if ($onboardingOverdue > 0) {
            $items[] = ['id' => 'onboarding-overdue', 'tone' => 'critical',
                'title' => 'Onboarding checklist items overdue', 'count' => $onboardingOverdue, 'link' => '/hr/employees'];
        }

        $offboardingRows = $this->offboarding->outstanding(200);
        $pendingClearance = $offboardingRows->where('clearanceStatus', '!=', 'Cleared')->count();

        if ($pendingClearance > 0) {
            $items[] = ['id' => 'offboarding-clearance', 'tone' => 'warning',
                'title' => 'Offboarding cases awaiting clearance', 'count' => $pendingClearance, 'link' => '/hr/offboarding'];
        }

        $pendingLeave = LeaveRequest::where('status', 'For Approval')->count();

        if ($pendingLeave > 0) {
            $items[] = ['id' => 'leave-pending', 'tone' => 'info',
                'title' => 'Leave requests awaiting approval', 'count' => $pendingLeave, 'link' => '/hr/leave'];
        }

        return $items;
    }

    private function performance(CarbonImmutable $now): array
    {
        $reviews = PerformanceReview::query()->get(['status', 'rating', 'score', 'due_date', 'period']);
        $completed = $reviews->where('status', 'Completed');

        return [
            'total' => $reviews->count(),
            'completed' => $completed->count(),
            'inProgress' => $reviews->whereNotIn('status', ['Completed', 'Not Started'])->count(),
            'notStarted' => $reviews->where('status', 'Not Started')->count(),
            'overdue' => $reviews->where('status', '!=', 'Completed')
                ->filter(fn ($r) => $r->due_date && $r->due_date->lt($now))->count(),
            'completionPct' => $reviews->isEmpty()
                ? null
                : round(($completed->count() / $reviews->count()) * 100, 1),
            'averageScore' => $completed->whereNotNull('score')->isEmpty()
                ? null
                : round((float) $completed->whereNotNull('score')->avg('score'), 2),
            'byStatus' => $reviews->groupBy('status')
                ->map(fn ($rows, $status) => ['name' => $status, 'value' => $rows->count()])
                ->values()->all(),
            'byRating' => collect(PerformanceOperations::BANDS)->pluck('rating')
                ->map(fn ($band) => ['name' => $band, 'value' => $completed->where('rating', $band)->count()])
                ->all(),
            'byCycle' => $reviews->groupBy('period')
                ->map(fn ($rows, $period) => [
                    'name' => $period,
                    'value' => $rows->count(),
                    'completed' => $rows->where('status', 'Completed')->count(),
                ])
                ->sortByDesc('value')->take(6)->values()->all(),
        ];
    }

    private function training(CarbonImmutable $now, CarbonImmutable $start, CarbonImmutable $end): array
    {
        $sessions = TrainingSession::query()
            ->whereBetween('scheduled_on', [$start->toDateString(), $end->toDateString()])
            ->get(['status', 'scheduled_on']);

        $expiring = TrainingRecord::query()
            ->with(['employee', 'trainingCourse'])
            ->whereNotNull('expires_on')
            ->whereDate('expires_on', '>=', $now->toDateString())
            ->whereDate('expires_on', '<=', $now->addDays(90)->toDateString())
            ->orderBy('expires_on')
            ->limit(10)
            ->get();

        return [
            'sessionsInWindow' => $sessions->count(),
            'sessionsCompleted' => $sessions->where('status', 'Completed')->count(),
            'attendeesInWindow' => DB::table('training_attendees')
                ->join('training_sessions', 'training_sessions.id', '=', 'training_attendees.training_session_id')
                ->whereBetween('training_sessions.scheduled_on', [$start->toDateString(), $end->toDateString()])
                ->count(),
            'certificatesHeld' => TrainingRecord::whereNotNull('certificate_no')->count(),
            'expiringSoon' => $expiring->count(),
            'expiring' => $expiring->map(fn (TrainingRecord $r) => [
                'employee' => $r->employee->full_name ?? null,
                'employeeNo' => $r->employee->employee_no ?? null,
                'course' => $r->trainingCourse->name ?? null,
                'expiresOn' => optional($r->expires_on)->toDateString(),
            ])->all(),
            'expired' => TrainingRecord::whereNotNull('expires_on')
                ->whereDate('expires_on', '<', $now->toDateString())->count(),
        ];
    }

    /**
     * Statutory coverage.
     *
     * Somebody with no SSS number cannot be remitted for, and the gap only
     * surfaces when the remittance is rejected — long after the cut-off it
     * belonged to. Counting them on the dashboard is how it gets fixed before
     * payroll rather than after.
     */
    private function compliance(): array
    {
        $active = $this->employedOn(CarbonImmutable::now());
        $total = (clone $active)->count();

        $missing = fn (string $column) => (clone $active)
            ->where(fn ($q) => $q->whereNull($column)->orWhere($column, '')->orWhere($column, 'N/A'))
            ->count();

        $gaps = [
            ['name' => 'TIN', 'value' => $missing('tin')],
            ['name' => 'SSS', 'value' => $missing('sss_no')],
            ['name' => 'PhilHealth', 'value' => $missing('philhealth_no')],
            ['name' => 'Pag-IBIG', 'value' => $missing('pagibig_no')],
            ['name' => 'ATM account', 'value' => $missing('atm_account')],
        ];

        return [
            'headcount' => $total,
            'gaps' => $gaps,
            'fullyDocumented' => $total - (clone $active)
                ->where(fn ($q) => $q
                    ->whereNull('tin')->orWhere('tin', 'N/A')
                    ->orWhereNull('sss_no')->orWhere('sss_no', 'N/A')
                    ->orWhereNull('philhealth_no')->orWhere('philhealth_no', 'N/A')
                    ->orWhereNull('pagibig_no')->orWhere('pagibig_no', 'N/A'))
                ->count(),
            'withoutSignIn' => (clone $active)->whereDoesntHave('user')->count(),
            'withoutShift' => (clone $active)->whereNull('shift_id')->count(),
            'withoutReportingLine' => (clone $active)->whereNull('reports_to_id')->count(),
            'withoutBankAccount' => $missing('atm_account'),
        ];
    }

    /* ---------------------------------------------------------------------- */

    private function infractionsByType(): array
    {
        $since = CarbonImmutable::now()->subDays(InfractionMonitor::WINDOW_DAYS)->toDateString();

        return EmployeeCase::query()
            ->whereDate('reported_on', '>=', $since)
            ->selectRaw('type, COUNT(*) AS total')
            ->groupBy('type')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => ['name' => $row->type, 'value' => (int) $row->total])
            ->all();
    }

    private function pendingLeave(): array
    {
        return LeaveRequest::query()
            ->with('employee', 'leaveType')
            ->where('status', 'For Approval')
            ->orderBy('start_date')
            ->limit(10)
            ->get()
            ->map(fn (LeaveRequest $r) => [
                'id' => $r->id,
                'no' => $r->request_no,
                'employee' => $r->employee->full_name ?? null,
                'employeeNo' => $r->employee->employee_no ?? null,
                'type' => $r->leaveType->name ?? null,
                'from' => optional($r->start_date)->toDateString(),
                'to' => optional($r->end_date)->toDateString(),
                'days' => (float) $r->days,
                'balanceBefore' => (float) $r->balance_before,
                'filed' => optional($r->filed_on)->toDateString(),
            ])
            ->all();
    }

    private function onLeaveToday(CarbonImmutable $now): array
    {
        return LeaveRequest::query()
            ->with('employee.hrDepartment', 'leaveType')
            ->where('status', 'Approved')
            ->whereDate('start_date', '<=', $now->toDateString())
            ->whereDate('end_date', '>=', $now->toDateString())
            ->get()
            ->map(fn (LeaveRequest $r) => [
                'employee' => $r->employee->full_name ?? null,
                'department' => $r->employee->hrDepartment->code ?? null,
                'type' => $r->leaveType->name ?? null,
                'until' => optional($r->end_date)->toDateString(),
            ])
            ->all();
    }
}
