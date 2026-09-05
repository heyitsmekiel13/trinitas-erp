<?php

namespace App\Console\Commands;

use App\Services\NotificationDispatcher;
use App\Services\OnboardingTasks;
use Illuminate\Console\Command;

/**
 * Chases an onboarding checklist item that has gone past its due date.
 *
 * Without this, an overdue "sign the contract" or "confirm SSS registration"
 * sits quietly on a new hire's record until somebody happens to open it — by
 * which point they are a month in and still not properly onboarded. One
 * digest a day to HR, same shape as `hr:document-expiry-check`.
 *
 *   php artisan hr:onboarding-overdue-check
 */
class CheckOnboardingOverdue extends Command
{
    protected $signature = 'hr:onboarding-overdue-check';

    protected $description = 'Emails HR a digest of new-hire checklist items past their due date';

    public function handle(OnboardingTasks $tasks, NotificationDispatcher $dispatcher): int
    {
        $overdue = $tasks->overdueTasks();

        if ($overdue->isEmpty()) {
            $this->info('Nothing overdue.');

            return self::SUCCESS;
        }

        $rows = $overdue->map(fn ($task) => [
            'employee' => $task->employee->full_name,
            'task' => $task->title,
            'due' => $task->due_date->format('j M Y'),
        ])->all();

        $sent = $dispatcher->dispatch(
            event: 'onboarding.overdue',
            subject: count($rows).' onboarding task(s) overdue',
            view: 'emails.onboarding-overdue',
            data: ['rows' => $rows],
        );

        $this->info(sprintf('%d task(s) overdue · %d recipient(s) notified.', count($rows), $sent));

        return self::SUCCESS;
    }
}
