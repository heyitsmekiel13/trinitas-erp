<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskComment;
use App\Models\TaskNotice;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Who gets told, and how often.
 *
 * The requirement is "remind until the task is finished", which is easy to
 * write and easy to implement as a mail bomb. Two things stop that here.
 *
 * First, `task_notices` records every notice actually sent, unique on
 * (task, person, kind, day). The scan can run hourly, or twice after a failed
 * cron, and a person still receives at most one notice of a kind per task per
 * day. The dedupe lives in the database rather than in this class because the
 * scan and a manual "nudge" from the UI are two callers and only the database
 * is shared between them.
 *
 * Second, chasing slows down as it ages. Daily forever is how a reminder
 * becomes a filter rule — after the first week the notice goes every third
 * day, and the escalation goes to the project lead and the compliance office
 * instead, because eight identical emails to somebody who has already decided
 * not to act is not a chase, it is noise with a paper trail.
 */
class TaskNotifier
{
    /** Days before the due date that a heads-up is sent. */
    public const AHEAD_DAYS = [3, 1];

    /** Days overdue at which the lead and the compliance office are told. */
    public const ESCALATE_AFTER_DAYS = 3;

    public function __construct(
        private readonly Mailer $mailer,
        private readonly Settings $settings,
        private readonly ProcessOffice $office,
        private readonly WorkingCalendar $calendar,
    ) {}

    /* ============================== Event mail ============================== */

    public function taskAssigned(Task $task, ?User $actor = null): void
    {
        if (! $task->assignee || $task->assignee_id === $actor?->id) {
            return;
        }

        $this->deliver($task, $task->assignee, 'assigned', [
            'headline' => 'A task has been assigned to you',
            'lead' => trim(($actor?->name ?? 'Somebody').' assigned you '.$task->reference.'.'),
        ]);
    }

    public function taskCompleted(Task $task, User $actor): void
    {
        // The reporter and the watchers, never the person who just clicked it.
        $recipients = $this->watchersOf($task)
            ->reject(fn (User $u) => $u->id === $actor->id);

        foreach ($recipients as $user) {
            $this->deliver($task, $user, 'assigned', [
                'headline' => 'A task you follow is finished',
                'lead' => $actor->name.' completed '.$task->reference.'.',
            ]);
        }
    }

    public function commented(Task $task, TaskComment $comment, User $actor): void
    {
        $mentioned = User::whereIn('id', $comment->mentions ?? [])->get();

        foreach ($mentioned->reject(fn (User $u) => $u->id === $actor->id) as $user) {
            $this->deliver($task, $user, 'mentioned', [
                'headline' => $actor->name.' mentioned you',
                'lead' => Str::limit(strip_tags($comment->body), 220),
            ]);
        }
    }

    /* ============================== The chase =============================== */

    /**
     * Sends whatever today's notices are for one task.
     *
     * Returns the notices written, so the command can report a real number
     * rather than "done".
     *
     * @return array<int, TaskNotice>
     */
    public function remind(Task $task): array
    {
        if ($task->isDone() || ! $task->due_date) {
            return [];
        }

        $daysLate = $task->daysLate();          // negative = still has time
        $sent = [];

        // Coming up.
        if ($daysLate < 0 && in_array(abs($daysLate), self::AHEAD_DAYS, true)) {
            $sent = $this->chase($task, 'ahead', [
                'headline' => 'Due in '.abs($daysLate).' '.Str::plural('day', abs($daysLate)),
                'lead' => $task->title.' is due on '.$task->due_date->format('j M Y').'.',
            ]);
        }

        // Today.
        if ($daysLate === 0) {
            $sent = $this->chase($task, 'due', [
                'headline' => 'Due today',
                'lead' => $task->title.' is due today.',
            ]);
        }

        // Past it. Daily for the first week, then every third day — a chase
        // that never lets up stops being read.
        if ($daysLate > 0 && ($daysLate <= 7 || $daysLate % 3 === 0)) {
            $sent = $this->chase($task, 'overdue', [
                'headline' => $daysLate.' '.Str::plural('day', $daysLate).' overdue',
                'lead' => $task->title.' was due on '.$task->due_date->format('j M Y').' and is still open.',
            ]);
        }

        // Nobody has acted. Tell the people who can do something about it.
        if ($daysLate >= self::ESCALATE_AFTER_DAYS && $daysLate % self::ESCALATE_AFTER_DAYS === 0) {
            $sent = array_merge($sent, $this->escalate($task, $daysLate));
        }

        return $sent;
    }

