<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\PayrollRun;
use App\Models\Payslip;
use App\Models\PayslipLine;
use Illuminate\Support\Facades\DB;

/**
 * Changing a payslip after the run computed it, without breaking the maths.
 *
 * Payslips were read-only, and that was defensible: every figure on one is the
 * output of the engine, and a payroll where somebody can type over the net pay
 * is not a payroll. But read-only is not the same as correct, and it left a
 * real gap. The engine deliberately writes zero into five fields it cannot
 * know — rest day pay, holiday pay, leave pay, and the two allowance columns —
 * and nothing in the application could ever put a figure in them. A cost of
 * living allowance, a holiday somebody actually worked, or a one-off transport
 * reimbursement had to be handled outside the system entirely.
 *
 * So this exists, and the rule that makes it safe is that **nothing derived is
 * ever writable**. What can be edited is what the engine treats as an input:
 *
 *   editable    rest day, holiday and leave pay; taxable and non-taxable
 *               allowances; itemised one-off earnings and deductions
 *
 *   derived     gross pay, taxable income, withholding tax, total deductions,
 *               net pay, employer cost — all recomputed here, every time,
 *               from the inputs above
 *
 * Withholding is recomputed through the engine's own BIR table rather than a
 * second copy of it, so an added allowance moves the tax the way it would have
 * if the run had known about it in the first place.
 *
 * Statutory contributions are deliberately *not* recomputed. SSS, PhilHealth
 * and Pag-IBIG are banded on monthly basic compensation, not on a one-off
 * allowance, so re-deriving them from an adjusted gross would over-deduct and
 * over-remit. They stay as the engine computed them.
 *
 * Everything here refuses on a run that has been approved or released. At that
 * point somebody has signed the register or the money has moved, and the way
 * to change a payslip is to reopen the run — which is a visible act.
 */
class PayrollAdjustments
{
    public function __construct(private readonly PayrollEngine $engine) {}

    /** Amounts a person may set. Everything else on a payslip is derived. */
    public const EDITABLE = [
        'restDayPay' => 'rest_day_pay',
        'holidayPay' => 'holiday_pay',
        'leavePay' => 'leave_pay',
        'taxableAllowances' => 'taxable_allowances',
        'nonTaxableAllowances' => 'non_taxable_allowances',
        'atmAccount' => 'atm_account',
        // Neither feeds this payslip's own gross/net — a hold changes what
        // is released, not what was earned, and a retro figure is the AUB
        // workbook's own lump adjustment column, not something this engine
        // computes. Both are read straight through by the AUB export.
        'holdAmount' => 'hold_amount',
        'retroAdjustment' => 'retro_adjustment',
    ];

    /* ====================================================================== */
    /* Guards */
    /* ====================================================================== */

    /**
     * Whether this run may still be edited, and why not when it may not.
     *
     * @throws \RuntimeException
     */
    public function assertOpen(PayrollRun $run): void
    {
        if ($run->status === 'Released') {
            throw new \RuntimeException(
                "{$run->run_no} has been released — the pay has gone out. Reverse it before changing a payslip."
            );
        }

        if ($run->status === 'Approved') {
            throw new \RuntimeException(
                "{$run->run_no} has been approved and somebody has signed that register. Reopen the run first."
            );
        }
    }

    /* ====================================================================== */
    /* Payslips */
    /* ====================================================================== */

    /**
     * Adds one employee to a run the engine has already computed.
     *
     * The case this is for: somebody hired mid-cut-off, or moved into the
     * group after the run was computed. Recomputing the whole run would work,
     * but it also throws away every adjustment made to the other payslips —
     * which is a bad trade for adding one person.
     *
     * @throws \RuntimeException
     */
    public function addEmployee(PayrollRun $run, Employee $employee): Payslip
    {
        $this->assertOpen($run);

        if ($run->payslips()->where('employee_id', $employee->id)->exists()) {
            throw new \RuntimeException("{$employee->full_name} already has a payslip on this run.");
        }

        if ($employee->payroll_group_id !== $run->payroll_group_id) {
            throw new \RuntimeException(
                "{$employee->full_name} is not in this run's payroll group, so they would be paid on the wrong "
                .'cut-off. Move them to the group first, or add them to the right run.'
            );
        }

        return DB::transaction(function () use ($run, $employee) {
            $slip = $this->engine->computeOne($run, $employee);

            $this->rollUp($run);

            return $slip;
        });
    }

