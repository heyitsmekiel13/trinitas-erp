<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `last_accrued_period` is what makes `hr:accrue-leave` safe to run every
 * day rather than once a month on a date that has to be remembered — the
 * command checks this before crediting anything, so a day it has already
 * run for a given balance this month is a no-op, and a day the scheduler
 * was down does not lose that month's credit, it just catches up on the
 * next run. Same idempotent-daily-job shape as every other command in
 * routes/console.php.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_balances', function (Blueprint $table) {
            // 'YYYY-MM' of the last month this balance was accrued for.
            $table->string('last_accrued_period', 7)->nullable()->after('balance');
        });
    }

    public function down(): void
    {
        Schema::table('leave_balances', function (Blueprint $table) {
            $table->dropColumn('last_accrued_period');
        });
    }
};
