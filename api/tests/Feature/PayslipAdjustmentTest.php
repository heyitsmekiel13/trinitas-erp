<?php

namespace Tests\Feature;

use App\Models\BranchUnit;
use App\Models\BusinessGroup;
use App\Models\DeductionType;
use App\Models\Employee;
use App\Models\EmployeeDeduction;
use App\Models\HrDepartment;
use App\Models\PayrollGroup;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\Payslip;
use App\Models\PayslipLine;
use App\Models\Position;
use App\Models\User;
use App\Services\PayrollAdjustments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Editing a payslip without breaking it.
 *
 * This is money, so the tests are about the invariants rather than the
 * feature. A payslip whose own columns disagree is the classic payroll bug and
 * it is invisible until somebody adds up a register by hand:
 *
 *   gross must equal what it is made of
 *   net must equal gross less deductions
 *   the run header must equal the sum of its payslips
 *   nothing at all changes once the run is approved
 */
class PayslipAdjustmentTest extends TestCase
{
    use RefreshDatabase;

    private PayrollRun $run;

    private Payslip $payslip;

    protected function setUp(): void
    {
        parent::setUp();

        Sanctum::actingAs(User::create([
            'name' => 'Payroll Officer',
            'email' => 'payroll@example.com',
            'password' => bcrypt('secret-for-tests'),
        ]));

        $group = PayrollGroup::create([
            'code' => 'MAIN', 'name' => 'Main', 'frequency' => 'S', 'statutory_schedule' => 'second',
        ]);

        $period = PayrollPeriod::create([
            'code' => '2026-08-2', 'label' => '16–31 Aug 2026', 'year' => 2026, 'month' => 8, 'half' => 2,
            'period_start' => '2026-08-16', 'period_end' => '2026-08-31', 'pay_date' => '2026-09-05',
        ]);

        $this->run = PayrollRun::create([
            'run_no' => 'PR-2026-0001',
            'payroll_period_id' => $period->id,
            'payroll_group_id' => $group->id,
            'status' => 'Computed',
        ]);

        $business = BusinessGroup::create(['code' => 'TFC', 'name' => 'Trinitas']);
        $branch = BranchUnit::create(['code' => 'HO', 'name' => 'Head Office', 'business_group_id' => $business->id]);
        $department = HrDepartment::create(['code' => 'FIN', 'name' => 'Finance']);
        $position = Position::create(['title' => 'Accounting Clerk']);

        $employee = Employee::create([
            'employee_no' => '1001', 'first_name' => 'Juan', 'last_name' => 'Dela Cruz',
            'position_id' => $position->id, 'hr_department_id' => $department->id,
            'branch_unit_id' => $branch->id, 'business_group_id' => $business->id,
            'payroll_group_id' => $group->id, 'date_hired' => '2020-01-01',
            'employment_status' => 'REGULAR', 'salary' => 30000,
        ]);

        /* A payslip shaped like one the engine produces: basic pay, the
           statutory shares, a tax, and zeros in the five fields the engine
           cannot know. */
        $this->payslip = Payslip::create([
            'payroll_run_id' => $this->run->id,
            'employee_id' => $employee->id,
            'hourly_rate' => 143.77, 'daily_rate' => 1150.16, 'monthly_equivalent' => 30000,
            'basic_pay' => 15000,
            'overtime_pay' => 0, 'night_diff_pay' => 0,
            'rest_day_pay' => 0, 'holiday_pay' => 0, 'leave_pay' => 0,
            'taxable_allowances' => 0, 'non_taxable_allowances' => 0,
            'gross_pay' => 15000,
            'late_deduction' => 0, 'undertime_deduction' => 0, 'absence_deduction' => 0,
            'sss_salary_credit' => 30000,
            'sss_employee' => 1350, 'sss_employer' => 2650,
            'philhealth_employee' => 750, 'philhealth_employer' => 750,
            'pagibig_employee' => 200, 'pagibig_employer' => 200,
            'taxable_income' => 12700, 'withholding_tax' => 0,
            'other_deductions' => 0, 'total_deductions' => 2300,
            'net_pay' => 12700, 'employer_cost' => 17700,
            'thirteenth_month_accrual' => 1250,
        ]);

        app(PayrollAdjustments::class)->rollUp($this->run);
        $this->run->refresh();
    }

