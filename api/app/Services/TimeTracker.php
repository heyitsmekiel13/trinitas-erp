<?php

namespace App\Services;

use App\Models\Task;
use App\Models\TaskTimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Time actually spent on a task.
 *
 * `tasks.logged_hours` used to be a number somebody typed into a box. It was
 * the only figure in the module nothing could verify, which makes it the only
 * one nobody should have trusted — and it was being compared against estimates
 * as though it meant something.
 *
 * It is now a cached sum of entries. Every hour has a person and a period
 * attached, so "who spent thirty hours on this and when" is answerable, and an
 * estimate-versus-actual comparison rests on something.
 *
 * One timer per person, enforced here rather than by a database constraint: a
 * partial unique index is not portable, and the rule needs to explain itself
 * ("you are already timing PRJ-2026-004") rather than fail with a violation.
 */
class TimeTracker
{
    /** A timer left running longer than this was forgotten, not worked. */
    public const RUNAWAY_HOURS = 12;

    /**
     * Starts the clock, stopping whatever else was running.
     *
     * Switching tasks without stopping the last one is the normal way people
     * work, and refusing it would mean the common case is an error message.
     * The previous timer is closed instead, which is what the person meant.
     */
    public function start(Task $task, User $user, ?string $note = null): TaskTimeEntry
    {
        return DB::transaction(function () use ($task, $user, $note) {
            $this->stopRunning($user);

            return TaskTimeEntry::create([
                'task_id' => $task->id,
                'user_id' => $user->id,
                'started_at' => now(),
                'note' => $note,
                'manual' => false,
            ]);
        });
    }

    /** Stops this person's running timer, wherever it is. */
    public function stop(User $user): ?TaskTimeEntry
    {
        $entry = $this->running($user);

        if (! $entry) {
            return null;
        }

        return DB::transaction(function () use ($entry) {
            $minutes = (int) $entry->started_at->diffInMinutes(now());

            /*
             * A timer running for half a day was forgotten at home time, not
             * worked. Capping it is a judgement, so the entry says so — a
             * silent twelve hours would quietly corrupt every average built on
             * top of it, and a silent zero would lose real work.
             */
            $capped = $minutes > self::RUNAWAY_HOURS * 60;

            $entry->update([
                'stopped_at' => now(),
                'minutes' => $capped ? self::RUNAWAY_HOURS * 60 : $minutes,
                'note' => $capped
                    ? trim(($entry->note ? $entry->note.' · ' : '').'Capped at '.self::RUNAWAY_HOURS.'h — timer left running')
                    : $entry->note,
            ]);

            $this->recalculate($entry->task);

            return $entry->fresh();
        });
    }

    /** Time entered by hand, for work done away from the screen. */
    public function log(Task $task, User $user, int $minutes, ?string $note = null, ?string $on = null): TaskTimeEntry
    {
        if ($minutes < 1 || $minutes > self::RUNAWAY_HOURS * 60) {
            throw ValidationException::withMessages([
                'minutes' => 'Enter between one minute and '.self::RUNAWAY_HOURS.' hours.',
            ]);
        }

        return DB::transaction(function () use ($task, $user, $minutes, $note, $on) {
            $started = $on ? Carbon::parse($on)->setTime(9, 0) : now()->subMinutes($minutes);

            $entry = TaskTimeEntry::create([
                'task_id' => $task->id,
                'user_id' => $user->id,
                'started_at' => $started,
                'stopped_at' => $started->copy()->addMinutes($minutes),
                'minutes' => $minutes,
                'note' => $note,
                'manual' => true,
            ]);

            $this->recalculate($task);

            return $entry;
        });
    }

    public function delete(TaskTimeEntry $entry): void
    {
        $task = $entry->task;
        $entry->delete();

        if ($task) {
            $this->recalculate($task);
        }
    }

    /** This person's timer, if one is running. */
    public function running(User $user): ?TaskTimeEntry
    {
        return TaskTimeEntry::where('user_id', $user->id)
            ->whereNull('stopped_at')
            ->with('task:id,reference,title,project_id')
            ->latest('started_at')
            ->first();
    }

    private function stopRunning(User $user): void
    {
        $open = TaskTimeEntry::where('user_id', $user->id)->whereNull('stopped_at')->get();

        foreach ($open as $entry) {
            $minutes = (int) $entry->started_at->diffInMinutes(now());

            $entry->update([
                'stopped_at' => now(),
                'minutes' => min($minutes, self::RUNAWAY_HOURS * 60),
            ]);

            if ($entry->task) {
                $this->recalculate($entry->task);
            }
        }
    }

    /**
     * Rewrites the cached total from the entries.
     *
     * Recomputed rather than incremented so that deleting an entry corrects
     * the task — an accumulating counter cannot be undone, and a wrong total
     * that cannot be fixed is worse than no total.
     */
    public function recalculate(Task $task): void
    {
        $minutes = (int) TaskTimeEntry::where('task_id', $task->id)->sum('minutes');

        $task->forceFill(['logged_hours' => round($minutes / 60, 2)])->saveQuietly();
    }

    /**
     * Entries on a task, newest first.
     *
     * @return array<int, array<string, mixed>>
     */
    public function entriesFor(Task $task): array
    {
        return TaskTimeEntry::where('task_id', $task->id)
            ->with('user:id,name')
            ->orderByDesc('started_at')
            ->limit(100)
            ->get()
            ->map(fn (TaskTimeEntry $e) => [
                'id' => $e->id,
                'user' => $e->user?->name,
                'userId' => $e->user_id,
                'startedAt' => $e->started_at?->toIso8601String(),
                'stoppedAt' => $e->stopped_at?->toIso8601String(),
                'minutes' => $e->elapsedMinutes(),
                'hours' => round($e->elapsedMinutes() / 60, 2),
                'note' => $e->note,
                'manual' => $e->manual,
                'running' => $e->isRunning(),
            ])
            ->all();
    }
}
