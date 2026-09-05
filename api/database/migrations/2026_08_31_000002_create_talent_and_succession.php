<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The competency matrix and 9-box succession planning.
 *
 * `employee_competencies` holds one current rating per employee per
 * competency — re-assessing is an edit, not a new row, so "where does this
 * person stand today" is always a straight read, never a max() over history.
 * `succession_plans` is deliberately not derived from the Process module's
 * performance-review scores: those are a point-in-time verdict on the cycle
 * just finished, while a succession rating is HR's standing judgment of
 * someone's trajectory, updated on its own schedule.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('competencies', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150)->unique();
            $table->string('category', 80)->nullable();
            $table->string('description', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('employee_competencies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('competency_id')->constrained()->cascadeOnDelete();
            // 1 Novice · 2 Developing · 3 Proficient · 4 Advanced · 5 Expert.
            $table->unsignedTinyInteger('level');
            $table->date('assessed_on');
            $table->foreignId('assessed_by_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('notes', 255)->nullable();
            $table->timestamps();

            $table->unique(['employee_id', 'competency_id']);
        });

        Schema::create('succession_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('target_position_id')->nullable()->constrained('positions')->nullOnDelete();
            // Both 1-5 — the two axes of a 9-box grid.
            $table->unsignedTinyInteger('performance_rating');
            $table->unsignedTinyInteger('potential_rating');
            $table->enum('readiness', ['Ready Now', '1-2 Years', '3-5 Years', 'Not Ready'])->default('3-5 Years');
            $table->string('notes', 255)->nullable();
            $table->date('assessed_on');
            $table->timestamps();

            $table->unique('employee_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('succession_plans');
        Schema::dropIfExists('employee_competencies');
        Schema::dropIfExists('competencies');
    }
};
