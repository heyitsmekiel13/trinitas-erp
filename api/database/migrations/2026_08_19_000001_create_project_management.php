<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Project management, and the compliance layer that watches it.
 *
 * The shape here is a deliberate reaction to the four tools it replaces.
 *
 * ClickUp's real defect is not a missing feature, it is seven levels of
 * containment (workspace, space, folder, list, task, subtask, checklist) —
 * people cannot find their own work. Trello's is the opposite: one board, no
 * dependencies, no timeline, and a due date that nothing acts on. Asana gets
 * the atom right (a task, appearing in more than one place) but keeps
 * reporting thin. Monday gets the *legibility* right — typed columns, plain
 * language automations — but everything is trapped inside its board.
 *
 * So: exactly two levels of containment, project → task, plus one level of
 * subtask, and no more. One `tasks` row is the atom; board, list, timeline
 * and calendar are four projections of it rather than four sets of data.
 * Sections carry the status (Monday's typed columns, Trello's lists), which
 * is why `status` is not an enum on the task — a project defines its own
 * workflow and the section knows whether it means "done".
 *
 * The last four tables have no equivalent in any of the four tools. The
 * Process & Performance office evaluates whether work landed on time, and the
 * people being evaluated cannot see the evaluation — a finding an assignee can
 * read is a finding they will argue with before it is recorded. Enforcement is
 * in the controller and the route, not here; this file only keeps the record
 * separate so it can be.
 */
