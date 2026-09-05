<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Recurrence, templates, time tracking and goals.
 *
 * The breadth the module was missing. Each table here answers a question the
 * existing schema could not:
 *
 *   - A compliance office runs the same checks every month, and had no way to
 *     say so. Somebody was going to end up copying a task by hand twelve times
 *     a year, or not doing it.
 *   - Every project started from the same four columns typed out again.
 *   - `tasks.logged_hours` was a number a person typed into a box. It is the
 *     only figure in the module nothing could verify, which makes it the only
 *     one nobody should have trusted.
 *   - Projects had no connection to why they were being done.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* ------------------------------ Recurrence ----------------------------- */

        /**
         * A task that should exist again on a schedule.
         *
         * Deliberately a template that spawns tasks rather than a flag on a
         * task that clones itself. A recurring task which is also a real task
         * has to be two things at once — the thing you complete this month and
         * the rule that makes next month's — and every tool that models it
         * that way ends up with a January task nobody can close because
         * closing it would stop February.
         */
        Schema::create('task_recurrences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('section_id')->nullable()->constrained('project_sections')->nullOnDelete();

            $table->string('title', 250);
            $table->text('description')->nullable();
            $table->enum('priority', ['Low', 'Normal', 'High', 'Urgent'])->default('Normal');
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->decimal('estimate_hours', 8, 2)->nullable();

            $table->enum('frequency', ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly', 'Yearly']);
            // 1 = Monday … 7 = Sunday, for the weekly frequencies.
            $table->unsignedTinyInteger('weekday')->nullable();
            // 1–31, or 0 meaning the last working day of the month — which is
            // what a month-end check actually means.
            $table->unsignedTinyInteger('day_of_month')->nullable();

            // How long after it appears the task is due, in working days.
            $table->unsignedSmallInteger('due_in_days')->default(3);

            $table->date('starts_on');
            $table->date('ends_on')->nullable();
            $table->date('next_run_on')->nullable();
            $table->date('last_run_on')->nullable();
            $table->unsignedInteger('times_raised')->default(0);
            $table->boolean('is_active')->default(true);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['is_active', 'next_run_on']);
        });

        // Which rule produced a task, so a series can be traced.
        Schema::table('tasks', function (Blueprint $table) {
            $table->foreignId('recurrence_id')->nullable()->after('parent_id')
                ->constrained('task_recurrences')->nullOnDelete();
        });

        /* ------------------------------ Templates ------------------------------ */

        Schema::create('project_templates', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->text('description')->nullable();
            $table->string('colour', 16)->default('var(--series-1)');
            $table->unsignedSmallInteger('default_sla_days')->default(5);

            // The shape, as data. A template is not a project — it has no
            // owner, no dates and nothing due — so modelling it as one would
            // put an empty project in every list that counts them.
            $table->json('sections')->nullable();
            $table->json('labels')->nullable();
            $table->json('tasks')->nullable();

            $table->unsignedInteger('times_used')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        /* ---------------------------- Time tracking ---------------------------- */

        /**
         * Time actually spent, as entries rather than a total.
         *
         * `logged_hours` stays on the task as a cached sum, but it stops being
         * something a person types: it is derived from these rows. A total
         * nobody can break down is a total nobody can question, and an
         * estimate-versus-actual comparison built on one is worthless.
         */
        Schema::create('task_time_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->timestamp('started_at');
            // Null while a timer is running. At most one open row per person is
            // enforced in the service, not here — a partial unique index is not
            // portable and the rule belongs where the message can explain it.
            $table->timestamp('stopped_at')->nullable();
            $table->unsignedInteger('minutes')->default(0);
            $table->string('note', 250)->nullable();
            // True when somebody typed the duration instead of running a timer.
            $table->boolean('manual')->default(false);

            $table->timestamps();
            $table->index(['task_id', 'started_at']);
            $table->index(['user_id', 'stopped_at']);
        });

        /* -------------------------------- Goals -------------------------------- */

        /**
         * What the projects are for.
         *
         * Projects could say what was being done and never why. A goal is the
         * outcome; projects are how it is being pursued, which is why the link
         * is many-to-many — one goal usually takes several, and a project often
         * serves more than one.
         */
        Schema::create('goals', function (Blueprint $table) {
            $table->id();
            $table->string('name', 190);
            $table->text('description')->nullable();

            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('hr_department_id')->nullable()->constrained('hr_departments')->nullOnDelete();

            $table->string('period', 16);          // 2026-Q3, or 2026
            $table->enum('status', ['Draft', 'Active', 'Achieved', 'Missed', 'Abandoned'])->default('Active');

            // A measurable target, where there is one. Null means the goal is
            // judged rather than counted, which is honest for some of them.
            $table->decimal('target_value', 14, 2)->nullable();
            $table->decimal('current_value', 14, 2)->default(0);
            $table->string('unit', 32)->nullable();

            // Set by hand when the goal is not numeric, derived from the linked
            // projects when it is left null.
            $table->unsignedTinyInteger('progress_override')->nullable();

            $table->date('due_on')->nullable();
            $table->timestamps();

            $table->index(['period', 'status']);
        });

        Schema::create('goal_project', function (Blueprint $table) {
            $table->id();
            $table->foreignId('goal_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();

            $table->unique(['goal_id', 'project_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('goal_project');
        Schema::dropIfExists('goals');
        Schema::dropIfExists('task_time_entries');
        Schema::dropIfExists('project_templates');

        Schema::table('tasks', function (Blueprint $table) {
            $table->dropConstrainedForeignId('recurrence_id');
        });

        Schema::dropIfExists('task_recurrences');
    }
};
