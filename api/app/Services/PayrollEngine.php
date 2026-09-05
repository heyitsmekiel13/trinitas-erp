<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\EmployeeDeduction;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\Payslip;
use App\Models\PayslipLine;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * The payroll computation.
 *
 * Everything needed to run Philippine payroll was already in the database —
 * 61 SSS brackets, the TRAIN withholding tables, the PhilHealth and Pag-IBIG
 * circulars, and an attendance table full of punches. What was missing was the
 * arithmetic joining them, so payroll could be looked at but never run.
 *
 * The rules this implements, and where each comes from:
 *
 *   SSS         Contribution read from the bracket the monthly salary falls
 *               in — never computed as a percentage, because the schedule is a
 *               table with its own rounding and an EC premium on top.
 *   PhilHealth  5% of monthly basic, split equally, floored at ₱10,000 and
 *               capped at ₱100,000 of salary.
 *   Pag-IBIG    1% under the lower bracket, 2% at or above it, on a fund
 *               salary capped at ₱10,000; the employer always pays 2%.
 *   Withholding BIR RR 8-2018 brackets for the payroll frequency, applied to
 *               taxable income after statutory contributions.
 *
 * Two things worth stating because they are where payroll usually goes wrong:
 *
 *   Statutory contributions are monthly, but this payroll is semi-monthly. The
 *   payroll group's own schedule decides which cut-off carries them — first,
 *   second, or split in half across both — so an employee is never deducted
 *   twice in one month.
 *
 *   A minimum-wage earner is exempt from withholding tax by law, and the
 *   masterfile flags them. That flag is honoured here rather than left to
 *   whoever reviews the register.
 */
class PayrollEngine
{
    public function __construct(private readonly Settings $settings) {}

    /**
     * Computes every payslip in a run, replacing whatever was there before.
     *
     * Recomputing is the normal case — attendance gets corrected after a first
     * pass — so this is destructive by design and safe to repeat. A released
     * run refuses, because money has already moved.
     *
     * @return array{payslips: int, gross: float, net: float, employerCost: float}
     */
    public function compute(PayrollRun $run): array
    {
        if ($run->status === 'Released') {
            throw new \RuntimeException('This run has been released. Reverse it before recomputing.');
        }

        // An approved run has been signed off. Recomputing it would rewrite the
        // register somebody put their name to, silently and without a trace, so
        // it has to be sent back to Draft deliberately first.
        if ($run->status === 'Approved') {
            throw new \RuntimeException('This run has been approved. Reopen it before recomputing.');
        }

        $run->loadMissing(['payrollPeriod', 'payrollGroup']);
        $period = $run->payrollPeriod;

        $from = CarbonImmutable::parse($period->period_start);
        $to = CarbonImmutable::parse($period->period_end);

        $factor = (int) $this->settings->get('payroll', 'working_days_factor', 313);
        $hoursPerDay = (int) $this->settings->get('payroll', 'hours_per_day', 8);

        // Which cut-off carries the monthly statutory deductions.
        $schedule = $run->payrollGroup->statutory_schedule
            ?? $this->settings->get('payroll', 'statutory_schedule', 'second');

        $employees = Employee::query()
            ->where('payroll_group_id', $run->payroll_group_id)
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->whereDate('date_hired', '<=', $to->toDateString())
            ->get();

        return DB::transaction(function () use ($run, $period, $employees, $from, $to, $factor, $hoursPerDay, $schedule) {
            $run->payslips()->delete();

            $totals = ['gross' => 0.0, 'net' => 0.0, 'employerCost' => 0.0, 'deductions' => 0.0,
                'statutoryEmployee' => 0.0, 'statutoryEmployer' => 0.0, 'withholding' => 0.0,
                'other' => 0.0];

            foreach ($employees as $employee) {
                $slip = $this->payslipFor($employee, $run, $from, $to, $factor, $hoursPerDay, $schedule, $period);

                $totals['gross'] += $slip->gross_pay;
                $totals['net'] += $slip->net_pay;
                $totals['employerCost'] += $slip->employer_cost;
                $totals['deductions'] += $slip->total_deductions;
                $totals['statutoryEmployee'] += $slip->sss_employee + $slip->philhealth_employee + $slip->pagibig_employee;
                $totals['statutoryEmployer'] += $slip->sss_employer + $slip->sss_ec + $slip->philhealth_employer + $slip->pagibig_employer;
                $totals['withholding'] += $slip->withholding_tax;
                $totals['other'] += $slip->other_deductions;
            }

            // The header is derived from the payslips, never typed. A run whose
            // total disagrees with its register is the classic payroll bug.
            $run->update([
                'headcount' => $employees->count(),
                'gross_pay' => round($totals['gross'], 2),
                'statutory_employee' => round($totals['statutoryEmployee'], 2),
                'statutory_employer' => round($totals['statutoryEmployer'], 2),
                'withholding_tax' => round($totals['withholding'], 2),
                // The column existed and was never written, so the register
                // showed loans on the payslips but nothing on the run header.
                'other_deductions' => round($totals['other'], 2),
                'total_deductions' => round($totals['deductions'], 2),
                'net_pay' => round($totals['net'], 2),
                'employer_cost' => round($totals['employerCost'], 2),
                'status' => 'Computed',
            ]);

            return [
                'payslips' => $employees->count(),
                'gross' => round($totals['gross'], 2),
                'net' => round($totals['net'], 2),
                'employerCost' => round($totals['employerCost'], 2),
            ];
        });
    }