return new class extends Migration
{
    public function up(): void
    {
        /* ------------------------------ Projects ------------------------------ */

        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 190);
            $table->text('description')->nullable();

            $table->enum('status', ['Planning', 'Active', 'On hold', 'Completed', 'Cancelled'])->default('Planning');
            $table->enum('priority', ['Low', 'Normal', 'High', 'Critical'])->default('Normal');
            $table->enum('visibility', ['Team', 'Department', 'Company'])->default('Team');

            // Who answers for it, and which department carries the work. Both
            // point at the people record, so a project inherits the org chart
            // rather than keeping a second copy of it.
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('hr_department_id')->nullable()->constrained('hr_departments')->nullOnDelete();

            $table->date('start_date')->nullable();
            $table->date('due_date')->nullable();
            $table->date('completed_on')->nullable();

            // The compliance clock. A task with no explicit due date inherits
            // this many working days from the day it is opened, so "nobody set
            // a date" cannot be a way of never being late.
            $table->unsignedSmallInteger('default_sla_days')->default(5);

            $table->string('colour', 16)->default('var(--series-1)');
            $table->string('icon', 32)->nullable();
            $table->timestamp('archived_at')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'due_date']);
        });

        Schema::create('project_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('role', ['Lead', 'Member', 'Viewer'])->default('Member');
            $table->timestamps();

            $table->unique(['project_id', 'user_id']);
        });

        /**
         * The workflow columns. A board's lists, a list view's groups and a
         * status field are the same thing seen three ways, so they are one
         * table — which is what stops a card being "Done" on the board and
         * "In progress" in a report.
         */
        Schema::create('project_sections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('colour', 16)->nullable();
            $table->unsignedSmallInteger('position')->default(0);

            // Trello and Monday both let a column fill without complaint. A
            // limit is the one piece of kanban that actually changes behaviour.
            $table->unsignedSmallInteger('wip_limit')->nullable();

            // Exactly one section per project should carry this. It is what
            // "finished" means for the reminder engine and the compliance scan.
            $table->boolean('is_done')->default(false);
            $table->boolean('is_default')->default(false);

            $table->timestamps();
            $table->index(['project_id', 'position']);
        });

        Schema::create('labels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('name', 60);
            $table->string('colour', 16)->default('var(--series-1)');
            $table->timestamps();

            $table->unique(['project_id', 'name']);
        });

        /* -------------------------------- Tasks ------------------------------- */

        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->foreignId('section_id')->nullable()->constrained('project_sections')->nullOnDelete();

            // One level of nesting, and one only. Enforced in the service.
            $table->foreignId('parent_id')->nullable()->constrained('tasks')->cascadeOnDelete();

            $table->string('reference', 32)->unique();
            $table->string('title', 250);
            $table->longText('description')->nullable();

            $table->enum('priority', ['Low', 'Normal', 'High', 'Urgent'])->default('Normal');

            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reporter_id')->nullable()->constrained('users')->nullOnDelete();

            $table->date('start_date')->nullable();
            $table->date('due_date')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();

            $table->decimal('estimate_hours', 8, 2)->nullable();
            $table->decimal('logged_hours', 8, 2)->default(0);
            $table->unsignedTinyInteger('progress')->default(0);

            // Board ordering. Fractional would avoid the reshuffle, but a
            // smallint the whole team can read in the database is worth more
            // here than saving a few writes on a drag.
            $table->unsignedInteger('position')->default(0);

            /**
             * Deadline movement, kept on the row rather than derived.
             *
             * Counting how often a due date moved is the single most useful
             * compliance signal there is, and none of the four tools surfaces
             * it: a task delivered "on time" against a date pushed four times
             * was not delivered on time. `original_due_date` is written once,
             * the first time a date is set, and never again.
             */
            $table->date('original_due_date')->nullable();
            $table->unsignedSmallInteger('due_date_changes')->default(0);
            $table->unsignedSmallInteger('reassignments')->default(0);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['project_id', 'section_id', 'position']);
            $table->index(['assignee_id', 'completed_at']);
            $table->index(['due_date', 'completed_at']);
        });

        Schema::create('label_task', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('label_id')->constrained()->cascadeOnDelete();

            $table->unique(['task_id', 'label_id']);
        });

        /** Everyone who hears about a change without being answerable for it. */
        Schema::create('task_watchers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['task_id', 'user_id']);
        });

        /**
         * Dependencies.
         *
         * `blocks` is the only type that changes behaviour — a task whose
         * blockers are open cannot be moved into a done section. `relates_to`
         * is a cross-reference and nothing more, which is stated here so
         * nobody later assumes it schedules anything.
         */
        Schema::create('task_dependencies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('depends_on_id')->constrained('tasks')->cascadeOnDelete();
            $table->enum('type', ['blocks', 'relates_to'])->default('blocks');
            $table->timestamps();

            $table->unique(['task_id', 'depends_on_id']);
        });

        Schema::create('task_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            // User ids named with @ in the body. Stored so a mention can be
            // notified without re-parsing the text on every read.
            $table->json('mentions')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'created_at']);
        });

        Schema::create('task_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('comment_id')->nullable()->constrained('task_comments')->cascadeOnDelete();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('disk', 32)->default('public');
            $table->string('path', 500);
            $table->string('original_name', 250);
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            // Set for images, so a gallery can lay them out before loading.
            $table->unsignedSmallInteger('width')->nullable();
            $table->unsignedSmallInteger('height')->nullable();

            $table->timestamps();
            $table->index('task_id');
        });

        /**
         * What happened to a task, in order.
         *
         * Written by the service on every material change. This is what the
         * compliance office reads to answer "when did this actually move?",
         * and it is why a due date moved quietly still leaves a trace.
         */
        Schema::create('task_activity', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 80);
            $table->string('field', 60)->nullable();
            $table->text('from_value')->nullable();
            $table->text('to_value')->nullable();
            $table->timestamp('occurred_at')->useCurrent();

            $table->index(['task_id', 'occurred_at']);
        });

        /* ------------------------------ Reminders ----------------------------- */

        /**
         * One row per notice actually sent.
         *
         * The uniqueness constraint is the whole design: a daily scan can run
         * as often as it likes and a person still receives at most one notice
         * of a given kind, for a given task, on a given day. Without it,
         * "remind until finished" becomes "mail them nine times an hour".
         */
        Schema::create('task_notices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('kind', ['assigned', 'mentioned', 'ahead', 'due', 'overdue', 'escalation']);
            $table->date('sent_on');
            $table->unsignedSmallInteger('streak')->default(1);
            $table->boolean('delivered')->default(false);
            $table->timestamps();

            $table->unique(['task_id', 'user_id', 'kind', 'sent_on'], 'task_notices_unique_per_day');
        });

        /**
         * Automations, in Monday's plain-language shape.
         *
         * Deliberately narrow: a trigger, an optional condition, an action.
         * ClickUp's automation builder can express far more and is used by
         * almost nobody, because expressing it takes longer than doing the
         * work by hand.
         */
        Schema::create('automation_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('name', 150);
            $table->enum('trigger', [
                'task_created', 'task_moved', 'task_assigned', 'task_completed',
                'due_soon', 'due_today', 'overdue', 'due_date_changed',
            ]);
            $table->json('conditions')->nullable();
            $table->enum('action', [
                'notify_assignee', 'notify_watchers', 'notify_project_lead',
                'notify_process_office', 'move_to_section', 'set_priority', 'assign_to',
            ]);
            $table->json('action_config')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('times_fired')->default(0);
            $table->timestamp('last_fired_at')->nullable();
            $table->timestamps();
        });

        /* ---------------------- Process & Performance only -------------------- */

        /**
         * An automatic observation.
         *
         * Raised by the scan, not by a person, so the register is complete
         * whether or not anyone was watching that week. Severity is derived
         * from how far past the line the task is, and `acknowledged_at` is the
         * office's own triage — it never reaches the assignee.
         */
        Schema::create('compliance_flags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('subject_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('kind', [
                'overdue', 'due_date_moved', 'no_due_date', 'stalled',
                'unassigned', 'wip_exceeded', 'blocked_ignored', 'reopened', 'late_completion',
            ]);
            $table->enum('severity', ['Low', 'Medium', 'High', 'Critical'])->default('Medium');
            $table->string('summary', 250);
            $table->json('detail')->nullable();

            $table->date('observed_on');
            $table->timestamp('acknowledged_at')->nullable();
            $table->foreignId('acknowledged_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            // One live flag of a kind per task per day; the scan is idempotent.
            $table->unique(['task_id', 'kind', 'observed_on'], 'compliance_flags_unique_daily');
            $table->index(['severity', 'resolved_at']);
        });

        /**
         * A judgement by the office, on a finished piece of work.
         *
         * Separate from the flag because they answer different questions: the
         * flag says what the data shows, the review says what the office
         * concluded. Only the second one can be wrong about a person.
         */
        Schema::create('compliance_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('subject_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('reviewer_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('verdict', ['Compliant', 'Minor delay', 'Non-compliant', 'Exemplary'])->default('Compliant');
            // Negative is early, positive is late. Null when there was no date
            // to be measured against, which is itself a finding.
            $table->smallInteger('timeliness_days')->nullable();
            $table->unsignedTinyInteger('quality_score')->nullable();
            $table->text('findings')->nullable();
            $table->text('action_required')->nullable();
            $table->date('follow_up_on')->nullable();

            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['subject_id', 'verdict']);
        });

        /**
         * A period scorecard per person.
         *
         * Rebuilt by the scan rather than accumulated, so a corrected task
         * corrects the score. Never exposed on any route a subject can reach.
         */
        Schema::create('compliance_scores', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('period', 16);          // 2026-08
            $table->unsignedSmallInteger('tasks_due')->default(0);
            $table->unsignedSmallInteger('tasks_completed')->default(0);
            $table->unsignedSmallInteger('completed_on_time')->default(0);
            $table->unsignedSmallInteger('completed_late')->default(0);
            $table->unsignedSmallInteger('still_overdue')->default(0);
            $table->unsignedSmallInteger('due_dates_moved')->default(0);
            $table->decimal('on_time_rate', 5, 2)->nullable();
            $table->decimal('average_days_late', 6, 2)->nullable();
            $table->unsignedTinyInteger('grade')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('compliance_scores');
        Schema::dropIfExists('compliance_reviews');
        Schema::dropIfExists('compliance_flags');
        Schema::dropIfExists('automation_rules');
        Schema::dropIfExists('task_notices');
        Schema::dropIfExists('task_activity');
        Schema::dropIfExists('task_attachments');
        Schema::dropIfExists('task_comments');
        Schema::dropIfExists('task_dependencies');
        Schema::dropIfExists('task_watchers');
        Schema::dropIfExists('label_task');
        Schema::dropIfExists('tasks');
        Schema::dropIfExists('labels');
        Schema::dropIfExists('project_sections');
        Schema::dropIfExists('project_members');
        Schema::dropIfExists('projects');
    }
};
