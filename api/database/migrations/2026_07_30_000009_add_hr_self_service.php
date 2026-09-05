<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Self-service time keeping and infraction monitoring.
 *
 * The attendance table recorded a time in and a time out as clock times, which
 * is enough for an import from a biometric device but not for a person punching
 * from a screen: it cannot express a break, it loses the date a night shift
 * crossed, and it has nowhere to record who pressed the button.
 *
 * Infractions gain a link back to the attendance day that caused them, so a
 * tardiness notice can always be traced to the punch behind it rather than
 * being somebody's assertion.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            // Full timestamps rather than clock times: a shift that ends at
            // 02:00 ends on the following day, and `time` cannot say so.
            $table->dateTime('clock_in_at')->nullable()->after('shift_id');
            $table->dateTime('break_out_at')->nullable()->after('clock_in_at');
            $table->dateTime('break_in_at')->nullable()->after('break_out_at');
            $table->dateTime('clock_out_at')->nullable()->after('break_in_at');

            // Unpaid break actually taken, which is what makes hours worked
            // checkable rather than assumed from the shift.
            $table->unsignedSmallInteger('break_minutes')->default(0)->after('undertime_minutes');

            $table->foreignId('recorded_by')->nullable()->after('source')
                ->constrained('users')->nullOnDelete();
        });

        // The punch screen is a source in its own right — an audit needs to
        // tell a self-service punch from a biometric read or a manual edit.
        self::mysqlOnly("ALTER TABLE attendance_records MODIFY COLUMN source
            ENUM('Biometric', 'Manual', 'Import', 'Self Service') NOT NULL DEFAULT 'Biometric'");

        Schema::table('employees', function (Blueprint $table) {
            // Without a shift there is nothing to be late against.
            $table->foreignId('shift_id')->nullable()->after('branch_unit_id')
                ->constrained()->nullOnDelete();
        });

        Schema::table('employee_cases', function (Blueprint $table) {
            // The attendance day that produced this, when one did.
            $table->foreignId('attendance_record_id')->nullable()->after('employee_id')
                ->constrained()->nullOnDelete();
            // Demerit points, so repeat offences escalate on evidence rather
            // than on whoever is handling the case that week.
            $table->unsignedSmallInteger('points')->default(0)->after('severity');
            $table->timestamp('acknowledged_at')->nullable()->after('hearing_on');
            // Raised by the monitor rather than typed by an officer.
            $table->boolean('is_automatic')->default(false)->after('acknowledged_at');
        });

        Schema::table('leave_requests', function (Blueprint $table) {
            $table->decimal('balance_after', 6, 2)->default(0)->after('balance_before');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', fn (Blueprint $t) => $t->dropColumn('balance_after'));

        Schema::table('employee_cases', function (Blueprint $table) {
            $table->dropConstrainedForeignId('attendance_record_id');
            $table->dropColumn(['points', 'acknowledged_at', 'is_automatic']);
        });

        Schema::table('employees', fn (Blueprint $t) => $t->dropConstrainedForeignId('shift_id'));

        self::mysqlOnly("ALTER TABLE attendance_records MODIFY COLUMN source
            ENUM('Biometric', 'Manual', 'Import') NOT NULL DEFAULT 'Biometric'");

        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropConstrainedForeignId('recorded_by');
            $table->dropColumn(['clock_in_at', 'break_out_at', 'break_in_at', 'clock_out_at', 'break_minutes']);
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
