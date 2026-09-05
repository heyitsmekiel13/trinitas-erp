<?php

namespace App\Services;

use App\Models\Project;
use App\Models\ProjectSection;
use App\Models\Task;
use App\Models\TaskActivity;
use App\Models\TaskAttachment;
use App\Models\TaskComment;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Everything that changes a task, in one place.
 *
 * A task can be written from the board (a drag), the list (an inline edit),
 * the detail panel, an automation and the reminder scan. Putting the rules in
 * the controller would mean five copies of them, so the controller validates
 * and this decides.
 *
 * Three rules are enforced here and nowhere else, because each one is a thing
 * the tools this replaces get wrong:
 *
 *   - Nesting stops at one level. ClickUp allows seven and people lose their
 *     own work inside it.
 *   - A task cannot be marked done while something it is blocked by is open.
 *     Trello has no concept of this at all; Asana records the dependency and
 *     then lets you close the task anyway.
 *   - Moving a due date is recorded, counted, and the first date ever set is
 *     kept. Delivering "on time" against a date pushed four times is the most
 *     common way a deadline is met on paper, and none of the four tools shows
 *     it.
 */
class TaskService
{
    public function __construct(
        private readonly TaskNotifier $notifier,
        private readonly AuditLogger $audit,
    ) {}

    /* ================================ Projects ============================== */

    /** The four columns almost every project starts with. */
    public const DEFAULT_SECTIONS = [
        ['name' => 'To do', 'colour' => 'var(--series-7)', 'is_default' => true],
        ['name' => 'In progress', 'colour' => 'var(--series-1)'],
        ['name' => 'In review', 'colour' => 'var(--series-4)'],
        ['name' => 'Done', 'colour' => 'var(--series-3)', 'is_done' => true],
    ];

    public function createProject(array $data, User $actor): Project
    {
        return DB::transaction(function () use ($data, $actor) {
            /*
             * `??` on the array, not `+` on the defaults.
             *
             * The union operator only fills in keys that are absent. The form
             * sends `owner_id: null` when nobody was picked — a key that is
             * present and null — so `$data + ['owner_id' => $actor->id]` kept
             * the null, and the member sync below then tried to key an array
             * on it, which PHP turns into an empty string and MySQL rejects.
             */
            $project = Project::create(array_merge($data, [
                'code' => $data['code'] ?? $this->nextProjectCode(),
                'created_by' => $actor->id,
                'owner_id' => $data['owner_id'] ?? $actor->id,
            ]));

            foreach (self::DEFAULT_SECTIONS as $index => $section) {
                $project->sections()->create($section + ['position' => $index]);
            }

            // The owner is a member without being invited: a project whose
            // owner cannot open it is a support ticket waiting to happen.
            if ($project->owner_id) {
                $project->members()->syncWithoutDetaching([
                    $project->owner_id => ['role' => 'Owner'],
                ]);
            }

            $this->audit->log('created a project', 'Project', $project->id, $project->name, 'process');

            return $project;
        });
    }

    private function nextProjectCode(): string
    {
        $stem = 'PRJ-'.date('Y').'-';
        $last = Project::withTrashed()->where('code', 'like', $stem.'%')->orderByDesc('code')->value('code');
        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }

    /* ================================= Tasks ================================ */

