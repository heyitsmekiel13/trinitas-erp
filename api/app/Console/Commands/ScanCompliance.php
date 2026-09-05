<?php

namespace App\Console\Commands;

use App\Services\ComplianceScanner;
use Illuminate\Console\Command;

/**
 * Rebuilds the Process & Performance register.
 *
 * Idempotent: every observation is unique on (task, kind, day), so running it
 * repeatedly changes nothing.
 *
 *   php artisan compliance:scan
 */
class ScanCompliance extends Command
{
    protected $signature = 'compliance:scan {--period= : Rebuild scorecards for a given YYYY-MM instead of this month}';

    protected $description = 'Raise compliance observations on late, stalled and undated work, and rebuild the scorecards';

    public function handle(ComplianceScanner $scanner): int
    {
        if ($period = $this->option('period')) {
            $count = $scanner->rebuildScores($period);
            $this->info("Rebuilt {$count} scorecard(s) for {$period}.");

            return self::SUCCESS;
        }

        $counts = $scanner->run();

        $this->table(
            ['Observation', 'Raised today'],
            collect($counts)->map(fn ($n, $kind) => [$kind, $n])->values()->all(),
        );

        return self::SUCCESS;
    }
}
