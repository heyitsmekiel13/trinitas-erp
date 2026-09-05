<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskAttachment;
use App\Services\ProcessOffice;
use App\Services\TaskNotifier;
use App\Services\TaskService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Tasks — read as a board, a list, a timeline or one person's queue.
 *
 * All four are projections of the same query. `board()` groups by section,
 * `mine()` filters by assignee and groups by urgency, and the timeline reads
 * the same rows with their dates. Deliberately not four endpoints returning
 * four shapes: that is how a card ends up in different states depending on
 * which screen you opened.
 */
class TaskController extends Controller
{
    public function __construct(
        private readonly TaskService $service,
        private readonly TaskNotifier $notifier,
        private readonly ProcessOffice $office,
    ) {}

    /* -------------------------------- Reading ------------------------------ */

    /** The board: every column, with its cards in order. */
    public function board(Request $request, Project $project): JsonResponse
    {
        $project->load('sections');

        $tasks = Task::where('project_id', $project->id)
            ->whereNull('parent_id')
            ->with($this->cardRelations())
            ->withCount([
                'subtasks',
                'subtasks as subtasks_done' => fn ($q) => $q->whereNotNull('completed_at'),
                'comments',
                'attachments',
            ])
            ->orderBy('position')
            ->get();

        $grouped = $tasks->groupBy('section_id');

        return response()->json(['data' => [
            'sections' => $project->sections->map(fn ($section) => [
                'id' => $section->id,
                'name' => $section->name,
                'colour' => $section->colour,
                'wipLimit' => $section->wip_limit,
                'isDone' => $section->is_done,
                'tasks' => $grouped->get($section->id, collect())->map(fn (Task $t) => $this->card($t))->values()->all(),
            ])->all(),
            // Cards whose column was deleted out from under them. Surfaced
            // rather than hidden — invisible work is the worst kind.
            'unsectioned' => $grouped->get(null, collect())->map(fn (Task $t) => $this->card($t))->values()->all(),
        ]]);
    }

