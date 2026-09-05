<?php

namespace App\Services;

use App\Models\ComplianceFlag;
use App\Models\ComplianceScore;
use App\Models\Project;
use App\Models\ProjectSection;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * What the Process & Performance office reads.
 *
 * This is the part none of Monday, ClickUp, Asana or Trello has. All four can
 * show you an overdue task; none of them keeps a register of *how* work went
 * late, and none of them distinguishes a task delivered on its original date
 * from one delivered on the fourth date somebody agreed to.
 *
 * The scan produces observations, not judgements. It says the data shows a
 * deadline moved three times; whether that was mismanagement or a customer
 * changing their mind is a person's call, recorded separately as a review.
 * Keeping those two apart matters — an automatic system that hands out
 * verdicts gets ignored the first time it is unfair.
 *
 * Idempotent by construction: every flag is unique on (task, kind, day), so
 * running the scan five times in an afternoon leaves the register unchanged.
 */
class ComplianceScanner
{
    public function __construct(private readonly WorkingCalendar $calendar) {}

    /** A task untouched this long, while open, is stalled. */
    public const STALL_DAYS = 7;

    /** Moving a deadline this many times is worth a look. */
    public const DUE_DATE_MOVE_LIMIT = 2;

    /**
     * An SLA longer than this is treated as an observation in its own right.
     *
     * Twenty working days is a calendar month of effort. A default deadline
     * beyond that means nothing raised in the project can realistically be
     * late, which is indistinguishable from not being measured — and, unlike
     * moving a deadline, it leaves no trace on any task.
     */
    public const GENEROUS_SLA_DAYS = 20;

    /**
     * Below this many measured tasks a score is noise, not a finding.
     *
     * One late task out of three is 67%, and five out of fifty is 90%. Ranking
     * those against each other puts the conscientious below the idle, which is
     * the fastest way for a scorecard to lose the room.
     */
    public const MIN_SAMPLE = 5;

    /**
     * Runs the whole scan.
     *
     * @return array<string, int>
     */
    public function run(): array
    {
        $counts = [
            'overdue' => $this->flagOverdue(),
            'due_date_moved' => $this->flagMovedDeadlines(),
            'no_due_date' => $this->flagUndated(),
            'stalled' => $this->flagStalled(),
            'unassigned' => $this->flagUnassigned(),
            'wip_exceeded' => $this->flagWipBreaches(),
            'late_completion' => $this->flagLateCompletions(),
            'generous_sla' => $this->flagGenerousSlas(),
            'coverage_gap' => $this->flagCoverageGaps(),
            'blocked_ignored' => $this->countBlockedDays(),
        ];

        $counts['scores'] = $this->rebuildScores();
        $counts['resolved'] = $this->closeResolved();

        return $counts;
    }

    /* ------------------------------- The flags ----------------------------- */

    /**
     * Open, dated, past it.
     *
     * Severity climbs with age rather than being fixed, so a register sorted
     * by severity puts the three-week-old breach above this morning's.
     */
    private function flagOverdue(): int
    {
        $raised = 0;

        Task::overdue()->with('project')->chunkById(200, function ($tasks) use (&$raised) {
            foreach ($tasks as $task) {
                $late = $task->daysLate();

                $raised += $this->raise($task, 'overdue', $this->ageSeverity($late), sprintf(
                    '%d %s overdue', $late, $late === 1 ? 'day' : 'days',
                ), ['daysLate' => $late, 'dueDate' => $task->due_date?->toDateString()]);
            }
        });

        return $raised;
    }

    private function ageSeverity(int $days): string
    {
        return match (true) {
            $days >= 14 => 'Critical',
            $days >= 7 => 'High',
            $days >= 3 => 'Medium',
            default => 'Low',
        };
    }

    /**
     * Deadlines that keep moving.
     *
     * The signal the four tools throw away. `original_due_date` is written
     * once and never rewritten, so the drift is measurable however many times
     * the date has since been agreed again.
     */
    private function flagMovedDeadlines(): int
    {
        $raised = 0;

        Task::open()
            ->where('due_date_changes', '>=', self::DUE_DATE_MOVE_LIMIT)
            ->chunkById(200, function ($tasks) use (&$raised) {
                foreach ($tasks as $task) {
                    $drift = $task->original_due_date && $task->due_date
                        ? (int) $task->original_due_date->diffInDays($task->due_date, false)
                        : null;

                    $raised += $this->raise(
                        $task,
                        'due_date_moved',
                        $task->due_date_changes >= 4 ? 'High' : 'Medium',
                        sprintf(
                            'Due date moved %d times%s',
                            $task->due_date_changes,
                            $drift !== null ? ", {$drift} days later than first agreed" : '',
                        ),
                        [
                            'moves' => $task->due_date_changes,
                            'originalDue' => $task->original_due_date?->toDateString(),
                            'currentDue' => $task->due_date?->toDateString(),
                            'driftDays' => $drift,
                        ],
                    );
                }
            });

        return $raised;
    }

