<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Puts the SLA beyond the reach of the people it measures.
 *
 * `default_sla_days` is the denominator of the entire compliance register: it
 * decides when an undated task is due, and therefore whether anybody is ever
 * late. It was editable by any member of a project — including a Viewer, since
 * the update path only checked visibility and never role.
 *
 * That made the register self-defeating in the easiest possible way. Moving a
 * deadline was counted and flagged; setting a generous one at the outset was
 * free and left no trace, because `due_date_changes` stays at zero when the
 * date was never moved. The harder exploit was closed and the easier one was
 * not.
 *
 * Two changes. The columns below record who last set the number and when, so a
 * change is attributable rather than merely present. Authorisation itself is
 * enforced in ProjectController — the office sets the SLA, everybody else
 * reads it.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Guarded, because this migration alters an index a foreign key
        // depends on and an early version failed halfway — leaving the columns
        // behind but the migration unrecorded. Re-running has to be safe.
        Schema::table('projects', function (Blueprint $table) {
            if (! Schema::hasColumn('projects', 'sla_set_by')) {
                $table->foreignId('sla_set_by')->nullable()->after('default_sla_days')->constrained('users')->nullOnDelete();
            }

            if (! Schema::hasColumn('projects', 'sla_set_at')) {
                $table->timestamp('sla_set_at')->nullable()->after('sla_set_by');
            }
        });

        /*
         * Two new observations.
         *
         * `generous_sla` is the one this migration exists for: a deadline long
         * enough that nothing inside it can realistically be late. Recorded as
         * an observation rather than blocked outright, because a genuinely long
         * project does exist and the office should judge which is which.
         *
         * `coverage_gap` is the other half of the same blind spot — a person or
         * department with no work in the system at all scores perfectly, so the
         * absence has to be visible.
         */
        self::mysqlOnly("ALTER TABLE compliance_flags MODIFY kind ENUM(
            'overdue','due_date_moved','no_due_date','stalled','unassigned',
            'wip_exceeded','blocked_ignored','reopened','late_completion',
            'generous_sla','coverage_gap'
        ) NOT NULL");

        /*
         * A flag does not always belong to a task.
         *
         * `generous_sla` is about a project and `coverage_gap` is about a
         * person; forcing either onto some arbitrary task in order to satisfy
         * the daily uniqueness key would put the finding on a row it is not
         * about. The unique index is rebuilt to allow a null task, keyed on the
         * subject instead so a coverage gap is still recorded once per person
         * per day.
         */
        // MySQL will not drop an index a foreign key depends on, so the
        // constraint comes off first and goes back on afterwards.
        Schema::table('compliance_flags', function (Blueprint $table) {
            $table->dropForeign(['task_id']);
            $table->dropUnique('compliance_flags_unique_daily');
        });

        self::mysqlOnly('ALTER TABLE compliance_flags MODIFY task_id BIGINT UNSIGNED NULL');

        Schema::table('compliance_flags', function (Blueprint $table) {
            $table->unique(['task_id', 'project_id', 'subject_id', 'kind', 'observed_on'], 'compliance_flags_unique_daily');
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('compliance_flags', function (Blueprint $table) {
            $table->dropForeign(['task_id']);
            $table->dropUnique('compliance_flags_unique_daily');
            $table->unique(['task_id', 'kind', 'observed_on'], 'compliance_flags_unique_daily');
            $table->foreign('task_id')->references('id')->on('tasks')->cascadeOnDelete();
        });

        self::mysqlOnly("ALTER TABLE compliance_flags MODIFY kind ENUM(
            'overdue','due_date_moved','no_due_date','stalled','unassigned',
            'wip_exceeded','blocked_ignored','reopened','late_completion'
        ) NOT NULL");

        Schema::table('projects', function (Blueprint $table) {
            $table->dropConstrainedForeignId('sla_set_by');
            $table->dropColumn('sla_set_at');
        });
    }

    /**
     * Runs a statement only on MySQL.
     *
     * The statements below are MySQL's own syntax for widening an enum in
     * place, which the schema builder cannot express. Every other driver skips
     * them: SQLite has no MODIFY COLUMN, and the test suite runs on an
     * in-memory SQLite database — without this guard the whole migration set
     * fails before the first test.
     */
    private static function mysqlOnly(string $sql): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            DB::statement($sql);
        }
    }
};
