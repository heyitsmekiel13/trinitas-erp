<?php
/**
 * Payroll deduction QA.
 *
 * The case that matters most is recompute: a run can be recomputed any number
 * of times and a loan must be no further paid off than it was after the first.
 * Everything rolls back.
 */

use App\Models\{AttendanceRecord, DeductionType, Employee, EmployeeDeduction, PayrollGroup,
    PayrollPeriod, PayrollRun, Payslip, PayslipLine, User};
use App\Services\PayrollEngine;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

$pass = 0; $fail = 0; $fails = [];
$check = function (string $what, bool $ok, string $detail = '') use (&$pass, &$fail, &$fails) {
    if ($ok) { $pass++; echo "  ok   $what\n"; }
    else { $fail++; $fails[] = "$what — $detail"; echo "  FAIL $what — $detail\n"; }
};

auth()->login(User::first());
DB::beginTransaction();

$engine = app(PayrollEngine::class);

/* ------------------------------------------------------------- fixtures */
echo "\n== fixtures ==\n";

$group = PayrollGroup::first();
$employee = Employee::where('payroll_group_id', $group->id)
    ->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED'])
    ->where('per_hour', false)
    ->first()
    ?? Employee::where('payroll_group_id', $group->id)->first();

$check('a salaried employee to test with', (bool) $employee,
    $employee ? "{$employee->employee_no} salary {$employee->salary}" : 'none');
echo "     {$employee->employee_no} {$employee->first_name} {$employee->last_name}"
    . "  salary={$employee->salary} per_hour=" . ($employee->per_hour ? 'yes' : 'no') . "\n";

// A cut-off in the past so it is computable.
$start = CarbonImmutable::now()->startOfMonth();
// The cut-off calendar may already be generated, and (year, month, half) is
// unique — so take the existing period for this slot rather than fight it.
$period = PayrollPeriod::firstOrCreate(
    ['year' => $start->year, 'month' => $start->month, 'half' => 1],
    [
        'code' => 'DQA-' . random_int(10000, 99999),
        'label' => 'Deduction QA ' . $start->format('M Y'),
        'period_start' => $start->toDateString(),
        'period_end' => $start->day(15)->toDateString(),
        'pay_date' => $start->day(20)->toDateString(),
        'status' => 'Open',
    ],
);

// Give them attendance so there is pay to deduct from.
for ($d = 1; $d <= 11; $d++) {
    $day = $start->day($d);
    if ($day->isWeekend()) continue;
    AttendanceRecord::updateOrCreate(
        ['employee_id' => $employee->id, 'work_date' => $day->toDateString()],
        ['status' => 'Present', 'hours_worked' => 8, 'overtime_hours' => 0,
         'night_diff_hours' => 0, 'late_minutes' => 0, 'undertime_minutes' => 0],
    );
}

$makeRun = fn () => PayrollRun::create([
    'run_no' => 'DQA-' . random_int(10000, 99999),
    'payroll_period_id' => $period->id,
    'payroll_group_id' => $group->id,
    'status' => 'Draft',
]);


/**
 * A fresh cut-off with attendance and a run of its own.
 *
 * One per scenario: payroll_runs is unique per (period, group), so scenarios
 * cannot share a cut-off, and recomputing a shared one would rewrite the
 * collections an earlier scenario had already asserted on.
 */
$cutoff = function (int $monthOffset, int $half) use ($employee, $group) {
    $base = CarbonImmutable::now()->startOfMonth()->addMonths($monthOffset);
    $from = $half === 1 ? $base : $base->day(16);
    $to = $half === 1 ? $base->day(15) : $base->endOfMonth();

    $period = PayrollPeriod::firstOrCreate(
        ['year' => $base->year, 'month' => $base->month, 'half' => $half],
        [
            'code' => 'DQA-' . $base->format('Ym') . "-$half",
            'label' => 'QA ' . $base->format('M Y') . " h$half",
            'period_start' => $from->toDateString(),
            'period_end' => $to->toDateString(),
            'pay_date' => $to->toDateString(),
            'status' => 'Open',
        ],
    );

    for ($d = (int) $from->day; $d <= (int) $to->day; $d++) {
        $day = $base->day($d);
        if ($day->isWeekend()) continue;
        AttendanceRecord::updateOrCreate(
            ['employee_id' => $employee->id, 'work_date' => $day->toDateString()],
            ['status' => 'Present', 'hours_worked' => 8, 'overtime_hours' => 0,
             'night_diff_hours' => 0, 'late_minutes' => 0, 'undertime_minutes' => 0],
        );
    }

    $run = PayrollRun::firstOrCreate(
        ['payroll_period_id' => $period->id, 'payroll_group_id' => $group->id],
        ['run_no' => 'DQA-' . $base->format('Ym') . "-$half", 'status' => 'Draft'],
    );

    return [$period, $run];
};

$loanType = DeductionType::where('code', 'COMPANY-LOAN')->first();
$canteenType = DeductionType::where('code', 'CANTEEN')->first();
$check('seeded deduction types are present', $loanType && $canteenType);
$check('loan types are flagged as loans', (bool) $loanType->is_loan);
$check('canteen is not a loan', ! $canteenType->is_loan);

