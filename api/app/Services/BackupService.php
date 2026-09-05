<?php

namespace App\Services;

use App\Models\Backup;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * Database backup, restore and reset.
 *
 * Uses `mysqldump` when it is available — it is faster and handles edge cases
 * no hand-rolled dumper gets right. When it is not (a shared host, or a
 * Windows box where MySQL is installed but not on PATH) it falls back to
 * generating the SQL in PHP, so the feature works everywhere rather than
 * only on a well-configured server.
 *
 * Every destructive operation takes its own backup first. Restoring is how
 * people lose data, and a pre-restore snapshot is the difference between a
 * mistake and a catastrophe.
 */
class BackupService
{
    private const DISK = 'local';

    private const DIR = 'backups';

    /**
     * Tables holding day-to-day documents. "Clear transactional data" empties
     * these and leaves the company structure, users and settings intact —
     * the state you want after piloting the system and before going live.
     *
     * Children are listed before their parents. That ordering is not cosmetic:
     * an earlier version of this list named `goods_receipts` but not
     * `goods_receipt_lines`, so a clear deleted the documents and left their
     * lines behind, pointing at receipts that no longer existed. Four line
     * tables were affected and the orphans were invisible until something
     * tried to read them. Every parent below now has its children above it.
     */
    private const TRANSACTIONAL = [
        // HR
        'payslip_lines', 'employee_deductions', 'payslips', 'payroll_runs',
        'payroll_disputes', 'payroll_periods',
        'employee_timecards', 'punch_events', 'attendance_records',
        'leave_requests', 'leave_balances',
        'applicants', 'job_postings', 'job_requisitions', 'performance_reviews',
        // `training_records` references `training_sessions` too, so it is a
        // child of it just like `training_attendees` — both must be cleared
        // before `training_sessions`, whatever order they are listed in
        // relative to each other, since neither may survive it.
        'training_attendees', 'training_records', 'training_sessions',
        'employee_cases',
        'resignation_requests', 'offboarding_tasks', 'offboarding_cases', 'onboarding_tasks',
        'employee_competencies', 'succession_plans', 'employee_benefits',
        'wage_order_adjustments',
        // Sales
        'quotation_lines', 'quotations', 'sales_order_lines', 'sales_orders',
        'deliveries', 'sales_returns', 'leads', 'campaigns', 'sales_targets',
        // Procurement
        'purchase_order_lines', 'purchase_orders',
        'goods_receipt_lines', 'goods_receipts', 'supplier_invoices',
        'purchase_requisition_lines', 'purchase_requisitions',
        'rfq_bids', 'rfqs', 'supplier_contracts',
        // Warehouse
        'stock_movements', 'stock_balances', 'inbound_shipments', 'pick_lists',
        'stock_transfer_lines', 'stock_transfers',
        'cycle_count_lines', 'cycle_counts', 'label_print_jobs',
        // Maintenance
        'work_order_parts', 'work_orders', 'downtime_events',
        'fuel_requests', 'fuel_logs', 'pm_schedules',
        // Finance
        'journal_lines', 'journal_entries', 'ar_invoices', 'ap_bills',
        'ar_receipt_allocations', 'ar_receipts',
        'ap_payment_allocations', 'ap_payments',
        'bank_transactions', 'expenses', 'tax_filings', 'budget_lines',
        // Process & Tasks — every one of these was missing entirely until
        // now, which meant "clear data" left the whole Process & Performance
        // and Tasks modules untouched no matter what was asked for.
        'task_attachments', 'task_comments', 'task_activity', 'task_time_entries',
        'task_watchers', 'task_notices', 'task_dependencies',
        'label_task', 'compliance_flags', 'compliance_reviews', 'compliance_scores',
        'tasks', 'task_recurrences', 'labels',
        'goal_project', 'goals',
        'automation_rules', 'project_members', 'project_sections', 'projects',
        // Support
        'support_ticket_attachments', 'support_ticket_messages', 'support_tickets',
        // Collaboration
        'message_attachments', 'message_deletions', 'message_reactions', 'messages',
        'poll_votes', 'poll_options', 'polls',
        'conversation_participants', 'conversations',
        // Platform
        'approval_requests', 'audit_logs', 'email_log', 'login_attempts', 'auth_codes',
    ];

