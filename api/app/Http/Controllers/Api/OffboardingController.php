<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\OffboardingCase;
use App\Models\OffboardingTask;
use App\Services\OffboardingOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The clearance process a separation starts, worked from here.
 *
 * `initiate` is the front door most cases should come through — HR starting
 * the process the day notice is given, ahead of the employment_status flip
 * that `EmployeeObserver` also watches for as a safety net. Both call the
 * same `OffboardingOperations::initiate()`, so neither path can produce two
 * cases for the same departure.
 */
class OffboardingController extends Controller
{
    public function __construct(private readonly OffboardingOperations $offboarding) {}

    /** Every open case, closest last-working-day first — the offboarding board. */
    public function index(): JsonResponse
    {
        $rows = $this->offboarding->outstanding();

        return response()->json([
            'data' => [
                'cases' => $rows,
                'counts' => [
                    'total' => $rows->count(),
                    'pendingClearance' => $rows->where('clearanceStatus', '!=', 'Cleared')->count(),
                    'pendingFinalPay' => $rows->where('finalPayStatus', '!=', 'Released')->count(),
                ],
            ],
        ]);
    }

    public function history(): JsonResponse
    {
        return response()->json(['data' => $this->offboarding->history()]);
    }

    /** Every case an employee has ever had — the Masterfile record's own view. */
    public function forEmployee(Employee $employee): JsonResponse
    {
        return response()->json(['data' => $this->offboarding->forEmployee($employee)]);
    }

    public function initiate(Request $request, Employee $employee): JsonResponse
    {
        $data = $request->validate([
            'reason' => 'required|in:Resignation,Termination,End of Contract,Retirement',
            'lastWorkingDay' => 'nullable|date',
        ]);

        $case = $this->offboarding->initiate(
            $employee,
            $data['reason'],
            $data['lastWorkingDay'] ?? null,
            $request->user()?->id,
        );

        return $this->show($case);
    }

    public function show(OffboardingCase $case): JsonResponse
    {
        $case->loadMissing(['employee.hrDepartment', 'employee.branchUnit', 'initiatedBy']);

        return response()->json([
            'data' => [
                'id' => $case->id,
                'employeeId' => $case->employee_id,
                'employeeNo' => $case->employee->employee_no,
                'name' => $case->employee->full_name,
                'department' => $case->employee->hrDepartment->name ?? null,
                'branch' => $case->employee->branchUnit->name ?? null,
                'reason' => $case->reason,
                'initiatedBy' => $case->initiatedBy->name ?? null,
                'lastWorkingDay' => optional($case->last_working_day)->toDateString(),
                'clearanceStatus' => $case->clearance_status,
                'exitInterviewCompleted' => $case->exit_interview_completed,
                'finalPayStatus' => $case->final_pay_status,
                'notes' => $case->notes,
                'closedAt' => optional($case->closed_at)->toIso8601String(),
                'outcome' => $case->outcome,
                'cancelReason' => $case->cancel_reason,
                // Meaningful only right after `initiate` — true there means
                // this call found a case already open rather than starting
                // one, so a re-click of "Initiate offboarding" reads as "was
                // already in progress" instead of looking like a no-op.
                'wasAlreadyOpen' => ! $case->wasRecentlyCreated,
            ] + $this->offboarding->forCase($case),
        ]);
    }

    public function update(Request $request, OffboardingCase $case): JsonResponse
    {
        $data = $request->validate([
            'clearance_status' => 'sometimes|in:Pending,In Progress,Cleared',
            'exit_interview_completed' => 'sometimes|boolean',
            'final_pay_status' => 'sometimes|in:Pending,Processing,Released',
            'last_working_day' => 'sometimes|nullable|date',
            'notes' => 'sometimes|nullable|string|max:2000',
        ]);

        return $this->show($this->offboarding->updateCase($case, $data));
    }

    public function close(OffboardingCase $case): JsonResponse
    {
        try {
            $this->offboarding->close($case);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->show($case->fresh());
    }

    public function cancel(Request $request, OffboardingCase $case): JsonResponse
    {
        $data = $request->validate([
            'reason' => 'required|string|max:500',
        ]);

        try {
            $this->offboarding->cancel($case, $data['reason'], $request->user()?->id);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->show($case->fresh());
    }

    public function completeTask(Request $request, OffboardingTask $task): JsonResponse
    {
        $this->offboarding->completeTask($task, $request->user()?->id);

        return $this->show($task->offboardingCase);
    }

    public function reopenTask(OffboardingTask $task): JsonResponse
    {
        $this->offboarding->reopenTask($task);

        return $this->show($task->offboardingCase);
    }
}
