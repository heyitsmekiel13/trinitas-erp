<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ComplianceFlag;
use App\Models\ComplianceReview;
use App\Models\ComplianceScore;
use App\Models\Task;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\ComplianceScanner;
use App\Services\InfractionMonitor;
use App\Services\Mailer;
use App\Services\ProcessMetrics;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The Process & Performance office's own screens.
 *
 * Every route in this controller sits behind the `process-office` middleware.
 * Nothing here is reachable by the people it describes, and the middleware
 * answers 404 rather than 403 so that the existence of an assessment is not
 * itself disclosed.
 *
 * The office reads work it does not do. That is the arrangement being modelled:
 * departments deliver, this office establishes whether they delivered on time,
 * and the two views of the same task are deliberately different.
 */
class ComplianceController extends Controller
{
    public function __construct(
        private readonly ComplianceScanner $scanner,
        private readonly AuditLogger $audit,
        private readonly ProcessMetrics $metrics,
    ) {}

    /* ------------------------------- Overview ------------------------------ */

    public function dashboard(Request $request): JsonResponse
    {
        $today = now()->toDateString();

        $open = Task::open();
        $overdue = (clone $open)->whereNotNull('due_date')->whereDate('due_date', '<', $today)->count();
        $dueToday = (clone $open)->whereDate('due_date', $today)->count();
        $dueWeek = Task::dueWithin(7)->count();
        $undated = (clone $open)->whereNull('due_date')->count();
        $openTotal = (clone $open)->count();

        // Completed against a date, this month — the on-time rate everything
        // else on the page is read against.
        $month = Task::whereNotNull('completed_at')
            ->whereNotNull('due_date')
            ->whereBetween('completed_at', [now()->startOfMonth(), now()->endOfMonth()])
            ->get(['due_date', 'completed_at']);

        $onTime = $month->filter(fn ($t) => $t->completed_at->toDateString() <= $t->due_date->toDateString())->count();

        $flags = ComplianceFlag::whereNull('resolved_at')
            ->selectRaw('kind, severity, COUNT(*) as total')
            ->groupBy('kind', 'severity')
            ->get();

        return response()->json(['data' => [
            'generatedAt' => now()->toIso8601String(),
            'kpis' => [
                'openTasks' => $openTotal,
                'overdue' => $overdue,
                'dueToday' => $dueToday,
                'dueThisWeek' => $dueWeek,
                'undated' => $undated,
                'completedThisMonth' => $month->count(),
                'onTimeThisMonth' => $onTime,
                'onTimeRate' => $month->count() > 0 ? round(($onTime / $month->count()) * 100, 1) : null,
                'openFlags' => (int) $flags->sum('total'),
                'criticalFlags' => (int) $flags->where('severity', 'Critical')->sum('total'),
            ],
            'flagsByKind' => $flags->groupBy('kind')->map(fn ($rows, $kind) => [
                'name' => $this->kindLabel($kind),
                'value' => (int) $rows->sum('total'),
            ])->values()->all(),
            'flagsBySeverity' => collect(['Critical', 'High', 'Medium', 'Low'])->map(fn ($s) => [
                'name' => $s,
                'value' => (int) $flags->where('severity', $s)->sum('total'),
            ])->all(),
            'projects' => $this->scanner->projectsAtRisk(),
            'ageing' => $this->ageing(),
            'worstOffenders' => $this->worstOffenders(),
            /*
             * Coverage sits on the main dashboard rather than a sub-page, and
             * that placement is the point.
             *
             * Every other figure here is computed over work that is in the
             * system. A department that never adopted the board has no tasks,
             * no findings and an unblemished record — so without this number
             * beside them, the rest of the page quietly rewards not taking
             * part.
             */
            'coverage' => $this->scanner->coverage(),
            'onTimeTrend' => $this->metrics->onTimeTrend(6),
        ]]);
    }

    /**
     * Overdue work in age bands.
     *
     * A single "23 overdue" says nothing about whether that is this week's
     * slippage or a year of accumulated debt; the bands do.
     */
    private function ageing(): array
    {
        $tasks = Task::overdue()->get(['due_date']);

        $bands = ['1–3 days' => 0, '4–7 days' => 0, '1–2 weeks' => 0, '2–4 weeks' => 0, 'Over a month' => 0];

        foreach ($tasks as $task) {
            $days = (int) $task->due_date->diffInDays(now());

            $key = match (true) {
                $days <= 3 => '1–3 days',
                $days <= 7 => '4–7 days',
                $days <= 14 => '1–2 weeks',
                $days <= 30 => '2–4 weeks',
                default => 'Over a month',
            };

            $bands[$key]++;
        }

        return collect($bands)->map(fn ($v, $k) => ['name' => $k, 'value' => $v])->values()->all();
    }

