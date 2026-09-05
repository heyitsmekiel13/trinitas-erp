<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/*
 * `audit_chain_state` is a one-row table holding only the last hash written.
 * AuditLogger locks that row (`SELECT ... FOR UPDATE`) for the duration of
 * each write, serialising concurrent audit writes so two simultaneous
 * requests can never both read the same "previous hash" and fork the chain —
 * reading `audit_logs` itself for the latest row cannot give that guarantee,
 * since two transactions can read the same "latest" row before either
 * commits.
 */

/**
 * Brings `audit_logs` up to what an auditor actually expects of one:
 *
 *   - `outcome` — every event so far was implicitly a success; there was no
 *     column to record a denied or failed one, so the trail could never show
 *     what was refused, only what went through.
 *   - `actor_type` — distinguishes a real signed-in user from a console
 *     command or an unattributed background action, instead of every
 *     non-user event collapsing into the same "System" label.
 *   - `request_id` — correlates every row written during one HTTP request,
 *     so a multi-step operation reads as one event in an investigation
 *     instead of several unconnected rows.
 *   - `prev_hash` / `hash` — a hash chain: each row's hash covers its own
 *     content plus the previous row's hash, so altering or deleting a row
 *     anywhere in the table breaks every hash after it. `AuditIntegrity`
 *     walks the chain to prove (or disprove) that nothing was touched
 *     outside this application.
 *
 * The triggers below are the other half of that promise — application code
 * already refused to expose an update/delete route for this table (see
 * `admin/audit-log` in config/erp.php, which has no `write` key), but that
 * only stops the API from being used to tamper with it. These stop it at
 * the database itself, for anyone with direct DB access. The one sanctioned
 * exception is retention purging (`audit:purge`), which sets
 * `@audit_maintenance_mode = 1` for the duration of its own deletes — no
 * web-facing code path ever sets that session variable.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('audit_logs', 'outcome')) {
            Schema::table('audit_logs', function (Blueprint $table) {
                $table->string('outcome', 16)->default('success')->after('module'); // success · denied · failure
                $table->string('actor_type', 16)->default('user')->after('user_label'); // user · console · system
                $table->uuid('request_id')->nullable()->after('occurred_at');
                $table->char('prev_hash', 64)->nullable()->after('request_id');
                $table->char('hash', 64)->nullable()->after('prev_hash');

                $table->index('outcome');
                $table->index('request_id');
                $table->index('hash');
            });
        }

        if (! Schema::hasTable('audit_chain_state')) {
            Schema::create('audit_chain_state', function (Blueprint $table) {
                $table->id();
                $table->char('last_hash', 64)->nullable();
                $table->timestamps();
            });

            DB::table('audit_chain_state')->insert(['last_hash' => null, 'created_at' => now(), 'updated_at' => now()]);
        }

        // Creating a trigger needs the SUPER privilege (or
        // log_bin_trust_function_creators=1) on a server with binary logging
        // on — a least-privilege application DB user, correctly, usually has
        // neither. Degrade to "not enforced at the DB layer yet" rather than
        // failing the whole migration over it: the hash chain below still
        // makes tampering detectable even without this, and the trigger can
        // be added later by running this same SQL as a privileged user (see
        // the GRANT note in this migration's class docblock).
        try {
            DB::unprepared('
                CREATE TRIGGER audit_logs_prevent_update
                BEFORE UPDATE ON audit_logs
                FOR EACH ROW
                BEGIN
                    IF @audit_maintenance_mode IS NULL OR @audit_maintenance_mode <> 1 THEN
                        SIGNAL SQLSTATE \'45000\'
                        SET MESSAGE_TEXT = \'audit_logs is append-only and cannot be modified\';
                    END IF;
                END
            ');

            DB::unprepared('
                CREATE TRIGGER audit_logs_prevent_delete
                BEFORE DELETE ON audit_logs
                FOR EACH ROW
                BEGIN
                    IF @audit_maintenance_mode IS NULL OR @audit_maintenance_mode <> 1 THEN
                        SIGNAL SQLSTATE \'45000\'
                        SET MESSAGE_TEXT = \'audit_logs is append-only and cannot be modified\';
                    END IF;
                END
            ');
        } catch (\Throwable $e) {
            fwrite(STDERR, "  ! Could not create audit_logs triggers (needs TRIGGER/SUPER privilege): {$e->getMessage()}\n");
            fwrite(STDERR, "    Run as a privileged user once available:\n");
            fwrite(STDERR, "    GRANT TRIGGER ON trinitas_erp.audit_logs TO 'trinitas_app'@'%';\n");
            fwrite(STDERR, "    then re-run the CREATE TRIGGER statements in this migration.\n");
        }
    }

    public function down(): void
    {
        try {
            DB::unprepared('DROP TRIGGER IF EXISTS audit_logs_prevent_update');
            DB::unprepared('DROP TRIGGER IF EXISTS audit_logs_prevent_delete');
        } catch (\Throwable) {
            // Never created (no TRIGGER privilege) — nothing to drop.
        }

        Schema::table('audit_logs', function (Blueprint $table) {
            $table->dropColumn(['outcome', 'actor_type', 'request_id', 'prev_hash', 'hash']);
        });

        Schema::dropIfExists('audit_chain_state');
    }
};
