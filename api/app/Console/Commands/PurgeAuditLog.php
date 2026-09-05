<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Services\AuditLogger;
use App\Services\Settings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Removes audit trail entries older than the retention window in
 * Settings → Security (`audit_retention_days`).
 *
 * The only sanctioned way anything is ever removed from `audit_logs` — see
 * that table's migration for the DB triggers this sets
 * `@audit_maintenance_mode` to get past, and why no web-facing code path is
 * allowed to set that variable itself. What this command does is logged as
 * its own audit entry before it deletes anything, so the trail records its
 * own trimming rather than the row count simply dropping between two visits
 * to the screen with no explanation.
 *
 *   php artisan audit:purge
 *   php artisan audit:purge --dry-run
 */
class PurgeAuditLog extends Command
{
    protected $signature = 'audit:purge {--dry-run : Report what would be removed without removing it}';

    protected $description = 'Delete audit trail entries older than the configured retention period';

    public function handle(Settings $settings, AuditLogger $audit): int
    {
        $days = (int) $settings->get('security', 'audit_retention_days', 730);
        $cutoff = now()->subDays($days);

        $eligible = AuditLog::where('occurred_at', '<', $cutoff);
        $count = $eligible->count();

        if ($count === 0) {
            $this->info("Nothing older than {$days} days ({$cutoff->toDateString()}).");

            return self::SUCCESS;
        }

        if ($this->option('dry-run')) {
            $this->info("Would remove {$count} entries older than {$cutoff->toDateString()}.");

            return self::SUCCESS;
        }

        DB::transaction(function () use ($eligible, $count, $days, $cutoff) {
            DB::statement('SET @audit_maintenance_mode = 1');
            $eligible->delete();
            DB::statement('SET @audit_maintenance_mode = 0');
        });

        // Written after the delete, using the chain as it now stands — the
        // purge itself becomes the next link, a permanent record that a
        // trim happened, by whom (console, so unattributed to a person by
        // design) and how many rows it removed.
        $audit->log(
            'purged entries older than retention window',
            module: 'admin',
            entityLabel: "{$count} entries · retention {$days}d · before {$cutoff->toDateString()}",
        );

        $this->info("Removed {$count} entries older than {$cutoff->toDateString()}.");

        return self::SUCCESS;
    }
}
