<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\OffboardingCase;
use App\Models\OffboardingTask;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The half of the employment lifecycle that used to just be a status flip.
 *
 * `initiate()` is the one place a separation actually starts a process:
 * property turnover, per-department clearance, access revocation, the COE,
 * and confirming Payroll actually has the final pay in hand — rather than an
 * employment_status column changing color with nothing behind it. Called from
 * two places by design: `EmployeeObserver` when the 201 file's status is set
 * to RESIGNED/TERMINATED directly, and `OffboardingController::initiate` when
 * HR starts the process ahead of the actual last day — which is how a
 * two-week notice period really works, and why the observer alone would
 * always be too late.
 */
class OffboardingOperations
{
    public function __construct(private readonly NotificationDispatcher $notifications) {}

    /**
     * @return list<array{key: string, category: string, title: string, description: string}>
     */
    public function template(): array
    {
        return [
            ['key' => 'notice_acknowledged', 'category' => 'Documentation', 'title' => 'Acknowledge resignation/termination notice',
                'description' => 'Signed notice or termination memo on file.'],
            ['key' => 'exit_interview', 'category' => 'Documentation', 'title' => 'Conduct exit interview',
                'description' => 'Reasons for leaving, and anything worth acting on.'],

            ['key' => 'return_property', 'category' => 'Property Turnover', 'title' => 'Return company property',
                'description' => 'ID, tools, uniform, keys, vehicle or any issued equipment.'],

            ['key' => 'revoke_access', 'category' => 'Access Revocation', 'title' => 'Revoke system access',
                'description' => 'Sign-in is suspended automatically on separation — confirm email and any third-party accounts are closed too.'],

            ['key' => 'clearance_hr', 'category' => 'Clearance', 'title' => 'HR clearance',
                'description' => 'No pending disciplinary matter or unacknowledged notice.'],
            ['key' => 'clearance_finance', 'category' => 'Clearance', 'title' => 'Finance clearance',
                'description' => 'No outstanding cash advance, loan balance or unliquidated expense.'],
            ['key' => 'clearance_department', 'category' => 'Clearance', 'title' => "Department head's clearance",
                'description' => 'No pending accountability with the immediate supervisor or department.'],

            ['key' => 'final_pay', 'category' => 'Finance', 'title' => 'Hand off final pay computation to Payroll',
                'description' => 'Last salary, pro-rated 13th month, unused leave conversion and any deductions.'],

            ['key' => 'coe_issued', 'category' => 'Documentation', 'title' => 'Issue Certificate of Employment',
                'description' => 'On request, per DOLE guidance — within three days of the request.'],
        ];
    }

    /**
     * Starts (or returns the existing) offboarding case for a separation.
     *
     * `firstOrCreate` on an open case — no `closed_at` — rather than always
     * creating one, so calling this from both the observer and a manual
     * "Initiate offboarding" action never produces two cases for the same
     * departure.
     */
    public function initiate(Employee $employee, string $reason, ?string $lastWorkingDay = null, ?int $initiatedBy = null): OffboardingCase
    {
        $case = OffboardingCase::where('employee_id', $employee->id)->whereNull('closed_at')->first();

        if ($case) {
            // Loaded via a query rather than created, so Eloquent's own flag
            // already reads false here — set explicitly anyway, because a
            // caller checking it (`OffboardingController::initiate`, to tell
            // an administrator re-clicking the button that nothing new
            // happened) should never depend on a default it did not choose.
            $case->wasRecentlyCreated = false;

            return $case;
        }

        // Case and checklist together, or neither — a case with half its
        // tasks missing would silently understate what clearance actually
        // requires.
        $case = DB::transaction(function () use ($employee, $reason, $initiatedBy, $lastWorkingDay) {
            $case = OffboardingCase::create([
                'employee_id' => $employee->id,
                'reason' => $reason,
                'initiated_by' => $initiatedBy,
                'last_working_day' => $lastWorkingDay,
            ]);

            foreach ($this->template() as $i => $task) {
                OffboardingTask::create([
                    'offboarding_case_id' => $case->id,
                    'key' => $task['key'],
                    'category' => $task['category'],
                    'title' => $task['title'],
                    'description' => $task['description'],
                    'sort_order' => $i,
                ]);
            }

            return $case;
        });

        // Outside the transaction, and only reached once it has committed —
        // a notice about a case that turned out not to exist is worse than
        // none.
        $this->notifyOpened($employee, $case);

        // `fresh()` re-queries, which is needed — `clearance_status` and
        // `final_pay_status` have no value in the insert (their DB defaults
        // supply it), so the in-memory object right after `create()` would
        // report them blank. But a re-queried instance is never
        // `wasRecentlyCreated`, so that has to be carried across by hand or
        // the one caller that reads it never sees a new case as new.
        return tap($case->fresh(), fn (OffboardingCase $fresh) => $fresh->wasRecentlyCreated = true);
    }