    public function createTask(Project $project, array $data, User $actor): Task
    {
        return DB::transaction(function () use ($project, $data, $actor) {
            // One level of nesting. A "subtask of a subtask" is re-parented to
            // the top of its family rather than rejected — the person meant to
            // break work down, and refusing the click teaches them nothing.
            $parent = isset($data['parent_id']) ? Task::find($data['parent_id']) : null;
            if ($parent?->parent_id) {
                $parent = $parent->parent;
            }

            $section = $this->resolveSection($project, $data['section_id'] ?? null);

            $due = $data['due_date'] ?? $this->slaDueDate($project);

            $task = Task::create([
                'project_id' => $project->id,
                'section_id' => $section?->id,
                'parent_id' => $parent?->id,
                'reference' => $this->nextTaskReference($project),
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'priority' => $data['priority'] ?? 'Normal',
                'assignee_id' => $data['assignee_id'] ?? null,
                'reporter_id' => $actor->id,
                'start_date' => $data['start_date'] ?? null,
                'due_date' => $due,
                // Written once, here. Nothing else in the system ever sets it,
                // which is what makes it usable as a baseline later.
                'original_due_date' => $due,
                'estimate_hours' => $data['estimate_hours'] ?? null,
                'position' => $this->nextPosition($project->id, $section?->id),
                'created_by' => $actor->id,
            ]);

            if (! empty($data['label_ids'])) {
                $task->labels()->sync($data['label_ids']);
            }

            if (! empty($data['watcher_ids'])) {
                $task->watchers()->sync($data['watcher_ids']);
            }

            $this->log($task, $actor, 'created the task');

            if ($task->assignee_id) {
                $this->notifier->taskAssigned($task->fresh(['assignee', 'project']), $actor);
            }

            // A new subtask changes the family's arithmetic even before anyone
            // ticks it — a parent sitting at 100% with three children should
            // not stay there the moment a fourth, unfinished one is added.
            $this->rollUpProgress($parent);

            return $task;
        });
    }

    /**
     * A due date for a task nobody dated.
     *
     * "No deadline" is how work escapes measurement entirely, so the project's
     * SLA supplies one. It is a working-day count: a five day SLA raised on a
     * Thursday is due the following Thursday, not on the Sunday.
     */
    private function slaDueDate(Project $project): ?string
    {
        $days = (int) $project->default_sla_days;

        if ($days < 1) {
            return null;
        }

        // Weekends *and* public holidays. This used to skip only weekends,
        // which made every deadline raised near Christmas roughly two days
        // shorter than the SLA claimed.
        return app(WorkingCalendar::class)
            ->addWorkingDays(now(), $days)
            ->toDateString();
    }

    private function resolveSection(Project $project, ?int $sectionId): ?ProjectSection
    {
        if ($sectionId) {
            return $project->sections()->whereKey($sectionId)->first();
        }

        return $project->sections()->where('is_default', true)->first()
            ?? $project->sections()->orderBy('position')->first();
    }

    private function nextTaskReference(Project $project): string
    {
        $stem = $project->code.'-';
        $last = Task::withTrashed()->where('reference', 'like', $stem.'%')->orderByDesc('id')->value('reference');
        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
    }

    private function nextPosition(int $projectId, ?int $sectionId): int
    {
        return (int) Task::where('project_id', $projectId)
            ->where('section_id', $sectionId)
            ->max('position') + 1;
    }

    /**
     * Applies a partial edit.
     *
     * Only keys actually present are touched, so the board's one-field drag
     * and the detail panel's full save can share a path without the drag
     * blanking every column the board does not show.
     */
    public function updateTask(Task $task, array $data, User $actor): Task
    {
        return DB::transaction(function () use ($task, $data, $actor) {
            $watched = [
                'title' => 'title', 'description' => 'description', 'priority' => 'priority',
                'assignee_id' => 'assignee', 'section_id' => 'section', 'due_date' => 'due date',
                'start_date' => 'start date', 'estimate_hours' => 'estimate', 'progress' => 'progress',
                'logged_hours' => 'logged hours',
            ];

            foreach ($watched as $column => $label) {
                if (! array_key_exists($column, $data)) {
                    continue;
                }

                $from = $task->{$column};
                $to = $data[$column] === '' ? null : $data[$column];

                if ((string) $from === (string) $to) {
                    continue;
                }

                if ($column === 'due_date') {
                    $this->applyDueDate($task, $to, $actor);

                    continue;
                }

                if ($column === 'assignee_id') {
                    $this->applyAssignee($task, $to ? (int) $to : null, $actor);

                    continue;
                }

                $task->{$column} = $to;
                $this->log($task, $actor, "changed the {$label}", $column, $this->readable($column, $from), $this->readable($column, $to));
            }

            $task->save();

            if (array_key_exists('label_ids', $data)) {
                $task->labels()->sync($data['label_ids'] ?? []);
            }

            if (array_key_exists('watcher_ids', $data)) {
                $task->watchers()->sync($data['watcher_ids'] ?? []);
            }

            // Merged, not replaced — the panel saves one field at a time on
            // blur, and a partial save should not blank out every other
            // custom field the task already had a value for.
            if (array_key_exists('custom_fields', $data)) {
                $task->custom_fields = array_merge($task->custom_fields ?? [], $data['custom_fields'] ?? []);
                $task->save();
            }

            return $task->fresh();
        });
    }