    /**
     * Takes a payslip off a run.
     *
     * For somebody who should not have been paid on this cut-off at all — a
     * resignation that was recorded late, a duplicate. The deduction lines go
     * with it, which hands any loan instalment it collected straight back to
     * the balance: the balance is derived from the lines, so removing them is
     * the reversal.
     *
     * @throws \RuntimeException
     */
    public function removePayslip(Payslip $payslip): PayrollRun
    {
        $run = $payslip->payrollRun;

        $this->assertOpen($run);

        return DB::transaction(function () use ($payslip, $run) {
            $payslip->lines()->delete();
            $payslip->delete();

            return $this->rollUp($run->fresh());
        });
    }

    /**
     * Sets the amounts a person is allowed to set, then re-derives the rest.
     *
     * @param  array<string, mixed>  $values
     *
     * @throws \RuntimeException
     */
    public function adjust(Payslip $payslip, array $values, ?string $note = null): Payslip
    {
        $this->assertOpen($payslip->payrollRun);

        $changes = [];

        foreach (self::EDITABLE as $field => $column) {
            if (array_key_exists($field, $values)) {
                $changes[$column] = $column === 'atm_account'
                    ? ($values[$field] ?: null)
                    : round((float) $values[$field], 2);
            }
        }

        if ($note !== null) {
            $changes['notes'] = $note ?: null;
        }

        // Same reasoning as `addLine`: an adjustment that is refused must not
        // leave the amounts written and the totals unchanged.
        return DB::transaction(function () use ($payslip, $changes) {
            if ($changes !== []) {
                $payslip->update($changes);
            }

            return $this->recalculate($payslip->fresh());
        });
    }

    /* ====================================================================== */
    /* Lines */
    /* ====================================================================== */

    /**
     * Adds a one-off earning or deduction, itemised.
     *
     * The column pair handles "an allowance of ₱2,000". This handles the case
     * where the payslip has to *say what it was* — a rice subsidy, a uniform
     * charge, a cash advance settled this cut-off — because a payslip that
     * shows an unexplained figure is a payslip somebody queries.
     *
     * @param  array<string, mixed>  $values
     *
     * @throws \RuntimeException
     */
    public function addLine(Payslip $payslip, array $values): Payslip
    {
        $this->assertOpen($payslip->payrollRun);

        /* In a transaction because `recalculate` refuses a line that would
           take net pay below zero — and without one the refusal still left the
           line behind, so the payslip was saved consistent and the register
           was not. A rejected change must leave nothing at all. */
        return DB::transaction(function () use ($payslip, $values) {
            PayslipLine::create([
                'payslip_id' => $payslip->id,
                'kind' => $values['kind'],
                'code' => strtoupper(substr((string) ($values['code'] ?? 'ADJ'), 0, 32)),
                'label' => $values['label'],
                'amount' => round((float) $values['amount'], 2),
                // Only an earning can be taxable; a deduction is never a form
                // of income, and letting the flag through on one would move
                // the tax in the wrong direction.
                'taxable' => $values['kind'] === 'earning' && ! empty($values['taxable']),
            ]);

            return $this->recalculate($payslip->fresh());
        });
    }

    /**
     * Removes a line.
     *
     * A collection line — one that paid down a loan — may not be removed here.
     * The balance is derived from these lines, so deleting one silently
     * un-collects an instalment and the loan quietly grows back. Recomputing
     * the run is the way to redo a collection, because that reverses every
     * line together and re-derives them from the arrangement.
     *
     * @throws \RuntimeException
     */
    public function removeLine(PayslipLine $line): Payslip
    {
        $payslip = $line->payslip;

        $this->assertOpen($payslip->payrollRun);

        if ($line->employee_deduction_id) {
            throw new \RuntimeException(
                'That line is a loan or advance collection, and the outstanding balance is worked out from it. '
                .'Change the arrangement and recompute the run instead of deleting the line.'
            );
        }

        return DB::transaction(function () use ($line, $payslip) {
            $line->delete();

            return $this->recalculate($payslip->fresh());
        });
    }

    /* ====================================================================== */
    /* The arithmetic */
    /* ====================================================================== */

