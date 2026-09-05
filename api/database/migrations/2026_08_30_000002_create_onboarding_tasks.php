<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The new-hire checklist, as tasks rather than a status.
 *
 * Hiring someone already creates the 201 file and the sign-in. What it never
 * created was a record of everything else a new hire actually needs in their
 * first month — the contract signed, the policy acknowledged, orientation
 * attended, the 201-file documents submitted — which meant onboarding
 * happened, if it happened, from memory. `key` ties each row back to the
 * fixed template in `OnboardingTasks` so a re-run of the generator is
 * idempotent rather than a second copy of the same checklist.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('onboarding_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->string('key', 64);
            $table->enum('category', ['Documentation', 'IT Access', 'Training', 'Compliance'])->default('Documentation');
            $table->string('title', 190);
            $table->string('description', 255)->nullable();
            $table->date('due_date')->nullable();
            $table->enum('status', ['Pending', 'Done'])->default('Pending');
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'key']);
            $table->index(['status', 'due_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('onboarding_tasks');
    }
};