    /** People carrying the most unresolved observations. */
    private function worstOffenders(): array
    {
        return ComplianceFlag::whereNull('resolved_at')
            ->whereNotNull('subject_id')
            ->selectRaw('subject_id, COUNT(*) as total')
            ->groupBy('subject_id')
            ->orderByDesc('total')
            ->limit(10)
            ->with('subject:id,name')
            ->get()
            ->map(fn ($row) => ['name' => $row->subject?->name ?? 'Unassigned', 'value' => (int) $row->total])
            ->all();
    }

    /**
     * How the process is behaving, as opposed to what is wrong today.
     *
     * A separate endpoint from the dashboard because it is markedly more
     * expensive — the cumulative flow diagram replays the activity trail day
     * by day — and the dashboard is the screen somebody opens every morning.
     * Making them pay for a flow chart they look at weekly would be the wrong
     * trade.
     */
    public function metrics(Request $request): JsonResponse
    {
        $window = min(max($request->integer('days') ?: 90, 7), 365);

        return response()->json(['data' => [
            'window' => $window,
            'cycleTime' => $this->metrics->cycleTime($window),
            'leadTime' => $this->metrics->leadTime($window),
            'throughput' => $this->metrics->throughput(12),
            'onTimeTrend' => $this->metrics->onTimeTrend(12),
            'flow' => $this->metrics->cumulativeFlow(30),
            'coverage' => $this->scanner->coverage(),
        ]]);
    }

    /* ------------------------------- Register ------------------------------ */

    public function flags(Request $request): JsonResponse
    {
        $query = ComplianceFlag::query()
            ->with(['task:id,reference,title,due_date,completed_at,assignee_id', 'project:id,code,name', 'subject:id,name'])
            ->when($request->string('kind')->toString(), fn ($q, $k) => $q->where('kind', $k))
            ->when($request->string('severity')->toString(), fn ($q, $s) => $q->where('severity', $s))
            ->when($request->boolean('includeResolved') === false, fn ($q) => $q->whereNull('resolved_at'))
            ->orderByRaw("FIELD(severity,'Critical','High','Medium','Low')")
            ->orderByDesc('observed_on')
            ->limit(500);

        return response()->json(['data' => $query->get()->map(fn (ComplianceFlag $f) => [
            'id' => $f->id,
            'kind' => $f->kind,
            'kindLabel' => $this->kindLabel($f->kind),
            'severity' => $f->severity,
            'summary' => $f->summary,
            'detail' => $f->detail,
            'observedOn' => $f->observed_on?->toDateString(),
            'acknowledged' => $f->acknowledged_at !== null,
            'resolved' => $f->resolved_at !== null,
            'taskId' => $f->task_id,
            'taskRef' => $f->task?->reference,
            'taskTitle' => $f->task?->title,
            'project' => $f->project?->name,
            'subject' => $f->subject?->name,
            'subjectId' => $f->subject_id,
        ])->all()]);
    }

    public function acknowledgeFlag(Request $request, ComplianceFlag $flag): JsonResponse
    {
        $flag->update(['acknowledged_at' => now(), 'acknowledged_by' => $request->user()->id]);

        return response()->json(['data' => ['id' => $flag->id]]);
    }

    public function resolveFlag(Request $request, ComplianceFlag $flag): JsonResponse
    {
        $flag->update(['resolved_at' => now()]);

        return response()->json(['data' => ['id' => $flag->id]]);
    }

    /** Runs the scan on demand rather than waiting for the 06:30 job. */
    public function scan(Request $request): JsonResponse
    {
        $counts = $this->scanner->run();

        $this->audit->log('ran the compliance scan', 'ComplianceFlag', null, null, 'process');

        return response()->json(['data' => $counts]);
    }

    /* ------------------------------ Evaluations ---------------------------- */