    /**
     * Open work with no deadline at all.
     *
     * The quietest way to never be late. Projects carry an SLA precisely so
     * this should be rare — when it is not, something is creating tasks
     * outside the service.
     */
    private function flagUndated(): int
    {
        $raised = 0;

        Task::open()
            ->whereNull('due_date')
            ->where('created_at', '<', now()->subDays(2))
            ->chunkById(200, function ($tasks) use (&$raised) {
                foreach ($tasks as $task) {
                    $raised += $this->raise($task, 'no_due_date', 'Medium', 'Open with no deadline set', [
                        'openedOn' => $task->created_at?->toDateString(),
                        'ageDays' => (int) $task->created_at?->diffInDays(now()),
                    ]);
                }
            });

        return $raised;
    }

    /** Open, assigned, and nothing has happened to it for a week. */
    private function flagStalled(): int
    {
        $raised = 0;
        $cutoff = now()->subDays(self::STALL_DAYS);

        Task::open()
            ->whereNotNull('assignee_id')
            ->where('updated_at', '<', $cutoff)
            ->chunkById(200, function ($tasks) use (&$raised) {
                foreach ($tasks as $task) {
                    $idle = (int) $task->updated_at->diffInDays(now());

                    $raised += $this->raise($task, 'stalled', $idle >= 21 ? 'High' : 'Medium',
                        "No movement for {$idle} days",
                        ['idleDays' => $idle, 'lastTouched' => $task->updated_at->toDateString()],
                    );
                }
            });

        return $raised;
    }

    /** Work nobody owns is work nobody is doing. */
    private function flagUnassigned(): int
    {
        $raised = 0;

        Task::open()
            ->whereNull('assignee_id')
            ->where('created_at', '<', now()->subDays(3))
            ->chunkById(200, function ($tasks) use (&$raised) {
                foreach ($tasks as $task) {
                    $raised += $this->raise($task, 'unassigned', 'Medium', 'Open with nobody assigned', [
                        'ageDays' => (int) $task->created_at?->diffInDays(now()),
                    ]);
                }
            });

        return $raised;
    }

    /**
     * Columns over their limit.
     *
     * A project-level observation rather than a task one, so it is attached to
     * the first task in the column purely to satisfy the daily uniqueness key
     * — the summary names the section, which is what the office reads.
     */
    private function flagWipBreaches(): int
    {
        $raised = 0;

        $sections = ProjectSection::whereNotNull('wip_limit')
            ->where('wip_limit', '>', 0)
            ->withCount(['tasks as open_count' => fn ($q) => $q->whereNull('completed_at')])
            ->get()
            ->filter(fn (ProjectSection $s) => $s->open_count > $s->wip_limit);

        foreach ($sections as $section) {
            $task = Task::where('section_id', $section->id)->open()->orderBy('position')->first();

            if (! $task) {
                continue;
            }

            $raised += $this->raise($task, 'wip_exceeded', 'Low', sprintf(
                '"%s" holds %d items against a limit of %d',
                $section->name, $section->open_count, $section->wip_limit,
            ), ['section' => $section->name, 'open' => $section->open_count, 'limit' => $section->wip_limit]);
        }

        return $raised;
    }

    /**
     * Finished, but not on time.
     *
     * Recorded on the day it completes and never revisited, so the register
     * keeps the fact rather than a number that keeps growing.
     */
    private function flagLateCompletions(): int
    {
        $raised = 0;

        Task::whereNotNull('completed_at')
            ->whereNotNull('due_date')
            ->whereDate('completed_at', '>=', now()->subDay()->toDateString())
            ->chunkById(200, function ($tasks) use (&$raised) {
                foreach ($tasks as $task) {
                    $late = $task->daysLate();

                    if ($late === null || $late <= 0) {
                        continue;
                    }

                    $raised += $this->raise($task, 'late_completion', $this->ageSeverity($late),
                        sprintf('Completed %d %s late', $late, $late === 1 ? 'day' : 'days'),
                        [
                            'daysLate' => $late,
                            'dueDate' => $task->due_date->toDateString(),
                            'completedOn' => $task->completed_at->toDateString(),
                            'deadlineMoves' => $task->due_date_changes,
                        ],
                    );
                }
            });

        return $raised;
    }