    /**
     * Moving a deadline, recorded rather than merely applied.
     *
     * The first date a task ever has becomes its baseline and is never
     * rewritten. Every later move increments a counter the compliance office
     * reads — which is the difference between "delivered on time" and
     * "delivered on the fourth date we agreed".
     */
    private function applyDueDate(Task $task, ?string $to, User $actor): void
    {
        $from = $task->due_date?->toDateString();

        $task->due_date = $to;

        if ($task->original_due_date === null && $to !== null) {
            $task->original_due_date = $to;
        } elseif ($from !== null) {
            $task->due_date_changes++;
        }

        $this->log($task, $actor, 'moved the due date', 'due_date', $from, $to);
    }

    private function applyAssignee(Task $task, ?int $to, User $actor): void
    {
        $from = $task->assignee_id;

        $task->assignee_id = $to;

        if ($from !== null && $to !== null) {
            // Repeated handovers are a compliance signal of their own: work
            // that has been passed around three times is rarely work that is
            // going to land on the date it was promised for.
            $task->reassignments++;
        }

        $this->log(
            $task,
            $actor,
            'reassigned the task',
            'assignee_id',
            $from ? User::find($from)?->name : null,
            $to ? User::find($to)?->name : null,
        );

        if ($to && $to !== $actor->id) {
            $task->save();
            $this->notifier->taskAssigned($task->fresh(['assignee', 'project']), $actor);
        }
    }

    /**
     * Moves a task between columns, and closes it when the column means done.
     *
     * The board drag and the "Mark complete" button are the same operation —
     * making them two would let a card sit in Done while the task stayed open.
     */
    public function moveTask(Task $task, int $sectionId, ?int $position, User $actor): Task
    {
        return DB::transaction(function () use ($task, $sectionId, $position, $actor) {
            $section = ProjectSection::where('project_id', $task->project_id)->findOrFail($sectionId);
            $from = $task->section;

            if ($section->is_done && ! $task->isDone()) {
                $this->assertUnblocked($task);
                $this->assertSubtasksFinished($task);
            }

            $task->section_id = $section->id;
            $task->position = $position ?? $this->nextPosition($task->project_id, $section->id);

            if ($section->is_done && ! $task->isDone()) {
                $task->completed_at = now();
                $task->completed_by = $actor->id;
                $task->progress = 100;
                $this->log($task, $actor, 'completed the task');
                $this->notifier->taskCompleted($task, $actor);
            } elseif (! $section->is_done && $task->isDone()) {
                // Reopening is a compliance event, not a correction — the scan
                // reads the activity trail for it.
                $task->completed_at = null;
                $task->completed_by = null;
                $this->log($task, $actor, 'reopened the task');
            }

            if ($from?->id !== $section->id) {
                $this->log($task, $actor, 'moved the task', 'section', $from?->name, $section->name);
            }

            $task->save();

            // Ticking a subtask moves its parent's progress bar.
            $this->rollUpProgress($task->parent);

            return $task->fresh();
        });
    }

    /**
     * A parent cannot finish while its children are open.
     *
     * The board would otherwise let somebody tick a task whose three subtasks
     * are still outstanding, and the compliance register would record it as
     * delivered — exactly the kind of quietly wrong number the office exists
     * to catch.
     *
     * Refused rather than cascading. Closing the children automatically would
     * mean one click silently completing work nobody has looked at, and those
     * subtasks are often assigned to other people.
     *
     * @throws ValidationException
     */
    private function assertSubtasksFinished(Task $task): void
    {
        $open = $task->subtasks()->whereNull('completed_at')->get(['reference', 'title']);

        if ($open->isEmpty()) {
            return;
        }

        $names = $open->take(3)->map(fn ($t) => $t->reference)->implode(', ');
        $more = $open->count() > 3 ? ' and '.($open->count() - 3).' more' : '';

        throw ValidationException::withMessages([
            'section_id' => [
                $open->count() === 1
                    ? "The subtask {$names} is still open. Finish it first."
                    : "{$open->count()} subtasks are still open ({$names}{$more}). Finish them first.",
            ],
        ]);
    }