    /**
     * Every task across every project the requester can see, filterable.
     *
     * `mine()` answers "what do I need to do"; this answers "what is
     * happening across the department" — the screen a project owner or the
     * office opens when one project's board is too narrow a window. Flat
     * rather than bucketed, since a filtered, sortable list is what that
     * question wants, not another set of urgency columns.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $projectIds = Project::visibleTo($user, $this->office->includes($user))->pluck('id');

        $tasks = Task::query()
            ->whereIn('project_id', $projectIds)
            ->whereNull('parent_id')
            ->when($request->filled('project_id'), fn ($q) => $q->where('project_id', $request->integer('project_id')))
            ->when($request->filled('assignee_id'), fn ($q) => $q->where('assignee_id', $request->integer('assignee_id')))
            ->when($request->filled('priority'), fn ($q) => $q->where('priority', $request->string('priority')))
            ->when($request->filled('label_id'), fn ($q) => $q->whereHas('labels', fn ($l) => $l->whereKey($request->integer('label_id'))))
            ->when($request->string('status')->toString() === 'open', fn ($q) => $q->whereNull('completed_at'))
            ->when($request->string('status')->toString() === 'done', fn ($q) => $q->whereNotNull('completed_at'))
            ->when($request->filled('due_from'), fn ($q) => $q->whereDate('due_date', '>=', $request->date('due_from')))
            ->when($request->filled('due_to'), fn ($q) => $q->whereDate('due_date', '<=', $request->date('due_to')))
            ->with($this->cardRelations())
            ->withCount(['subtasks', 'subtasks as subtasks_done' => fn ($q) => $q->whereNotNull('completed_at'), 'comments', 'attachments'])
            ->orderByRaw('due_date IS NULL, due_date asc')
            ->limit(500)
            ->get();

        return response()->json(['data' => $tasks->map(fn (Task $t) => $this->card($t))->values()->all()]);
    }

    /**
     * One person's queue, bucketed by how urgent it is.
     *
     * This is the screen most of the workforce will ever open, so it answers
     * the only question they have — what do I need to do, and what is late —
     * without asking them to pick a project first.
     */
    public function mine(Request $request): JsonResponse
    {
        $user = $request->user();
        $today = now()->toDateString();

        $tasks = Task::query()
            ->where(function ($q) use ($user) {
                $q->where('assignee_id', $user->id)
                    ->orWhereHas('watchers', fn ($w) => $w->whereKey($user->id));
            })
            ->where(function ($q) {
                // Everything open, plus anything finished this week, so a
                // completed task does not vanish the instant it is ticked.
                $q->whereNull('completed_at')->orWhere('completed_at', '>=', now()->subDays(7));
            })
            ->with($this->cardRelations())
            ->withCount(['subtasks', 'subtasks as subtasks_done' => fn ($q) => $q->whereNotNull('completed_at'), 'comments', 'attachments'])
            ->orderByRaw('due_date IS NULL, due_date asc')
            ->get();

        $bucket = function (Task $task) use ($today) {
            if ($task->isDone()) {
                return 'done';
            }
            if (! $task->due_date) {
                return 'undated';
            }

            return match (true) {
                $task->due_date->toDateString() < $today => 'overdue',
                $task->due_date->toDateString() === $today => 'today',
                $task->due_date->lte(now()->addDays(7)) => 'week',
                default => 'later',
            };
        };

        $grouped = $tasks->groupBy($bucket);

        return response()->json(['data' => [
            'buckets' => collect(['overdue', 'today', 'week', 'later', 'undated', 'done'])
                ->mapWithKeys(fn ($key) => [
                    $key => $grouped->get($key, collect())->map(fn (Task $t) => $this->card($t))->values()->all(),
                ])->all(),
            'counts' => [
                'overdue' => $grouped->get('overdue', collect())->count(),
                'today' => $grouped->get('today', collect())->count(),
                'week' => $grouped->get('week', collect())->count(),
                'open' => $tasks->filter(fn (Task $t) => ! $t->isDone())->count(),
            ],
        ]]);
    }

