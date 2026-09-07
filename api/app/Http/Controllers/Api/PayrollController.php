<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LegalEntity;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\Payslip;
use App\Models\PayslipLine;
use App\Models\User;
use App\Services\AubTemplateExporter;
use App\Services\PayrollAdjustments;
use App\Services\PayrollEngine;
use App\Services\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Running payroll.
 *
 * A run moves Draft → Computed → Approved → Released, and each step means
 * something: computed produces the register, approved is somebody signing it
 * off, released is money leaving. The transitions are one-way past approval
 * because a released run has already been paid — correcting one is a reversal,
 * not an edit.
 */
class PayrollController extends Controller
{
    public function __construct(
        private readonly PayrollEngine $engine,
        private readonly PayrollAdjustments $adjustments,
        private readonly Settings $settings,
    ) {}

    /**
     * Generates the semi-monthly cut-offs for a year.
     *
     * The 1st–15th and 16th–end pattern every Philippine payroll uses. Doing
     * it in one action rather than twenty-four forms is the difference between
     * payroll being set up and payroll being abandoned halfway through.
     *
     * Pay dates come from the company's own pay schedule (Settings →
     * Payroll), not a guessed lag after the cut-off: the 1st–15th cut-off
     * pays out on `first_half_pay_day` the same month, and the 16th–end
     * cut-off on `second_half_pay_day` the following month — the 10th/25th
     * pattern most employers run, whatever days this company actually uses.
     */
    public function generatePeriods(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => 'required|integer|between:2000,2100',
        ]);

        $year = (int) $data['year'];
        $firstPayDay = (int) $this->settings->get('payroll', 'first_half_pay_day', 25);
        $secondPayDay = (int) $this->settings->get('payroll', 'second_half_pay_day', 10);
        $created = 0;

        for ($month = 1; $month <= 12; $month++) {
            $monthStart = CarbonImmutable::create($year, $month, 1);
            $nextMonth = $monthStart->addMonth();

            foreach ([1, 2] as $half) {
                $start = $half === 1 ? $monthStart : $monthStart->day(16);
                $end = $half === 1 ? $monthStart->day(15) : $monthStart->endOfMonth();
                $code = sprintf('%d-%02d-%d', $year, $month, $half);

                // Rerunnable: a year already generated is left alone rather
                // than duplicated.
                if (PayrollPeriod::where('code', $code)->exists()) {
                    continue;
                }

                // Clamped to the paying month's own length, so a 31st
                // configured as the pay day still lands somewhere real in
                // February.
                $payDate = $half === 1
                    ? $monthStart->day(min($firstPayDay, $monthStart->daysInMonth))
                    : $nextMonth->day(min($secondPayDay, $nextMonth->daysInMonth));

                PayrollPeriod::create([
                    'code' => $code,
                    'label' => $start->format('j').'–'.$end->format('j M Y'),
                    'year' => $year,
                    'month' => $month,
                    'half' => $half,
                    'period_start' => $start->toDateString(),
                    'period_end' => $end->toDateString(),
                    'pay_date' => $payDate->toDateString(),
                    'status' => 'Open',
                ]);
                $created++;
            }
        }

        return response()->json(['data' => ['created' => $created, 'year' => $year]]);
    }

    /** Computes the run: builds every payslip and totals the header from them. */
    public function compute(PayrollRun $run): JsonResponse
    {
        try {
            $result = $this->engine->compute($run);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $result + ['run' => $this->present($run->fresh())]]);
    }

    /** Signs off the register. Nothing is paid yet. */
    public function approve(Request $request, PayrollRun $run): JsonResponse
    {
        if ($run->status !== 'Computed') {
            return response()->json([
                'message' => 'Only a computed run can be approved. Compute it first.',
            ], 422);
        }

        /** @var User $actor */
        $actor = $request->user();

        $run->update(['status' => 'Approved', 'approved_by' => $actor->id, 'approved_at' => now()]);

        return response()->json(['data' => $this->present($run->fresh())]);
    }

    /** Marks the money as paid out. The point of no return. */
    public function release(PayrollRun $run): JsonResponse
    {
        if ($run->status !== 'Approved') {
            return response()->json(['message' => 'Approve the run before releasing it.'], 422);
        }

        $run->update(['status' => 'Released', 'released_at' => now()]);

        // The cut-off is done once a run against it has been paid.
        $run->payrollPeriod?->update(['status' => 'Closed']);

        return response()->json(['data' => $this->present($run->fresh())]);
    }

    /** The register: every payslip in the run, for review before approval. */
    public function register(PayrollRun $run): JsonResponse
    {
        $run->loadMissing(['payrollPeriod', 'payrollGroup']);

        return response()->json([
            'data' => [
                'run' => $this->present($run),
                /* Whether the screen may offer any of the edit controls at
                   all. Decided here rather than in the browser, so what is
                   shown is exactly what the server would accept. */
                'editable' => ! in_array($run->status, ['Approved', 'Released'], true),
                'payslips' => $run->payslips()
                    ->with(['employee.hrDepartment', 'lines'])
                    ->get()
                    ->sortBy(fn ($p) => $p->employee->full_name ?? '')
                    ->map(fn ($p) => [
                        'id' => $p->id,
                        'employee' => $p->employee->full_name ?? 'Unknown',
                        'employeeNo' => $p->employee->employee_no ?? null,
                        // For the bank file — AUB's own credit-file template
                        // has a department column, not just name and account.
                        'department' => $p->employee->hrDepartment->name ?? null,
                        'dailyRate' => (float) $p->daily_rate,
                        'basicPay' => (float) $p->basic_pay,
                        'overtimePay' => (float) $p->overtime_pay,
                        'nightDiffPay' => (float) $p->night_diff_pay,
                        /* The five the engine cannot know and leaves at zero,
                           plus the account. These are the only figures on a
                           payslip a person may set; the screen edits exactly
                           this list and nothing else. */
                        'restDayPay' => (float) $p->rest_day_pay,
                        'holidayPay' => (float) $p->holiday_pay,
                        'leavePay' => (float) $p->leave_pay,
                        'taxableAllowances' => (float) $p->taxable_allowances,
                        'nonTaxableAllowances' => (float) $p->non_taxable_allowances,
                        'grossPay' => (float) $p->gross_pay,
                        'lateDeduction' => (float) $p->late_deduction,
                        'undertimeDeduction' => (float) $p->undertime_deduction,
                        'absenceDeduction' => (float) $p->absence_deduction,
                        'sss' => (float) $p->sss_employee,
                        'philhealth' => (float) $p->philhealth_employee,
                        'pagibig' => (float) $p->pagibig_employee,
                        'withholdingTax' => (float) $p->withholding_tax,
                        'otherDeductions' => (float) $p->other_deductions,
                        // Itemised, so a reviewer can see which loan the
                        // "other deductions" figure is actually made of.
                        'deductionLines' => $p->lines->where('kind', 'deduction')->map(fn ($l) => [
                            'id' => $l->id,
                            'code' => $l->code,
                            'label' => $l->label,
                            'amount' => (float) $l->amount,
                            // A collection line pays down a loan, and the
                            // balance is derived from it. The screen offers no
                            // delete on one, because the server refuses.
                            'locked' => (bool) $l->employee_deduction_id,
                        ])->values(),
                        'earningLines' => $p->lines->where('kind', 'earning')->map(fn ($l) => [
                            'id' => $l->id,
                            'code' => $l->code,
                            'label' => $l->label,
                            'amount' => (float) $l->amount,
                            'taxable' => (bool) $l->taxable,
                            'locked' => false,
                        ])->values(),
                        'totalDeductions' => (float) $p->total_deductions,
                        'netPay' => (float) $p->net_pay,
                        'holdAmount' => (float) $p->hold_amount,
                        'retroAdjustment' => (float) $p->retro_adjustment,
                        'atmAccount' => $p->atm_account,
                        // Which disbursement channel this employee is
                        // actually on — the bank file must only ever include
                        // ATM. Read from the employee record, not the
                        // payslip, since a payslip never had a column of its
                        // own for it.
                        'paymentMode' => $p->employee->payment_mode ?? 'ATM',
                        'notes' => $p->notes,
                    ])
                    ->values(),
            ],
        ]);
    }

    /**
     * The company's own AUB HRIS workbook, handed back filled from this
     * run's real payroll — the green columns only, per the template's own
     * instruction. See `AubTemplateExporter` for exactly what is and is not
     * filled, and why.
     */
    public function aubTemplate(PayrollRun $run, AubTemplateExporter $exporter): Response
    {
        $tempPath = $exporter->export($run);
        $bytes = file_get_contents($tempPath);
        unlink($tempPath);

        $period = $run->payrollPeriod?->label ?? $run->run_no;
        $filename = 'AUB_HRIS_'.preg_replace('/[^\w]+/', '_', $period).'.xlsx';

        return response($bytes, 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'Content-Length' => (string) strlen($bytes),
        ]);
    }

    /**
     * What the AUB workbook would rather you knew before you download it —
     * a name collision on the template's only join key, an ATM-mode employee
     * with no account, a missing designation or branch. None of these block
     * the export; they just mean part of it will read blank or, on a name
     * collision, wrong.
     */
    public function aubWarnings(PayrollRun $run, AubTemplateExporter $exporter): JsonResponse
    {
        return response()->json(['data' => $exporter->validate($run)]);
    }

    /* ====================================================================== */
    /* Payslips */
    /* ====================================================================== */

    /**
     * Adds one employee to a run that has already been computed.
     *
     * Recomputing the run would also do it, and would also throw away every
     * adjustment made to the other payslips. Adding one person should cost one
     * person's worth of work.
     */
    public function addPayslip(Request $request, PayrollRun $run): JsonResponse
    {
        $data = $request->validate(['employeeId' => 'required|integer|exists:employees,id']);

        try {
            $slip = $this->adjustments->addEmployee($run, Employee::findOrFail($data['employeeId']));
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => ['id' => $slip->id]], 201);
    }

    /**
     * Changes the amounts on a payslip that a person is allowed to change.
     *
     * Everything derived — gross, taxable income, tax, deductions, net — is
     * recomputed from those inputs rather than accepted from the client, so a
     * payslip can never be saved in a state where its own columns disagree.
     */
    public function adjustPayslip(Request $request, Payslip $payslip): JsonResponse
    {
        $data = $request->validate([
            'restDayPay' => 'nullable|numeric|min:0|max:1000000',
            'holidayPay' => 'nullable|numeric|min:0|max:1000000',
            'leavePay' => 'nullable|numeric|min:0|max:1000000',
            'taxableAllowances' => 'nullable|numeric|min:0|max:1000000',
            'nonTaxableAllowances' => 'nullable|numeric|min:0|max:1000000',
            'holdAmount' => 'nullable|numeric|min:0|max:1000000',
            'retroAdjustment' => 'nullable|numeric|min:-1000000|max:1000000',
            'atmAccount' => 'nullable|string|max:40',
            'notes' => 'nullable|string|max:500',
        ]);

        try {
            $this->adjustments->adjust(
                $payslip,
                // Only the keys actually sent. A form that knows about two
                // fields must not blank the other four.
                array_intersect_key($data, array_flip(array_keys(PayrollAdjustments::EDITABLE))),
                $request->has('notes') ? ($data['notes'] ?? '') : null,
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->register($payslip->payrollRun->fresh());
    }

    /** Takes a payslip off a run, and hands back any loan it collected. */
    public function deletePayslip(Payslip $payslip): JsonResponse
    {
        $run = $payslip->payrollRun;

        try {
            $this->adjustments->removePayslip($payslip);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->register($run->fresh());
    }

    /** An itemised one-off — a rice subsidy, a uniform charge. */
    public function addPayslipLine(Request $request, Payslip $payslip): JsonResponse
    {
        $data = $request->validate([
            'kind' => 'required|in:earning,deduction',
            'code' => 'nullable|string|max:32',
            'label' => 'required|string|max:150',
            'amount' => 'required|numeric|min:0.01|max:1000000',
            'taxable' => 'nullable|boolean',
        ]);

        try {
            $this->adjustments->addLine($payslip, $data);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->register($payslip->payrollRun->fresh());
    }

    public function deletePayslipLine(PayslipLine $line): JsonResponse
    {
        $run = $line->payslip->payrollRun;

        try {
            $this->adjustments->removeLine($line);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->register($run->fresh());
    }

    /**
     * What each agency is owed for a cut-off.
     *
     * Summed from the payslips actually computed rather than recalculated, so
     * the remittance and the register cannot disagree.
     */
    public function remittances(Request $request): JsonResponse
    {
        $data = $request->validate(['periodId' => 'nullable|integer|exists:payroll_periods,id']);

        $runs = PayrollRun::query()
            ->when($data['periodId'] ?? null, fn ($q, $id) => $q->where('payroll_period_id', $id))
            ->whereIn('status', ['Computed', 'Approved', 'Released'])
            ->with(['payslips', 'payrollPeriod'])
            ->get();

        $sum = fn (string $column) => round($runs->sum(fn ($r) => $r->payslips->sum($column)), 2);

        return response()->json([
            'data' => [
                'runs' => $runs->count(),
                'headcount' => $runs->sum('headcount'),
                'agencies' => [
                    [
                        'agency' => 'SSS',
                        'employee' => $sum('sss_employee'),
                        // Employer share plus Employees' Compensation — EC is
                        // a separate line item on the actual SSS remittance,
                        // but it is employer-paid like the share it sits
                        // next to, so it belongs in the same column here.
                        'employer' => round($sum('sss_employer') + $sum('sss_ec'), 2),
                        'total' => round($sum('sss_employee') + $sum('sss_employer') + $sum('sss_ec'), 2),
                        'reference' => 'SSS Circular 2024-006 · includes Employees\' Compensation',
                    ],
                    [
                        'agency' => 'PhilHealth',
                        'employee' => $sum('philhealth_employee'),
                        'employer' => $sum('philhealth_employer'),
                        'total' => round($sum('philhealth_employee') + $sum('philhealth_employer'), 2),
                        'reference' => 'UHC Act RA 11223',
                    ],
                    [
                        'agency' => 'Pag-IBIG',
                        'employee' => $sum('pagibig_employee'),
                        'employer' => $sum('pagibig_employer'),
                        'total' => round($sum('pagibig_employee') + $sum('pagibig_employer'), 2),
                        'reference' => 'HDMF Circular 460',
                    ],
                    [
                        'agency' => 'BIR',
                        'employee' => $sum('withholding_tax'),
                        'employer' => 0,
                        'total' => $sum('withholding_tax'),
                        'reference' => 'BIR RR 8-2018 (TRAIN)',
                    ],
                ],
            ],
        ]);
    }

    /**
     * Per-employee schedule for one statutory agency, one calendar month.
     *
     * Government remittance forms (SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF)
     * are filed by calendar month, not by cut-off — a month covers both
     * halves, so this sums across every payslip in every cut-off that falls
     * in it, unlike `remittances()`'s one-period-at-a-time totals.
     */
    public function agencySchedule(Request $request, string $agency): JsonResponse
    {
        abort_unless(in_array($agency, ['sss', 'philhealth', 'pagibig'], true), 404);

        $data = $request->validate([
            'year' => 'required|integer|min:2000|max:2100',
            'month' => 'required|integer|between:1,12',
            'legalEntityId' => 'nullable|integer|exists:legal_entities,id',
        ]);

        $columns = [
            // SSS carries a third employer-paid line — Employees'
            // Compensation — that the other two agencies have no equivalent
            // of. `ec` is null for those, not zero, so the schedule's own
            // "EC" column can tell "not applicable" from "nothing owed".
            'sss' => ['number' => 'sss_no', 'employee' => 'sss_employee', 'employer' => 'sss_employer', 'ec' => 'sss_ec'],
            'philhealth' => ['number' => 'philhealth_no', 'employee' => 'philhealth_employee', 'employer' => 'philhealth_employer', 'ec' => null],
            'pagibig' => ['number' => 'pagibig_no', 'employee' => 'pagibig_employee', 'employer' => 'pagibig_employer', 'ec' => null],
        ][$agency];

        $rows = $this->employeeSchedule($data['year'], $data['month'], function ($group) use ($columns) {
            $employee = $group->first()->employee;
            $employeeShare = round($group->sum($columns['employee']), 2);
            $employerShare = round($group->sum($columns['employer']), 2);
            $ec = $columns['ec'] ? round($group->sum($columns['ec']), 2) : null;

            return [
                'employeeId' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                /* Kept apart rather than parsed back out of `name` — a
                   filing template (Pag-IBIG's converter) that wants LASTNAME
                   and FIRSTNAME in their own columns needs the fields the
                   201 file actually stores them in, not a guess split on
                   whatever `full_name` happens to be formatted as. */
                'firstName' => $employee->first_name,
                'lastName' => $employee->last_name,
                'middleName' => $employee->middle_name,
                'birthDate' => optional($employee->birth_date)->toDateString(),
                'tin' => $employee->tin,
                'number' => $employee->{$columns['number']},
                'employee' => $employeeShare,
                'employer' => $employerShare,
                'ec' => $ec,
                'total' => round($employeeShare + $employerShare + ($ec ?? 0), 2),
            ];
        }, $data['legalEntityId'] ?? null);

        return response()->json(['data' => [
            'agency' => $agency,
            'year' => $data['year'],
            'month' => $data['month'],
            'legalEntity' => $this->legalEntitySummary($data['legalEntityId'] ?? null),
            'rows' => $rows,
            'totals' => [
                'employee' => round($rows->sum('employee'), 2),
                'employer' => round($rows->sum('employer'), 2),
                'ec' => $columns['ec'] ? round($rows->sum('ec'), 2) : null,
                'total' => round($rows->sum('total'), 2),
            ],
        ]]);
    }

    /**
     * 13th-month pay due for the year — 1/12 of total basic salary earned,
     * per Presidential Decree 851. Read straight from what payroll already
     * accrued each cut-off (`thirteenth_month_accrual` = that cut-off's
     * basic pay ÷ 12), so this can never disagree with what a payslip itself
     * shows.
     */
    public function thirteenthMonth(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => 'required|integer|min:2000|max:2100',
            'legalEntityId' => 'nullable|integer|exists:legal_entities,id',
        ]);

        $rows = $this->employeeSchedule($data['year'], null, function ($group) {
            $employee = $group->first()->employee;

            return [
                'employeeId' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                'totalBasicPay' => round($group->sum('basic_pay'), 2),
                'thirteenthMonthDue' => round($group->sum('thirteenth_month_accrual'), 2),
            ];
        }, $data['legalEntityId'] ?? null);

        return response()->json(['data' => [
            'year' => $data['year'],
            'legalEntity' => $this->legalEntitySummary($data['legalEntityId'] ?? null),
            'rows' => $rows,
            'totalDue' => round($rows->sum('thirteenthMonthDue'), 2),
        ]]);
    }

    /**
     * Annual compensation summary per employee — the figures BIR Form 2316
     * asks for. Not a facsimile of the form itself (its exact box layout
     * changes with every BIR revision), but every number on it is read
     * straight from what was actually paid and withheld, so filling in the
     * official form — or attaching this as its backup — needs no separate
     * computation.
     */
    public function bir2316(Request $request): JsonResponse
    {
        $data = $request->validate([
            'year' => 'required|integer|min:2000|max:2100',
            'legalEntityId' => 'nullable|integer|exists:legal_entities,id',
        ]);

        $rows = $this->employeeSchedule($data['year'], null, function ($group) {
            $employee = $group->first()->employee;
            $statutory = round(
                $group->sum('sss_employee') + $group->sum('philhealth_employee') + $group->sum('pagibig_employee'),
                2,
            );

            return [
                'employeeId' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                'tin' => $employee->tin,
                'grossCompensation' => round($group->sum('gross_pay'), 2),
                // Non-taxable de minimis/allowances plus the employee's own
                // statutory contributions — both reduce compensation before
                // tax, so BIR 2316 reports them together in this box.
                'nonTaxableCompensation' => round($group->sum('non_taxable_allowances') + $statutory, 2),
                'taxableCompensation' => round($group->sum('taxable_income'), 2),
                'taxWithheld' => round($group->sum('withholding_tax'), 2),
            ];
        }, $data['legalEntityId'] ?? null);

        return response()->json(['data' => [
            'year' => $data['year'],
            'legalEntity' => $this->legalEntitySummary($data['legalEntityId'] ?? null),
            'rows' => $rows,
        ]]);
    }

    /** The identity a printed schedule needs — null when no entity was chosen. */
    private function legalEntitySummary(?int $legalEntityId): ?array
    {
        if (! $legalEntityId) {
            return null;
        }

        $entity = LegalEntity::find($legalEntityId);

        if (! $entity) {
            return null;
        }

        return [
            'id' => $entity->id,
            'name' => $entity->name,
            'legalName' => $entity->legal_name,
            'tin' => $entity->tin,
            'sssEmployerNo' => $entity->sss_employer_no,
            'philhealthEmployerNo' => $entity->philhealth_employer_no,
            'pagibigEmployerNo' => $entity->pagibig_employer_no,
            'pagibigBranchCode' => $entity->pagibig_branch_code,
            'address' => $entity->address,
            'zipCode' => $entity->zip_code,
            'phone' => $entity->phone,
        ];
    }

    /**
     * One row per employee, summed from every payslip in a released or
     * approved run for the given year (and calendar month, when given) —
     * the shared shape every statutory report above is built from.
     *
     * `legalEntityId` narrows it to one registered employer's own people —
     * SSS/PhilHealth/Pag-IBIG are filed separately per employer, so a
     * schedule spanning all of them at once is not a real filing, just a
     * number nobody can submit anywhere.
     */
    private function employeeSchedule(int $year, ?int $month, \Closure $mapGroup, ?int $legalEntityId = null): \Illuminate\Support\Collection
    {
        $payslips = Payslip::query()
            ->with('employee')
            ->whereHas('payrollRun', function ($q) use ($year, $month) {
                $q->whereIn('status', ['Approved', 'Released'])
                    ->whereHas('payrollPeriod', function ($q2) use ($year, $month) {
                        $q2->where('year', $year);
                        if ($month !== null) {
                            $q2->where('month', $month);
                        }
                    });
            })
            ->when($legalEntityId, fn ($q) => $q->whereHas('employee', fn ($e) => $e->where('legal_entity_id', $legalEntityId)))
            ->get()
            ->filter(fn (Payslip $p) => $p->employee !== null);

        return $payslips->groupBy('employee_id')
            ->map($mapGroup)
            ->values()
            ->sortBy('name')
            ->values();
    }

    private function present(PayrollRun $run): array
    {
        $run->loadMissing(['payrollPeriod', 'payrollGroup']);

        return [
            'id' => $run->id,
            'no' => $run->run_no,
            'period' => $run->payrollPeriod->code ?? null,
            'periodLabel' => $run->payrollPeriod->label ?? null,
            'periodId' => $run->payroll_period_id,
            'groupId' => $run->payroll_group_id,
            'group' => $run->payrollGroup->name ?? null,
            'headcount' => (int) $run->headcount,
            'grossPay' => (float) $run->gross_pay,
            'statutoryEmployee' => (float) $run->statutory_employee,
            'statutoryEmployer' => (float) $run->statutory_employer,
            'withholdingTax' => (float) $run->withholding_tax,
            'otherDeductions' => (float) $run->other_deductions,
            'totalDeductions' => (float) $run->total_deductions,
            'netPay' => (float) $run->net_pay,
            'employerCost' => (float) $run->employer_cost,
            'status' => $run->status,
            'approvedAt' => $run->approved_at?->toIso8601String(),
            'releasedAt' => $run->released_at?->toIso8601String(),
        ];
    }
}
