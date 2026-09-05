<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A DOLE regional wage order, and what it did when applied.
 *
 * `minimum_wage_earner` on `employees` was a tax-exemption flag with nothing
 * behind it — no rate, no region, no way to act on a new wage order except
 * editing salaries by hand one at a time. This is the rate itself, entered
 * once when DOLE issues an order (the system has no way to know a government
 * rate on its own — that part stays a person's job, same as every real
 * payroll office), and the propagation to affected employees automated from
 * there.
 *
 * Branches are chosen directly rather than matched by a region string on
 * `branch_units` — there is nowhere in this system today that field would
 * ever get populated, and a wage order silently matching zero branches
 * because a text field was left blank is worse than an administrator picking
 * the branches by hand once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wage_orders', function (Blueprint $table) {
            $table->id();
            $table->string('label', 190);
            $table->string('order_no', 60)->nullable();
            $table->string('region_label', 120);
            $table->decimal('daily_rate', 10, 2);
            $table->date('effective_date');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('applied_at')->nullable();
            $table->foreignId('applied_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('wage_order_branches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('wage_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('branch_unit_id')->constrained()->cascadeOnDelete();
            $table->unique(['wage_order_id', 'branch_unit_id']);
        });

        Schema::create('wage_order_adjustments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('wage_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->decimal('old_salary', 12, 4);
            $table->decimal('new_salary', 12, 4);
            $table->decimal('old_daily_rate', 10, 2);
            $table->decimal('new_daily_rate', 10, 2);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wage_order_adjustments');
        Schema::dropIfExists('wage_order_branches');
        Schema::dropIfExists('wage_orders');
    }
};