    private function assertConsistent(Payslip $slip): void
    {
        $slip->refresh()->load('lines');

        $earnings = (float) $slip->lines->where('kind', 'earning')->sum('amount');
        $lineDeductions = (float) $slip->lines->where('kind', 'deduction')->sum('amount');

        $expectedGross = round(
            (float) $slip->basic_pay + (float) $slip->overtime_pay + (float) $slip->night_diff_pay
            + (float) $slip->rest_day_pay + (float) $slip->holiday_pay + (float) $slip->leave_pay
            + (float) $slip->taxable_allowances + (float) $slip->non_taxable_allowances + $earnings,
            2,
        );

        $this->assertEqualsWithDelta($expectedGross, (float) $slip->gross_pay, 0.01, 'gross must equal its parts');

        $expectedDeductions = round(
            (float) $slip->late_deduction + (float) $slip->undertime_deduction + (float) $slip->absence_deduction
            + (float) $slip->sss_employee + (float) $slip->philhealth_employee + (float) $slip->pagibig_employee
            + (float) $slip->withholding_tax + $lineDeductions,
            2,
        );

        $this->assertEqualsWithDelta($expectedDeductions, (float) $slip->total_deductions, 0.01);
        $this->assertEqualsWithDelta(
            round((float) $slip->gross_pay - (float) $slip->total_deductions, 2),
            (float) $slip->net_pay,
            0.01,
            'net must equal gross less deductions',
        );

        $this->assertEqualsWithDelta($lineDeductions, (float) $slip->other_deductions, 0.01);
    }

    private function assertHeaderMatchesRegister(): void
    {
        $this->run->refresh();
        $payslips = $this->run->payslips()->get();

        $this->assertSame($payslips->count(), (int) $this->run->headcount);
        $this->assertEqualsWithDelta((float) $payslips->sum('gross_pay'), (float) $this->run->gross_pay, 0.01);
        $this->assertEqualsWithDelta((float) $payslips->sum('net_pay'), (float) $this->run->net_pay, 0.01);
        $this->assertEqualsWithDelta(
            (float) $payslips->sum('total_deductions'),
            (float) $this->run->total_deductions,
            0.01,
        );
    }

    public function test_an_allowance_moves_gross_net_and_the_run_total(): void
    {
        $response = $this->patchJson("/api/v1/hr/payslips/{$this->payslip->id}", [
            'nonTaxableAllowances' => 2000,
        ]);

        $response->assertOk();

        $this->payslip->refresh();

        $this->assertEqualsWithDelta(17000.0, (float) $this->payslip->gross_pay, 0.01);
        $this->assertEqualsWithDelta(14700.0, (float) $this->payslip->net_pay, 0.01);

        $this->assertConsistent($this->payslip);
        $this->assertHeaderMatchesRegister();
    }

    public function test_a_non_taxable_allowance_stays_out_of_the_tax_base(): void
    {
        $before = (float) $this->payslip->taxable_income;

        $this->patchJson("/api/v1/hr/payslips/{$this->payslip->id}", ['nonTaxableAllowances' => 5000])
            ->assertOk();

        $this->assertEqualsWithDelta($before, (float) $this->payslip->refresh()->taxable_income, 0.01);
    }

    public function test_a_taxable_allowance_raises_the_tax_base(): void
    {
        $before = (float) $this->payslip->taxable_income;

        $this->patchJson("/api/v1/hr/payslips/{$this->payslip->id}", ['taxableAllowances' => 5000])
            ->assertOk();

        $this->assertEqualsWithDelta($before + 5000, (float) $this->payslip->refresh()->taxable_income, 0.01);
        $this->assertConsistent($this->payslip);
    }

    public function test_statutory_contributions_are_never_re_derived(): void
    {
        // They are banded on monthly basic compensation, not on a one-off
        // allowance. Recomputing them from an adjusted gross would over-deduct
        // and over-remit.
        $this->patchJson("/api/v1/hr/payslips/{$this->payslip->id}", ['taxableAllowances' => 9000])
            ->assertOk();

        $this->payslip->refresh();

        $this->assertEqualsWithDelta(1350.0, (float) $this->payslip->sss_employee, 0.01);
        $this->assertEqualsWithDelta(750.0, (float) $this->payslip->philhealth_employee, 0.01);
        $this->assertEqualsWithDelta(200.0, (float) $this->payslip->pagibig_employee, 0.01);
    }

    public function test_an_itemised_earning_and_deduction_both_land(): void
    {
        $this->postJson("/api/v1/hr/payslips/{$this->payslip->id}/lines", [
            'kind' => 'earning', 'label' => 'Rice subsidy', 'amount' => 1500,
        ])->assertOk();

        $this->postJson("/api/v1/hr/payslips/{$this->payslip->id}/lines", [
            'kind' => 'deduction', 'label' => 'Uniform charge', 'amount' => 500,
        ])->assertOk();

        $this->payslip->refresh();

        $this->assertEqualsWithDelta(16500.0, (float) $this->payslip->gross_pay, 0.01);
        $this->assertEqualsWithDelta(500.0, (float) $this->payslip->other_deductions, 0.01);

        $this->assertConsistent($this->payslip);
        $this->assertHeaderMatchesRegister();
    }

