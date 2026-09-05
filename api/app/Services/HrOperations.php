<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\LeaveBalance;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * HR actions that decide something, and the self-service payload.
 *
 * Leave is the interesting one: approving it has to move a balance, and a
 * balance that is not moved by the approval is a number that will be wrong by
 * the end of the month.
 */
class HrOperations
{
    public function __construct(
        private readonly AuditLogger $audit,
        private readonly TimeClock $clock,
        private readonly InfractionMonitor $infractions,
        private readonly TrainingOperations $training,
        private readonly PerformanceOperations $performance,
    ) {}

    /* ============================== Leave ============================= */

    /**
     * Files a leave request against the employee's balance.
     *
     * The balance at the moment of filing is recorded on the request, because
     * "you had eight days when you asked" is the fact a dispute turns on — not
     * what the balance happens to be when somebody opens the record later.
     *
     * @throws ValidationException
     */
    public function fileLeave(Employee $employee, array $data): LeaveRequest
    {
        return DB::transaction(function () use ($employee, $data) {
            $start = CarbonImmutable::parse($data['startDate']);
            $end = CarbonImmutable::parse($data['endDate']);

            if ($end->lt($start)) {
                throw ValidationException::withMessages([
                    'endDate' => 'Leave cannot end before it starts.',
                ]);
            }

            $days = (float) ($data['days'] ?? ($start->diffInDays($end) + 1));

            $balance = $this->balanceFor($employee, (int) $data['leaveTypeId']);

            $overlapping = LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->whereIn('status', ['For Approval', 'Approved'])
                ->whereDate('start_date', '<=', $end->toDateString())
                ->whereDate('end_date', '>=', $start->toDateString())
                ->exists();

            if ($overlapping) {
                throw ValidationException::withMessages([
                    'startDate' => 'You already have leave filed over these dates.',
                ]);
            }

            $request = LeaveRequest::create([
                'request_no' => $this->nextNumber(LeaveRequest::class, 'request_no', 'LV-'),
                'employee_id' => $employee->id,
                'leave_type_id' => $data['leaveTypeId'],
                'start_date' => $start->toDateString(),
                'end_date' => $end->toDateString(),
                'days' => $days,
                'balance_before' => $balance?->balance ?? 0,
                'balance_after' => max(0, ($balance?->balance ?? 0) - $days),
                'reason' => $data['reason'] ?? null,
                'filed_on' => now()->toDateString(),
                'status' => $data['status'] ?? 'For Approval',
            ]);

            $this->audit->log('filed a leave request', 'LeaveRequest', $request->id, $request->request_no, 'hr');

            return $request->fresh(['leaveType', 'employee']);
        });
    }

    /**
     * Approves leave and takes the days off the balance.
     *
     * @throws ValidationException
     */
    public function decideLeave(LeaveRequest $request, string $decision, ?int $approverId = null): LeaveRequest
    {
        if (! in_array($decision, ['Approved', 'Rejected', 'Cancelled'], true)) {
            throw ValidationException::withMessages(['status' => "Unknown decision [{$decision}]."]);
        }

        if (in_array($request->status, ['Approved', 'Rejected', 'Cancelled'], true)) {
            throw ValidationException::withMessages([
                'status' => "{$request->request_no} has already been decided.",
            ]);
        }

        return DB::transaction(function () use ($request, $decision, $approverId) {
            $balance = $this->balanceFor($request->employee, (int) $request->leave_type_id);

            if ($decision === 'Approved') {
                if ($balance && (float) $balance->balance < (float) $request->days) {
                    throw ValidationException::withMessages([
                        'days' => sprintf(
                            'Only %s day(s) left on this leave type — the request is for %s.',
                            rtrim(rtrim(number_format((float) $balance->balance, 2), '0'), '.'),
                            rtrim(rtrim(number_format((float) $request->days, 2), '0'), '.'),
                        ),
                    ]);
                }

                if ($balance) {
                    $balance->forceFill([
                        'used' => (float) $balance->used + (float) $request->days,
                        'balance' => (float) $balance->balance - (float) $request->days,
                    ])->save();
                }
            }

            $request->forceFill([
                'status' => $decision,
                'approver_id' => $approverId,
                'decided_at' => now(),
                'balance_after' => $balance?->balance ?? $request->balance_after,
            ])->save();

            $this->audit->log(
                strtolower($decision).' a leave request',
                'LeaveRequest',
                $request->id,
                $request->request_no,
                'hr',
            );

            return $request->fresh(['leaveType', 'employee', 'approver']);
        });
    }