    /**
     * Advances the blocked-day counter, once per task per day.
     *
     * Every open task waiting on an unfinished dependency gets a day added, so
     * the time it spent unable to progress can be taken off its lateness. The
     * `blocked_counted_on` guard is what makes the scan safe to run twice in an
     * afternoon — without it, a re-run would excuse the same day again and a
     * task could be blocked into permanent compliance.
     *
     * A task that has been blocked a long time is also flagged: at some point
     * "waiting on something else" stops being an excuse and becomes the thing
     * that needs escalating.
     */
    private function countBlockedDays(): int
    {
        $today = now()->toDateString();
        $flagged = 0;

        Task::open()
            ->whereHas('dependencies', function ($q) {
                $q->where('type', 'blocks')
                    ->whereHas('dependsOn', fn ($d) => $d->whereNull('completed_at'));
            })
            ->where(function ($q) use ($today) {
                $q->whereNull('blocked_counted_on')->orWhere('blocked_counted_on', '<', $today);
            })
            ->with('dependencies.dependsOn:id,reference,title,completed_at')
            ->chunkById(200, function ($tasks) use ($today, &$flagged) {
                foreach ($tasks as $task) {
                    // Weekends do not accrue: the clock they are pausing does
                    // not run on those days either.
                    if ($this->calendar->isWorkingDay($today)) {
                        $task->forceFill([
                            'blocked_days' => $task->blocked_days + 1,
                            'blocked_counted_on' => $today,
                        ])->saveQuietly();
                    }

                    if ($task->blocked_days >= 10) {
                        $blockers = $task->dependencies
                            ->filter(fn ($d) => $d->dependsOn && ! $d->dependsOn->completed_at)
                            ->map(fn ($d) => $d->dependsOn->reference)
                            ->implode(', ');

                        $flagged += $this->raise(
                            $task,
                            'blocked_ignored',
                            $task->blocked_days >= 20 ? 'High' : 'Medium',
                            sprintf('Blocked for %d working days by %s', $task->blocked_days, $blockers ?: 'another task'),
                            ['blockedDays' => $task->blocked_days, 'blockers' => $blockers],
                        );
                    }
                }
            });

        return $flagged;
    }

    /**
     * Deadline policies long enough to guarantee compliance.
     *
     * The other half of the deadline-gaming problem. `due_date_moved` catches
     * somebody pushing a date; this catches somebody who never had to, because
     * the project was given a month of slack at the outset. Recorded rather
     * than blocked — a genuinely long project exists — but the office should
     * be the one deciding which is which.
     */
    private function flagGenerousSlas(): int
    {
        $raised = 0;

        Project::query()
            ->whereNull('archived_at')
            ->whereIn('status', ['Planning', 'Active'])
            ->where('default_sla_days', '>', self::GENEROUS_SLA_DAYS)
            ->with('owner:id,name')
            ->get()
            ->each(function (Project $project) use (&$raised) {
                $raised += $this->raiseFor(
                    null,
                    $project->id,
                    $project->owner_id,
                    'generous_sla',
                    $project->default_sla_days > 60 ? 'High' : 'Medium',
                    sprintf(
                        '"%s" gives every undated task %d working days',
                        $project->name,
                        $project->default_sla_days,
                    ),
                    [
                        'slaDays' => $project->default_sla_days,
                        'threshold' => self::GENEROUS_SLA_DAYS,
                        'owner' => $project->owner?->name,
                    ],
                );
            });

        return $raised;
    }