    /**
     * Computes one payslip, on a run that already has others.
     *
     * `compute()` deletes and rebuilds every payslip on the run, which is the
     * right behaviour when attendance has been corrected and wrong when one
     * person was simply missed — a mid-cut-off hire, or somebody moved into
     * the group after the run went through. Rebuilding for them would discard
     * every adjustment already made to the other payslips.
     *
     * The caller rolls the run header up afterwards.
     */
    public function computeOne(PayrollRun $run, Employee $employee): Payslip
    {
        $run->loadMissing(['payrollPeriod', 'payrollGroup']);
        $period = $run->payrollPeriod;

        return $this->payslipFor(
            $employee,
            $run,
            CarbonImmutable::parse($period->period_start),
            CarbonImmutable::parse($period->period_end),
            (int) $this->settings->get('payroll', 'working_days_factor', 313),
            (int) $this->settings->get('payroll', 'hours_per_day', 8),
            $run->payrollGroup->statutory_schedule
                ?? $this->settings->get('payroll', 'statutory_schedule', 'second'),
            $period,
        );
    }

    /* ====================================================================== */

    private function payslipFor(
        Employee $employee,
        PayrollRun $run,
        CarbonImmutable $from,
        CarbonImmutable $to,
        int $factor,
        int $hoursPerDay,
        string $schedule,
        PayrollPeriod $period,
    ): Payslip {
        // The masterfile stores pay two ways and `per_hour` says which: an
        // hourly rate for rank and file, a monthly salary for everyone else.
        // Reading an hourly rate as a monthly salary produces a ₱65 "monthly"
        // wage, statutory floors larger than the pay, and a negative payslip.
        if ($employee->per_hour) {
            $hourly = (float) $employee->salary;
            $daily = round($hourly * $hoursPerDay, 2);
            // What the rate works out to over a month, for the statutory
            // tables — every one of them is banded on monthly compensation.
            $monthly = $factor > 0 ? round($daily * $factor / 12, 2) : 0.0;
        } else {
            $monthly = (float) $employee->salary;
            $daily = $factor > 0 ? round($monthly * 12 / $factor, 2) : 0.0;
            $hourly = $hoursPerDay > 0 ? round($daily / $hoursPerDay, 2) : 0.0;
        }

        $attendance = AttendanceRecord::query()
            ->where('employee_id', $employee->id)
            ->whereBetween('work_date', [$from->toDateString(), $to->toDateString()])
            ->get();

        $daysWorked = $attendance->where('hours_worked', '>', 0)->count();
        $overtimeHours = (float) $attendance->sum('overtime_hours');
        $nightDiffHours = (float) $attendance->sum('night_diff_hours');
        $lateMinutes = (int) $attendance->sum('late_minutes');
        $undertimeMinutes = (int) $attendance->sum('undertime_minutes');
        $absentDays = $attendance->where('status', 'Absent')->count();

        // Hourly staff are paid for the hours they actually worked; salaried
        // staff get half the month and lose time through the deductions below.
        // Applying the salaried rule to an hourly worker pays them for days
        // they were not there.
        $basic = $employee->per_hour
            ? round((float) $attendance->sum('hours_worked') * $hourly, 2)
            : round($monthly / 2, 2);

        // Time lost is already absent from an hourly worker's basic pay —
        // deducting it again would charge them twice for the same minutes.
        $lateDeduction = $employee->per_hour ? 0.0 : round($lateMinutes / 60 * $hourly, 2);
        $undertimeDeduction = $employee->per_hour ? 0.0 : round($undertimeMinutes / 60 * $hourly, 2);
        $absenceDeduction = $employee->per_hour ? 0.0 : round($absentDays * $daily, 2);

        // 25% premium on overtime, 10% on hours between 10pm and 6am — the
        // Labor Code minimums.
        $overtimePay = round($overtimeHours * $hourly * 1.25, 2);
        $nightDiffPay = round($nightDiffHours * $hourly * 0.10, 2);

        $gross = round($basic + $overtimePay + $nightDiffPay, 2);

        // Statutory contributions land on the cut-off the group is set to.
        $share = $this->statutoryShare($schedule, $period);

        $sss = $this->sss($monthly);
        $philhealth = $this->philhealth($monthly);
        $pagibig = $this->pagibig($monthly);

        $sssEmployee = round($sss['employee'] * $share, 2);
        $sssEmployer = round($sss['employer'] * $share, 2);
        $sssEc = round($sss['ec'] * $share, 2);
        $phEmployee = round($philhealth['employee'] * $share, 2);
        $phEmployer = round($philhealth['employer'] * $share, 2);
        $piEmployee = round($pagibig['employee'] * $share, 2);
        $piEmployer = round($pagibig['employer'] * $share, 2);

        $statutoryEmployee = $sssEmployee + $phEmployee + $piEmployee;

        $taxable = round($gross - $lateDeduction - $undertimeDeduction - $absenceDeduction - $statutoryEmployee, 2);

        // Minimum-wage earners are exempt from withholding by law.
        $withholding = $employee->minimum_wage_earner
            ? 0.0
            : $this->withholding(max(0, $taxable), $run->payrollGroup->frequency ?? 'S');

        $deductions = round(
            $lateDeduction + $undertimeDeduction + $absenceDeduction + $statutoryEmployee + $withholding,
            2,
        );

        // Nobody is ever paid a negative wage. On a short cut-off the monthly
        // statutory contributions can exceed what was earned; the excess is
        // capped here and called out on the payslip so it can be collected on
        // the next run rather than silently vanishing.
        $shortfall = max(0, round($deductions - $gross, 2));

        if ($shortfall > 0) {
            $deductions = $gross;
        }

        // Loans, advances and the rest come out of what is left once the
        // mandatory amounts are settled. Statutory contributions and tax are
        // not negotiable and a company loan is, so the loan is what waits —
        // collecting in the other order would under-remit to SSS to pay the
        // employer back, which is the wrong way round.
        [$otherDeductions, $collections] = $this->collectDeductions(
            $employee,
            $from,
            $to,
            capacity: round($gross - $deductions, 2),
        );

        $deductions = round($deductions + $otherDeductions, 2);

        $slip = Payslip::create([
            'payroll_run_id' => $run->id,
            'employee_id' => $employee->id,
            'hourly_rate' => $hourly,
            'daily_rate' => $daily,
            'monthly_equivalent' => $monthly,
            'basic_pay' => $basic,
            'overtime_pay' => $overtimePay,
            'night_diff_pay' => $nightDiffPay,
            'rest_day_pay' => 0,
            'holiday_pay' => 0,
            'leave_pay' => 0,
            'taxable_allowances' => 0,
            'non_taxable_allowances' => 0,
            'gross_pay' => $gross,
            'late_deduction' => $lateDeduction,
            'undertime_deduction' => $undertimeDeduction,
            'absence_deduction' => $absenceDeduction,
            'sss_salary_credit' => $sss['credit'],
            'sss_employee' => $sssEmployee,
            'sss_employer' => $sssEmployer,
            'sss_ec' => $sssEc,
            'philhealth_employee' => $phEmployee,
            'philhealth_employer' => $phEmployer,
            'pagibig_employee' => $piEmployee,
            'pagibig_employer' => $piEmployer,
            'taxable_income' => max(0, $taxable),
            'withholding_tax' => $withholding,
            'other_deductions' => $otherDeductions,
            'total_deductions' => $deductions,
            'net_pay' => round($gross - $deductions, 2),
            'employer_cost' => round($gross + $sssEmployer + $sssEc + $phEmployer + $piEmployer, 2),
            // A twelfth of basic pay earned, accrued each run so December is
            // not a surprise.
            'thirteenth_month_accrual' => round($basic / 12, 2),
            'atm_account' => $employee->atm_account,
            'notes' => match (true) {
                $shortfall > 0 => 'Deductions exceeded pay by '.number_format($shortfall, 2)
                    .'. Capped at gross — collect the balance next cut-off.',
                $attendance->isEmpty() => 'No attendance recorded for this cut-off.',
                default => null,
            },
        ]);

        // Each collection is written as a line pointing back at the
        // arrangement it paid down. This is what makes the balance derivable:
        // there is no counter to decrement, so recomputing a run — which
        // deletes these lines with the payslip — hands the balance straight
        // back instead of collecting the instalment a second time.
        foreach ($collections as $line) {
            PayslipLine::create([
                'payslip_id' => $slip->id,
                'employee_deduction_id' => $line['employee_deduction_id'],
                'kind' => 'deduction',
                'code' => $line['code'],
                'label' => $line['label'],
                'amount' => $line['amount'],
                'taxable' => false,
            ]);
        }

        return $slip;
    }

