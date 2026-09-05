<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Deductions that are not statutory: loans, advances, and the rest.
 *
 * Payroll could compute SSS, PhilHealth, Pag-IBIG and withholding tax, but
 * had nowhere to record a salary loan or a cash advance — `other_deductions`
 * on the payslip was hardcoded to zero, so anything the company was owed had
 * to be collected outside the system and reconciled by hand.
 *
 * Two decisions here are worth stating, because both are about being able to
 * recompute a run safely.
 *
 * A loan's outstanding balance is NOT stored as a counter the engine
 * decrements. Recomputing a payroll run is normal — attendance gets corrected
 * after a first pass — and a decrementing counter would collect the same
 * instalment twice every time somebody recomputed. Instead each collection is
 * written as a payslip line pointing back at the deduction, and the balance is
 * derived from the lines that exist. Delete a run's payslips and its
 * collections disappear with them, which is exactly what recomputing means.
 *
 * And `priority` decides what gets collected first when there is not enough
 * pay to cover everything. Without an explicit order the answer would depend
 * on primary-key order, which is to say on the order somebody happened to
 * enter the records.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deduction_types', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 120);

            // A loan is collected until its principal is paid off. Anything
            // else runs until somebody stops it.
            $table->boolean('is_loan')->default(false);

            // Lower collects first when pay will not stretch to everything.
            $table->unsignedSmallInteger('priority')->default(100);

            $table->boolean('is_active')->default(true);
            $table->string('notes', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('employee_deductions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('deduction_type_id')->constrained()->restrictOnDelete();

            // The lender's own reference — an SSS loan number, a voucher no.
            $table->string('reference', 64)->nullable();

            // Null principal means open-ended: collect the same amount every
            // cut-off until it is stopped, which is what a canteen tab or a
            // union due looks like.
            $table->decimal('principal', 12, 2)->nullable();
            $table->decimal('amount_per_cutoff', 12, 2);

            $table->date('starts_on');
            $table->date('ends_on')->nullable();

            // Completed is deliberately absent: a settled loan is one whose
            // collections add up to its principal, and storing that as a state
            // as well would give two answers to the same question.
            $table->enum('status', ['Active', 'Suspended', 'Cancelled'])->default('Active');

            $table->string('notes', 255)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['employee_id', 'status']);
        });

        Schema::table('payslip_lines', function (Blueprint $table) {
            // What this line collected against, so a balance can be derived
            // and a payslip can say which loan it paid down.
            $table->foreignId('employee_deduction_id')
                ->nullable()
                ->after('payslip_id')
                ->constrained()
                ->nullOnDelete();

            $table->index('employee_deduction_id');
        });
    }

    public function down(): void
    {
        Schema::table('payslip_lines', function (Blueprint $table) {
            $table->dropForeign(['employee_deduction_id']);
            $table->dropColumn('employee_deduction_id');
        });

        Schema::dropIfExists('employee_deductions');
        Schema::dropIfExists('deduction_types');
    }
};
