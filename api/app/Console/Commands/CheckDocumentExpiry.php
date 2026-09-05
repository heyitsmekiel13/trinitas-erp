<?php

namespace App\Console\Commands;

use App\Services\EmployeeDocumentChecklist;
use App\Services\NotificationDispatcher;
use Illuminate\Console\Command;

/**
 * Chases a 201 document before it lapses, not after.
 *
 * An NBI clearance or medical certificate expiring quietly is worse than one
 * missing outright — a missing one is visible on the checklist from day one,
 * an expired one looks fine until someone actually needs it. One digest email
 * a day to HR, routed through NotificationDispatcher so Admin's on/off switch
 * for "document.expiring" actually controls it.
 *
 *   php artisan hr:document-expiry-check
 */
class CheckDocumentExpiry extends Command
{
    protected $signature = 'hr:document-expiry-check {--days=30 : Window to check within}';

    protected $description = 'Emails HR a digest of 201 documents expiring within the given window';

    public function handle(EmployeeDocumentChecklist $checklist, NotificationDispatcher $dispatcher): int
    {
        $days = (int) $this->option('days');
        $documents = $checklist->expiringWithin($days);

        if ($documents->isEmpty()) {
            $this->info('Nothing expiring in the next '.$days.' days.');

            return self::SUCCESS;
        }

        $rows = $documents->map(fn ($doc) => [
            'employee' => $doc->employee->full_name,
            'document' => $doc->documentType->name,
            'expiry' => $doc->expiry_date->format('j M Y'),
        ])->all();

        $sent = $dispatcher->dispatch(
            event: 'document.expiring',
            subject: count($rows).' employee document(s) expiring within '.$days.' days',
            view: 'emails.document-expiring',
            data: ['rows' => $rows],
        );

        $this->info(sprintf('%d document(s) expiring · %d recipient(s) notified.', count($rows), $sent));

        return self::SUCCESS;
    }
}
