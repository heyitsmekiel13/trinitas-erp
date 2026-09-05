<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Label;
use App\Models\Project;
use App\Models\ProjectSection;
use App\Models\Task;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\ProcessOffice;
use App\Services\TaskService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Projects, their columns, their people and their labels.
 *
 * The board is not a separate concept from the list: `board()` returns the
 * sections with their tasks nested, and the list view reads the same payload
 * flat. One request serves four views, which is the only way the four stay in
 * agreement.
 */
class ProjectController extends Controller
{
    public function __construct(
        private readonly TaskService $tasks,
        private readonly ProcessOffice $office,
        private readonly AuditLogger $audit,
    ) {}

    /* ------------------------------- Reading ------------------------------- */

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $projects = $this->visible($request)
            // Archived projects are out of the way, not gone. They come back
            // on request so they can be restored — see the note on visible().
            ->when(! $request->boolean('archived'), fn ($q) => $q->whereNull('archived_at'))
            ->when($request->boolean('archived'), fn ($q) => $q->whereNotNull('archived_at'))
            ->withCount([
                'tasks as total_tasks',
                'tasks as done_tasks' => fn ($q) => $q->whereNotNull('completed_at'),
                'tasks as open_tasks' => fn ($q) => $q->whereNull('completed_at'),
                'tasks as overdue_tasks' => fn ($q) => $q->whereNull('completed_at')
                    ->whereNotNull('due_date')->whereDate('due_date', '<', now()->toDateString()),
                'tasks as my_tasks' => fn ($q) => $q->whereNull('completed_at')->where('assignee_id', $user->id),
            ])
            ->with(['owner:id,name', 'hrDepartment:id,code,name', 'members:id,name'])
            ->orderByDesc('updated_at')
            ->get();

