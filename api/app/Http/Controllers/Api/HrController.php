<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeCase;
use App\Models\LeaveRequest;
use App\Models\PayrollPeriod;
use App\Models\Payslip;
use App\Models\PunchEvent;
use App\Services\DailyTimeRecord;
use App\Services\DueProcess;
use App\Services\HrAnalytics;
use App\Services\HrOperations;
use App\Services\InfractionMonitor;
use App\Services\NoticeDocuments;
use App\Services\PunchGuard;
use App\Services\TimeClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * HR endpoints with behaviour of their own, and the employee's own view.
 *
 * The self-service routes deliberately never take an employee id. They resolve
 * the employee from the signed-in account, so there is no parameter to tamper
 * with and no way to ask for somebody else's pay.
 */
class HrController extends Controller
{
    /**
     * The HR dashboard.
     *
     * `grain` buckets the trend by day, month or year; `from`/`to` narrow the
     * window. Omitting the dates means all of it, reached back as far as the
     * grain can sensibly show.
     */
    public function dashboard(Request $request, HrAnalytics $analytics): JsonResponse
    {
        $data = $request->validate([
            'period' => 'nullable|in:'.implode(',', HrAnalytics::PERIODS),
            'grain' => 'nullable|in:day,month,year',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        $period = $data['period'] ?? 'last_12m';
        $from = $data['from'] ?? null;
        $to = $data['to'] ?? null;
        $grain = $data['grain'] ?? null;

        // This one screen runs ~20 aggregate queries across the whole HR
        // domain (payroll, attendance, recruitment, performance...) to
        // answer a single request — real time on a live database, not
        // something worth re-running every time somebody flips between
        // period chips or reopens the tab. A minute-long cache keeps it
        // answering the same question from memory instead, without ever
        // being more than a minute behind what payroll or the punch clock
        // actually did.
        $key = 'hr-dashboard:'.md5(json_encode([$period, $from, $to, $grain]));

        return response()->json([
            'data' => Cache::remember($key, 60, fn () => $analytics->dashboard($period, $from, $to, $grain)),
        ]);
    }

    /**
     * Every active employee, flattened for the org chart to build a tree from.
     *
     * `reportsToId` is the only structure the client needs — it is simpler
     * (and cheaper) to walk a flat list into a tree in the browser than to
     * recurse a `with('manager.manager.manager...')` chain of unknown depth
     * on the server. Separated employees are left out entirely: a chart is a
     * picture of who works here today, not an org history.
     */
    public function orgChart(): JsonResponse
    {
        $employees = Employee::query()
            ->whereNull('date_separated')
            ->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED'])
            ->with(['hrDepartment', 'position', 'businessGroup'])
            ->orderBy('last_name')
            ->get();

        $rows = $employees->map(fn (Employee $e) => [
            'id' => $e->id,
            'name' => $e->full_name,
            'employeeNo' => $e->employee_no,
            'title' => $e->position?->title,
            'department' => $e->hrDepartment?->name,
            'businessGroupId' => $e->business_group_id,
            'businessGroup' => $e->businessGroup?->name,
            'reportsToId' => $e->reports_to_id,
            'photoUrl' => $e->photo_path ? route('public-files.show', ['path' => $e->photo_path]) : null,
            'x' => $e->org_chart_x,
            'y' => $e->org_chart_y,
        ]);

        return response()->json(['data' => $rows]);
    }

    /**
     * Where a card was dragged to on the canvas — never who reports to
     * whom. See the migration that added these two columns for why the
     * two are kept apart.
     */
    public function saveOrgChartPosition(Request $request, Employee $employee): JsonResponse
    {
        $data = $request->validate([
            'x' => 'required|numeric',
            'y' => 'required|numeric',
        ]);

        $employee->update(['org_chart_x' => $data['x'], 'org_chart_y' => $data['y']]);

        return response()->json(['data' => ['id' => $employee->id, 'x' => $employee->org_chart_x, 'y' => $employee->org_chart_y]]);
    }

    /**
     * Reassigns who an employee reports to — the tree view's own drag,
     * distinct from `saveOrgChartPosition`. This is the field the canvas's
     * connecting lines are actually drawn from, so dropping a row onto
     * another one here is a real change to the 201 file, not a layout
     * preference.
     *
     * Refuses a drop that would make someone their own manager's manager —
     * that is not a hierarchy at all, just a cycle, and the canvas has no
     * sane way to draw one.
     */
    public function reassignManager(Request $request, Employee $employee): JsonResponse
    {
        $data = $request->validate([
            'managerId' => 'nullable|integer|exists:employees,id',
        ]);

        $managerId = $data['managerId'] ?? null;

        if ($managerId === $employee->id) {
            return response()->json(['message' => 'An employee cannot report to themselves.'], 422);
        }

        if ($managerId !== null) {
            $cursor = Employee::find($managerId);
            $depth = 0;

            while ($cursor && $depth < 50) {
                if ($cursor->id === $employee->id) {
                    return response()->json([
                        'message' => 'That would make '.$employee->full_name." their own manager's manager — pick someone outside their own reporting line.",
                    ], 422);
                }
                $cursor = $cursor->reports_to_id ? Employee::find($cursor->reports_to_id) : null;
                $depth++;
            }
        }

        $employee->update(['reports_to_id' => $managerId]);

        return response()->json(['data' => ['id' => $employee->id, 'reportsToId' => $employee->reports_to_id]]);
    }

    /**
     * The daily time record for one employee over one cut-off.
     *
     * Takes either a payroll period — the cut-offs people actually think in —
     * or an explicit date range for the odd investigation that does not line
     * up with one.
     */
    public function dtr(Request $request, DailyTimeRecord $dtr): JsonResponse
    {
        $data = $request->validate([
            'employeeId' => 'required|integer|exists:employees,id',
            'periodId' => 'nullable|integer|exists:payroll_periods,id',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        $employee = Employee::findOrFail($data['employeeId']);

        if (! empty($data['periodId'])) {
            [$from, $to] = $dtr->periodWindow(PayrollPeriod::findOrFail($data['periodId']));
        } elseif (! empty($data['from']) && ! empty($data['to'])) {
            $from = CarbonImmutable::parse($data['from']);
            $to = CarbonImmutable::parse($data['to']);
        } else {
            return response()->json([
                'message' => 'Choose a payroll period, or give both a start and an end date.',
            ], 422);
        }

        // A DTR is printed and filed; an unbounded range would be neither.
        if ($from->diffInDays($to) > 92) {
            return response()->json(['message' => 'Choose a range of 92 days or less.'], 422);
        }

        return response()->json(['data' => $dtr->build($employee, $from, $to)]);
    }

    /**
     * The daily time record for every employee in one payroll group, over
     * one cut-off — the batch a payroll run is actually reconciled against.
     *
     * Same period-or-range contract as `dtr()` above, just applied once per
     * employee rather than to a single one. Capped at 200 employees: past
     * that, the response is large enough that the browser building it into a
     * print job is the slow part, not the query.
     */
    public function dtrBulk(Request $request, DailyTimeRecord $dtr): JsonResponse
    {
        $data = $request->validate([
            'payrollGroupId' => 'required|integer|exists:payroll_groups,id',
            'periodId' => 'nullable|integer|exists:payroll_periods,id',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        if (! empty($data['periodId'])) {
            [$from, $to] = $dtr->periodWindow(PayrollPeriod::findOrFail($data['periodId']));
        } elseif (! empty($data['from']) && ! empty($data['to'])) {
            $from = CarbonImmutable::parse($data['from']);
            $to = CarbonImmutable::parse($data['to']);
        } else {
            return response()->json([
                'message' => 'Choose a payroll period, or give both a start and an end date.',
            ], 422);
        }

        if ($from->diffInDays($to) > 92) {
            return response()->json(['message' => 'Choose a range of 92 days or less.'], 422);
        }

        $employees = Employee::query()
            ->where('payroll_group_id', $data['payrollGroupId'])
            ->whereNull('date_separated')
            ->orderBy('last_name')
            ->limit(200)
            ->get();

        if ($employees->isEmpty()) {
            return response()->json(['message' => 'No active employees are in that payroll group.'], 422);
        }

        return response()->json([
            'data' => $employees->map(fn (Employee $employee) => $dtr->build($employee, $from, $to))->values(),
        ]);
    }

    /** The cut-offs a DTR can be run for, newest first. */
    public function dtrPeriods(): JsonResponse
    {
        return response()->json([
            'data' => PayrollPeriod::query()
                ->orderByDesc('period_end')
                ->limit(36)
                ->get()
                ->map(fn (PayrollPeriod $p) => [
                    'id' => $p->id,
                    'label' => $p->label ?: $p->code,
                    'from' => optional($p->period_start)->toDateString(),
                    'to' => optional($p->period_end)->toDateString(),
                    'status' => $p->status,
                ]),
        ]);
    }

    /**
     * Where a disciplinary case stands against the process the law requires.
     *
     * Reports; never blocks. An employer who has skipped a step needs to see
     * that plainly, not be stopped from recording what actually happened.
     */
    public function caseDueProcess(EmployeeCase $case, DueProcess $process): JsonResponse
    {
        return response()->json([
            'data' => $process->forCase($case) + [
                'case' => [
                    'id' => $case->id,
                    'no' => $case->case_no,
                    'type' => $case->type,
                    'status' => $case->status,
                    'employee' => $case->employee->full_name ?? null,
                ],
            ],
        ]);
    }

    /** Records a due-process step against a case. */
    public function recordDueProcess(Request $request, EmployeeCase $case, DueProcess $process): JsonResponse
    {
        $data = $request->validate([
            'nteIssuedOn' => 'nullable|date',
            'nteResponseDueOn' => 'nullable|date|after_or_equal:nteIssuedOn',
            'nteDetails' => 'nullable|string|max:5000',
            'explanationReceivedOn' => 'nullable|date',
            'explanation' => 'nullable|string|max:5000',
            'hearingOn' => 'nullable|date',
            'hearingHeldOn' => 'nullable|date',
            'hearingNotes' => 'nullable|string|max:5000',
            'decisionOn' => 'nullable|date',
            'decisionFindings' => 'nullable|string|max:5000',
            'penalty' => 'nullable|string|max:80',
            'preventiveSuspensionFrom' => 'nullable|date',
            'preventiveSuspensionTo' => 'nullable|date|after_or_equal:preventiveSuspensionFrom',
            'doleNotifiedOn' => 'nullable|date',
        ]);

        $columns = [
            'nteIssuedOn' => 'nte_issued_on',
            'nteResponseDueOn' => 'nte_response_due_on',
            'nteDetails' => 'nte_details',
            'explanationReceivedOn' => 'explanation_received_on',
            'explanation' => 'explanation',
            'hearingOn' => 'hearing_on',
            'hearingHeldOn' => 'hearing_held_on',
            'hearingNotes' => 'hearing_notes',
            'decisionOn' => 'decision_on',
            'decisionFindings' => 'decision_findings',
            'penalty' => 'penalty',
            'preventiveSuspensionFrom' => 'preventive_suspension_from',
            'preventiveSuspensionTo' => 'preventive_suspension_to',
            'doleNotifiedOn' => 'dole_notified_on',
        ];

        $update = [];
        foreach ($data as $key => $value) {
            $update[$columns[$key]] = $value;
        }

        // Issuing the first notice without saying when the answer is due
        // silently removes the deadline the whole rule turns on.
        if (! empty($update['nte_issued_on']) && empty($update['nte_response_due_on']) && ! $case->nte_response_due_on) {
            $update['nte_response_due_on'] = CarbonImmutable::parse($update['nte_issued_on'])
                ->addDays(DueProcess::EXPLANATION_DAYS)
                ->toDateString();
        }

        $case->update($update);

        return response()->json(['data' => $process->forCase($case->fresh())]);
    }

    /**
     * The first notice, as a file — not just a date recorded against it.
     *
     * Stamps `nte_issued_on` (and, if it was not already set, the response
     * deadline) the first time the letter is actually produced, so the
     * date on the case record can never say "issued" when nothing was ever
     * generated. A re-download after that first time does not move the
     * date — it is the same notice printed again, not a new one.
     */
    public function caseNte(EmployeeCase $case, NoticeDocuments $documents): JsonResponse|Response
    {
        try {
            $file = $documents->noticeToExplain($case);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        if (! $case->nte_issued_on) {
            $case->update([
                'nte_issued_on' => now()->toDateString(),
                'nte_response_due_on' => $case->nte_response_due_on
                    ?? now()->addDays(DueProcess::EXPLANATION_DAYS)->toDateString(),
                'status' => $case->status === 'Open' ? 'Notice Issued' : $case->status,
            ]);
        }

        return response($file['bytes'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
            'Content-Length' => (string) strlen($file['bytes']),
        ]);
    }

    /** The second notice, as a file. Stamps `decision_on` the first time it is produced, same reasoning as the NTE. */
    public function caseNod(EmployeeCase $case, NoticeDocuments $documents): JsonResponse|Response
    {
        try {
            $file = $documents->noticeOfDecision($case);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        if (! $case->decision_on) {
            $case->update(['decision_on' => now()->toDateString()]);
        }

        return response($file['bytes'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
            'Content-Length' => (string) strlen($file['bytes']),
        ]);
    }

    /* ========================== Self service ========================== */

    /** Everything the signed-in employee can see about themselves. */
    public function me(Request $request, HrOperations $operations): JsonResponse
    {
        return response()->json(['data' => $operations->selfService($this->employee($request))]);
    }

    /**
     * My Attendance, filtered by cut-off — the self-service equivalent of
     * `dtr()` above, which only HR can reach. Same "period or explicit range,
     * never both" contract; neither given falls back to the last 30 days.
     */
    public function myAttendance(Request $request, HrOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'periodId' => 'nullable|integer|exists:payroll_periods,id',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        $period = ! empty($data['periodId']) ? PayrollPeriod::findOrFail($data['periodId']) : null;
        $from = ! empty($data['from']) ? CarbonImmutable::parse($data['from']) : null;
        $to = ! empty($data['to']) ? CarbonImmutable::parse($data['to']) : null;

        return response()->json([
            'data' => $operations->attendanceForRange($this->employee($request), $period, $from, $to),
        ]);
    }

    /** The cut-offs My Attendance can be filtered by — same list `dtrPeriods()` offers HR. */
    public function myPayrollPeriods(): JsonResponse
    {
        return $this->dtrPeriods();
    }

    /**
     * An employee correcting their own "Personal and statutory" card.
     *
     * The validated key list here IS the security boundary — see
     * HrOperations::updateOwnProfile, which only ever receives what passes
     * validation. Nothing employment-related (position, salary, department,
     * dates) is accepted, so there is no way to widen this into a self-edit
     * of the whole 201 file by adding a field to the request body.
     */
    public function updateProfile(Request $request, HrOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'civilStatus' => ['nullable', Rule::in(['S', 'M', 'D', 'W'])],
            'email' => ['nullable', 'email', 'max:150'],
            'mobile' => ['nullable', 'string', 'max:20'],
            'address' => ['nullable', 'string', 'max:255'],
            'paymentMode' => ['nullable', Rule::in(['ATM', 'CASH', 'CHEQUE'])],
            'tin' => ['nullable', 'string', 'max:32'],
            'sss' => ['nullable', 'string', 'max:32'],
            'philhealth' => ['nullable', 'string', 'max:32'],
            'pagibig' => ['nullable', 'string', 'max:32'],
        ]);

        // Only a key the request actually sent gets passed through — mapping
        // every one of the 9 with `?? null` regardless of presence is how an
        // omitted field became "set this to null", which broke `civil_status`
        // and `payment_mode`: both are NOT NULL enum columns with no blank
        // option, so a request that simply didn't mention one (rather than
        // deliberately clearing it) crashed the update instead of leaving it
        // alone.
        $columns = [
            'civilStatus' => 'civil_status', 'email' => 'email', 'mobile' => 'mobile',
            'address' => 'address', 'paymentMode' => 'payment_mode', 'tin' => 'tin',
            'sss' => 'sss_no', 'philhealth' => 'philhealth_no', 'pagibig' => 'pagibig_no',
        ];

        // `civil_status` and `payment_mode` are NOT NULL enum columns with no
        // blank option in the schema — a null here (the dropdown's own blank
        // choice, or simply the field never having been touched) is not a
        // legal value to write, so it is left alone rather than crashing.
        $neverNull = ['civil_status', 'payment_mode'];

        $updates = [];
        foreach ($columns as $field => $column) {
            if (array_key_exists($field, $data) && ! (in_array($column, $neverNull, true) && $data[$field] === null)) {
                $updates[$column] = $data[$field];
            }
        }

        $operations->updateOwnProfile($this->employee($request), $updates);

        return response()->json(['data' => $operations->selfService($this->employee($request))['profile']]);
    }

    /**
     * One of the signed-in employee's own payslips, in full — the same shape
     * `hr/payslips` gives HR, just scoped to one person's own record rather
     * than the whole company's. `findOrFail` alone would let anyone view any
     * payslip by id; the `where('employee_id', ...)` before it is what
     * actually stops that.
     */
    public function myPayslip(Request $request, Payslip $payslip): JsonResponse
    {
        $employee = $this->employee($request);

        abort_unless($payslip->employee_id === $employee->id, 404);

        $payslip->loadMissing(['employee.branchUnit', 'employee.position', 'employee.payrollGroup', 'payrollRun.payrollPeriod', 'lines']);

        return response()->json(['data' => [
            'id' => $payslip->id,
            'employeeId' => $payslip->employee_id,
            'employeeNo' => $payslip->employee->employee_no,
            'employee' => $payslip->employee->full_name,
            'payrollGroup' => $payslip->employee->payrollGroup->code ?? null,
            'branchUnit' => $payslip->employee->branchUnit->code ?? null,
            'positionTitle' => $payslip->employee->position->title ?? null,
            'atmAccount' => $payslip->atm_account,
            'period' => $payslip->payrollRun->payrollPeriod->code ?? null,
            'periodLabel' => $payslip->payrollRun->payrollPeriod->label ?? null,
            'runId' => $payslip->payroll_run_id,
            'runNo' => $payslip->payrollRun->run_no ?? null,
            'status' => $payslip->payrollRun->status ?? null,
            'hourlyRate' => (float) $payslip->hourly_rate,
            'dailyRate' => (float) $payslip->daily_rate,
            'monthlyEquivalent' => (float) $payslip->monthly_equivalent,
            'basicPay' => (float) $payslip->basic_pay,
            'overtimePay' => (float) $payslip->overtime_pay,
            'nightDiffPay' => (float) $payslip->night_diff_pay,
            'restDayPay' => (float) $payslip->rest_day_pay,
            'holidayPay' => (float) $payslip->holiday_pay,
            'leavePay' => (float) $payslip->leave_pay,
            'taxableAllowances' => (float) $payslip->taxable_allowances,
            'nonTaxableAllowances' => (float) $payslip->non_taxable_allowances,
            'lateDeduction' => (float) $payslip->late_deduction,
            'undertimeDeduction' => (float) $payslip->undertime_deduction,
            'absenceDeduction' => (float) $payslip->absence_deduction,
            'sssSalaryCredit' => (float) $payslip->sss_salary_credit,
            'sssEmployee' => (float) $payslip->sss_employee,
            'sssEmployer' => (float) $payslip->sss_employer,
            'philhealthEmployee' => (float) $payslip->philhealth_employee,
            'philhealthEmployer' => (float) $payslip->philhealth_employer,
            'pagibigEmployee' => (float) $payslip->pagibig_employee,
            'pagibigEmployer' => (float) $payslip->pagibig_employer,
            'taxableIncome' => (float) $payslip->taxable_income,
            'withholdingTax' => (float) $payslip->withholding_tax,
            'otherDeductions' => (float) $payslip->other_deductions,
            'deductionLines' => Computed::payslipDeductionLines($payslip),
            'earningLines' => Computed::payslipEarningLines($payslip),
            'thirteenthMonthAccrual' => (float) $payslip->thirteenth_month_accrual,
            'employerCost' => (float) $payslip->employer_cost,
            'grossPay' => (float) $payslip->gross_pay,
            'totalDeductions' => (float) $payslip->total_deductions,
            'netPay' => (float) $payslip->net_pay,
        ]]);
    }

    /** One press of the clock: in, break-out, break-in, out, or the separate ot-in/ot-out pair. */
    public function punch(Request $request, TimeClock $clock): JsonResponse
    {
        $data = $request->validate([
            'action' => 'required|in:in,break-out,break-in,out,ot-in,ot-out',
            // Proves who pressed it. The account cannot, because everybody
            // signs in with the same default password.
            'pin' => 'nullable|string|max:12',
            // A per-browser identifier the client keeps, so a shared terminal
            // is visible. Not a security control on its own.
            'deviceId' => 'nullable|string|max:64',
        ]);

        $employee = $this->employee($request);

        $record = $clock->punch($employee, $data['action'], null, [
            'pin' => $data['pin'] ?? null,
            'deviceId' => $data['deviceId'] ?? null,
            'ip' => $request->ip(),
            'userAgent' => $request->userAgent(),
        ]);

        return response()->json([
            'data' => [
                'action' => $data['action'],
                'record' => [
                    'id' => $record->id,
                    'date' => optional($record->work_date)->toDateString(),
                    'hoursWorked' => (float) $record->hours_worked,
                    'lateMinutes' => (int) $record->late_minutes,
                    'status' => $record->status,
                ],
                'clock' => $clock->state($employee),
            ],
        ]);
    }

    /** Where the signed-in employee stands right now, for the punch screen. */
    public function clockState(Request $request, TimeClock $clock): JsonResponse
    {
        return response()->json(['data' => $clock->state($this->employee($request))]);
    }

    /** Files leave for the signed-in employee. */
    public function fileLeave(Request $request, HrOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'leaveTypeId' => 'required|integer|exists:leave_types,id',
            'startDate' => 'required|date',
            'endDate' => 'required|date|after_or_equal:startDate',
            'days' => 'nullable|numeric|min:0.5|max:365',
            'reason' => 'nullable|string|max:255',
        ]);

        $leave = $operations->fileLeave($this->employee($request), $data);

        return response()->json([
            'data' => [
                'id' => $leave->id,
                'no' => $leave->request_no,
                'type' => $leave->leaveType->name ?? null,
                'days' => (float) $leave->days,
                'balanceBefore' => (float) $leave->balance_before,
                'status' => $leave->status,
            ],
        ], 201);
    }

    /** The employee confirms they have seen an infraction notice. */
    public function acknowledgeCase(Request $request, EmployeeCase $case, InfractionMonitor $monitor): JsonResponse
    {
        $employee = $this->employee($request);

        // A notice can only be acknowledged by the person it is against.
        if ((int) $case->employee_id !== (int) $employee->id) {
            throw ValidationException::withMessages([
                'case' => 'That notice is not yours to acknowledge.',
            ]);
        }

        $acknowledged = $monitor->acknowledge($case);

        return response()->json([
            'data' => [
                'id' => $acknowledged->id,
                'no' => $acknowledged->case_no,
                'acknowledgedAt' => optional($acknowledged->acknowledged_at)->toIso8601String(),
            ],
        ]);
    }

    /* =============================== PIN =============================== */

    /**
     * Sets or changes the signed-in employee's punch PIN.
     *
     * Deliberately separate from the account password: the password is shared
     * by design so people can sign in easily, and the PIN is the thing that
     * makes a punch theirs.
     */
    public function setPin(Request $request, PunchGuard $guard): JsonResponse
    {
        $data = $request->validate([
            'pin' => 'required|string',
            'currentPin' => 'nullable|string',
        ]);

        $employee = $this->employee($request);
        $guard->setPin($employee, $data['pin'], $data['currentPin'] ?? null);

        return response()->json([
            'data' => ['set' => true, 'employee' => $employee->full_name],
        ]);
    }

    /* ========================== Punch integrity ======================== */

    /**
     * Punches that looked like somebody else's.
     *
     * Detection rather than prevention — these were all accepted at the time,
     * because refusing them would let anyone mark a colleague absent by sharing
     * a device with them.
     */
    public function suspiciousPunches(Request $request, PunchGuard $guard): JsonResponse
    {
        $data = $request->validate(['withinDays' => 'nullable|integer|min:1|max:365']);
        $since = now()->subDays($data['withinDays'] ?? 30)->startOfDay();

        $events = PunchEvent::query()
            ->with('employee.hrDepartment')
            ->where('is_flagged', true)
            ->where('punched_at', '>=', $since)
            ->orderByDesc('punched_at')
            ->limit(200)
            ->get();

        // Devices used by more than one person, whether or not any single
        // punch tripped the threshold — the pattern is the finding.
        $devices = PunchEvent::query()
            ->whereNotNull('device_id')
            ->where('punched_at', '>=', $since)
            ->get(['device_id', 'employee_id', 'punched_at'])
            ->groupBy('device_id')
            ->map(fn ($rows) => [
                'deviceId' => substr((string) $rows->first()->device_id, 0, 12),
                'employees' => $rows->pluck('employee_id')->unique()->count(),
                'punches' => $rows->count(),
                'lastSeen' => optional($rows->max('punched_at'))->toIso8601String(),
            ])
            ->filter(fn ($row) => $row['employees'] > 1)
            ->sortByDesc('employees')
            ->take(20)
            ->values()
            ->all();

        return response()->json([
            'data' => [
                'config' => $guard->config(),
                'flagged' => $events->map(fn (PunchEvent $e) => [
                    'id' => $e->id,
                    'employee' => $e->employee->full_name ?? null,
                    'employeeNo' => $e->employee->employee_no ?? null,
                    'department' => $e->employee->hrDepartment->code ?? null,
                    'action' => $e->action,
                    'punchedAt' => optional($e->punched_at)->toIso8601String(),
                    'deviceId' => $e->device_id ? substr($e->device_id, 0, 12) : null,
                    'ipAddress' => $e->ip_address,
                    'reason' => $e->flag_reason,
                ])->all(),
                'sharedDevices' => $devices,
                'employeesWithoutPin' => Employee::query()
                    ->where('employment_status', '!=', 'RESIGNED')
                    ->whereNull('punch_pin')
                    ->count(),
            ],
        ]);
    }

    /* ============================== Leave ============================= */

    public function decideLeave(Request $request, LeaveRequest $leave, HrOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'decision' => 'required|in:Approved,Rejected,Cancelled',
        ]);

        $decided = $operations->decideLeave(
            $leave,
            $data['decision'],
            $request->user()?->employee_id,
        );

        return response()->json([
            'data' => [
                'id' => $decided->id,
                'no' => $decided->request_no,
                'employee' => $decided->employee->full_name ?? null,
                'days' => (float) $decided->days,
                'balanceAfter' => (float) $decided->balance_after,
                'status' => $decided->status,
            ],
        ]);
    }

    /* =========================== Infractions ========================== */

    /** Raises cases for tardiness and absence found in the attendance log. */
    public function scanInfractions(Request $request, InfractionMonitor $monitor): JsonResponse
    {
        $data = $request->validate([
            'withinDays' => 'nullable|integer|min:1|max:365',
            'employeeId' => 'nullable|integer|exists:employees,id',
        ]);

        $result = $monitor->scan($data['withinDays'] ?? null, $data['employeeId'] ?? null);

        return response()->json(['data' => $result], $result['raised'] > 0 ? 201 : 200);
    }

    /** Opens a case by hand, for the things attendance cannot see. */
    public function raiseCase(Request $request, InfractionMonitor $monitor): JsonResponse
    {
        $data = $request->validate([
            'employeeId' => 'required|integer|exists:employees,id',
            'type' => 'required|in:Tardiness,Absence Without Leave,Policy Violation,Safety Incident,Performance,Grievance',
            'details' => 'nullable|string|max:2000',
        ]);

        $case = $monitor->raise(
            Employee::findOrFail($data['employeeId']),
            $data['type'],
            $data['details'] ?? null,
            handledBy: $request->user()?->employee_id,
        );

        return response()->json([
            'data' => [
                'id' => $case->id,
                'no' => $case->case_no,
                'type' => $case->type,
                'severity' => $case->severity,
                'action' => $case->action,
                'points' => (int) $case->points,
            ],
        ], 201);
    }

    /** Employees carrying the most infraction points. */
    public function watchlist(InfractionMonitor $monitor): JsonResponse
    {
        return response()->json(['data' => $monitor->watchlist(20)]);
    }

    /* ============================ Accounts ============================ */

    /** Puts an employee's sign-in back to the shared default. */
    public function resetPassword(Request $request, Employee $employee, HrOperations $operations): JsonResponse
    {
        $data = $request->validate([
            'mustChange' => 'nullable|boolean',
        ]);

        $result = $operations->resetPassword($employee, null, (bool) ($data['mustChange'] ?? false));

        return response()->json([
            'data' => [
                'employee' => $employee->full_name,
                'username' => $result['username'],
                'password' => $result['password'],
                'mustChange' => $result['mustChange'],
            ],
        ]);
    }

    /* ---------------------------------------------------------------------- */

    /**
     * The employee behind the signed-in account.
     *
     * @throws ValidationException
     */
    private function employee(Request $request): Employee
    {
        $employee = $request->user()?->employee;

        if (! $employee) {
            throw ValidationException::withMessages([
                'employee' => 'This account is not linked to an employee record, so it has no timesheet of its own.',
            ]);
        }

        return $employee;
    }
}