    /**
     * Finished work with no verdict recorded yet.
     *
     * The office's actual queue. Ordered worst-first by how late the delivery
     * was, so the reviews that matter are the ones done first.
     */
    public function queue(Request $request): JsonResponse
    {
        $reviewed = ComplianceReview::whereNotNull('task_id')->pluck('task_id');

        $tasks = Task::whereNotNull('completed_at')
            ->whereNotIn('id', $reviewed)
            ->where('completed_at', '>=', now()->subDays(60))
            ->with(['project:id,code,name', 'assignee:id,name', 'completedBy:id,name'])
            ->orderByDesc('completed_at')
            ->limit(200)
            ->get();

        return response()->json(['data' => $tasks->map(fn (Task $t) => [
            'taskId' => $t->id,
            'reference' => $t->reference,
            'title' => $t->title,
            'project' => $t->project?->name,
            'subject' => $t->assignee?->name,
            'subjectId' => $t->assignee_id,
            'dueDate' => $t->due_date?->toDateString(),
            'completedOn' => $t->completed_at?->toDateString(),
            'daysLate' => $t->daysLate(),
            'deadlineMoves' => $t->due_date_changes,
            'reassignments' => $t->reassignments,
            'originalDue' => $t->original_due_date?->toDateString(),
        ])->sortByDesc(fn ($r) => $r['daysLate'] ?? -999)->values()->all()]);
    }

    public function reviews(Request $request): JsonResponse
    {
        $reviews = ComplianceReview::query()
            ->with(['task:id,reference,title', 'project:id,name', 'subject:id,name', 'reviewer:id,name', 'escalatedCase:id,case_no'])
            ->when($request->integer('subjectId'), fn ($q, $id) => $q->where('subject_id', $id))
            ->orderByDesc('reviewed_at')
            ->limit(300)
            ->get();

        return response()->json(['data' => $reviews->map(fn (ComplianceReview $r) => [
            'id' => $r->id,
            'taskId' => $r->task_id,
            'reference' => $r->task?->reference,
            'title' => $r->task?->title,
            'project' => $r->project?->name,
            'subject' => $r->subject?->name,
            'reviewer' => $r->reviewer?->name,
            'verdict' => $r->verdict,
            'timelinessDays' => $r->timeliness_days,
            'qualityScore' => $r->quality_score,
            'findings' => $r->findings,
            'actionRequired' => $r->action_required,
            'followUpOn' => $r->follow_up_on?->toDateString(),
            'reviewedAt' => $r->reviewed_at?->toIso8601String(),
            'disclosed' => $r->isDisclosed(),
            'disclosedAt' => $r->disclosed_at?->toIso8601String(),
            'responseStatus' => $r->response_status,
            'subjectResponse' => $r->subject_response,
            'subjectRespondedAt' => $r->subject_responded_at?->toIso8601String(),
            'officeReply' => $r->office_reply,
            'escalatedCaseId' => $r->escalated_case_id,
            'escalatedCaseNo' => $r->escalatedCase?->case_no,
        ])->all()]);
    }