/* --------------------------------------------------- a loan is collected */
echo "\n== a loan is collected ==\n";

$loan = EmployeeDeduction::create([
    'employee_id' => $employee->id,
    'deduction_type_id' => $loanType->id,
    'reference' => 'CL-QA-001',
    'principal' => 5000,
    'amount_per_cutoff' => 1200,
    'starts_on' => $start->toDateString(),
    'status' => 'Active',
]);

$check('a new loan owes its whole principal', $loan->outstanding() === 5000.0, (string) $loan->outstanding());
$check('nothing collected yet', $loan->collected() === 0.0);

$run = $makeRun();
$engine->compute($run);
$slip = Payslip::where('payroll_run_id', $run->id)->where('employee_id', $employee->id)->first();

$check('a payslip was produced', (bool) $slip);
echo "     gross={$slip->gross_pay} statutory+tax="
    . round($slip->sss_employee + $slip->philhealth_employee + $slip->pagibig_employee + $slip->withholding_tax, 2)
    . " other={$slip->other_deductions} net={$slip->net_pay}\n";

$check('the instalment was deducted', (float) $slip->other_deductions === 1200.0,
    (string) $slip->other_deductions);
$check('a line was written for it',
    PayslipLine::where('payslip_id', $slip->id)->where('employee_deduction_id', $loan->id)->count() === 1);
$check('the line names the loan',
    str_contains((string) PayslipLine::where('employee_deduction_id', $loan->id)->value('label'), 'CL-QA-001'),
    (string) PayslipLine::where('employee_deduction_id', $loan->id)->value('label'));
$check('the balance fell by the instalment', $loan->fresh()->outstanding() === 3800.0,
    (string) $loan->fresh()->outstanding());
$check('net = gross less all deductions',
    abs((float) $slip->net_pay - ((float) $slip->gross_pay - (float) $slip->total_deductions)) < 0.01);
$check('total deductions include the loan',
    (float) $slip->total_deductions >= (float) $slip->other_deductions);
$check('the run header carries the collected total',
    (float) $run->fresh()->other_deductions === 1200.0, (string) $run->fresh()->other_deductions);

/* --------------------------------------------- RECOMPUTE IS IDEMPOTENT */
echo "\n== recompute does not collect twice ==\n";

$engine->compute($run);
$check('balance unchanged after one recompute', $loan->fresh()->outstanding() === 3800.0,
    (string) $loan->fresh()->outstanding());

$engine->compute($run);
$engine->compute($run);
$check('balance unchanged after three more', $loan->fresh()->outstanding() === 3800.0,
    (string) $loan->fresh()->outstanding());
$check('still exactly one collection line',
    PayslipLine::where('employee_deduction_id', $loan->id)->count() === 1,
    (string) PayslipLine::where('employee_deduction_id', $loan->id)->count());

/* ------------------------------------------------ collection across runs */
echo "\n== a second cut-off continues the loan ==\n";

$period2 = PayrollPeriod::firstOrCreate(
    ['year' => $start->year, 'month' => $start->month, 'half' => 2],
    [
        'code' => 'DQA2-' . random_int(10000, 99999),
        'label' => 'Deduction QA B',
        'period_start' => $start->day(16)->toDateString(),
        'period_end' => $start->endOfMonth()->toDateString(),
        'pay_date' => $start->endOfMonth()->toDateString(),
        'status' => 'Open',
    ],
);
for ($d = 16; $d <= 26; $d++) {
    $day = $start->day($d);
    if ($day->isWeekend()) continue;
    AttendanceRecord::updateOrCreate(
        ['employee_id' => $employee->id, 'work_date' => $day->toDateString()],
        ['status' => 'Present', 'hours_worked' => 8, 'overtime_hours' => 0,
         'night_diff_hours' => 0, 'late_minutes' => 0, 'undertime_minutes' => 0],
    );
}
$run2 = PayrollRun::create([
    'run_no' => 'DQA-B' . random_int(1000, 9999),
    'payroll_period_id' => $period2->id,
    'payroll_group_id' => $group->id,
    'status' => 'Draft',
]);
$engine->compute($run2);
$check('the second cut-off collected another instalment', $loan->fresh()->outstanding() === 2600.0,
    (string) $loan->fresh()->outstanding());
$check('two collection lines now exist',
    PayslipLine::where('employee_deduction_id', $loan->id)->count() === 2);

/* -------------------------------------------------- the last instalment */
echo "\n== the final instalment is only what is left ==\n";

$small = EmployeeDeduction::create([
    'employee_id' => $employee->id,
    'deduction_type_id' => $loanType->id,
    'reference' => 'CL-QA-TAIL',
    'principal' => 300,
    'amount_per_cutoff' => 1200,     // instalment far exceeds the principal
    'starts_on' => $start->toDateString(),
    'status' => 'Active',
]);
[, $run3] = $cutoff(1, 1);
$engine->compute($run3);
$tail = PayslipLine::where('employee_deduction_id', $small->id)->first();
$check('collected only the outstanding 300, not the 1200 instalment',
    $tail && (float) $tail->amount === 300.0, $tail ? (string) $tail->amount : 'no line');
