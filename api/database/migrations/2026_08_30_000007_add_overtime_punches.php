<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The gap-overtime case, as its own pair of punches.
 *
 * `overtime_hours` already gets computed automatically — the moment
 * `clock_out_at` lands past the shift's scheduled end, `TimeClock::recompute`
 * already counts every minute of it. That is the *straight* case: somebody
 * kept working past their shift with no break in between, and nothing about
 * this migration changes it.
 *
 * What that single pair of punches cannot represent is somebody who finished
 * their regular eight hours, clocked out, left, and came back later for a
 * separate overtime stint — a different session, with a gap the automatic
 * calculation has no way to see. These two columns are that second session,
 * on the same day's row rather than a second row, because `work_date` is
 * still one row per employee per day by design (see the table's own unique
 * constraint) and an overtime stint is still part of that one day.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dateTime('ot_clock_in_at')->nullable()->after('clock_out_at');
            $table->dateTime('ot_clock_out_at')->nullable()->after('ot_clock_in_at');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropColumn(['ot_clock_in_at', 'ot_clock_out_at']);
        });
    }
};