    /**
     * Collects what the employee owes, in priority order, out of what is left.
     *
     * Three rules, each of which exists because the alternative is a payslip
     * somebody has to argue about:
     *
     *   Nothing is collected that would take net pay below zero. When the
     *   capacity runs out the remaining arrangements simply wait for the next
     *   cut-off.
     *
     *   An instalment can be part-collected. Taking ₱200 of a ₱500 instalment
     *   and leaving ₱300 on the balance is right; skipping the whole thing
     *   because it does not fit would stretch a loan by an entire cut-off for
     *   the sake of ₱300.
     *
     *   A loan never over-collects. The last instalment is whatever is left,
     *   not the full amount, so a ₱5,000 loan on ₱1,200 instalments collects
     *   ₱200 at the end rather than ₱1,200 and a refund.
     *
     * @return array{0: float, 1: array<int, array<string, mixed>>}
     */
    private function collectDeductions(
        Employee $employee,
        CarbonImmutable $from,
        CarbonImmutable $to,
        float $capacity,
    ): array {
        if ($capacity <= 0) {
            return [0.0, []];
        }

        $arrangements = EmployeeDeduction::query()
            ->where('employee_id', $employee->id)
            ->collectableOn($from->toDateString(), $to->toDateString())
            ->with('deductionType')
            ->get()
            // One composite key rather than sortBy's multi-column form: that
            // form expects [column, direction] pairs, and handing it bare
            // closures sorted by neither — the canteen was collecting ahead of
            // an SSS loan, which is the exact order this is here to prevent.
            ->sortBy(fn (EmployeeDeduction $d) => sprintf(
                '%04d-%010d',
                $d->deductionType->priority ?? 100,
                $d->id,
            ))
            ->values();

        $remaining = $capacity;
        $collected = 0.0;
        $lines = [];

        foreach ($arrangements as $arrangement) {
            if ($remaining <= 0) {
                break;
            }

            $due = (float) $arrangement->amount_per_cutoff;

            // A loan is only ever owed what is left of its principal.
            $outstanding = $arrangement->outstanding();
            if ($outstanding !== null) {
                if ($outstanding <= 0) {
                    continue;   // settled; nothing further to take
                }
                $due = min($due, $outstanding);
            }

            $take = round(min($due, $remaining), 2);

            if ($take <= 0) {
                continue;
            }

            $lines[] = [
                'employee_deduction_id' => $arrangement->id,
                'code' => $arrangement->deductionType->code ?? 'OTHER',
                'label' => trim(($arrangement->deductionType->name ?? 'Deduction')
                    .($arrangement->reference ? ' · '.$arrangement->reference : '')),
                'amount' => $take,
            ];

            $collected = round($collected + $take, 2);
            $remaining = round($remaining - $take, 2);
        }

        return [$collected, $lines];
    }