    /**
     * The 201 files, their attached documents, and the sign-ins issued
     * against them.
     *
     * Emptied only when the caller asks for it, because this is master data
     * rather than a document: you clear it when the masterfile is about to be
     * re-imported from source, not as part of a routine pilot reset.
     * `employee_documents` goes first — it is a child of `employees`, the
     * same reason sign-ins do — followed by sign-ins, then the 201 files
     * themselves.
     */
    private const MASTERFILE = ['employee_documents', 'users', 'employees'];

    public function __construct(private readonly AuditLogger $audit) {}

    /* ---------------------------------------------------------------------- */
    /* Create */
    /* ---------------------------------------------------------------------- */

    public function create(string $kind = 'manual', ?int $userId = null): Backup
    {
        $connection = config('database.default');
        $stamp = now()->format('Ymd-His');
        $filename = "trinitas-{$stamp}.sql";
        $relativePath = self::DIR.'/'.$filename;

        $backup = Backup::create([
            'filename' => $filename,
            'path' => $relativePath,
            'kind' => $kind,
            'created_by' => $userId,
            'status' => 'Running',
        ]);

        try {
            Storage::disk(self::DISK)->makeDirectory(self::DIR);
            $absolute = Storage::disk(self::DISK)->path($relativePath);

            $sql = match ($connection) {
                'mysql', 'mariadb' => $this->dumpMysql($absolute),
                default => $this->dumpWithPhp(),
            };

            if ($sql !== null) {
                Storage::disk(self::DISK)->put($relativePath, $sql);
            }

            $backup->update([
                'status' => 'Completed',
                'size_bytes' => Storage::disk(self::DISK)->size($relativePath),
            ]);

            $this->audit->log('created a database backup', 'Backup', $backup->id, $filename, 'admin');
        } catch (\Throwable $e) {
            $backup->update(['status' => 'Failed', 'error' => $e->getMessage()]);
            throw $e;
        }

        return $backup->fresh();
    }

    /**
     * Runs mysqldump straight to the target file. Returns null because the
     * process writes the file itself.
     */
    private function dumpMysql(string $absolute): ?string
    {
        $binary = $this->findMysqlBinary('mysqldump');
        $config = config('database.connections.'.config('database.default'));

        if (! $binary) {
            // No mysqldump on this machine — the PHP dumper handles it.
            return $this->dumpWithPhp();
        }

        // PDO resolves "localhost" via a named pipe or socket, but mysqldump
        // goes through the OS resolver, which on Windows frequently cannot
        // answer for "localhost" (error 2005 / 11003). Using the loopback
        // address avoids the lookup entirely.
        $host = in_array(strtolower((string) $config['host']), ['localhost', ''], true)
            ? '127.0.0.1'
            : $config['host'];

        // Credentials go in a defaults file rather than on the command line
        // (where any user could read them from the process list) or in the
        // environment (which on Windows can leave the child without the
        // variables Winsock needs, producing socket error 10106).
        $defaults = tempnam(sys_get_temp_dir(), 'trinitas-my');
        file_put_contents($defaults, sprintf(
            "[client]\nuser=%s\npassword=%s\nhost=%s\nport=%d\n",
            $config['username'],
            $config['password'],
            $host,
            (int) $config['port'],
        ));
        @chmod($defaults, 0600);

        try {
            $process = new Process([
                $binary,
                // Must be the first argument or mysqldump ignores it.
                '--defaults-extra-file='.$defaults,
                '--single-transaction',
                '--routines',
                '--events',
                '--no-tablespaces',
                '--add-drop-table',
                '--result-file='.$absolute,
                $config['database'],
            ]);
            $process->setTimeout(600);
            $process->run();
        } finally {
            @unlink($defaults);
        }

        if (! $process->isSuccessful()) {
            // A backup that works beats a backup that is correct in principle,
            // so fall back to the built-in exporter and record why.
            //
            // One failure is expected rather than alarming: under PHP's
            // built-in dev server (`php artisan serve`) on Windows, child
            // processes get a restricted environment and Winsock cannot
            // initialise, giving socket error 10106. The same command succeeds
            // from the CLI and under Apache, nginx or php-fpm — so this path is
            // a development-only detour, not a production one.
            Log::warning('mysqldump failed, falling back to the built-in exporter.', [
                'error' => trim($process->getErrorOutput()),
            ]);

            @unlink($absolute);

            return $this->dumpWithPhp();
        }

        return null;
    }