    /**
     * Rolls a parent's progress up from its children.
     *
     * Only where the parent actually has subtasks — a slider somebody dragged
     * deliberately on a childless task should not be overwritten by
     * arithmetic.
     */
    public function rollUpProgress(?Task $parent): void
    {
        if (! $parent) {
            return;
        }

        $total = $parent->subtasks()->count();

        if ($total === 0) {
            return;
        }

        $done = $parent->subtasks()->whereNotNull('completed_at')->count();

        $parent->forceFill(['progress' => (int) round(($done / $total) * 100)])->saveQuietly();
    }

    /** @throws ValidationException */
    private function assertUnblocked(Task $task): void
    {
        $open = $task->dependencies()
            ->where('type', 'blocks')
            ->whereHas('dependsOn', fn (Builder $q) => $q->whereNull('completed_at'))
            ->with('dependsOn:id,reference,title')
            ->get();

        if ($open->isEmpty()) {
            return;
        }

        $names = $open->map(fn ($d) => $d->dependsOn->reference)->implode(', ');

        throw ValidationException::withMessages([
            'section_id' => ["This task is blocked by {$names}. Finish those first, or remove the dependency."],
        ]);
    }

    /* ============================== Discussion ============================== */

    /**
     * A comment, with everyone it names notified.
     *
     * Mentions are resolved against the ids the client sends rather than by
     * parsing names out of the text: two people called Cruz would otherwise
     * make the notification a coin toss.
     */
    public function comment(Task $task, string $body, array $mentions, User $actor): TaskComment
    {
        return DB::transaction(function () use ($task, $body, $mentions, $actor) {
            $comment = $task->comments()->create([
                'user_id' => $actor->id,
                'body' => $body,
                'mentions' => array_values(array_unique(array_map('intval', $mentions))),
            ]);

            $this->log($task, $actor, 'commented');

            $this->notifier->commented($task, $comment, $actor);

            return $comment;
        });
    }

    /* ============================== Attachments ============================= */

    /**
     * Stores an upload against a task.
     *
     * Images keep their pixel dimensions so the gallery can reserve the space
     * before the file arrives — without them a task with six screenshots
     * reflows the panel six times as they load.
     */
    public function attach(Task $task, UploadedFile $file, User $actor, ?int $commentId = null): TaskAttachment
    {
        $path = $file->store("tasks/{$task->id}", 'public');

        $width = null;
        $height = null;

        if (str_starts_with((string) $file->getMimeType(), 'image/')) {
            $size = @getimagesize($file->getRealPath() ?: '');
            if ($size) {
                [$width, $height] = $size;
            }
        }

        $attachment = $task->attachments()->create([
            'comment_id' => $commentId,
            'uploaded_by' => $actor->id,
            'disk' => 'public',
            'path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size_bytes' => $file->getSize(),
            'width' => $width,
            'height' => $height,
        ]);

        $this->log($task, $actor, 'attached a file', 'attachment', null, $file->getClientOriginalName());

        return $attachment;
    }

    public function detach(TaskAttachment $attachment, User $actor): void
    {
        Storage::disk($attachment->disk)->delete($attachment->path);
        $this->log($attachment->task, $actor, 'removed a file', 'attachment', $attachment->original_name, null);
        $attachment->delete();
    }

    /* ================================ Trail ================================= */

    public function log(Task $task, ?User $actor, string $action, ?string $field = null, ?string $from = null, ?string $to = null): void
    {
        TaskActivity::create([
            'task_id' => $task->id,
            'user_id' => $actor?->id,
            'action' => $action,
            'field' => $field,
            'from_value' => $from,
            'to_value' => $to,
            'occurred_at' => now(),
        ]);
    }

    /** Trims a stored value to something a person can read in a trail. */
    private function readable(string $column, mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if ($column === 'description') {
            return Str::limit(strip_tags((string) $value), 120);
        }

        return (string) $value;
    }
}