    /** @return array{items: list<OffboardingTask>, completion: array<string, mixed>} */
    public function forCase(OffboardingCase $case): array
    {
        $items = $case->tasks()->with('completedBy')->orderBy('sort_order')->get();

        return [
            'items' => $items->values()->all(),
            'completion' => $this->completion($items),
        ];
    }

    /** @param  Collection<int, OffboardingTask>  $items */
    private function completion(Collection $items): array
    {
        $total = max($items->count(), 1);
        $done = $items->where('status', 'Done')->count();

        return [
            'percent' => (int) round(($done / $total) * 100),
            'done' => $done,
            'total' => $items->count(),
        ];
    }

    /**
     * Every open case, oldest last-working-day first — the ones closest to
     * (or past) the door with clearance still outstanding.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function outstanding(int $limit = 50): Collection
    {
        $cases = OffboardingCase::query()
            ->with(['employee.hrDepartment', 'employee.branchUnit', 'tasks'])
            ->whereNull('closed_at')
            ->limit(200)
            ->get();

        return $cases
            ->map(function (OffboardingCase $case) {
                $completion = $this->completion($case->tasks);

                return [
                    'id' => $case->id,
                    'employeeId' => $case->employee_id,
                    'employeeNo' => $case->employee->employee_no ?? null,
                    'name' => $case->employee->full_name ?? null,
                    'department' => $case->employee->hrDepartment->name ?? null,
                    'branch' => $case->employee->branchUnit->name ?? null,
                    'reason' => $case->reason,
                    'lastWorkingDay' => optional($case->last_working_day)->toDateString(),
                    'clearanceStatus' => $case->clearance_status,
                    'finalPayStatus' => $case->final_pay_status,
                ] + $completion;
            })
            ->sortBy(fn (array $row) => $row['lastWorkingDay'] ?? '9999-99-99')
            ->take($limit)
            ->values();
    }

    /**
     * Every closed case, most recently closed first — `outstanding()`'s
     * `whereNull('closed_at')` means a case simply disappears from the board
     * the moment it is closed, with nowhere to look it up again afterwards.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function history(int $limit = 50): Collection
    {
        $cases = OffboardingCase::query()
            ->with(['employee.hrDepartment', 'employee.branchUnit'])
            ->whereNotNull('closed_at')
            ->orderByDesc('closed_at')
            ->limit($limit)
            ->get();

        return $cases->map(fn (OffboardingCase $case) => [
            'id' => $case->id,
            'employeeId' => $case->employee_id,
            'employeeNo' => $case->employee->employee_no ?? null,
            'name' => $case->employee->full_name ?? null,
            'department' => $case->employee->hrDepartment->name ?? null,
            'branch' => $case->employee->branchUnit->name ?? null,
            'reason' => $case->reason,
            'closedAt' => optional($case->closed_at)->toDateString(),
            // Older rows closed before `outcome` existed have none on file —
            // read as Completed rather than leaving a blank badge, since
            // that is what closing meant before this column did.
            'outcome' => $case->outcome ?? 'Completed',
            'cancelReason' => $case->cancel_reason,
        ])->values();
    }

    /**
     * Every case an employee has ever had, open or closed — what a Masterfile
     * record needs to say "there is history here" without a trip to the
     * standalone board.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function forEmployee(Employee $employee): Collection
    {
        return $employee->offboardingCases()
            ->withCount('tasks')
            ->latest('id')
            ->get()
            ->map(fn (OffboardingCase $case) => [
                'id' => $case->id,
                'reason' => $case->reason,
                'clearanceStatus' => $case->clearance_status,
                'finalPayStatus' => $case->final_pay_status,
                'lastWorkingDay' => optional($case->last_working_day)->toDateString(),
                'closedAt' => optional($case->closed_at)->toDateString(),
                'open' => $case->closed_at === null,
            ])
            ->values();
    }

    public function completeTask(OffboardingTask $task, ?int $userId): OffboardingTask
    {
        $task->update(['status' => 'Done', 'completed_by' => $userId, 'completed_at' => now()]);

        return $task->fresh(['completedBy']);
    }

    public function reopenTask(OffboardingTask $task): OffboardingTask
    {
        $task->update(['status' => 'Pending', 'completed_by' => null, 'completed_at' => null]);

        return $task->fresh();
    }

    /** @param  array<string, mixed>  $data */
    public function updateCase(OffboardingCase $case, array $data): OffboardingCase
    {
        $case->update(array_intersect_key($data, array_flip([
            'clearance_status', 'exit_interview_completed', 'final_pay_status', 'last_working_day', 'notes',
        ])));

        return $case->fresh();
    }