    /** Portable dumper: schema-agnostic INSERT statements built from the data. */
    private function dumpWithPhp(): string
    {
        $driver = DB::connection()->getDriverName();
        $lines = [
            '-- Trinitas ERP backup',
            '-- Generated '.now()->toDateTimeString(),
            '-- Driver: '.$driver,
            '',
            $driver === 'sqlite' ? 'PRAGMA foreign_keys = OFF;' : 'SET FOREIGN_KEY_CHECKS = 0;',
            '',
        ];

        foreach ($this->tables() as $table) {
            $rows = DB::table($table)->get();
            if ($rows->isEmpty()) {
                continue;
            }

            $lines[] = "-- Table: {$table} ({$rows->count()} rows)";
            $lines[] = "DELETE FROM `{$table}`;";

            // Batched inserts — one statement per row makes restores crawl.
            foreach ($rows->chunk(200) as $chunk) {
                $columns = array_keys((array) $chunk->first());
                $columnList = implode('`, `', $columns);

                $values = $chunk->map(function ($row) use ($columns, $driver) {
                    $cells = array_map(fn ($c) => $this->quote(((array) $row)[$c] ?? null, $driver), $columns);

                    return '('.implode(', ', $cells).')';
                })->implode(",\n  ");

                $lines[] = "INSERT INTO `{$table}` (`{$columnList}`) VALUES\n  {$values};";
            }
            $lines[] = '';
        }

        $lines[] = $driver === 'sqlite' ? 'PRAGMA foreign_keys = ON;' : 'SET FOREIGN_KEY_CHECKS = 1;';

        return implode("\n", $lines)."\n";
    }

    /**
     * Quotes a value as a SQL literal for the given driver.
     *
     * The two engines disagree about backslashes, and getting this wrong
     * silently corrupts data rather than throwing. SQLite treats a backslash
     * as an ordinary character, so escaping it doubles it on every backup and
     * restore cycle — which is how `App\Models\User` turns into
     * `App\\Models\\User` and Sanctum stops being able to resolve a token.
     * MySQL does treat it as an escape character, so there it must be doubled.
     *
     * Literal newlines are valid inside quoted strings in both, so they are
     * left exactly as they are.
     */
    private function quote(mixed $value, string $driver): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        $text = (string) $value;

        if ($driver === 'sqlite') {
            // The only escape SQLite recognises in a string literal is '' .
            return "'".str_replace("'", "''", $text)."'";
        }

