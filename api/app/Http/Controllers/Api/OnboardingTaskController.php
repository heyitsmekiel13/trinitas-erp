<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\OnboardingTask;
use App\Services\OnboardingTasks;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The new-hire checklist: what is on it, and marking an item done.
 *
 * Sibling to `OnboardingController` and `EmployeeDocumentController` — that
 * one answers "is the 201 file's data complete", this one answers "has this
 * new hire actually gone through onboarding". Generation happens once, from
 * `RecruitmentOperations::hire()`; this controller only ever reads the
 * checklist and ticks items off it.
 */
class OnboardingTaskController extends Controller
{
    public function __construct(private readonly OnboardingTasks $tasks) {}

    public function index(Employee $employee): JsonResponse
    {
        return response()->json([
            'data' => [
                'employeeId' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
            ] + $this->tasks->forEmployee($employee),
        ]);
    }

    public function outstanding(): JsonResponse
    {
        $rows = $this->tasks->outstanding();

        return response()->json([
            'data' => [
                'employees' => $rows,
                'counts' => [
                    'total' => $rows->count(),
                    'overdue' => $rows->where('overdue', '>', 0)->count(),
                ],
            ],
        ]);
    }

    public function complete(Request $request, OnboardingTask $task): JsonResponse
    {
        $task->update([
            'status' => 'Done',
            'completed_by' => $request->user()?->id,
            'completed_at' => now(),
        ]);

        return response()->json(['data' => $task->fresh(['completedBy'])]);
    }

    public function reopen(OnboardingTask $task): JsonResponse
    {
        $task->update(['status' => 'Pending', 'completed_by' => null, 'completed_at' => null]);

        return response()->json(['data' => $task->fresh()]);
    }
}