$check('the loan is settled', $small->fresh()->isSettled());
[, $run4] = $cutoff(1, 2);
$engine->compute($run4);
$check('a settled loan is skipped on the next cut-off',
    PayslipLine::where('employee_deduction_id', $small->id)
        ->whereIn('payslip_id', Payslip::where('payroll_run_id', $run4->id)->pluck('id'))->count() === 0);

/* ------------------------------------------------- never a negative wage */
echo "\n== net pay can never go negative ==\n";

$huge = EmployeeDeduction::create([
    'employee_id' => $employee->id,
    'deduction_type_id' => $loanType->id,
    'reference' => 'CL-QA-HUGE',
    'principal' => 999999,
    'amount_per_cutoff' => 999999,
    'starts_on' => $start->toDateString(),
    'status' => 'Active',
]);
[, $run5] = $cutoff(2, 1);
$engine->compute($run5);
$slip4 = Payslip::where('payroll_run_id', $run5->id)->where('employee_id', $employee->id)->first();
$check('net pay is not negative', (float) $slip4->net_pay >= 0, (string) $slip4->net_pay);
$check('deductions never exceed gross',
    (float) $slip4->total_deductions <= (float) $slip4->gross_pay + 0.01,
    "{$slip4->total_deductions} vs {$slip4->gross_pay}");
// The invariant that matters is not that statutory is non-zero on this
// particular cut-off — the group's schedule puts contributions on the second
// half, so zero is correct here — but that whatever IS mandatory was taken in
// full before the loan got anything, and the loan took only the remainder.
$mandatory = round((float) $slip4->total_deductions - (float) $slip4->other_deductions, 2);
$expectedMandatory = round(
    (float) $slip4->late_deduction + (float) $slip4->undertime_deduction + (float) $slip4->absence_deduction
    + (float) $slip4->sss_employee + (float) $slip4->philhealth_employee + (float) $slip4->pagibig_employee
    + (float) $slip4->withholding_tax, 2);
$check('mandatory deductions were taken in full before the loan',
    abs($mandatory - $expectedMandatory) < 0.01, "$mandatory vs $expectedMandatory");
$check('the loan took only what was left after them',
    abs((float) $slip4->other_deductions - ((float) $slip4->gross_pay - $expectedMandatory)) < 0.01,
    "{$slip4->other_deductions} vs " . round((float) $slip4->gross_pay - $expectedMandatory, 2));
$check('the huge loan was only part-collected',
    (float) $huge->fresh()->collected() < 999999);
echo "     gross={$slip4->gross_pay} other={$slip4->other_deductions} net={$slip4->net_pay}\n";

/* --------------------------------------------------------- status rules */
echo "\n== status and dates are honoured ==\n";

$suspended = EmployeeDeduction::create([
    'employee_id' => $employee->id, 'deduction_type_id' => $canteenType->id,
    'principal' => null, 'amount_per_cutoff' => 100,
    'starts_on' => $start->toDateString(), 'status' => 'Suspended',
]);
$future = EmployeeDeduction::create([
    'employee_id' => $employee->id, 'deduction_type_id' => $canteenType->id,
    'principal' => null, 'amount_per_cutoff' => 100,
    'starts_on' => $start->addYear()->toDateString(), 'status' => 'Active',
]);
$ended = EmployeeDeduction::create([
    'employee_id' => $employee->id, 'deduction_type_id' => $canteenType->id,
    'principal' => null, 'amount_per_cutoff' => 100,
    'starts_on' => $start->subYear()->toDateString(),
    'ends_on' => $start->subMonths(6)->toDateString(), 'status' => 'Active',
]);
// The huge loan from the previous scenario would swallow this cut-off's whole
// capacity, and then every check below would pass for the wrong reason —
// nothing collected because nothing could be, rather than because the status
// and dates excluded it. Stop it first.
$huge->update(['status' => 'Cancelled']);

$engine->compute($run4);
$check('a cancelled deduction is not collected',
    PayslipLine::where('employee_deduction_id', $huge->id)
        ->whereIn('payslip_id', Payslip::where('payroll_run_id', $run4->id)->pluck('id'))->count() === 0);
$check('a suspended deduction is not collected',
    PayslipLine::where('employee_deduction_id', $suspended->id)->count() === 0);
$check('one that has not started is not collected',
    PayslipLine::where('employee_deduction_id', $future->id)->count() === 0);
$check('one that has ended is not collected',
    PayslipLine::where('employee_deduction_id', $ended->id)->count() === 0);

/* ------------------------------------------------------------- priority */
echo "\n== priority decides who collects first ==\n";
$check('government loans outrank company loans',
    DeductionType::where('code', 'SSS-LOAN')->value('priority')
        < DeductionType::where('code', 'COMPANY-LOAN')->value('priority'));
$check('company loans outrank the canteen',
    DeductionType::where('code', 'COMPANY-LOAN')->value('priority')
        < DeductionType::where('code', 'CANTEEN')->value('priority'));

DB::rollBack();

echo "\n$pass passed, $fail failed\n";
foreach ($fails as $f) echo "  - $f\n";
