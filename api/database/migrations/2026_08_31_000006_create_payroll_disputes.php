<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll complaints, HR's response to them, and any retro-pay or deduction
 * that comes out of resolving one.
 *
 * This was a spreadsheet — one row per complaint, no linkage back to the
 * employee or the cut-off it was about beyond typed text — before this
 * table existed. Applying the resolved amount to a payslip is still a
 * deliberate, separate action on the payroll run itself (an "add line" the
 * payroll screens already support): this table is the record of what was
 * decided and why, not something that reaches into a run on its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_disputes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_period_id')->nullable()->constrained()->nullOnDelete();
            $table->text('complaint');
            $table->text('hr_feedback')->nullable();
            // Free text on purpose — "Payroll", "Employee", "Timekeeping",
            // a specific branch — whatever the finding actually was, not a
            // fixed list that will not fit the next one.
            $table->string('liable', 120)->nullable();
            $table->text('action_plan')->nullable();
            // Money the employee owes back (an overpayment) and money still
            // owed to them (a retro) are tracked as two separate figures
            // rather than one signed amount — a dispute can carry both at
            // once, and collapsing them into one number is how one gets
            // silently netted against the other with nothing on record.
            $table->decimal('deduct_amount', 12, 2)->nullable();
            $table->decimal('retro_amount', 12, 2)->nullable();
            $table->enum('status', ['Open', 'Under Review', 'Resolved', 'Applied to Payroll'])->default('Open');
            $table->date('raised_on');
            $table->date('resolved_on')->nullable();
            $table->foreignId('resolved_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['employee_id', 'status']);
            $table->index('status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_disputes');
    }
};