    /**
     * Re-derives every computed figure on a payslip from its inputs.
     *
     * This is the whole safety of the feature. Nothing that follows is read
     * from the record: gross, taxable income, tax, total deductions and net
     * pay are all recomputed, so a payslip cannot end up in a state where its
     * own columns disagree with each other.
     *
     * @throws \RuntimeException
     */
    public function recalculate(Payslip $payslip): Payslip
    {
        $payslip->loadMissing(['lines', 'employee', 'payrollRun.payrollGroup']);

        $lines = $payslip->lines;

        $manualEarnings = round((float) $lines->where('kind', 'earning')->sum('amount'), 2);
        $taxableEarnings = round((float) $lines->where('kind', 'earning')->where('taxable', true)->sum('amount'), 2);
        $lineDeductions = round((float) $lines->where('kind', 'deduction')->sum('amount'), 2);

        $earned = round(
            (float) $payslip->basic_pay
            + (float) $payslip->overtime_pay
            + (float) $payslip->night_diff_pay
            + (float) $payslip->rest_day_pay
            + (float) $payslip->holiday_pay
            + (float) $payslip->leave_pay,
            2,
        );

        $gross = round(
            $earned
            + (float) $payslip->taxable_allowances
            + (float) $payslip->non_taxable_allowances
            + $manualEarnings,
            2,
        );

        $timeLost = round(
            (float) $payslip->late_deduction
            + (float) $payslip->undertime_deduction
            + (float) $payslip->absence_deduction,
            2,
        );

        $statutoryEmployee = round(
            (float) $payslip->sss_employee
            + (float) $payslip->philhealth_employee
            + (float) $payslip->pagibig_employee,
            2,
        );

        // Non-taxable allowances are, by definition, out of the tax base. De
        // minimis benefits and the statutory contributions are the two things
        // that come off before the BIR table is read.
        $taxable = round(
            $earned + (float) $payslip->taxable_allowances + $taxableEarnings - $timeLost - $statutoryEmployee,
            2,
        );

        $taxable = max(0.0, $taxable);

        $withholding = $payslip->employee?->minimum_wage_earner
            ? 0.0
            : $this->engine->withholdingFor($taxable, $payslip->payrollRun->payrollGroup->frequency ?? 'S');

        $deductions = round($timeLost + $statutoryEmployee + $withholding + $lineDeductions, 2);
        $net = round($gross - $deductions, 2);

        if ($net < 0) {
            throw new \RuntimeException(
                'That would take net pay to '.number_format($net, 2)
                .'. Nobody can be paid a negative wage — reduce the deduction, or collect it next cut-off.'
            );
        }

        /* The employer's share of SSS carries an Employees' Compensation
           premium that is not stored in a column of its own. Rather than lose
           it on every adjustment, it is recovered as the difference the engine
           left behind and carried forward. */
        $employerShare = round(
            (float) $payslip->sss_employer
            + (float) $payslip->philhealth_employer
            + (float) $payslip->pagibig_employer,
            2,
        );

        $ec = max(0.0, round(
            (float) $payslip->employer_cost - ((float) $payslip->gross_pay + $employerShare),
            2,
        ));

        $payslip->update([
            'gross_pay' => $gross,
            'taxable_income' => $taxable,
            'withholding_tax' => $withholding,
            'other_deductions' => $lineDeductions,
            'total_deductions' => $deductions,
            'net_pay' => $net,
            'employer_cost' => round($gross + $employerShare + $ec, 2),
        ]);

        $this->rollUp($payslip->payrollRun);

        return $payslip->fresh(['lines']);
    }

    /**
     * Re-derives a run's header from the payslips under it.
     *
     * The header is a sum, never a typed figure. A run whose total disagrees
     * with its own register is the classic payroll bug, and it is the reason
     * every path in this class ends here.
     */
    public function rollUp(PayrollRun $run): PayrollRun
    {
        $payslips = $run->payslips()->get();

        $run->update([
            'headcount' => $payslips->count(),
            'gross_pay' => round((float) $payslips->sum('gross_pay'), 2),
            'statutory_employee' => round(
                (float) $payslips->sum('sss_employee')
                + (float) $payslips->sum('philhealth_employee')
                + (float) $payslips->sum('pagibig_employee'),
                2,
            ),
            'statutory_employer' => round(
                (float) $payslips->sum('sss_employer')
                + (float) $payslips->sum('philhealth_employer')
                + (float) $payslips->sum('pagibig_employer'),
                2,
            ),
            'withholding_tax' => round((float) $payslips->sum('withholding_tax'), 2),
            'other_deductions' => round((float) $payslips->sum('other_deductions'), 2),
            'total_deductions' => round((float) $payslips->sum('total_deductions'), 2),
            'net_pay' => round((float) $payslips->sum('net_pay'), 2),
            'employer_cost' => round((float) $payslips->sum('employer_cost'), 2),
        ]);

        return $run->fresh();
    }
}
