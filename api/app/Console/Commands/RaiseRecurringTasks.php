<?php

namespace App\Console\Commands;

use App\Services\RecurrenceRunner;
use Illuminate\Console\Command;

/**
 * Raises the tasks a recurrence rule says should exist today.
 *
 * Idempotent: a rule that has already produced its occurrence today is
 * skipped, so running this twice changes nothing.
 *
 *   php artisan tasks:recur
 */
class RaiseRecurringTasks extends Command
{
    protected $signature = 'tasks:recur';

    protected $description = 'Raise the tasks due from recurrence rules today';

    public function handle(RecurrenceRunner $runner): int
    {
        $result = $runner->run();

        $this->info(sprintf(
            'Raised %d · skipped %d · retired %d expired rule(s).',
            $result['raised'],
            $result['skipped'],
            $result['closed'],
        ));

        return self::SUCCESS;
    }
}
