<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\OnboardingTask;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The new-hire checklist, generated the moment somebody is hired.
 *
 * A fixed template rather than something HR builds per person — every new
 * hire in the Philippines needs the same handful of things regardless of
 * role: the contract signed, the 201-file documents in, an account, an
 * orientation, the statutory registrations confirmed. Data rather than a run
 * of ifs, for the same reason `EmployeeProfile::requirements()` is: one list
 * drives generation, the progress bar and the overdue check together.
 */
class OnboardingTasks
{
    /**
     * @return list<array{key: string, category: string, title: string, description: string, dueOffsetDays: int}>
     */
    public function template(): array
    {
        return [
            // Day 1 — the paperwork nothing else can start without.
            ['key' => 'sign_contract', 'category' => 'Documentation', 'title' => 'Sign employment contract',
                'description' => 'The signed contract itself — this is the paper trail, not the offer letter.', 'dueOffsetDays' => 0],
            ['key' => 'policy_ack', 'category' => 'Documentation', 'title' => 'Acknowledge company policy',
                'description' => 'Code of conduct, attendance policy and data privacy consent.', 'dueOffsetDays' => 0],
            ['key' => 'submit_201_documents', 'category' => 'Documentation', 'title' => 'Submit 201-file documents',
                'description' => 'Government IDs, PSA birth certificate, NBI clearance and the rest of the checklist in 201 Files.', 'dueOffsetDays' => 5],

            // Day 1 — access, already half-done by the hire itself.
            ['key' => 'system_access', 'category' => 'IT Access', 'title' => 'Confirm system sign-in works',
                'description' => 'The account was created at hire — have them sign in once to confirm it.', 'dueOffsetDays' => 0],
            ['key' => 'company_email', 'category' => 'IT Access', 'title' => 'Set up company email and equipment',
                'description' => 'Email, workstation or tools needed for the role.', 'dueOffsetDays' => 1],

            // Week 1.
            ['key' => 'orientation', 'category' => 'Training', 'title' => 'Attend new-hire orientation',
                'description' => 'Company overview, org structure and reporting lines.', 'dueOffsetDays' => 3],
            ['key' => 'safety_orientation', 'category' => 'Training', 'title' => 'Complete safety and compliance orientation',
                'description' => 'Occupational safety briefing and, for warehouse or technical roles, equipment handling.', 'dueOffsetDays' => 5],

            // Within the month — statutory registration has its own lead time.
            ['key' => 'statutory_registration', 'category' => 'Compliance', 'title' => 'Confirm SSS, PhilHealth and Pag-IBIG registration',
                'description' => 'Register if not yet a member; confirm the numbers on file if already registered.', 'dueOffsetDays' => 30],
            ['key' => 'probation_terms', 'category' => 'Compliance', 'title' => 'Acknowledge probationary period terms',
                'description' => 'Standards for regularisation, explained and signed within the first month per DOLE guidance.', 'dueOffsetDays' => 30],
        ];
    }

    /**
     * Creates the checklist for a newly hired employee.
     *
     * `firstOrCreate` per key rather than `insert`, so calling this twice for
     * the same employee — a re-run, a retry — extends nothing and duplicates
     * nothing.
     */
    public function generateFor(Employee $employee): void
    {
        $hired = CarbonImmutable::parse($employee->date_hired ?? now());

        foreach ($this->template() as $i => $task) {
            OnboardingTask::firstOrCreate(
                ['employee_id' => $employee->id, 'key' => $task['key']],
                [
                    'category' => $task['category'],
                    'title' => $task['title'],
                    'description' => $task['description'],
                    'due_date' => $hired->addDays($task['dueOffsetDays'])->toDateString(),
                    'sort_order' => $i,
                ],
            );
        }
    }

    /** @return array{items: list<OnboardingTask>, completion: array<string, mixed>} */
    public function forEmployee(Employee $employee): array
    {
        $items = $employee->onboardingTasks()->with('completedBy')->orderBy('sort_order')->get();

        return [
            'items' => $items->values()->all(),
            'completion' => $this->completion($items),
        ];
    }

    /** @param  Collection<int, OnboardingTask>  $items */
    private function completion(Collection $items): array
    {
        $total = max($items->count(), 1);
        $done = $items->where('status', 'Done')->count();

        // Strictly before today, not before this instant — a task due
        // "today" is not overdue at 7am on the day it is due. `due_date`
        // casts to midnight, and `isPast()` compares against the current
        // time, so without this every same-day task was born overdue.
        $overdue = $items->filter(
            fn (OnboardingTask $t) => $t->status === 'Pending' && $t->due_date
                && $t->due_date->lt(CarbonImmutable::today()),
        )->count();

        return [
            'percent' => (int) round(($done / $total) * 100),
            'done' => $done,
            'total' => $items->count(),
            'overdue' => $overdue,
        ];
    }

    /**
     * Every employee with an overdue onboarding task, worst first — the
     * bell, the dashboard panel, and the reminder digest all read this.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function outstanding(int $limit = 50): Collection
    {
        $employees = Employee::query()
            ->with(['hrDepartment', 'branchUnit', 'onboardingTasks'])
            ->whereHas('onboardingTasks', fn ($q) => $q->where('status', 'Pending'))
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->limit(400)
            ->get();

        return $employees
            ->map(function (Employee $employee) {
                $completion = $this->completion($employee->onboardingTasks);

                return [
                    'id' => $employee->id,
                    'employeeNo' => $employee->employee_no,
                    'name' => $employee->full_name,
                    'department' => $employee->hrDepartment->name ?? null,
                    'branch' => $employee->branchUnit->name ?? null,
                ] + $completion;
            })
            ->filter(fn (array $row) => $row['overdue'] > 0 || $row['percent'] < 100)
            ->sortByDesc('overdue')
            ->take($limit)
            ->values();
    }

    /**
     * Every individual overdue task, across everybody — what the daily
     * reminder digest actually lists, one row per item rather than per
     * employee.
     *
     * @return Collection<int, OnboardingTask>
     */
    public function overdueTasks(): Collection
    {
        return OnboardingTask::query()
            ->with('employee')
            ->where('status', 'Pending')
            ->whereNotNull('due_date')
            ->where('due_date', '<', now()->toDateString())
            ->get();
    }
}