    /* ========================== Self service ========================== */

    /**
     * Everything an employee can see about themselves.
     *
     * Deliberately assembled here rather than left to the client to stitch out
     * of a dozen list endpoints — each of which would need scoping, and any one
     * of which getting it wrong would show somebody another person's pay.
     */
    public function selfService(Employee $employee): array
    {
        $employee->loadMissing(['hrDepartment', 'branchUnit', 'position', 'payrollGroup', 'shift', 'businessGroup']);

        $attendance = AttendanceRecord::query()
            ->where('employee_id', $employee->id)
            ->orderByDesc('work_date')
            ->limit(30)
            ->get();

        $payslips = Payslip::query()
            ->with('payrollRun.payrollPeriod')
            ->where('employee_id', $employee->id)
            ->orderByDesc('id')
            ->limit(12)
            ->get();

        $leave = LeaveRequest::query()
            ->with('leaveType', 'approver')
            ->where('employee_id', $employee->id)
            ->orderByDesc('filed_on')
            ->limit(20)
            ->get();

        $balances = LeaveBalance::query()
            ->with('leaveType')
            ->where('employee_id', $employee->id)
            ->get();

        $monthStart = CarbonImmutable::now()->startOfMonth();
        $thisMonth = $attendance->filter(
            fn ($r) => CarbonImmutable::parse($r->work_date)->gte($monthStart),
        );

        return [
            'profile' => [
                'id' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                'firstName' => $employee->first_name,
                'position' => $employee->position->title ?? null,
                // Drives whether the overtime clock buttons show at all — see
                // PunchClock.tsx. A manager or supervisor works the hours the
                // job needs, not a shift with a straight-overtime tail, so
                // the pair only makes sense for rank and file.
                'isManagerial' => (bool) ($employee->position->is_managerial ?? false),
                'department' => $employee->hrDepartment->name ?? null,
                'departmentCode' => $employee->hrDepartment->code ?? null,
                'branch' => $employee->branchUnit->code ?? null,
                'group' => $employee->businessGroup->code ?? null,
                'dateHired' => optional($employee->date_hired)->toDateString(),
                'employmentStatus' => $employee->employment_status,
                'email' => $employee->email,
                'birthDate' => optional($employee->birth_date)->toDateString(),
                'civilStatus' => $employee->civil_status,
                'payrollGroup' => $employee->payrollGroup->code ?? null,
                'paymentMode' => $employee->payment_mode,
                // Statutory numbers are the employee's own and they routinely
                // need to quote them; pay rate is deliberately not here.
                'tin' => $employee->tin,
                'sss' => $employee->sss_no,
                'philhealth' => $employee->philhealth_no,
                'pagibig' => $employee->pagibig_no,
                'mobile' => $employee->mobile,
                'address' => $employee->address,
                'shift' => $employee->shift->name ?? null,
            ],
            'clock' => $this->clock->state($employee),
            'attendance' => $this->mapAttendance($attendance),
            'attendanceSummary' => [
                'daysThisMonth' => $thisMonth->count(),
                'hoursThisMonth' => round($thisMonth->sum(fn ($r) => (float) $r->hours_worked), 2),
                'lateThisMonth' => $thisMonth->where('late_minutes', '>', 0)->count(),
                'lateMinutesThisMonth' => (int) $thisMonth->sum('late_minutes'),
                'overtimeThisMonth' => round($thisMonth->sum(fn ($r) => (float) $r->overtime_hours), 2),
                'absentThisMonth' => $thisMonth->where('status', 'Absent')->count(),
            ],
            'leave' => [
                'balances' => $balances->map(fn (LeaveBalance $b) => [
                    'type' => $b->leaveType->name ?? null,
                    'typeId' => $b->leave_type_id,
                    'entitled' => (float) $b->credits,
                    'used' => (float) $b->used,
                    'balance' => (float) $b->balance,
                ])->all(),
                /*
                 * Every leave type that exists, regardless of whether this
                 * employee has a balance row for it yet.
                 *
                 * The "File leave" dropdown used to be built from `balances`
                 * alone, so a type HR had not opened a balance for — the
                 * common case for a type this employee has never had reason
                 * to take — was invisible in the form, not just showing zero.
                 * `Filing` still checks the actual balance at approval time,
                 * so listing a type nobody has credits for yet is safe: it
                 * files, and gets refused on review rather than silently
                 * disappearing from the form.
                 */
                'leaveTypes' => LeaveType::where('is_active', true)->orderBy('name')->get(['id', 'name'])
                    ->map(fn (LeaveType $t) => ['id' => $t->id, 'name' => $t->name])->all(),
                'requests' => $leave->map(fn (LeaveRequest $r) => [
                    'id' => $r->id,
                    'no' => $r->request_no,
                    'type' => $r->leaveType->name ?? null,
                    'from' => optional($r->start_date)->toDateString(),
                    'to' => optional($r->end_date)->toDateString(),
                    'days' => (float) $r->days,
                    'reason' => $r->reason,
                    'filed' => optional($r->filed_on)->toDateString(),
                    'approver' => $r->approver->full_name ?? null,
                    'status' => $r->status,
                ])->all(),
            ],
            'payslips' => $payslips->map(fn (Payslip $p) => [
                'id' => $p->id,
                'period' => $p->payrollRun->payrollPeriod->name
                    ?? optional($p->payrollRun?->payrollPeriod?->period_end)->toDateString()
                    ?? 'Payslip',
                'grossPay' => (float) $p->gross_pay,
                'totalDeductions' => (float) $p->total_deductions,
                'netPay' => (float) $p->net_pay,
                'atmAccount' => $p->atm_account,
            ])->all(),
            'infractions' => $this->infractions->recordFor($employee),
            // Somebody whose forklift licence lapses next month is the person
            // who most needs to know, so their certifications sit on their own
            // page rather than only in HR's.
            'training' => $this->training->certificatesFor($employee),
            // Only completed reviews carry a score and rating — see
            // PerformanceOperations. An open cycle shows as in progress and
            // nothing more.
            'reviews' => $this->performance->reviewsFor($employee),
        ];
    }