    /**
     * Records the office's judgement on one task.
     *
     * `timeliness_days` is taken from the task rather than typed, so the
     * verdict is a judgement and the number beside it stays a fact.
     */
    public function evaluate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'task_id' => 'required|integer|exists:tasks,id',
            'verdict' => 'required|in:Compliant,Minor delay,Non-compliant,Exemplary',
            'quality_score' => 'nullable|integer|min:0|max:100',
            'findings' => 'nullable|string|max:4000',
            'action_required' => 'nullable|string|max:2000',
            'follow_up_on' => 'nullable|date|after_or_equal:today',
        ]);

        $task = Task::findOrFail($data['task_id']);

        $review = ComplianceReview::updateOrCreate(
            ['task_id' => $task->id],
            $data + [
                'project_id' => $task->project_id,
                'subject_id' => $task->assignee_id,
                'reviewer_id' => $request->user()->id,
                'timeliness_days' => $task->daysLate(),
                'reviewed_at' => now(),
            ],
        );

        // Logged under `process`, not `hr` — the audit trail should show which
        // office reached the conclusion.
        $this->audit->log('recorded a compliance verdict', 'Task', $task->id, $task->reference, 'process');

        return response()->json(['data' => ['id' => $review->id]], 201);
    }

    /**
     * Tells the subject a verdict about them exists.
     *
     * Deliberate and one-way. Most reviews never leave the office and should
     * not — the register is confidential so that observations get recorded at
     * all. But a verdict that is going to be *used*, in a rating or a
     * conversation or a penalty, cannot also be secret: that is the point at
     * which a confidential record becomes a decision made about somebody
     * behind their back.
     *
     * Disclosing starts a clock the office has to answer to, which is the
     * intended friction. It should be a considered act.
     */
    public function disclose(Request $request, ComplianceReview $review): JsonResponse
    {
        abort_if($review->isDisclosed(), 422, 'This has already been disclosed.');

        $data = $request->validate([
            'note' => 'nullable|string|max:2000',
        ]);

        $review->update([
            'disclosed_at' => now(),
            'disclosed_by' => $request->user()->id,
            'response_status' => 'Awaiting response',
            'office_reply' => $data['note'] ?? null,
        ]);

        $this->audit->log(
            'disclosed a compliance verdict to its subject',
            'ComplianceReview',
            $review->id,
            $review->subject?->name,
            'process',
        );

        $this->notifyDisclosure($review);

        return response()->json(['data' => ['id' => $review->id, 'status' => $review->response_status]]);
    }

    /**
     * The office's answer to a response.
     *
     * A dispute that is simply ignored is worse than no right of reply at all,
     * because it looks like process without being any. Answering closes it
     * either way — `Accepted` means the office agrees the verdict was wrong,
     * `Closed` means it stands and here is why.
     */
    public function replyToResponse(Request $request, ComplianceReview $review): JsonResponse
    {
        abort_unless($review->isDisclosed(), 422, 'Nothing has been disclosed on this review.');

        $data = $request->validate([
            'reply' => 'required|string|max:4000',
            'outcome' => 'required|in:Accepted,Closed',
            // Correcting the verdict is allowed, and is the whole reason for
            // asking: a right of reply that cannot change the answer is a
            // suggestion box.
            'verdict' => 'nullable|in:Compliant,Minor delay,Non-compliant,Exemplary',
        ]);

        $review->update([
            'office_reply' => $data['reply'],
            'office_replied_at' => now(),
            'office_replied_by' => $request->user()->id,
            'response_status' => $data['outcome'],
        ] + (isset($data['verdict']) ? ['verdict' => $data['verdict']] : []));

        $this->audit->log(
            'answered a disputed compliance verdict',
            'ComplianceReview',
            $review->id,
            $review->subject?->name,
            'process',
            ['outcome' => $data['outcome']],
        );

        return response()->json(['data' => ['id' => $review->id, 'status' => $review->response_status]]);
    }

    /**
     * Hands the matter to the disciplinary process.
     *
     * The office establishes whether work landed on time. It does not get to
     * impose a penalty for it — that requires a notice to explain, a chance to
     * answer, a hearing and a decision, which the HR module already implements
     * because Philippine labour law requires it.
     *
     * So escalation creates an `employee_cases` row and steps back. The case
     * carries the process from there, and the review keeps a pointer to it so
     * the two are not separate stories about the same event.
     *
     * Refused unless the verdict has been disclosed: raising a case off a
     * finding the person has never seen is precisely the shortcut this whole
     * mechanism exists to prevent.
     */
    public function escalateToCase(Request $request, ComplianceReview $review, InfractionMonitor $monitor): JsonResponse
    {
        abort_unless(
            $review->isDisclosed(),
            422,
            'Disclose the verdict and give them a chance to respond before raising a case.',
        );

        abort_if($review->escalated_case_id, 422, 'A case has already been raised from this review.');

        $employee = $review->subject?->employee;

        abort_unless($employee, 422, 'This account is not linked to an employee record, so no case can be raised.');

        $data = $request->validate([
            'details' => 'required|string|max:4000',
        ]);

        $case = $monitor->raise(
            employee: $employee,
            type: 'Performance',
            details: $data['details'],
            record: null,
            automatic: false,
            handledBy: $request->user()->employee_id,
        );

        $review->update(['escalated_case_id' => $case->id]);

        $this->audit->log(
            'raised a disciplinary case from a compliance verdict',
            'EmployeeCase',
            $case->id,
            $case->case_no,
            'process',
            ['reviewId' => $review->id, 'subject' => $review->subject?->name],
        );

        return response()->json(['data' => [
            'caseId' => $case->id,
            'caseNo' => $case->case_no,
            'message' => "Case {$case->case_no} raised. The notice to explain, hearing and decision are handled under Employee Relations.",
        ]], 201);
    }

    /** Lets the subject know, without putting the verdict itself in an email. */
    private function notifyDisclosure(ComplianceReview $review): void
    {
        $subject = $review->subject;

        if (! $subject || ! filter_var((string) $subject->email, FILTER_VALIDATE_EMAIL)) {
            return;
        }

        app(Mailer::class)->send(
            $subject->email,
            'A delivery review has been shared with you',
            'emails.task-reminder',
            [
                'user' => $subject,
                'task' => $review->task,
                'project' => $review->project,
                'kind' => 'assigned',
                'headline' => 'A delivery review has been shared with you',
                // The finding itself is not in the email. It belongs on the
                // screen, with the context and the box to answer in.
                'lead' => 'The Process & Performance office has shared a review of delivered work with you. Open it from My Workspace to read it and respond.',
                'streak' => 1,
                'taskUrl' => rtrim((string) config('app.url'), '/').'/me',
            ],
            'compliance.disclosed',
            'ComplianceReview',
            $review->id,
        );
    }

    /* ------------------------------ Scorecards ----------------------------- */

    public function scores(Request $request): JsonResponse
    {
        $period = $request->string('period')->toString() ?: now()->format('Y-m');

        // Rebuilt on read as well as on the nightly scan: an office opening
        // this screen expects the numbers to reflect this morning's work.
        $this->scanner->rebuildScores($period);

        $scores = ComplianceScore::where('period', $period)
            ->with('user:id,name,employee_id', 'user.employee.hrDepartment:id,name')
            ->orderByDesc('tasks_due')
            ->get();

        return response()->json(['data' => [
            'period' => $period,
            'rows' => $scores->map(fn (ComplianceScore $s) => [
                'userId' => $s->user_id,
                'name' => $s->user?->name,
                'department' => $s->user?->employee?->hrDepartment?->name,
                'tasksDue' => $s->tasks_due,
                'completed' => $s->tasks_completed,
                'onTime' => $s->completed_on_time,
                'late' => $s->completed_late,
                'stillOverdue' => $s->still_overdue,
                'deadlinesMoved' => $s->due_dates_moved,
                'onTimeRate' => $s->on_time_rate !== null ? (float) $s->on_time_rate : null,
                'averageDaysLate' => $s->average_days_late !== null ? (float) $s->average_days_late : null,
            ])->all(),
        ]]);
    }

    /**
     * One person's full compliance file.
     *
     * Everything the office holds on them in one place, because a scorecard
     * without the tasks behind it is a number nobody can defend in a meeting.
     */
    public function subject(Request $request, User $user): JsonResponse
    {
        $tasks = Task::where('assignee_id', $user->id)
            ->with('project:id,name')
            ->orderByDesc('due_date')
            ->limit(200)
            ->get();

        return response()->json(['data' => [
            'user' => ['id' => $user->id, 'name' => $user->name],
            'scores' => ComplianceScore::where('user_id', $user->id)->orderByDesc('period')->limit(12)->get()
                ->map(fn ($s) => [
                    'period' => $s->period,
                    'tasksDue' => $s->tasks_due,
                    'onTime' => $s->completed_on_time,
                    'late' => $s->completed_late,
                    'onTimeRate' => $s->on_time_rate !== null ? (float) $s->on_time_rate : null,
                ])->all(),
            'flags' => ComplianceFlag::where('subject_id', $user->id)->whereNull('resolved_at')
                ->orderByDesc('observed_on')->limit(50)->get()
                ->map(fn ($f) => [
                    'id' => $f->id, 'kind' => $this->kindLabel($f->kind), 'severity' => $f->severity,
                    'summary' => $f->summary, 'observedOn' => $f->observed_on?->toDateString(),
                ])->all(),
            'tasks' => $tasks->map(fn (Task $t) => [
                'id' => $t->id, 'reference' => $t->reference, 'title' => $t->title,
                'project' => $t->project?->name,
                'dueDate' => $t->due_date?->toDateString(),
                'completedOn' => $t->completed_at?->toDateString(),
                'daysLate' => $t->daysLate(),
                'deadlineMoves' => $t->due_date_changes,
            ])->all(),
        ]]);
    }

    private function kindLabel(string $kind): string
    {
        return match ($kind) {
            'overdue' => 'Past its deadline',
            'due_date_moved' => 'Deadline moved repeatedly',
            'no_due_date' => 'No deadline set',
            'stalled' => 'No movement',
            'unassigned' => 'Nobody assigned',
            'wip_exceeded' => 'Column over its limit',
            'blocked_ignored' => 'Blocked but progressing',
            'reopened' => 'Reopened after completion',
            'late_completion' => 'Delivered late',
            'generous_sla' => 'Deadline policy too generous to measure',
            'coverage_gap' => 'No tracked work at all',
            default => ucfirst(str_replace('_', ' ', $kind)),
        };
    }
}
