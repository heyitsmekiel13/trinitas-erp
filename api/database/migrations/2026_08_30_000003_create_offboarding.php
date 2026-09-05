<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The half of the employment lifecycle that did not exist.
 *
 * Hiring creates a 201 file, a sign-in and an onboarding checklist. Nothing
 * happened on the way out except a status flip to RESIGNED or TERMINATED —
 * no property turnover recorded, no per-department clearance, no COE trail,
 * no confirmation the final pay was actually handed to Payroll. An
 * `EmployeeObserver` already deactivates the sign-in the moment that status
 * changes; this is everything else that moment should also set in motion.
 *
 * `offboarding_cases` is one row per separation, not one row per employee —
 * somebody who resigns, is rehired, and resigns again has two cases, each
 * with their own clearance trail. `offboarding_tasks` mirrors
 * `onboarding_tasks` in shape deliberately: the same checklist mechanics,
 * generated from a fixed template, ticked off the same way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('offboarding_cases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->enum('reason', ['Resignation', 'Termination', 'End of Contract', 'Retirement'])
                ->default('Resignation');
            $table->foreignId('initiated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('last_working_day')->nullable();
            $table->enum('clearance_status', ['Pending', 'In Progress', 'Cleared'])->default('Pending');
            $table->boolean('exit_interview_completed')->default(false);
            $table->enum('final_pay_status', ['Pending', 'Processing', 'Released'])->default('Pending');
            $table->text('notes')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamps();

            $table->index(['employee_id', 'closed_at']);
        });

        Schema::create('offboarding_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('offboarding_case_id')->constrained()->cascadeOnDelete();
            $table->string('key', 64);
            $table->enum('category', ['Property Turnover', 'Access Revocation', 'Clearance', 'Documentation', 'Finance'])
                ->default('Clearance');
            $table->string('title', 190);
            $table->string('description', 255)->nullable();
            $table->enum('status', ['Pending', 'Done'])->default('Pending');
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['offboarding_case_id', 'key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('offboarding_tasks');
        Schema::dropIfExists('offboarding_cases');
    }
};