    /**
     * An employee correcting their own personal and statutory details.
     *
     * Deliberately narrow — the same 8 fields the "Personal and statutory"
     * card on their own screen shows, nothing from the "Employment" card
     * beside it. Position, department, salary, dates and every other field
     * HR alone is trusted with stay entirely out of reach here: this method
     * only ever receives the keys `rules()` below validated, so there is no
     * path from this endpoint to anything else on the 201 file.
     */
    public function updateOwnProfile(Employee $employee, array $data): Employee
    {
        $employee->update(array_intersect_key($data, array_flip([
            'civil_status', 'email', 'mobile', 'address', 'payment_mode',
            'tin', 'sss_no', 'philhealth_no', 'pagibig_no',
        ])));

        $this->audit->log('updated their personal and statutory details', 'Employee', $employee->id, $employee->full_name, 'self-service');

        return $employee->fresh();
    }

    /**
     * One employee's attendance for a payroll cut-off, or an explicit range —
     * the self-service equivalent of HrController::dtr(), which only HR can
     * reach. Defaults to the last 30 days when neither is given, matching
     * what `selfService()` shows on first load.
     */
    public function attendanceForRange(Employee $employee, ?PayrollPeriod $period, ?CarbonImmutable $from, ?CarbonImmutable $to): array
    {
        $query = AttendanceRecord::query()->where('employee_id', $employee->id)->orderByDesc('work_date');

        if ($period) {
            $query->whereBetween('work_date', [$period->period_start, $period->period_end]);
        } elseif ($from && $to) {
            $query->whereBetween('work_date', [$from->toDateString(), $to->toDateString()]);
        } else {
            $query->limit(30);
        }

        return $this->mapAttendance($query->get());
    }