    /**
     * People carrying no measured work at all.
     *
     * The single most important check here, and the one whose absence made the
     * whole register misleading: the scorecard's denominator is tasks assigned
     * in this system, so anybody who never uses it has no tasks, no findings
     * and a flawless record. The incentive ran exactly backwards.
     *
     * Recording the absence does not make somebody idle — plenty of real work
     * never becomes a task — but it stops the register implying they were
     * perfect when it simply was not looking.
     */
    private function flagCoverageGaps(): int
    {
        $raised = 0;

        $withWork = Task::query()
            ->whereNotNull('assignee_id')
            ->where('created_at', '>=', now()->subDays(60))
            ->distinct()
            ->pluck('assignee_id')
            ->all();

        User::query()
            ->where('status', 'Active')
            ->where('is_super_admin', false)
            ->whereNotIn('id', $withWork ?: [0])
            ->whereHas('employee', fn ($q) => $q->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED']))
            ->with('employee.hrDepartment:id,name')
            ->get()
            ->each(function (User $user) use (&$raised) {
                $raised += $this->raiseFor(
                    null,
                    null,
                    $user->id,
                    'coverage_gap',
                    'Low',
                    $user->name.' has had no tracked work for 60 days',
                    [
                        'department' => $user->employee?->hrDepartment?->name,
                        'meaning' => 'Not necessarily idle — but nothing about them is being measured, so their record is silent rather than clean.',
                    ],
                );
            });

        return $raised;
    }

    /**
     * Coverage, as a figure rather than a list.
     *
     * What proportion of active staff has any work in the system, overall and
     * per department. A department at 10% is not a well-run department; it is
     * a department the register cannot see.
     *
     * @return array{overall: float|null, headcount: int, covered: int, byDepartment: array}
     */
    public function coverage(): array
    {
        $active = User::query()
            ->where('status', 'Active')
            ->where('is_super_admin', false)
            ->whereHas('employee', fn ($q) => $q->whereNotIn('employment_status', ['RESIGNED', 'TERMINATED']))
            ->with('employee.hrDepartment:id,name')
            ->get();

        $withWork = Task::query()
            ->whereNotNull('assignee_id')
            ->where('created_at', '>=', now()->subDays(60))
            ->distinct()
            ->pluck('assignee_id')
            ->flip();

        $byDepartment = [];

        foreach ($active as $user) {
            $department = $user->employee?->hrDepartment?->name ?? 'Unassigned';

            $byDepartment[$department] ??= ['headcount' => 0, 'covered' => 0];
            $byDepartment[$department]['headcount']++;

            if ($withWork->has($user->id)) {
                $byDepartment[$department]['covered']++;
            }
        }

        $covered = $active->filter(fn (User $u) => $withWork->has($u->id))->count();

        return [
            'headcount' => $active->count(),
            'covered' => $covered,
            'overall' => $active->count() > 0 ? round(($covered / $active->count()) * 100, 1) : null,
            'byDepartment' => collect($byDepartment)
                ->map(fn ($row, $name) => [
                    'name' => $name,
                    'headcount' => $row['headcount'],
                    'covered' => $row['covered'],
                    'value' => $row['headcount'] > 0 ? round(($row['covered'] / $row['headcount']) * 100) : 0,
                ])
                ->sortBy('value')
                ->values()
                ->all(),
        ];
    }

    /**
     * Writes one observation that is not about a single task.
     *
     * A generous SLA belongs to a project and a coverage gap belongs to a
     * person; neither has a task to hang from, and attaching one arbitrarily
     * would put the finding on a row it is not about.
     */
    private function raiseFor(?int $taskId, ?int $projectId, ?int $subjectId, string $kind, string $severity, string $summary, array $detail = []): int
    {
        $flag = ComplianceFlag::firstOrNew([
            'task_id' => $taskId,
            'project_id' => $projectId,
            'subject_id' => $subjectId,
            'kind' => $kind,
            'observed_on' => now()->toDateString(),
        ]);

        if ($flag->exists) {
            return 0;
        }

        $flag->fill(['severity' => $severity, 'summary' => $summary, 'detail' => $detail])->save();

        return 1;
    }

    /**
     * Writes one observation, once per task per kind per day.
     *
     * Returns 1 when a row was created and 0 when today's already existed, so
     * the caller can report what the scan actually found rather than how many
     * rows it looked at.
     */
    private function raise(Task $task, string $kind, string $severity, string $summary, array $detail = []): int
    {
        $flag = ComplianceFlag::firstOrNew([
            'task_id' => $task->id,
            'kind' => $kind,
            'observed_on' => now()->toDateString(),
        ]);

        if ($flag->exists) {
            return 0;
        }

        $flag->fill([
            'project_id' => $task->project_id,
            'subject_id' => $task->assignee_id,
            'severity' => $severity,
            'summary' => $summary,
            'detail' => $detail,
        ])->save();

        return 1;
    }

    /**
     * Closes flags whose cause has gone away.
     *
     * A register that only ever grows is a register nobody opens. An overdue
     * flag on a task that has since been finished has served its purpose and
     * should stop competing for attention — the row stays for the history.
     */
    private function closeResolved(): int
    {
        return ComplianceFlag::whereNull('resolved_at')
            ->whereIn('kind', ['overdue', 'stalled', 'unassigned', 'no_due_date'])
            ->whereHas('task', function ($q) {
                $q->whereNotNull('completed_at');
            })
            ->update(['resolved_at' => now()]);
    }

    /* ------------------------------- Scorecards ---------------------------- */

    /**
     * Rebuilds this month's score for everyone who had work due.
     *
     * Rebuilt rather than incremented: a task whose date was corrected should
     * correct the score, and an accumulating counter cannot do that.
     */
    public function rebuildScores(?string $period = null): int
    {
        $period ??= now()->format('Y-m');
        [$year, $month] = array_map('intval', explode('-', $period));

        $start = now()->setDate($year, $month, 1)->startOfMonth()->toDateString();
        $end = now()->setDate($year, $month, 1)->endOfMonth()->toDateString();

        $rows = Task::query()
            ->whereNotNull('assignee_id')
            ->whereNotNull('due_date')
            ->whereBetween('due_date', [$start, $end])
            ->select('assignee_id')
            ->selectRaw('COUNT(*) as tasks_due')
            ->selectRaw('SUM(completed_at IS NOT NULL) as tasks_completed')
            ->selectRaw('SUM(completed_at IS NOT NULL AND DATE(completed_at) <= due_date) as on_time')
            ->selectRaw('SUM(completed_at IS NOT NULL AND DATE(completed_at) > due_date) as late')
            ->selectRaw('SUM(completed_at IS NULL AND due_date < CURDATE()) as still_overdue')
            ->selectRaw('SUM(due_date_changes) as moves')
            ->selectRaw('AVG(CASE WHEN completed_at IS NOT NULL AND DATE(completed_at) > due_date
                                  THEN DATEDIFF(DATE(completed_at), due_date) END) as avg_late')
            ->groupBy('assignee_id')
            ->get();

        DB::transaction(function () use ($rows, $period) {
            foreach ($rows as $row) {
                $due = (int) $row->tasks_due;
                $onTime = (int) $row->on_time;

                // Measured against everything that was due, not against what
                // was finished — otherwise ignoring a task improves the score.
                $rate = $due > 0 ? round(($onTime / $due) * 100, 2) : null;

                ComplianceScore::updateOrCreate(
                    ['user_id' => $row->assignee_id, 'period' => $period],
                    [
                        'tasks_due' => $due,
                        'tasks_completed' => (int) $row->tasks_completed,
                        'completed_on_time' => $onTime,
                        'completed_late' => (int) $row->late,
                        'still_overdue' => (int) $row->still_overdue,
                        'due_dates_moved' => (int) $row->moves,
                        'on_time_rate' => $rate,
                        'average_days_late' => $row->avg_late !== null ? round((float) $row->avg_late, 2) : null,
                        // Withheld below the minimum sample. A grade computed
                        // from three tasks reads as a judgement and is really a
                        // coin toss; leaving it null makes the screen say
                        // "not enough to judge" instead of ranking somebody on
                        // noise.
                        'grade' => ($rate === null || $due < self::MIN_SAMPLE) ? null : (int) round($rate),
                    ],
                );
            }
        });

        return $rows->count();
    }

    /* -------------------------------- Reading ------------------------------ */

    /** Projects with something the office should look at. */
    public function projectsAtRisk(): array
    {
        return Project::query()
            ->whereNull('archived_at')
            ->whereIn('status', ['Planning', 'Active'])
            ->withCount([
                'tasks as open_tasks' => fn ($q) => $q->whereNull('completed_at'),
                'tasks as overdue_tasks' => fn ($q) => $q->whereNull('completed_at')
                    ->whereNotNull('due_date')->whereDate('due_date', '<', now()->toDateString()),
                'tasks as total_tasks',
                'tasks as done_tasks' => fn ($q) => $q->whereNotNull('completed_at'),
            ])
            ->with('owner:id,name')
            ->get()
            ->map(fn (Project $p) => [
                'id' => $p->id,
                'code' => $p->code,
                'name' => $p->name,
                'owner' => $p->owner?->name,
                'status' => $p->status,
                'dueDate' => $p->due_date?->toDateString(),
                'totalTasks' => (int) $p->total_tasks,
                'openTasks' => (int) $p->open_tasks,
                'doneTasks' => (int) $p->done_tasks,
                'overdueTasks' => (int) $p->overdue_tasks,
                'progress' => $p->total_tasks > 0 ? round(($p->done_tasks / $p->total_tasks) * 100) : 0,
            ])
            ->sortByDesc('overdueTasks')
            ->values()
            ->all();
    }
}
