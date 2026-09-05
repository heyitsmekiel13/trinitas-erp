<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stops the clock while a task is waiting on something else.
 *
 * A task blocked by an open dependency is one the assignee cannot finish, and
 * holding somebody to a date they do not control is the fastest way for a
 * compliance register to be dismissed as unfair. Leave was already subtracted
 * from lateness; being blocked was not.
 *
 * Counted forward by the daily scan rather than reconstructed from history.
 * The activity trail records when a dependency was added, but not reliably
 * when the blocker was finished relative to each day in between, and a number
 * that is only approximately right is worse here than one that starts from
 * today and is exact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->unsignedSmallInteger('blocked_days')->default(0)->after('reassignments');
            // The scan runs daily and must not double-count if it runs twice.
            $table->date('blocked_counted_on')->nullable()->after('blocked_days');
        });
    }

    public function down(): void
    {
        Schema::table('tasks', function (Blueprint $table) {
            $table->dropColumn(['blocked_days', 'blocked_counted_on']);
        });
    }
};
