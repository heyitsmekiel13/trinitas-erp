<?php

namespace App\Console\Commands;

use App\Services\Mailer;
use Illuminate\Console\Command;

/**
 * Re-sends email that failed for a reason worth trying again.
 *
 * Exists because two credential emails were lost to a two-second DNS failure:
 * the settings were correct, the host resolved fine minutes later, and nothing
 * ever went back for them. A send is not a one-shot operation any more.
 *
 *   php artisan mail:retry
 */
class RetryFailedEmails extends Command
{
    protected $signature = 'mail:retry {--limit=50 : How many to attempt in one pass}';

    protected $description = 'Re-send emails that failed for a transient reason, such as a network or DNS blip';

    public function handle(Mailer $mailer): int
    {
        $result = $mailer->retryFailed((int) $this->option('limit'));

        if ($result['retried'] === 0) {
            $this->info('Nothing waiting to be resent.');

            return self::SUCCESS;
        }

        $this->info(sprintf(
            'Attempted %d · sent %d · gave up on %d.',
            $result['retried'],
            $result['sent'],
            $result['gaveUp'],
        ));

        return self::SUCCESS;
    }
}