        return response()->json(['data' => $projects->map(fn (Project $p) => $this->card($p))->all()]);
    }

    /**
     * Tasks and projects, for the command palette.
     *
     * Scoped through `Project::visibleTo()` — the same rule that decides
     * whether somebody can open a project decides whether they can find its
     * tasks by typing, so search never surfaces a title from a project the
     * requester could not otherwise reach.
     */
    public function search(Request $request): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));

        if (mb_strlen($q) < 2) {
            return response()->json(['data' => ['tasks' => [], 'projects' => []]]);
        }

        $user = $request->user();
        $projectIds = Project::visibleTo($user, $this->office->includes($user))->pluck('id');

        $tasks = Task::whereIn('project_id', $projectIds)
            ->where(fn ($w) => $w->where('title', 'like', "%{$q}%")->orWhere('reference', 'like', "%{$q}%"))
            ->with('project:id,name,colour')
            ->orderByDesc('updated_at')
            ->limit(8)
            ->get()
            ->map(fn (Task $t) => [
                'id' => $t->id,
                'reference' => $t->reference,
                'title' => $t->title,
                'project' => $t->project?->name,
                'projectColour' => $t->project?->colour,
            ]);

        $projects = Project::whereIn('id', $projectIds)
            ->where('name', 'like', "%{$q}%")
            ->orderBy('name')
            ->limit(5)
            ->get(['id', 'code', 'name', 'colour']);

        return response()->json(['data' => ['tasks' => $tasks, 'projects' => $projects]]);
    }

    public function show(Request $request, Project $project): JsonResponse
    {
        $this->assertVisible($request, $project);

        $project->load([
            'owner:id,name', 'hrDepartment:id,code,name',
            'sections', 'labels',
            'memberRows.user:id,name,username',
        ]);

        return response()->json(['data' => [
            'id' => $project->id,
            'code' => $project->code,
            'name' => $project->name,
            'description' => $project->description,
            'status' => $project->status,
            'priority' => $project->priority,
            'visibility' => $project->visibility,
            'ownerId' => $project->owner_id,
            'owner' => $project->owner?->name,
            'departmentId' => $project->hr_department_id,
            'department' => $project->hrDepartment?->name,
            'startDate' => $project->start_date?->toDateString(),
            'dueDate' => $project->due_date?->toDateString(),
            'slaDays' => $project->default_sla_days,
            // Drives whether the client offers the field as editable. The API
            // refuses it regardless; this only stops offering a control that
            // would be rejected.
            'slaLocked' => ! $this->office->includes($request->user()),
            'slaSetAt' => $project->sla_set_at?->toIso8601String(),
            'canEdit' => $this->canEdit($request, $project),
            'colour' => $project->colour,
            'archived' => $project->archived_at !== null,
            'customFieldDefs' => $project->custom_field_defs ?? [],
            'sections' => $project->sections->map(fn (ProjectSection $s) => [
                'id' => $s->id,
                'name' => $s->name,
                'colour' => $s->colour,
                'position' => $s->position,
                'wipLimit' => $s->wip_limit,
                'isDone' => $s->is_done,
                'isDefault' => $s->is_default,
            ])->all(),
            'labels' => $project->labels->map(fn (Label $l) => [
                'id' => $l->id, 'name' => $l->name, 'colour' => $l->colour,
            ])->all(),
            'members' => $project->memberRows->map(fn ($m) => [
                'id' => $m->user_id,
                'name' => $m->user?->name,
                'username' => $m->user?->username,
                'role' => $m->role,
            ])->all(),
            // Drives whether the client renders the compliance strip. The
            // routes enforce it regardless; this only stops the menu appearing
            // for somebody it would 404 for anyway.
            'canEvaluate' => $this->office->includes($request->user()),
        ]]);
    }

    /* ------------------------------- Writing ------------------------------- */

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:190',
            'description' => 'nullable|string|max:5000',
            'status' => 'nullable|in:Planning,Active,On hold,Completed,Cancelled',
            'priority' => 'nullable|in:Low,Normal,High,Critical',
            'visibility' => 'nullable|in:Team,Department,Company',
            'owner_id' => 'nullable|integer|exists:users,id',
            'hr_department_id' => 'nullable|integer|exists:hr_departments,id',
            'start_date' => 'nullable|date',
            'due_date' => 'nullable|date|after_or_equal:start_date',
            'default_sla_days' => 'nullable|integer|min:0|max:120',
            'colour' => 'nullable|string|max:16',
        ]);

        $project = $this->tasks->createProject($data, $request->user());

        return response()->json(['data' => ['id' => $project->id, 'code' => $project->code]], 201);
    }

    public function update(Request $request, Project $project): JsonResponse
    {
        $this->assertVisible($request, $project);

        $this->assertCanEdit($request, $project);

        $data = $request->validate([
            'name' => 'sometimes|string|max:190',
            'description' => 'nullable|string|max:5000',
            'status' => 'sometimes|in:Planning,Active,On hold,Completed,Cancelled',
            'priority' => 'sometimes|in:Low,Normal,High,Critical',
            'visibility' => 'sometimes|in:Team,Department,Company',
            'owner_id' => 'nullable|integer|exists:users,id',
            'hr_department_id' => 'nullable|integer|exists:hr_departments,id',
            'start_date' => 'nullable|date',
            'due_date' => 'nullable|date',
            'default_sla_days' => 'sometimes|integer|min:0|max:120',
            'colour' => 'sometimes|string|max:16',
            'archived' => 'sometimes|boolean',
            'custom_field_defs' => 'sometimes|array',
            'custom_field_defs.*.key' => 'required_with:custom_field_defs|string|max:60',
            'custom_field_defs.*.label' => 'required_with:custom_field_defs|string|max:80',
            'custom_field_defs.*.type' => 'required_with:custom_field_defs|in:text,number,date,select',
            'custom_field_defs.*.options' => 'nullable|array',
        ]);

        /*
         * The SLA is the office's to set, not the project's.
         *
         * It decides when an undated task falls due and therefore whether
         * anybody is ever late — so leaving it with the team being measured
         * made the register self-defeating. Moving a deadline was already
         * counted and flagged; setting a generous one at the outset was free
         * and left no trace at all, which is the easier exploit of the two.
         *
         * Refused rather than silently dropped: a lead who thinks they have
         * changed the deadline policy and has not is worse off than one who is
         * told they cannot.
         */
        if (array_key_exists('default_sla_days', $data)
            && (int) $data['default_sla_days'] !== (int) $project->default_sla_days) {
            abort_unless(
                $this->office->includes($request->user()),
                403,
                'The default deadline is set by the Process & Performance office. Ask them to change it.',
            );

            $this->audit->log(
                'changed a project deadline policy',
                'Project',
                $project->id,
                $project->name,
                'process',
                ['from' => $project->default_sla_days, 'to' => (int) $data['default_sla_days']],
            );

            $data['sla_set_by'] = $request->user()->id;
            $data['sla_set_at'] = now();
        }

        if (array_key_exists('archived', $data)) {
            $data['archived_at'] = $data['archived'] ? now() : null;
            unset($data['archived']);
        }

        // Closing a project stamps the day, so "when did this land?" survives
        // somebody reopening and re-closing it later.
        if (($data['status'] ?? null) === 'Completed' && ! $project->completed_on) {
            $data['completed_on'] = now()->toDateString();
        }

        // The Details tab can hand the seat to someone new too — keep their
        // membership row in step, the same as a role change from the People
        // tab does, so the two ways of transferring ownership never disagree.
        if (array_key_exists('owner_id', $data) && $data['owner_id'] && $data['owner_id'] !== $project->owner_id) {
            if ($project->owner_id) {
                $project->members()->updateExistingPivot($project->owner_id, ['role' => 'Lead']);
            }
            $project->members()->syncWithoutDetaching([$data['owner_id'] => ['role' => 'Owner']]);
        }

        $project->update($data);

        return response()->json(['data' => ['id' => $project->id]]);
    }

    public function destroy(Request $request, Project $project): JsonResponse
    {
        $this->assertCanEdit($request, $project);
        $project->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* ------------------------------- Sections ------------------------------ */

    public function storeSection(Request $request, Project $project): JsonResponse
    {
        $this->assertCanEdit($request, $project);

        $data = $request->validate([
            'name' => 'required|string|max:80',
            'colour' => 'nullable|string|max:16',
            'wip_limit' => 'nullable|integer|min:1|max:99',
            'is_done' => 'nullable|boolean',
        ]);

        $section = $project->sections()->create($data + [
            'position' => (int) $project->sections()->max('position') + 1,
        ]);

        // Only one column can mean "finished" — two would make "is it done?"
        // a question with two answers.
        if ($section->is_done) {
            $project->sections()->whereKeyNot($section->id)->update(['is_done' => false]);
        }

        return response()->json(['data' => ['id' => $section->id]], 201);
    }

    public function updateSection(Request $request, Project $project, ProjectSection $section): JsonResponse
    {
        $this->assertCanEdit($request, $project);
        abort_unless($section->project_id === $project->id, 404);

        $data = $request->validate([
            'name' => 'sometimes|string|max:80',
            'colour' => 'nullable|string|max:16',
            'position' => 'sometimes|integer|min:0',
            'wip_limit' => 'nullable|integer|min:1|max:99',
            'is_done' => 'sometimes|boolean',
        ]);

        $section->update($data);

        if ($section->is_done) {
            $project->sections()->whereKeyNot($section->id)->update(['is_done' => false]);
        }

        return response()->json(['data' => ['id' => $section->id]]);
    }

    public function destroySection(Request $request, Project $project, ProjectSection $section): JsonResponse
    {
        $this->assertCanEdit($request, $project);
        abort_unless($section->project_id === $project->id, 404);

        $fallback = $project->sections()->whereKeyNot($section->id)->orderBy('position')->first();

        abort_if(! $fallback, 422, 'A project needs at least one column.');

        // Tasks move rather than vanish. Deleting a column should never be a
        // way to delete work by accident.
        $section->tasks()->update(['section_id' => $fallback->id]);
        $section->delete();

        return response()->json(['data' => ['deleted' => true, 'movedTo' => $fallback->id]]);
    }

    /* -------------------------------- People ------------------------------- */

    public function syncMembers(Request $request, Project $project): JsonResponse
    {
        $this->assertCanEdit($request, $project);

        $data = $request->validate([
            'members' => 'present|array',
            'members.*.userId' => 'required|integer|exists:users,id',
            'members.*.role' => 'nullable|in:Owner,Lead,Member,Viewer',
        ]);

        $payload = collect($data['members'])
            ->mapWithKeys(fn ($m) => [$m['userId'] => ['role' => $m['role'] ?? 'Member']])
            ->all();

        $ownerIds = collect($payload)->filter(fn ($m) => $m['role'] === 'Owner')->keys()->all();

        if (count($ownerIds) > 0) {
            // Whoever was just handed the seat takes it; anyone else who still
            // reads 'Owner' in this same write (the seat's previous holder,
            // echoed back unchanged by the client) steps down to Lead rather
            // than the project ending up with two.
            $project->owner_id = $ownerIds[0];
            foreach (array_slice($ownerIds, 1) as $extra) {
                $payload[$extra]['role'] = 'Lead';
            }
        } elseif ($project->owner_id) {
            // The owner cannot be removed from their own project by simply
            // being left out of the list.
            $payload[$project->owner_id] = ['role' => 'Owner'];
        }

        $project->members()->sync($payload);
        $project->save();

        return response()->json(['data' => ['count' => count($payload)]]);
    }

    /**
     * Everybody who can be given work.
     *
     * Read straight off the people record, so the picker is the org chart
     * rather than a second list somebody has to keep up to date. Resigned
     * staff drop out of it the moment HR changes their status.
     */
    public function directory(): JsonResponse
    {
        $users = User::query()
            ->where('status', 'Active')
            ->where('is_super_admin', false)
            ->with('employee.hrDepartment:id,code,name', 'employee.position:id,title')
            ->orderBy('name')
            ->get(['id', 'name', 'username', 'email', 'employee_id']);

        return response()->json(['data' => $users->map(fn (User $u) => [
            'id' => $u->id,
            'name' => $u->name,
            'username' => $u->username,
            'email' => $u->email,
            'department' => $u->employee?->hrDepartment?->name,
            'position' => $u->employee?->position?->title,
        ])->all()]);
    }

    /* -------------------------------- Labels ------------------------------- */

    public function storeLabel(Request $request, Project $project): JsonResponse
    {
        $this->assertCanEdit($request, $project);

        $data = $request->validate([
            'name' => 'required|string|max:60',
            'colour' => 'nullable|string|max:16',
        ]);

        $label = $project->labels()->firstOrCreate(['name' => $data['name']], $data);

        return response()->json(['data' => ['id' => $label->id, 'name' => $label->name, 'colour' => $label->colour]], 201);
    }

    public function destroyLabel(Request $request, Project $project, Label $label): JsonResponse
    {
        $this->assertCanEdit($request, $project);
        abort_unless($label->project_id === $project->id, 404);
        $label->delete();

        return response()->json(['data' => ['deleted' => true]]);
    }

    /* -------------------------------- Access ------------------------------- */

    /**
     * The projects a person may open.
     *
     * Membership, ownership, department, or company-wide — and the compliance
     * office sees everything, because it cannot evaluate work it is not
     * allowed to look at.
     */
    /**
     * Deliberately does NOT filter out archived projects.
     *
     * It used to, and that made archiving a one-way trip: the project dropped
     * out of every query, including the one behind "can this person open it?",
     * so the only screen carrying a Restore button could never be reached for
     * a project that had been archived. The list decides what to show; this
     * decides what somebody is allowed to touch, and those are different
     * questions.
     */
    private function visible(Request $request)
    {
        $user = $request->user();

        return Project::visibleTo($user, $this->office->includes($user));
    }

    /**
     * Whether somebody may change a project, as opposed to read it.
     *
     * Every write path used to check `assertVisible`, which is a question
     * about reading — and `visible()` includes members of every role, so a
     * Viewer could rename the project, delete its columns, remove its team and
     * rewrite its deadline policy. "Viewer" meant nothing.
     *
     * The owner runs it, a Lead helps run it, and the office can reach
     * anything because it has to be able to correct what it audits.
     */
    /** The same rule as assertCanEdit, as a question rather than a guard. */
    private function canEdit(Request $request, Project $project): bool
    {
        $user = $request->user();

        if ($this->office->includes($user) || $project->owner_id === $user->id) {
            return true;
        }

        return $project->memberRows()->where('user_id', $user->id)->where('role', 'Lead')->exists();
    }

    private function assertCanEdit(Request $request, Project $project): void
    {
        $this->assertVisible($request, $project);

        $user = $request->user();

        if ($this->office->includes($user) || $project->owner_id === $user->id) {
            return;
        }

        $isLead = $project->memberRows()
            ->where('user_id', $user->id)
            ->where('role', 'Lead')
            ->exists();

        abort_unless($isLead, 403, 'Only the project owner or a lead can change this project.');
    }

    private function assertVisible(Request $request, Project $project): void
    {
        abort_unless($this->visible($request)->whereKey($project->id)->exists(), 404, 'Project not found.');
    }

    /** The shape the project grid renders. */
    private function card(Project $project): array
    {
        $total = (int) $project->total_tasks;
        $done = (int) $project->done_tasks;

        return [
            'id' => $project->id,
            'code' => $project->code,
            'name' => $project->name,
            'description' => $project->description,
            'status' => $project->status,
            'priority' => $project->priority,
            'visibility' => $project->visibility,
            'owner' => $project->owner?->name,
            'ownerId' => $project->owner_id,
            'department' => $project->hrDepartment?->name,
            'startDate' => $project->start_date?->toDateString(),
            'dueDate' => $project->due_date?->toDateString(),
            'colour' => $project->colour,
            'totalTasks' => $total,
            'doneTasks' => $done,
            'openTasks' => (int) ($project->open_tasks ?? 0),
            'overdueTasks' => (int) $project->overdue_tasks,
            'myTasks' => (int) $project->my_tasks,
            'progress' => $total > 0 ? (int) round(($done / $total) * 100) : 0,
            'archived' => $project->archived_at !== null,
            'memberCount' => $project->members->count(),
            'members' => $project->members->take(5)->map(fn ($m) => ['id' => $m->id, 'name' => $m->name])->values()->all(),
        ];
    }
}