    /** @return array<int, array<string, mixed>> */
    private function mapAttendance(\Illuminate\Support\Collection $records): array
    {
        return $records->map(fn (AttendanceRecord $r) => [
            'id' => $r->id,
            'date' => CarbonImmutable::parse($r->work_date)->toDateString(),
            'clockIn' => optional($r->clock_in_at)->toIso8601String(),
            'breakOut' => optional($r->break_out_at)->toIso8601String(),
            'breakIn' => optional($r->break_in_at)->toIso8601String(),
            'clockOut' => optional($r->clock_out_at)->toIso8601String(),
            'hoursWorked' => (float) $r->hours_worked,
            'breakMinutes' => (int) $r->break_minutes,
            'lateMinutes' => (int) $r->late_minutes,
            'undertimeMinutes' => (int) $r->undertime_minutes,
            'overtimeHours' => (float) $r->overtime_hours,
            'status' => $r->status,
        ])->all();
    }

    /* ============================ Accounts ============================ */

    /**
     * Puts an employee's sign-in back to the shared default.
     *
     * Their username is their employee number without the branch prefix — the
     * number staff already know and quote — so a reset needs nothing else
     * explaining to them.
     */
    public function resetPassword(Employee $employee, ?string $password = null, bool $mustChange = false): array
    {
        $user = $employee->user;

        /*
         * The password is the last four digits of the mobile number on the
         * 201 file, or a random one when there is no usable number.
         *
         * It used to be a single fixed default for everybody, which meant one
         * string opened every account in the company that had not been
         * changed. Deriving it per person is weaker than a random password and
         * stronger than that — see PasswordIssuer for what the trade costs.
         */
        $issued = app(PasswordIssuer::class)->issue($employee);
        $plain = $password ?? $issued['password'];

        if (! $user) {
            $user = User::create([
                'name' => $employee->full_name,
                'username' => $this->usernameFor($employee),
                'email' => $employee->email,
                'password' => Hash::make($plain),
                'employee_id' => $employee->id,
                'status' => 'Active',
                'must_change_password' => $mustChange,
            ]);
        } else {
            $user->forceFill([
                'password' => Hash::make($plain),
                'must_change_password' => $mustChange,
                'failed_attempts' => 0,
                'locked_until' => null,
                'status' => 'Active',
            ])->save();
        }

        $this->audit->log('reset an employee sign-in', 'User', $user->id, $employee->full_name, 'hr');

        return [
            'username' => $user->username,
            'password' => $plain,
            'source' => $password ? 'given' : $issued['source'],
            // Null unless the phone rule could not be applied, in which case
            // it says why — so HR can fix the record rather than guess.
            'reason' => $password ? null : $issued['reason'],
            'mustChange' => (bool) $user->must_change_password,
        ];
    }

    /**
     * The sign-in name for an employee number.
     *
     * `UNI1438` becomes `1438`. The branch prefix means nothing to the person
     * typing it and is the part they get wrong.
     */
    public function usernameFor(Employee $employee): string
    {
        $digits = preg_replace('/\D+/', '', (string) $employee->employee_no);

        return $digits !== '' ? $digits : (string) $employee->employee_no;
    }

    /* ---------------------------------------------------------------------- */

    private function balanceFor(?Employee $employee, int $leaveTypeId): ?LeaveBalance
    {
        if (! $employee) {
            return null;
        }

        return LeaveBalance::query()
            ->where('employee_id', $employee->id)
            ->where('leave_type_id', $leaveTypeId)
            ->where('year', (int) date('Y'))
            ->first();
    }

    private function nextNumber(string $model, string $column, string $prefix): string
    {
        $stem = $prefix.date('Y').'-';

        $last = $model::query()
            ->where($column, 'like', $stem.'%')
            ->orderByDesc($column)
            ->lockForUpdate()
            ->value($column);

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