    /** The assignee, and the watchers who asked to hear about it. */
    private function chase(Task $task, string $kind, array $body): array
    {
        $sent = [];

        foreach ($this->watchersOf($task) as $user) {
            if ($notice = $this->deliver($task, $user, $kind, $body)) {
                $sent[] = $notice;
            }
        }

        return $sent;
    }

    /**
     * Routes past the assignee.
     *
     * Deliberately a different `kind`, so the daily dedupe on the assignee's
     * overdue notice does not suppress the lead's escalation, and so the
     * compliance register can tell "they were chased" from "their manager was
     * told".
     */
    private function escalate(Task $task, int $daysLate): array
    {
        $recipients = collect([$task->project?->owner])
            ->merge($this->office->members())
            ->filter()
            ->reject(fn (User $u) => $u->id === $task->assignee_id)
            ->unique('id');

        $body = [
            'headline' => 'Escalation — '.$daysLate.' days overdue',
            'lead' => sprintf(
                '%s (%s) was due on %s and is still open. Assigned to %s.',
                $task->title,
                $task->reference,
                $task->due_date->format('j M Y'),
                $task->assignee?->name ?? 'nobody',
            ),
        ];

        $sent = [];
        foreach ($recipients as $user) {
            if ($notice = $this->deliver($task, $user, 'escalation', $body)) {
                $sent[] = $notice;
            }
        }

        return $sent;
    }

    /* ============================== Delivery ================================ */

    /**
     * One notice, at most once per person per kind per day.
     *
     * `firstOrCreate` against the unique index is the guard: two scans racing
     * each other produce one row and one email, not two of each.
     */
    private function deliver(Task $task, ?User $user, string $kind, array $body): ?TaskNotice
    {
        if (! $user || ! filter_var((string) $user->email, FILTER_VALIDATE_EMAIL)) {
            return null;
        }

        /*
         * Somebody on approved leave is not chased.
         *
         * They were being emailed daily about a deadline they were not at work
         * to meet, and escalated to their manager on the third day of it. HR
         * has held that fact all along; nothing here was reading it.
         *
         * Escalations still go out, because those are addressed to the project
         * owner and the office — who are precisely the people who need to know
         * that the person holding this is away.
         */
        if ($kind !== 'escalation' && $this->calendar->isOnLeave($user)) {
            return null;
        }

        $notice = TaskNotice::firstOrNew([
            'task_id' => $task->id,
            'user_id' => $user->id,
            'kind' => $kind,
            'sent_on' => now()->toDateString(),
        ]);

        if ($notice->exists) {
            return null;
        }

        // How many notices of this kind this task has already produced —
        // shown in the email so the reader can see it is the fourth chase.
        $notice->streak = TaskNotice::where('task_id', $task->id)->where('kind', $kind)->count() + 1;
        $notice->save();

        $company = $this->settings->group('company');

        $delivered = $this->mailer->send(
            $user->email,
            $body['headline'].' — '.$task->reference.' '.Str::limit($task->title, 60),
            'emails.task-reminder',
            [
                'user' => $user,
                'task' => $task,
                'project' => $task->project,
                'kind' => $kind,
                'headline' => $body['headline'],
                'lead' => $body['lead'],
                'streak' => $notice->streak,
                'companyName' => $company['trade_name'] ?? config('app.name'),
                // APP_URL, not a company setting — there was no `app_url` key
                // in that group, so this silently produced "/tasks?task=12"
                // and the template dropped the button for having no scheme.
                'taskUrl' => rtrim((string) config('app.url'), '/').'/tasks?task='.$task->id,
            ],
            'task.'.$kind,
            'Task',
            $task->id,
        );

        $notice->update(['delivered' => $delivered]);

        return $notice;
    }

    /**
     * Everyone who should hear about this task.
     *
     * The assignee, the person who raised it, and anyone who added themselves
     * — deduplicated, because being both reporter and watcher should not mean
     * two emails.
     *
     * @return Collection<int, User>
     */
    private function watchersOf(Task $task): Collection
    {
        return collect([$task->assignee, $task->reporter])
            ->merge($task->watchers)
            ->filter()
            ->unique('id')
            ->values();
    }
}