    /**
     * How much of the monthly statutory contribution this cut-off carries.
     *
     * `split` halves it across both cut-offs; `first` and `second` put the
     * whole month's contribution on one of them and nothing on the other.
     */
    private function statutoryShare(string $schedule, PayrollPeriod $period): float
    {
        if ($schedule === 'split') {
            return 0.5;
        }

        $isFirstHalf = (int) ($period->half ?? 1) === 1;

        return match ($schedule) {
            'first' => $isFirstHalf ? 1.0 : 0.0,
            default => $isFirstHalf ? 0.0 : 1.0,
        };
    }

    /**
     * SSS, from the contribution table.
     *
     * Read from the bracket rather than computed, because the schedule is a
     * published table with its own steps — a percentage would disagree with
     * it at almost every salary.
     */
    private function sss(float $monthly): array
    {
        $bracket = DB::table('sss_brackets')
            ->where('compensation_from', '<=', $monthly)
            ->where('compensation_to', '>=', $monthly)
            ->first();

        // Above the top bracket, everybody pays the ceiling.
        $bracket ??= DB::table('sss_brackets')->orderByDesc('compensation_to')->first();

        if (! $bracket) {
            return ['employee' => 0.0, 'employer' => 0.0, 'credit' => 0.0, 'ec' => 0.0];
        }

        return [
            'employee' => (float) $bracket->employee_share,
            'employer' => (float) $bracket->employer_share,
            'credit' => (float) $bracket->salary_credit,
            // The employer's Employees' Compensation premium. Not deducted
            // from anybody — it is a cost of employment.
            'ec' => (float) $bracket->employer_ec,
        ];
    }

