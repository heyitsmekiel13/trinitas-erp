<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Makes a failed email something the system can come back to.
 *
 * Two credential emails were lost to a momentary DNS failure — the SMTP
 * settings were correct the whole time, and the same host resolved fine
 * minutes later. The send was attempted once, recorded as Failed, and never
 * looked at again, so a two-second network blip cost somebody their sign-in
 * details with nothing to indicate it beyond a row in a log nobody reads.
 *
 * `attempts` and `last_attempt_at` are what let a retry exist at all: without
 * them a re-send cannot tell a first try from a fifth, and "try again forever"
 * is how a broken address turns into an infinite loop.
 *
 * `Retrying` is a separate status from `Failed` on purpose. Failed should mean
 * "this is not going to arrive, look at it"; anything still in the queue is
 * not that yet, and an administrator seeing five Failed rows that are actually
 * fine stops trusting the screen.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('email_log', function (Blueprint $table) {
            $table->unsignedSmallInteger('attempts')->default(0)->after('status');
            $table->timestamp('last_attempt_at')->nullable()->after('attempts');
            // Set when the failure looks like the network rather than the
            // message — a bad address is never worth retrying, a DNS blip
            // always is.
            $table->boolean('retryable')->default(false)->after('last_attempt_at');
        });

        // MySQL cannot add to an enum in place through the schema builder.
        self::mysqlOnly(
            "ALTER TABLE email_log MODIFY status ENUM('Queued','Retrying','Sent','Failed') NOT NULL DEFAULT 'Queued'"
        );

        Schema::table('email_log', function (Blueprint $table) {
            // The retry sweep's only query: unsent, retryable, oldest first.
            $table->index(['status', 'retryable', 'last_attempt_at'], 'email_log_retry_idx');
        });
    }

    public function down(): void
    {
        Schema::table('email_log', function (Blueprint $table) {
            $table->dropIndex('email_log_retry_idx');
            $table->dropColumn(['attempts', 'last_attempt_at', 'retryable']);
        });

        self::mysqlOnly(
            "ALTER TABLE email_log MODIFY status ENUM('Queued','Sent','Failed') NOT NULL DEFAULT 'Queued'"
        );
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
