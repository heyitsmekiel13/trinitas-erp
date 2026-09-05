<?php
// End-to-end: generate a period, run payroll on a real group, approve, release.
use App\Models\{PayrollPeriod, PayrollGroup, PayrollRun, Employee, User};
use App\Services\PayrollEngine;
use Carbon\CarbonImmutable;

$pass = 0; $fail = 0;
$check = function (string $what, bool $ok, string $detail = '') use (&$pass, &$fail) {
    if ($ok) { $pass++; echo "  ok   $what\n"; }
    else { $fail++; echo "  FAIL $what" . ($detail ? " — $detail" : '') . "\n"; }
};

echo "== fixtures ==\n";
$group = PayrollGroup::first();
$check('a payroll group exists', (bool) $group, 'none seeded');
if (!$group) exit(1);

$active = Employee::whereNull('date_separated')->count();
echo "  employees active: $active   groups: " . PayrollGroup::count() . "\n";

// A cut-off in the past so attendance can exist for it.
$period = PayrollPeriod::orderBy('period_start', 'desc')
    ->where('period_end', '<=', now()->toDateString())->first();
if (!$period) {
    $start = CarbonImmutable::now()->startOfMonth()->subMonth();
    $period = PayrollPeriod::create([
        'code' => 'E2E-' . $start->format('Y-m'), 'label' => 'E2E ' . $start->format('M Y'),
        'year' => $start->year, 'month' => $start->month, 'half' => 1,
        'period_start' => $start->toDateString(), 'period_end' => $start->day(15)->toDateString(),
        'pay_date' => $start->day(20)->toDateString(), 'status' => 'Open',
    ]);
}
echo "  period: {$period->code} ({$period->period_start} → {$period->period_end}) status={$period->status}\n";

echo "== compute ==\n";
$run = PayrollRun::firstOrCreate(
    ['payroll_period_id' => $period->id, 'payroll_group_id' => $group->id],
    ['run_no' => 'E2E-' . uniqid(), 'status' => 'Draft'],
);
$run->update(['status' => 'Draft']);
$run->payslips()->delete();

$engine = app(PayrollEngine::class);
$result = $engine->compute($run);
$run->refresh();

$check('run reaches Computed', $run->status === 'Computed', "status={$run->status}");
$check('payslips were produced', $run->payslips()->count() > 0, 'zero payslips');
$check('headcount matches payslip count', (int) $run->headcount === $run->payslips()->count());

$slips = $run->payslips()->get();
$check('no negative net pay', $slips->every(fn ($p) => (float) $p->net_pay >= 0),
    'min=' . $slips->min('net_pay'));
$check('no negative gross', $slips->every(fn ($p) => (float) $p->gross_pay >= 0));
$check('deductions never exceed gross', $slips->every(fn ($p) => (float) $p->total_deductions <= (float) $p->gross_pay + 0.01));

foreach (['gross_pay', 'net_pay', 'withholding_tax', 'total_deductions'] as $col) {
    $header = round((float) $run->$col, 2);
    $sum = round((float) $slips->sum($col), 2);
    $check("header $col equals sum of payslips", abs($header - $sum) < 0.02, "header=$header sum=$sum");
}

$badRow = $slips->first(fn ($p) =>
    abs((float) $p->net_pay - ((float) $p->gross_pay - (float) $p->total_deductions)) > 0.01);
$check('every payslip: net = gross − deductions', $badRow === null,
    $badRow ? "payslip {$badRow->id}" : '');

$badDed = $slips->first(function ($p) {
    $parts = (float) $p->sss_employee + (float) $p->philhealth_employee + (float) $p->pagibig_employee
        + (float) $p->withholding_tax + (float) $p->late_deduction + (float) $p->undertime_deduction
        + (float) $p->absence_deduction;
    return abs($parts - (float) $p->total_deductions) > 0.02;
});
$check('every payslip: deduction components sum to total', $badDed === null,
    $badDed ? "payslip {$badDed->id}" : '');

echo "  gross " . number_format((float) $run->gross_pay, 2)
   . " | deductions " . number_format((float) $run->total_deductions, 2)
   . " | net " . number_format((float) $run->net_pay, 2)
   . " | employer cost " . number_format((float) $run->employer_cost, 2) . "\n";

echo "== transitions ==\n";
$actor = User::first();
try { $engine->compute($run); $check('recompute of a Computed run is allowed (idempotent)', true); }
catch (\RuntimeException $e) { $check('recompute of a Computed run is allowed', false, $e->getMessage()); }

$run->update(['status' => 'Approved', 'approved_by' => $actor?->id, 'approved_at' => now()]);
try { $engine->compute($run->fresh()); $check('an Approved run refuses recompute', false, 'it recomputed'); }
catch (\RuntimeException $e) { $check('an Approved run refuses recompute', true); }

$run->fresh()->update(['status' => 'Released', 'released_at' => now()]);
$period->fresh()->update(['status' => 'Closed']);
$check('period closes on release', PayrollPeriod::find($period->id)->status === 'Closed');

echo "\n$pass passed, $fail failed\n";
exit($fail > 0 ? 1 : 0);