    /** 5% of monthly basic, split evenly, floored and capped. */
    private function philhealth(float $monthly): array
    {
        $config = $this->agency('PHILHEALTH', ['rate' => 0.05, 'floor' => 10000, 'ceiling' => 100000, 'employee_share' => 0.5]);

        $base = min(max($monthly, (float) $config['floor']), (float) $config['ceiling']);
        $premium = round($base * (float) $config['rate'], 2);
        $employee = round($premium * (float) $config['employee_share'], 2);

        return ['employee' => $employee, 'employer' => round($premium - $employee, 2)];
    }

    /** 1% under the lower bracket, 2% at or above; employer always 2%. */
    private function pagibig(float $monthly): array
    {
        $config = $this->agency('PAGIBIG', [
            'employer_rate' => 0.02, 'lower_bracket' => 1500,
            'max_fund_salary' => 10000, 'employee_rate_low' => 0.01, 'employee_rate_high' => 0.02,
        ]);

        $fundSalary = min($monthly, (float) $config['max_fund_salary']);
        $rate = $monthly <= (float) $config['lower_bracket']
            ? (float) $config['employee_rate_low']
            : (float) $config['employee_rate_high'];

        return [
            'employee' => round($fundSalary * $rate, 2),
            'employer' => round($fundSalary * (float) $config['employer_rate'], 2),
        ];
    }

    /** BIR RR 8-2018, on the bracket table for the payroll frequency. */
    /**
     * The withholding on a taxable amount, for a pay frequency.
     *
     * Public because a payslip that has been adjusted by hand — an allowance
     * added, a holiday paid — has a different taxable income from the one the
     * run computed, and the tax has to follow it. The alternative was a second
     * copy of the BIR table living in the adjustments service, which is the
     * kind of duplication that is correct on the day it is written and wrong
     * the first time a rate changes.
     */
    public function withholdingFor(float $taxable, string $frequency): float
    {
        return $this->withholding($taxable, $frequency);
    }

    private function withholding(float $taxable, string $frequency): float
    {
        $table = match (strtoupper($frequency)) {
            'D' => 'daily',
            'W' => 'weekly',
            'M' => 'monthly',
            default => 'semi-monthly',
        };

        $bracket = DB::table('withholding_brackets')
            ->where('frequency', $table)
            ->where('over', '<=', $taxable)
            ->orderByDesc('over')
            ->first();

        if (! $bracket) {
            return 0.0;
        }

        return round((float) $bracket->base_tax + ($taxable - (float) $bracket->over) * (float) $bracket->rate, 2);
    }

    /** An agency's live configuration, falling back to the shipped defaults. */
    private function agency(string $agency, array $fallback): array
    {
        $row = DB::table('statutory_settings')
            ->where('agency', $agency)
            ->where('is_active', true)
            ->first();

        if (! $row || ! $row->config) {
            return $fallback;
        }

        return json_decode($row->config, true) + $fallback;
    }
}