    /** Everything about one task — the detail panel's single request. */
    public function show(Request $request, Task $task): JsonResponse
    {
        $task->load([
            'project:id,code,name,colour,custom_field_defs', 'section', 'assignee:id,name', 'reporter:id,name',
            'labels', 'watchers:id,name', 'subtasks.assignee:id,name',
            'comments.user:id,name', 'comments.attachments',
            'attachments.uploader:id,name',
            'activity.user:id,name',
            'dependencies.dependsOn:id,reference,title,completed_at',
            'dependents.task:id,reference,title,completed_at',
        ]);

        return response()->json(['data' => [
            'id' => $task->id,
            'reference' => $task->reference,
            'title' => $task->title,
            'description' => $task->description,
            'priority' => $task->priority,
            'projectId' => $task->project_id,
            'project' => $task->project?->name,
            'projectColour' => $task->project?->colour,
            'sectionId' => $task->section_id,
            'section' => $task->section?->name,
            'isDone' => $task->isDone(),
            'parentId' => $task->parent_id,
            'assigneeId' => $task->assignee_id,
            'assignee' => $task->assignee?->name,
            'reporter' => $task->reporter?->name,
            'startDate' => $task->start_date?->toDateString(),
            'dueDate' => $task->due_date?->toDateString(),
            'completedAt' => $task->completed_at?->toIso8601String(),
            'daysLate' => $task->daysLate(),
            'estimateHours' => $task->estimate_hours !== null ? (float) $task->estimate_hours : null,
            'loggedHours' => (float) $task->logged_hours,
            'progress' => $task->progress,
            'customFields' => $task->custom_fields ?? [],
            'projectFieldDefs' => $task->project?->custom_field_defs ?? [],
            'labels' => $task->labels->map(fn ($l) => ['id' => $l->id, 'name' => $l->name, 'colour' => $l->colour])->all(),
            'watchers' => $task->watchers->map(fn ($w) => ['id' => $w->id, 'name' => $w->name])->all(),
            'subtasks' => $task->subtasks->map(fn (Task $s) => [
                'id' => $s->id, 'reference' => $s->reference, 'title' => $s->title,
                'isDone' => $s->isDone(), 'assignee' => $s->assignee?->name,
                'assigneeId' => $s->assignee_id, 'dueDate' => $s->due_date?->toDateString(),
            ])->all(),
            'comments' => $task->comments->map(fn ($c) => [
                'id' => $c->id,
                'body' => $c->body,
                'author' => $c->user?->name,
                'authorId' => $c->user_id,
                'mentions' => $c->mentions ?? [],
                'createdAt' => $c->created_at?->toIso8601String(),
                'editedAt' => $c->edited_at?->toIso8601String(),
                'attachments' => $c->attachments->map(fn ($a) => $this->file($a))->all(),
            ])->all(),
            'attachments' => $task->attachments->whereNull('comment_id')->map(fn ($a) => $this->file($a))->values()->all(),
            'dependencies' => $task->dependencies->map(fn ($d) => [
                'id' => $d->id, 'type' => $d->type,
                'taskId' => $d->depends_on_id,
                'reference' => $d->dependsOn?->reference,
                'title' => $d->dependsOn?->title,
                'isDone' => $d->dependsOn?->completed_at !== null,
            ])->all(),
            'blocking' => $task->dependents->map(fn ($d) => [
                'taskId' => $d->task_id,
                'reference' => $d->task?->reference,
                'title' => $d->task?->title,
                'isDone' => $d->task?->completed_at !== null,
            ])->all(),
            'activity' => $task->activity->take(60)->map(fn ($a) => [
                'id' => $a->id,
                'action' => $a->action,
                'field' => $a->field,
                'from' => $a->from_value,
                'to' => $a->to_value,
                'user' => $a->user?->name,
                'at' => $a->occurred_at?->toIso8601String(),
            ])->values()->all(),
            // Deadline history, shown to everyone: the assignee seeing that a
            // date has moved three times is useful. What they cannot see is
            // the office's conclusion about it.
            'deadline' => [
                'originalDue' => $task->original_due_date?->toDateString(),
                'moves' => $task->due_date_changes,
                'reassignments' => $task->reassignments,
            ],
        ]]);
    }

    /* -------------------------------- Writing ------------------------------ */

    public function store(Request $request, Project $project): JsonResponse
    {
        $data = $request->validate([
            'title' => 'required|string|max:250',
            'description' => 'nullable|string',
            'section_id' => 'nullable|integer|exists:project_sections,id',
            'parent_id' => 'nullable|integer|exists:tasks,id',
            'priority' => 'nullable|in:Low,Normal,High,Urgent',
            'assignee_id' => 'nullable|integer|exists:users,id',
            'start_date' => 'nullable|date',
            'due_date' => 'nullable|date',
            'estimate_hours' => 'nullable|numeric|min:0|max:9999',
            'label_ids' => 'nullable|array',
            'label_ids.*' => 'integer|exists:labels,id',
            'watcher_ids' => 'nullable|array',
            'watcher_ids.*' => 'integer|exists:users,id',
        ]);

        $task = $this->service->createTask($project, $data, $request->user());

        return response()->json(['data' => ['id' => $task->id, 'reference' => $task->reference]], 201);
    }

