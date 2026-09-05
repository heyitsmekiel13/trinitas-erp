<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Goal;
use App\Models\Project;
use App\Models\ProjectTemplate;
use App\Models\Task;
use App\Models\TaskRecurrence;
use App\Models\TaskTimeEntry;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\RecurrenceRunner;
use App\Services\TaskService;
use App\Services\TimeTracker;
use App\Services\WorkingCalendar;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Recurrence, templates, time and goals.
 *
 * Four small surfaces in one controller rather than four files of forty lines
 * each. They share nothing with the board except the project they hang off,
 * and none is large enough to earn its own class — splitting them would be
 * tidier on disk and worse to read.
 */
class ProcessExtrasController extends Controller
{
    public function __construct(
        private readonly TaskService $tasks,
        private readonly RecurrenceRunner $recurrence,
        private readonly TimeTracker $time,
        private readonly WorkingCalendar $calendar,
        private readonly AuditLogger $audit,
    ) {}

    /* ============================== Recurrence ============================== */

    public function recurrences(Request $request, Project $project): JsonResponse
    {
        $rules = $project->hasMany(TaskRecurrence::class)->getQuery()
            ->with('assignee:id,name', 'section:id,name')
            ->orderByDesc('is_active')
            ->orderBy('next_run_on')
            ->get();

        return response()->json(['data' => $rules->map(fn (TaskRecurrence $r) => [
            'id' => $r->id,
            'title' => $r->title,
            'description' => $r->description,
            'priority' => $r->priority,
            'assignee' => $r->assignee?->name,
            'assigneeId' => $r->assignee_id,
            'section' => $r->section?->name,
            'sectionId' => $r->section_id,
            'frequency' => $r->frequency,
            'weekday' => $r->weekday,
            'dayOfMonth' => $r->day_of_month,
            'dueInDays' => $r->due_in_days,
            'startsOn' => $r->starts_on?->toDateString(),
            'endsOn' => $r->ends_on?->toDateString(),
            'nextRunOn' => $r->next_run_on?->toDateString(),
            'timesRaised' => $r->times_raised,
            'isActive' => $r->is_active,
            // Spelled out, because a rule nobody can read is a rule nobody
            // trusts to be doing the right thing.
            'describes' => $r->describe(),
            'upcoming' => $this->recurrence->preview($r, 3),
        ])->all()]);
    }

    public function storeRecurrence(Request $request, Project $project): JsonResponse
    {
        $data = $this->validateRecurrence($request);

        $rule = $project->hasMany(TaskRecurrence::class)->getQuery()->create($data + [
            'project_id' => $project->id,
            'created_by' => $request->user()->id,
        ]);

        $this->audit->log('created a recurring task', 'TaskRecurrence', $rule->id, $rule->title, 'process');

        return response()->json(['data' => ['id' => $rule->id, 'describes' => $rule->describe()]], 201);
    }

    public function updateRecurrence(Request $request, TaskRecurrence $recurrence): JsonResponse
    {
        $data = $this->validateRecurrence($request, partial: true);

        // Changing the schedule invalidates the date already worked out.
        if (array_intersect(array_keys($data), ['frequency', 'weekday', 'day_of_month', 'starts_on'])) {
            $data['next_run_on'] = null;
        }

        $recurrence->update($data);

        return response()->json(['data' => ['id' => $recurrence->id, 'describes' => $recurrence->describe()]]);
    }

