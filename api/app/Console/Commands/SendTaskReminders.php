<?php

namespace App\Console\Commands;

use App\Models\Task;
use App\Services\TaskNotifier;
use Illuminate\Console\Command;

/**
 * The chase, run once a day.
 *
 * Safe to run more than once — TaskNotifier dedupes on (task, person, kind,
 * day) in the database, so a cron that fires twice sends one email. That
 * property is what makes it safe to also expose a manual "run now" button.
 *
 *   php artisan tasks:remind --dry-run
 */
class SendTaskReminders extends Command
{
    protected $signature = 'tasks:remind {--dry-run : Show what would be sent without sending it}';

    protected $description = 'Email deadline reminders for every open task, escalating the ones nobody has acted on';

    public function handle(TaskNotifier $notifier): int
    {
        $dryRun = (bool) $this->option('dry-run');

        // Only tasks with a deadline can be chased about one. The compliance
        // scan is what notices the ones that never got a date.
        $tasks = Task::query()
            ->open()
            ->whereNotNull('due_date')
            ->with(['assignee', 'reporter', 'watchers', 'project.owner'])
            ->get();

        $rows = [];
        $sent = 0;

        foreach ($tasks as $task) {
            $late = $task->daysLate();

            if ($dryRun) {
                $kind = match (true) {
                    $late > 0 => 'overdue',
                    $late === 0 => 'due',
                    in_array(abs($late), TaskNotifier::AHEAD_DAYS, true) => 'ahead',
                    default => null,
                };

                if ($kind) {
                    $rows[] = [$task->reference, $task->assignee?->name ?? '—', $task->due_date->toDateString(), $kind];
                }

                continue;
            }

            $sent += count($notifier->remind($task));
        }

        if ($dryRun) {
            $this->table(['Task', 'Assignee', 'Due', 'Would send'], $rows);
            $this->info(count($rows).' notice(s) would be sent across '.$tasks->count().' open task(s).');

            return self::SUCCESS;
        }

        $this->info("{$sent} notice(s) sent across {$tasks->count()} open task(s).");

        return self::SUCCESS;
    }
}