    public function update(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'title' => 'sometimes|string|max:250',
            'description' => 'nullable|string',
            'priority' => 'sometimes|in:Low,Normal,High,Urgent',
            'assignee_id' => 'nullable|integer|exists:users,id',
            'start_date' => 'nullable|date',
            'due_date' => 'nullable|date',
            'estimate_hours' => 'nullable|numeric|min:0|max:9999',
            'logged_hours' => 'sometimes|numeric|min:0|max:9999',
            'progress' => 'sometimes|integer|min:0|max:100',
            'label_ids' => 'sometimes|array',
            'label_ids.*' => 'integer|exists:labels,id',
            'watcher_ids' => 'sometimes|array',
            'watcher_ids.*' => 'integer|exists:users,id',
            'custom_fields' => 'sometimes|array',
        ]);

        $this->service->updateTask($task, $data, $request->user());

        return response()->json(['data' => ['id' => $task->id]]);
    }

    /** The board drag, and the "mark complete" button — one operation. */
    public function move(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'section_id' => 'required|integer|exists:project_sections,id',
            'position' => 'nullable|integer|min:0',
        ]);

        $this->service->moveTask($task, $data['section_id'], $data['position'] ?? null, $request->user());

        return response()->json(['data' => ['id' => $task->id]]);
    }

    /**
     * Completing from anywhere that is not the board.
     *
     * Routed through the same move, so the card physically lands in the done
     * column rather than sitting in "In progress" with a tick on it.
     */
    public function complete(Request $request, Task $task): JsonResponse
    {
        $done = $task->project->sections()->where('is_done', true)->first();

        abort_if(! $done, 422, 'This project has no column marked as finished.');

        $this->service->moveTask($task, $done->id, null, $request->user());

        return response()->json(['data' => ['id' => $task->id, 'sectionId' => $done->id]]);
    }

    public function reopen(Request $request, Task $task): JsonResponse
    {
        $target = $task->project->sections()->where('is_done', false)->orderBy('position')->first();

        abort_if(! $target, 422, 'This project has no open column to move it back to.');

        $this->service->moveTask($task, $target->id, null, $request->user());

        return response()->json(['data' => ['id' => $task->id, 'sectionId' => $target->id]]);
    }

    public function destroy(Request $request, Task $task): JsonResponse
    {
        $parent = $task->parent;

        $this->service->log($task, $request->user(), 'deleted the task');
        $task->delete();

        // Deleting the last open subtask should not leave the parent frozen
        // below 100% forever.
        $this->service->rollUpProgress($parent);

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* ------------------------------ Dependencies --------------------------- */

    public function addDependency(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'depends_on_id' => 'required|integer|exists:tasks,id|different:task',
            'type' => 'nullable|in:blocks,relates_to',
        ]);

        abort_if((int) $data['depends_on_id'] === $task->id, 422, 'A task cannot depend on itself.');

        // One hop of cycle checking. Deeper chains are rare enough, and a
        // full graph walk on every save costs more than it protects.
        $reverse = Task::whereKey($data['depends_on_id'])
            ->whereHas('dependencies', fn ($q) => $q->where('depends_on_id', $task->id))
            ->exists();

        abort_if($reverse, 422, 'Those two tasks would then be waiting on each other.');

        $task->dependencies()->firstOrCreate(
            ['depends_on_id' => $data['depends_on_id']],
            ['type' => $data['type'] ?? 'blocks'],
        );

        $this->service->log($task, $request->user(), 'added a dependency');

        return response()->json(['data' => ['id' => $task->id]], 201);
    }

    public function removeDependency(Request $request, Task $task, int $dependency): JsonResponse
    {
        $task->dependencies()->whereKey($dependency)->delete();
        $this->service->log($task, $request->user(), 'removed a dependency');

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* -------------------------------- Comments ----------------------------- */

    public function comment(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'body' => 'required|string|max:8000',
            'mentions' => 'nullable|array',
            'mentions.*' => 'integer|exists:users,id',
        ]);

        $comment = $this->service->comment($task, $data['body'], $data['mentions'] ?? [], $request->user());

        return response()->json(['data' => ['id' => $comment->id]], 201);
    }

    /* ------------------------------ Attachments ---------------------------- */

    /**
     * Files and images on a task.
     *
     * Capped at 20MB and refused for the executable types, because an ERP
     * attachment box is otherwise a very convenient way to pass a payload
     * around an office.
     */
    public function attach(Request $request, Task $task): JsonResponse
    {
        $request->validate([
            'files' => 'required|array|max:10',
            'files.*' => [
                'file',
                'max:20480',
                'mimes:jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,ppt,pptx,csv,txt,zip,rtf,odt,ods',
            ],
            'comment_id' => 'nullable|integer|exists:task_comments,id',
        ]);

        $saved = [];
        foreach ($request->file('files') as $file) {
            $saved[] = $this->file($this->service->attach($task, $file, $request->user(), $request->integer('comment_id') ?: null));
        }

        return response()->json(['data' => $saved], 201);
    }

    public function detach(Request $request, Task $task, TaskAttachment $attachment): JsonResponse
    {
        abort_unless($attachment->task_id === $task->id, 404);

        $this->service->detach($attachment, $request->user());

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* -------------------------------- Nudge -------------------------------- */

    /**
     * Sends today's reminder now instead of waiting for the morning run.
     *
     * Safe to press repeatedly — the notifier's per-day uniqueness means the
     * second press sends nothing, which is why the response says how many
     * actually went rather than claiming success.
     */
    public function nudge(Request $request, Task $task): JsonResponse
    {
        $sent = $this->notifier->remind($task->load(['assignee', 'reporter', 'watchers', 'project.owner']));

        return response()->json(['data' => [
            'sent' => count($sent),
            'message' => count($sent) > 0
                ? count($sent).' reminder(s) sent.'
                : 'Everyone on this task has already been reminded today.',
        ]]);
    }

    /* -------------------------------- Shaping ------------------------------ */

    private function cardRelations(): array
    {
        return ['assignee:id,name', 'labels:id,name,colour', 'project:id,code,name,colour', 'section:id,name,is_done'];
    }

    /** The compact shape a board card, a list row and a queue item all use. */
    private function card(Task $task): array
    {
        return [
            'id' => $task->id,
            'reference' => $task->reference,
            'title' => $task->title,
            'priority' => $task->priority,
            'projectId' => $task->project_id,
            'project' => $task->project?->name,
            'projectColour' => $task->project?->colour,
            'sectionId' => $task->section_id,
            'section' => $task->section?->name,
            'assigneeId' => $task->assignee_id,
            'assignee' => $task->assignee?->name,
            'startDate' => $task->start_date?->toDateString(),
            'dueDate' => $task->due_date?->toDateString(),
            'isDone' => $task->isDone(),
            'daysLate' => $task->daysLate(),
            'progress' => $task->progress,
            'estimateHours' => $task->estimate_hours !== null ? (float) $task->estimate_hours : null,
            'subtaskCount' => (int) ($task->subtasks_count ?? 0),
            'subtasksDone' => (int) ($task->subtasks_done ?? 0),
            'commentCount' => (int) ($task->comments_count ?? 0),
            'attachmentCount' => (int) ($task->attachments_count ?? 0),
            'deadlineMoves' => $task->due_date_changes,
            'labels' => $task->labels->map(fn ($l) => ['id' => $l->id, 'name' => $l->name, 'colour' => $l->colour])->all(),
        ];
    }

    /**
     * The shape an attachment goes out in.
     *
     * `path` rather than a finished URL. `Storage::url()` builds against
     * APP_URL, which is the API's own host — but the React app is served from
     * a different origin in development and potentially a different one in
     * production, so a URL baked here resolves to nothing in the browser. The
     * client composes it against the API host it is already talking to, which
     * is the same thing the company logo does.
     */
    private function file(TaskAttachment $a): array
    {
        return [
            'id' => $a->id,
            'name' => $a->original_name,
            'path' => $a->path,
            'mimeType' => $a->mime_type,
            'size' => (int) $a->size_bytes,
            'isImage' => $a->isImage(),
            'width' => $a->width,
            'height' => $a->height,
            'uploadedBy' => $a->uploader?->name,
            'uploadedAt' => $a->created_at?->toIso8601String(),
        ];
    }
}