    /**
     * Closes a case once clearance, the exit interview and final pay are all
     * settled — refuses otherwise, the same reasoning `EmployeeProfile`
     * applies to signing off a 201 file: closing a case that is not actually
     * finished is how "cleared" stops meaning anything.
     */
    public function close(OffboardingCase $case): OffboardingCase
    {
        if ($case->clearance_status !== 'Cleared') {
            throw new \RuntimeException('Clearance is not marked Cleared yet.');
        }

        if ($case->final_pay_status !== 'Released') {
            throw new \RuntimeException('Final pay has not been marked Released yet.');
        }

        $case->update(['closed_at' => now(), 'outcome' => 'Completed']);

        return $case->fresh();
    }

    /**
     * Aborts a case that turns out not to be happening — the employee
     * rescinded, a termination was reconsidered, and so on. Deliberately
     * does not require `close()`'s Cleared/Released checks: a case that is
     * being called off was never going to finish those, and requiring it to
     * would make cancelling one impossible.
     *
     * Whatever tasks were or weren't done stay exactly as recorded — this
     * is not an undo of the clearance work, only a decision that the
     * process itself has stopped.
     *
     * @throws \RuntimeException when the case is already closed
     */
    public function cancel(OffboardingCase $case, string $reason, ?int $cancelledBy): OffboardingCase
    {
        if ($case->closed_at !== null) {
            throw new \RuntimeException('This case is already closed.');
        }

        $case->loadMissing('employee');

        $case->update(['closed_at' => now(), 'outcome' => 'Cancelled', 'cancel_reason' => $reason]);

        $this->notifications->dispatch(
            event: 'offboarding.cancelled',
            subject: "Offboarding cancelled — {$case->employee->full_name}",
            view: 'emails.offboarding-cancelled-internal',
            data: ['employee' => $case->employee, 'case' => $case],
            referenceType: 'OffboardingCase',
            referenceId: $case->id,
        );

        if ($case->employee->email) {
            $this->notifications->dispatchDirect(
                event: 'offboarding.cancelled-notice',
                to: $case->employee->email,
                subject: 'Your offboarding has been cancelled',
                view: 'emails.offboarding-cancelled-notice',
                data: ['employee' => $case->employee, 'case' => $case],
                referenceType: 'OffboardingCase',
                referenceId: $case->id,
            );
        }

        return $case->fresh();
    }

    /**
     * Tells the people who need to act, and tells the person leaving what to
     * expect — the two audiences a separation actually has.
     */
    private function notifyOpened(Employee $employee, OffboardingCase $case): void
    {
        $this->notifications->dispatch(
            event: 'offboarding.initiated',
            subject: "Offboarding started — {$employee->full_name}",
            view: 'emails.offboarding-internal',
            data: ['employee' => $employee, 'case' => $case],
            referenceType: 'OffboardingCase',
            referenceId: $case->id,
        );

        if ($employee->email) {
            $this->notifications->dispatchDirect(
                event: 'offboarding.exit-notice',
                to: $employee->email,
                subject: 'Your clearance checklist',
                view: 'emails.offboarding-exit-notice',
                data: ['employee' => $employee, 'case' => $case],
                referenceType: 'OffboardingCase',
                referenceId: $case->id,
            );
        }
    }
}
