<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A deliberate "not active right now" state, and a date to reach it on.
 *
 * `Suspended` already exists and already means something specific — it is
 * what `EmployeeObserver` sets the instant somebody is RESIGNED or
 * TERMINATED, and what a failed sign-in streak sets via `locked_until`. Both
 * are involuntary, for-cause states. `Inactive` is the third, voluntary case
 * this schema never had a word for: an account an administrator has decided,
 * ahead of time, should stop working on a known date — a contract ending, a
 * leave of absence, a seasonal role — without that being a suspension for
 * cause or a resignation. Raw SQL for the enum because Laravel's fluent
 * `change()` needs doctrine/dbal for a column this project does not carry.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE users MODIFY status ENUM('Active','Suspended','Locked','Invited','Inactive') NOT NULL DEFAULT 'Active'");

        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('deactivate_at')->nullable()->after('status');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('deactivate_at');
        });

        DB::statement("ALTER TABLE users MODIFY status ENUM('Active','Suspended','Locked','Invited') NOT NULL DEFAULT 'Active'");
    }
};
