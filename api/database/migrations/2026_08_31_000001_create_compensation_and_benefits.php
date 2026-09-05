<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Compensation bands and the benefits catalog.
 *
 * Salary already lives on `employees.salary` — a band is a range that salary
 * is judged against, not a new place to store it. Benefits work the same
 * way: the catalog is what the company offers, `employee_benefits` is who
 * is actually enrolled in what, and neither one touches payroll — an HMO
 * premium the company pays outright is company cost, not something that runs
 * through the payslip the way a payroll-deducted loan does.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('salary_bands', function (Blueprint $table) {
            $table->id();
            $table->foreignId('position_id')->unique()->constrained()->cascadeOnDelete();
            $table->decimal('min_monthly', 12, 2);
            $table->decimal('mid_monthly', 12, 2);
            $table->decimal('max_monthly', 12, 2);
            $table->string('currency', 3)->default('PHP');
            $table->string('notes', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('benefit_plans', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 150);
            $table->enum('type', ['HMO', 'Life Insurance', 'Retirement', 'Allowance', 'Other'])->default('Other');
            $table->string('provider', 150)->nullable();
            $table->string('description', 255)->nullable();
            // Monthly, company-paid — what enrolling one employee costs the
            // business. Not run through payroll, so no taxable/non-taxable
            // split: see the module-level docblock in statutoryReports.tsx
            // and PayrollEngine for where that split actually happens.
            $table->decimal('employer_cost', 12, 2)->default(0);
            $table->decimal('employee_cost', 12, 2)->default(0);
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('employee_benefits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('benefit_plan_id')->constrained()->restrictOnDelete();
            $table->date('enrolled_on');
            $table->date('ended_on')->nullable();
            $table->unsignedTinyInteger('dependents')->default(0);
            $table->enum('status', ['Active', 'Ended'])->default('Active');
            $table->string('notes', 255)->nullable();
            $table->timestamps();

            $table->index(['employee_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_benefits');
        Schema::dropIfExists('benefit_plans');
        Schema::dropIfExists('salary_bands');
    }
};
