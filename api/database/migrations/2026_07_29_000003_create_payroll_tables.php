<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll processing.
 *
 * A period is the cutoff (1–15 or 16–EOM). A run is one payroll group being
 * processed for that period — groups are approved and released separately
 * because the bank requires one credit file per group. A payslip is one
 * employee within a run, and payslip_lines hold the itemised breakdown so a
 * payslip can be reprinted exactly as issued even after rates change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_periods', function (Blueprint $table) {
            $table->id();
            $table->string('code', 16)->unique();       // 2026-07-B
            $table->string('label', 64);                // July 16–31, 2026
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('month');
            $table->unsignedTinyInteger('half');        // 1 or 2
            $table->date('period_start');
            $table->date('period_end');
            $table->date('pay_date');
            $table->enum('status', ['Open', 'Processing', 'For Approval', 'Approved', 'Released', 'Closed'])
                ->default('Open');
            $table->timestamps();

            $table->unique(['year', 'month', 'half']);
        });

        Schema::create('employee_timecards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payroll_period_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();

            $table->decimal('regular_hours', 8, 2)->default(0);
            $table->decimal('overtime_hours', 8, 2)->default(0);
            $table->decimal('night_diff_hours', 8, 2)->default(0);
            $table->decimal('rest_day_hours', 8, 2)->default(0);
            $table->decimal('regular_holiday_hours', 8, 2)->default(0);
            $table->decimal('special_holiday_hours', 8, 2)->default(0);
            $table->unsignedSmallInteger('late_minutes')->default(0);
            $table->unsignedSmallInteger('undertime_minutes')->default(0);
            $table->decimal('absent_days', 5, 2)->default(0);
            $table->decimal('paid_leave_days', 5, 2)->default(0);

            $table->enum('source', ['Biometric', 'Manual', 'Import'])->default('Manual');
            $table->timestamps();

            $table->unique(['payroll_period_id', 'employee_id']);
        });

        Schema::create('payroll_runs', function (Blueprint $table) {
            $table->id();
            $table->string('run_no', 32)->unique();
            $table->foreignId('payroll_period_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_group_id')->constrained()->restrictOnDelete();

            $table->unsignedInteger('headcount')->default(0);
            $table->decimal('gross_pay', 14, 2)->default(0);
            $table->decimal('statutory_employee', 14, 2)->default(0);
            $table->decimal('statutory_employer', 14, 2)->default(0);
            $table->decimal('withholding_tax', 14, 2)->default(0);
            $table->decimal('other_deductions', 14, 2)->default(0);
            $table->decimal('total_deductions', 14, 2)->default(0);
            $table->decimal('net_pay', 14, 2)->default(0);
            $table->decimal('employer_cost', 14, 2)->default(0);

            $table->enum('status', ['Draft', 'Computed', 'For Approval', 'Approved', 'Released', 'Cancelled'])
                ->default('Draft');
            $table->foreignId('prepared_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('released_at')->nullable();
            $table->timestamps();

            $table->unique(['payroll_period_id', 'payroll_group_id']);
        });

        Schema::create('payslips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payroll_run_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained()->restrictOnDelete();

            // Rates are snapshotted so a historic payslip never changes when
            // the employee's current rate is updated.
            $table->decimal('hourly_rate', 12, 4);
            $table->decimal('daily_rate', 12, 4);
            $table->decimal('monthly_equivalent', 12, 2);

            $table->decimal('basic_pay', 12, 2)->default(0);
            $table->decimal('overtime_pay', 12, 2)->default(0);
            $table->decimal('night_diff_pay', 12, 2)->default(0);
            $table->decimal('rest_day_pay', 12, 2)->default(0);
            $table->decimal('holiday_pay', 12, 2)->default(0);
            $table->decimal('leave_pay', 12, 2)->default(0);
            $table->decimal('taxable_allowances', 12, 2)->default(0);
            $table->decimal('non_taxable_allowances', 12, 2)->default(0);
            $table->decimal('gross_pay', 12, 2)->default(0);

            $table->decimal('late_deduction', 12, 2)->default(0);
            $table->decimal('undertime_deduction', 12, 2)->default(0);
            $table->decimal('absence_deduction', 12, 2)->default(0);

            $table->decimal('sss_salary_credit', 12, 2)->default(0);
            $table->decimal('sss_employee', 12, 2)->default(0);
            $table->decimal('sss_employer', 12, 2)->default(0);
            $table->decimal('philhealth_employee', 12, 2)->default(0);
            $table->decimal('philhealth_employer', 12, 2)->default(0);
            $table->decimal('pagibig_employee', 12, 2)->default(0);
            $table->decimal('pagibig_employer', 12, 2)->default(0);

            $table->decimal('taxable_income', 12, 2)->default(0);
            $table->decimal('withholding_tax', 12, 2)->default(0);
            $table->decimal('other_deductions', 12, 2)->default(0);
            $table->decimal('total_deductions', 12, 2)->default(0);
            $table->decimal('net_pay', 12, 2)->default(0);
            $table->decimal('employer_cost', 12, 2)->default(0);
            $table->decimal('thirteenth_month_accrual', 12, 2)->default(0);

            // Snapshot of the account credited, for bank reconciliation.
            $table->string('atm_account', 32)->nullable();
            $table->json('notes')->nullable();
            $table->timestamps();

            $table->unique(['payroll_run_id', 'employee_id']);
        });

        Schema::create('payslip_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('payslip_id')->constrained()->cascadeOnDelete();
            $table->enum('kind', ['earning', 'deduction']);
            $table->string('code', 32);
            $table->string('label', 150);
            $table->decimal('amount', 12, 2);
            $table->boolean('taxable')->default(false);
            $table->timestamps();

            $table->index(['payslip_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslip_lines');
        Schema::dropIfExists('payslips');
        Schema::dropIfExists('payroll_runs');
        Schema::dropIfExists('employee_timecards');
        Schema::dropIfExists('payroll_periods');
    }
};