        return "'".str_replace(['\\', "'", "\0"], ['\\\\', "''", '\\0'], $text)."'";
    }

    /* ---------------------------------------------------------------------- */
    /* Restore */
    /* ---------------------------------------------------------------------- */

    public function restore(Backup $backup, ?int $userId = null): void
    {
        if (! Storage::disk(self::DISK)->exists($backup->path)) {
            throw new RuntimeException('That backup file is no longer on disk.');
        }

        // Non-negotiable: snapshot the current state before overwriting it.
        $this->create('pre-restore', $userId);

        $sql = Storage::disk(self::DISK)->get($backup->path);
        $driver = DB::connection()->getDriverName();

        DB::disconnect();
        DB::reconnect();

        try {
            if ($driver === 'sqlite') {
                DB::statement('PRAGMA foreign_keys = OFF');
            } else {
                DB::statement('SET FOREIGN_KEY_CHECKS = 0');
            }

            // unprepared() because a dump is many statements, not one query.
            DB::unprepared($sql);
        } finally {
            if ($driver === 'sqlite') {
                DB::statement('PRAGMA foreign_keys = ON');
            } else {
                DB::statement('SET FOREIGN_KEY_CHECKS = 1');
            }
        }

        // Cached settings and Geo-IP rules now describe the pre-restore
        // database. Without this the app keeps serving the old values.
        $this->flushCaches();

        $this->audit->log('restored the database', 'Backup', $backup->id, $backup->filename, 'admin');
    }

    /* ---------------------------------------------------------------------- */
    /* Clear */
    /* ---------------------------------------------------------------------- */

    /**
     * Empties documents, keeps the company structure and settings.
     *
     * With `$includeMasterfile` the 201 files and their sign-ins go too — for
     * the case where the masterfile is about to be re-imported from source and
     * matching row-by-row would leave whoever is no longer on the sheet behind.
     *
     * Super administrators and any account not attached to an employee always
     * survive. Clearing the masterfile must not be able to lock everybody out
     * of the system that is meant to be re-populated afterwards.
     */
    public function clearTransactional(?int $userId = null, bool $includeMasterfile = false): array
    {
        $this->create('pre-restore', $userId);

        $driver = DB::connection()->getDriverName();
        $cleared = [];

        $tables = $includeMasterfile
            ? [...self::TRANSACTIONAL, ...self::MASTERFILE]
            : self::TRANSACTIONAL;

        $driver === 'sqlite'
            ? DB::statement('PRAGMA foreign_keys = OFF')
            : DB::statement('SET FOREIGN_KEY_CHECKS = 0');

        $deletedUserIds = [];

        try {
            foreach ($tables as $table) {
                if (! Schema::hasTable($table)) {
                    continue;
                }

                $query = DB::table($table);

                // The one table that is never emptied wholesale.
                if ($table === 'users') {
                    $query->whereNotNull('employee_id')
                        ->where('is_super_admin', false)
                        ->when($userId, fn ($q) => $q->where('id', '!=', $userId));

                    // Captured before the delete — `detachMasterfileReferences`
                    // needs to know exactly which users are gone, not blank
                    // out a "created by" that still points at somebody who
                    // survived (a super administrator, most often).
                    $deletedUserIds = (clone $query)->pluck('id')->all();
                }

                $count = (clone $query)->count();
                if ($count > 0) {
                    $query->delete();
                    $cleared[$table] = $count;
                }
            }
            if ($includeMasterfile) {
                $this->detachMasterfileReferences($deletedUserIds);
            }
        } finally {
            $driver === 'sqlite'
                ? DB::statement('PRAGMA foreign_keys = ON')
                : DB::statement('SET FOREIGN_KEY_CHECKS = 1');
        }

        $this->flushCaches();

        // The label is a varchar(190). Listing every table overflowed it once
        // the list grew, and the insert threw *after* the rows were already
        // gone — a clear that worked but reported itself as a failure. The
        // summary always fits; the table-by-table detail goes in `changes`,
        // which is where something that size belongs anyway.
        $this->audit->log(
            $includeMasterfile ? 'cleared transactional data and the masterfile' : 'cleared transactional data',
            'Database',
            null,
            sprintf('%d rows across %d tables', array_sum($cleared), count($cleared)),
            'admin',
            $cleared ?: null,
        );

        return $cleared;
    }

    /**
     * Kept reference tables — the org chart, the fleet, wage orders — are
     * deliberately left standing when the masterfile is cleared, but a
     * handful of them carry a "who did this" or "who is assigned" pointer
     * at the employees or users just wiped. Foreign-key checks were off for
     * the whole clear, so nothing forced those to null themselves the way a
     * live `ON DELETE SET NULL` would have — done by hand here instead, so
     * a warehouse's manager or a vehicle's driver reads as genuinely unset
     * rather than a stale id pointing at nobody.
     *
     * The two reference tables split differently: every employee is gone
     * once this runs, so a column pointing at `employees` is always safe to
     * blank out wholesale. Clearing `users` is partial by design — super
     * administrators and any account with no employee behind it survive —
     * so a column pointing at `users` is only blanked for the specific ids
     * that were actually deleted, or a wage order's own "created by" would
     * get wiped out from under the administrator who is still signed in.
     *
     * `role_user` is the one exception among the `users`-referencing set: a
     * role assignment for a user who no longer exists is not "unset who
     * this belongs to", it is nothing at all, and the column is not
     * nullable in the first place — those rows are deleted outright rather
     * than nulled, scoped the same way.
     */
    private function detachMasterfileReferences(array $deletedUserIds): void
    {
        $referencesEmployees = [
            'assets' => ['assigned_to'],
            'customers' => ['sales_rep_id'],
            'vehicles' => ['driver_id'],
            'warehouses' => ['manager_id'],
        ];

        foreach ($referencesEmployees as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                DB::table($table)->whereNotNull($column)->update([$column => null]);
            }
        }

        if ($deletedUserIds === []) {
            return;
        }

        $referencesUsers = [
            'approval_rules' => ['approver_user_id'],
            'backups' => ['created_by'],
            'geo_rules' => ['created_by'],
            'project_templates' => ['created_by'],
            'wage_orders' => ['applied_by', 'created_by'],
        ];

        foreach ($referencesUsers as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                DB::table($table)->whereIn($column, $deletedUserIds)->update([$column => null]);
            }
        }

        if (Schema::hasTable('role_user')) {
            DB::table('role_user')->whereIn('user_id', $deletedUserIds)->delete();
        }
    }

    /** Drops every cache whose contents are read straight out of the database. */
    private function flushCaches(): void
    {
        app(Settings::class)->flush();
        Cache::forget('erp.geo_rules');
    }

    /* ---------------------------------------------------------------------- */
    /* Helpers */
    /* ---------------------------------------------------------------------- */

    /** @return string[] */
    public function tables(): array
    {
        $driver = DB::connection()->getDriverName();

        $names = match ($driver) {
            'sqlite' => collect(DB::select("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
                ->pluck('name'),
            default => collect(DB::select('SHOW TABLES'))->map(fn ($row) => array_values((array) $row)[0]),
        };

        return $names
            // Excluded on purpose:
            //  - migrations: restoring it would fight the migrator
            //  - cache/sessions/jobs: transient infrastructure, not business data
            //  - personal_access_tokens: session state. Including it signs the
            //    administrator out mid-restore, so they cannot see whether it
            //    worked, and revives tokens that were deliberately revoked.
            //  - backups: the catalogue of backup files. Restoring it erases
            //    the record of the pre-restore snapshot taken moments earlier —
            //    destroying the safety net at the exact moment it is needed.
            ->reject(fn ($name) => in_array($name, [
                'migrations', 'cache', 'cache_locks', 'sessions',
                'jobs', 'job_batches', 'failed_jobs', 'personal_access_tokens', 'backups',
            ], true))
            ->values()
            ->all();
    }

    /** Row counts per table, for the "what is in here" panel. */
    public function inventory(): array
    {
        $out = [];
        foreach ($this->tables() as $table) {
            $out[$table] = DB::table($table)->count();
        }
        arsort($out);

        return $out;
    }

    public function path(Backup $backup): string
    {
        return Storage::disk(self::DISK)->path($backup->path);
    }

    public function delete(Backup $backup): void
    {
        Storage::disk(self::DISK)->delete($backup->path);
        $this->audit->log('deleted a backup', 'Backup', $backup->id, $backup->filename, 'admin');
        $backup->delete();
    }

    /**
     * Finds a MySQL client binary. PATH first, then the places the Windows
     * installer and Laragon put it.
     */
    public function findMysqlBinary(string $name): ?string
    {
        $exe = PHP_OS_FAMILY === 'Windows' ? "{$name}.exe" : $name;

        $which = new Process(PHP_OS_FAMILY === 'Windows' ? ['where', $exe] : ['which', $name]);
        $which->run();
        if ($which->isSuccessful()) {
            $found = trim(strtok($which->getOutput(), "\n"));
            if ($found !== '') {
                return $found;
            }
        }

        $candidates = array_merge(
            glob('C:\\Program Files\\MySQL\\MySQL Server *\\bin\\'.$exe) ?: [],
            glob('C:\\laragon\\bin\\mysql\\*\\bin\\'.$exe) ?: [],
            glob('C:\\xampp\\mysql\\bin\\'.$exe) ?: [],
            ['/usr/bin/'.$name, '/usr/local/bin/'.$name, '/opt/homebrew/bin/'.$name],
        );

        foreach ($candidates as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