    public function destroyRecurrence(TaskRecurrence $recurrence): JsonResponse
    {
        // Tasks it already raised are left alone — they are real work, and
        // deleting the rule should not delete last month's completed check.
        $recurrence->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /** Raises the next occurrence now, without waiting for the morning run. */
    public function runRecurrences(): JsonResponse
    {
        return response()->json(['data' => $this->recurrence->run()]);
    }

    private function validateRecurrence(Request $request, bool $partial = false): array
    {
        $rule = fn (string $r) => $partial ? 'sometimes|'.$r : $r;

        $data = $request->validate([
            'title' => $rule('required|string|max:250'),
            'description' => 'nullable|string|max:5000',
            'section_id' => 'nullable|integer|exists:project_sections,id',
            'priority' => 'nullable|in:Low,Normal,High,Urgent',
            'assignee_id' => 'nullable|integer|exists:users,id',
            'estimate_hours' => 'nullable|numeric|min:0|max:9999',
            'frequency' => $rule('required|in:Daily,Weekly,Fortnightly,Monthly,Quarterly,Yearly'),
            'weekday' => 'nullable|integer|min:1|max:7',
            'day_of_month' => 'nullable|integer|min:0|max:31',
            'due_in_days' => 'nullable|integer|min:0|max:60',
            'starts_on' => $rule('required|date'),
            'ends_on' => 'nullable|date|after:starts_on',
            'is_active' => 'nullable|boolean',
        ]);

        return $data;
    }

    /* =============================== Templates ============================== */

    public function templates(): JsonResponse
    {
        return response()->json(['data' => ProjectTemplate::query()
            ->with('creator:id,name')
            ->orderByDesc('times_used')
            ->get()
            ->map(fn (ProjectTemplate $t) => [
                'id' => $t->id,
                'name' => $t->name,
                'description' => $t->description,
                'colour' => $t->colour,
                'slaDays' => $t->default_sla_days,
                'sectionCount' => count($t->sections ?? []),
                'taskCount' => count($t->tasks ?? []),
                'labelCount' => count($t->labels ?? []),
                'timesUsed' => $t->times_used,
                'createdBy' => $t->creator?->name,
            ])->all()]);
    }

    /** Captures a project's shape — its columns, labels and open tasks. */
    public function saveTemplate(Request $request, Project $project): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:150',
            'description' => 'nullable|string|max:2000',
            'includeTasks' => 'nullable|boolean',
        ]);

        $project->load('sections', 'labels', 'rootTasks');

        $template = ProjectTemplate::create([
            'name' => $data['name'],
            'description' => $data['description'] ?? $project->description,
            'colour' => $project->colour,
            'default_sla_days' => $project->default_sla_days,
            'sections' => $project->sections->map(fn ($s) => [
                'name' => $s->name, 'colour' => $s->colour, 'position' => $s->position,
                'wip_limit' => $s->wip_limit, 'is_done' => $s->is_done, 'is_default' => $s->is_default,
            ])->all(),
            'labels' => $project->labels->map(fn ($l) => ['name' => $l->name, 'colour' => $l->colour])->all(),
            // Titles only. Copying assignees and dates would make every project
            // from this template start out assigned to whoever happened to be
            // on the one it was captured from.
            'tasks' => $request->boolean('includeTasks')
                ? $project->rootTasks->map(fn ($t) => ['title' => $t->title, 'priority' => $t->priority])->all()
                : [],
            'created_by' => $request->user()->id,
        ]);

        return response()->json(['data' => ['id' => $template->id]], 201);
    }

    public function createFromTemplate(Request $request, ProjectTemplate $template): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:190',
            'owner_id' => 'nullable|integer|exists:users,id',
            'start_date' => 'nullable|date',
            'due_date' => 'nullable|date',
        ]);

        $project = DB::transaction(function () use ($template, $data, $request) {
            $project = $this->tasks->createProject([
                'name' => $data['name'],
                'description' => $template->description,
                'colour' => $template->colour,
                'default_sla_days' => $template->default_sla_days,
                'owner_id' => $data['owner_id'] ?? $request->user()->id,
                'start_date' => $data['start_date'] ?? null,
                'due_date' => $data['due_date'] ?? null,
                'status' => 'Active',
            ], $request->user());

            // createProject seeds the four defaults; a template replaces them.
            if (! empty($template->sections)) {
                $project->sections()->delete();

                foreach ($template->sections as $section) {
                    $project->sections()->create($section);
                }
            }

            foreach ($template->labels ?? [] as $label) {
                $project->labels()->create($label);
            }

            foreach ($template->tasks ?? [] as $task) {
                $this->tasks->createTask($project, $task, $request->user());
            }

            $template->increment('times_used');

            return $project;
        });

        return response()->json(['data' => ['id' => $project->id, 'code' => $project->code]], 201);
    }

    public function destroyTemplate(ProjectTemplate $template): JsonResponse
    {
        $template->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* ================================= Time ================================= */

    public function startTimer(Request $request, Task $task): JsonResponse
    {
        $entry = $this->time->start($task, $request->user(), $request->string('note')->toString() ?: null);

        return response()->json(['data' => ['id' => $entry->id, 'startedAt' => $entry->started_at->toIso8601String()]], 201);
    }

    public function stopTimer(Request $request): JsonResponse
    {
        $entry = $this->time->stop($request->user());

        return response()->json(['data' => $entry ? [
            'id' => $entry->id,
            'minutes' => $entry->minutes,
            'taskId' => $entry->task_id,
        ] : ['message' => 'No timer was running.']]);
    }

    public function currentTimer(Request $request): JsonResponse
    {
        $entry = $this->time->running($request->user());

        return response()->json(['data' => $entry ? [
            'id' => $entry->id,
            'taskId' => $entry->task_id,
            'reference' => $entry->task?->reference,
            'title' => $entry->task?->title,
            'startedAt' => $entry->started_at->toIso8601String(),
            'minutes' => $entry->elapsedMinutes(),
        ] : null]);
    }

    public function logTime(Request $request, Task $task): JsonResponse
    {
        $data = $request->validate([
            'minutes' => 'required|integer|min:1',
            'note' => 'nullable|string|max:250',
            'on' => 'nullable|date|before_or_equal:today',
        ]);

        $entry = $this->time->log($task, $request->user(), $data['minutes'], $data['note'] ?? null, $data['on'] ?? null);

        return response()->json(['data' => ['id' => $entry->id]], 201);
    }

    public function timeEntries(Task $task): JsonResponse
    {
        return response()->json(['data' => [
            'entries' => $this->time->entriesFor($task),
            'estimateHours' => $task->estimate_hours !== null ? (float) $task->estimate_hours : null,
            'loggedHours' => (float) $task->logged_hours,
        ]]);
    }

    public function destroyTimeEntry(Request $request, TaskTimeEntry $entry): JsonResponse
    {
        abort_unless(
            $entry->user_id === $request->user()->id || $request->user()->is_super_admin,
            403,
            'You can only remove your own time.',
        );

        $this->time->delete($entry);

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* ================================ Capacity ============================== */

    /**
     * Who has room, in hours rather than task counts.
     *
     * Counting tasks treats a ten minute job and a fortnight the same. This
     * takes the working days left in the window, subtracts approved leave,
     * multiplies by a working day, and compares that against the estimates
     * already assigned — which is the question a lead is actually asking
     * before they hand somebody else a job.
     */
    public function capacity(Request $request): JsonResponse
    {
        $days = min(max($request->integer('days') ?: 14, 1), 90);
        $hoursPerDay = 8;
        $until = now()->addDays($days);

        $rows = User::query()
            ->where('status', 'Active')
            ->where('is_super_admin', false)
            ->whereHas('employee', fn ($q) => $q->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED']))
            ->with('employee.hrDepartment:id,name')
            ->get()
            ->map(function ($user) use ($hoursPerDay, $until) {
                $workingDays = $this->calendar->workingDaysBetween(now(), $until);
                $onLeave = $this->calendar->leaveDaysBetween($user, now(), $until);
                $available = max(0, ($workingDays - $onLeave) * $hoursPerDay);

                $open = Task::where('assignee_id', $user->id)
                    ->whereNull('completed_at')
                    ->where(function ($q) use ($until) {
                        $q->whereNull('due_date')->orWhereDate('due_date', '<=', $until->toDateString());
                    })
                    ->get(['estimate_hours']);

                // An unestimated task is not free. Charging it a nominal half
                // day is a guess, but a guess that is visibly a guess beats
                // silently treating it as zero and declaring somebody idle.
                $committed = $open->sum(fn ($t) => $t->estimate_hours !== null ? (float) $t->estimate_hours : 4);
                $unestimated = $open->filter(fn ($t) => $t->estimate_hours === null)->count();

                return [
                    'userId' => $user->id,
                    'name' => $user->name,
                    'department' => $user->employee?->hrDepartment?->name,
                    'availableHours' => $available,
                    'committedHours' => round($committed, 1),
                    'leaveDays' => $onLeave,
                    'openTasks' => $open->count(),
                    'unestimated' => $unestimated,
                    'loadPct' => $available > 0 ? (int) round(($committed / $available) * 100) : null,
                ];
            })
            ->sortByDesc('loadPct')
            ->values()
            ->all();

        return response()->json(['data' => [
            'days' => $days,
            'hoursPerDay' => $hoursPerDay,
            'workingDays' => $this->calendar->workingDaysBetween(now(), $until),
            'people' => $rows,
        ]]);
    }

    /* ================================= Goals ================================ */

    public function goals(Request $request): JsonResponse
    {
        $goals = Goal::query()
            ->when($request->string('period')->toString(), fn ($q, $p) => $q->where('period', $p))
            ->with(['owner:id,name', 'hrDepartment:id,name', 'projects:id,code,name,colour,status'])
            ->orderByRaw("FIELD(status,'Active','Draft','Achieved','Missed','Abandoned')")
            ->orderBy('due_on')
            ->get();

        return response()->json(['data' => $goals->map(fn (Goal $g) => [
            'id' => $g->id,
            'name' => $g->name,
            'description' => $g->description,
            'owner' => $g->owner?->name,
            'ownerId' => $g->owner_id,
            'department' => $g->hrDepartment?->name,
            'period' => $g->period,
            'status' => $g->status,
            'targetValue' => $g->target_value !== null ? (float) $g->target_value : null,
            'currentValue' => (float) $g->current_value,
            'unit' => $g->unit,
            'dueOn' => $g->due_on?->toDateString(),
            'progress' => $g->progress(),
            // Says which of the three sources the number came from, because
            // "62%" derived from task counts means something weaker than 62%
            // measured against a target.
            'progressSource' => $g->progress_override !== null
                ? 'set by hand'
                : ($g->target_value !== null ? 'measured against target' : 'from linked projects'),
            'projects' => $g->projects->map(fn ($p) => [
                'id' => $p->id, 'code' => $p->code, 'name' => $p->name, 'colour' => $p->colour, 'status' => $p->status,
            ])->all(),
        ])->all()]);
    }

    public function storeGoal(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:190',
            'description' => 'nullable|string|max:4000',
            'owner_id' => 'nullable|integer|exists:users,id',
            'hr_department_id' => 'nullable|integer|exists:hr_departments,id',
            'period' => 'required|string|max:16',
            'status' => 'nullable|in:Draft,Active,Achieved,Missed,Abandoned',
            'target_value' => 'nullable|numeric',
            'current_value' => 'nullable|numeric',
            'unit' => 'nullable|string|max:32',
            'due_on' => 'nullable|date',
            'project_ids' => 'nullable|array',
            'project_ids.*' => 'integer|exists:projects,id',
        ]);

        $goal = Goal::create(collect($data)->except('project_ids')->all());
        $goal->projects()->sync($data['project_ids'] ?? []);

        return response()->json(['data' => ['id' => $goal->id]], 201);
    }

    public function updateGoal(Request $request, Goal $goal): JsonResponse
    {
        $data = $request->validate([
            'name' => 'sometimes|string|max:190',
            'description' => 'nullable|string|max:4000',
            'owner_id' => 'nullable|integer|exists:users,id',
            'hr_department_id' => 'nullable|integer|exists:hr_departments,id',
            'period' => 'sometimes|string|max:16',
            'status' => 'sometimes|in:Draft,Active,Achieved,Missed,Abandoned',
            'target_value' => 'nullable|numeric',
            'current_value' => 'nullable|numeric',
            'unit' => 'nullable|string|max:32',
            'progress_override' => 'nullable|integer|min:0|max:100',
            'due_on' => 'nullable|date',
            'project_ids' => 'sometimes|array',
            'project_ids.*' => 'integer|exists:projects,id',
        ]);

        $goal->update(collect($data)->except('project_ids')->all());

        if (array_key_exists('project_ids', $data)) {
            $goal->projects()->sync($data['project_ids']);
        }

        return response()->json(['data' => ['id' => $goal->id]]);
    }

    public function destroyGoal(Goal $goal): JsonResponse
    {
        $goal->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }
}