    public function test_a_deduction_can_never_be_marked_taxable(): void
    {
        // It is not a form of income, and letting the flag through would move
        // the tax in the wrong direction.
        $this->postJson("/api/v1/hr/payslips/{$this->payslip->id}/lines", [
            'kind' => 'deduction', 'label' => 'Cash advance', 'amount' => 300, 'taxable' => true,
        ])->assertOk();

        $this->assertFalse((bool) PayslipLine::where('label', 'Cash advance')->first()->taxable);
    }

    public function test_nobody_can_be_paid_a_negative_wage(): void
    {
        $this->postJson("/api/v1/hr/payslips/{$this->payslip->id}/lines", [
            'kind' => 'deduction', 'label' => 'Enormous advance', 'amount' => 99000,
        ])->assertStatus(422);

        // And the refusal left nothing behind.
        $this->payslip->refresh();

        $this->assertEqualsWithDelta(12700.0, (float) $this->payslip->net_pay, 0.01);
        $this->assertConsistent($this->payslip);
    }

    public function test_a_loan_collection_line_cannot_be_deleted(): void
    {
        $deduction = DeductionType::create(['code' => 'LOAN', 'name' => 'Company loan', 'is_loan' => true]);

        $arrangement = EmployeeDeduction::create([
            'employee_id' => $this->payslip->employee_id,
            'deduction_type_id' => $deduction->id,
            'principal' => 5000, 'amount_per_cutoff' => 500, 'starts_on' => '2026-01-01', 'status' => 'Active',
        ]);

        $line = PayslipLine::create([
            'payslip_id' => $this->payslip->id,
            'employee_deduction_id' => $arrangement->id,
            'kind' => 'deduction', 'code' => 'LOAN', 'label' => 'Company loan', 'amount' => 500,
        ]);

        $this->deleteJson("/api/v1/hr/payslip-lines/{$line->id}")
            ->assertStatus(422);

        $this->assertNotNull(PayslipLine::find($line->id));
    }

    public function test_an_approved_run_refuses_every_change(): void
    {
        $this->run->update(['status' => 'Approved']);

        $this->patchJson("/api/v1/hr/payslips/{$this->payslip->id}", ['holidayPay' => 1000])
            ->assertStatus(422);

        $this->postJson("/api/v1/hr/payslips/{$this->payslip->id}/lines", [
            'kind' => 'earning', 'label' => 'Bonus', 'amount' => 1000,
        ])->assertStatus(422);

        $this->deleteJson("/api/v1/hr/payslips/{$this->payslip->id}")
            ->assertStatus(422);

        $this->assertEqualsWithDelta(0.0, (float) $this->payslip->refresh()->holiday_pay, 0.01);
    }

    public function test_removing_a_payslip_takes_it_off_the_run_total(): void
    {
        $this->deleteJson("/api/v1/hr/payslips/{$this->payslip->id}")->assertOk();

        $this->run->refresh();

        $this->assertSame(0, (int) $this->run->headcount);
        $this->assertEqualsWithDelta(0.0, (float) $this->run->net_pay, 0.01);
        $this->assertNull(Payslip::find($this->payslip->id));
    }

    public function test_an_employee_from_another_group_cannot_be_added(): void
    {
        $other = PayrollGroup::create([
            'code' => 'EXEC', 'name' => 'Executive', 'frequency' => 'M', 'statutory_schedule' => 'second',
        ]);

        $employee = Employee::create([
            'employee_no' => '1002', 'first_name' => 'Maria', 'last_name' => 'Santos',
            'position_id' => Position::first()->id,
            'hr_department_id' => HrDepartment::first()->id,
            'branch_unit_id' => BranchUnit::first()->id,
            'business_group_id' => BusinessGroup::first()->id,
            'payroll_group_id' => $other->id,
            'date_hired' => '2020-01-01', 'employment_status' => 'REGULAR', 'salary' => 60000,
        ]);

        $this->postJson("/api/v1/hr/payroll-runs/{$this->run->id}/payslips", ['employeeId' => $employee->id])
            ->assertStatus(422);

        $this->assertSame(1, $this->run->payslips()->count());
    }

    public function test_the_register_says_whether_it_may_be_edited(): void
    {
        $this->getJson("/api/v1/hr/payroll-runs/{$this->run->id}/register")
            ->assertOk()
            ->assertJsonPath('data.editable', true);

        $this->run->update(['status' => 'Released']);

        $this->getJson("/api/v1/hr/payroll-runs/{$this->run->id}/register")
            ->assertOk()
            ->assertJsonPath('data.editable', false);
    }
}
