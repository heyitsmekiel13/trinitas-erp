<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\OvertimeRequest;
use App\Services\OvertimeRequests;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * An employee's own overtime pre-approval request, and a manager's decision.
 * Mirrors ResignationController/CoeController's self-service/HR split.
 */
class OvertimeController extends Controller
{
    public function __construct(private readonly OvertimeRequests $requests) {}

    public function submit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'workDate' => 'required|date',
            'expectedStartAt' => 'required|date',
            'expectedEndAt' => 'required|date|after:expectedStartAt',
            'reason' => 'nullable|string|max:2000',
        ]);

        try {
            $result = $this->requests->submit(
                $this->employee($request),
                $data['workDate'],
                $data['expectedStartAt'],
                $data['expectedEndAt'],
                $data['reason'] ?? null,
            );
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->present($result)], 201);
    }

    public function mine(Request $request): JsonResponse
    {
        $list = $this->requests->forEmployee($this->employee($request));

        return response()->json(['data' => $list->map(fn ($r) => $this->present($r))->values()]);
    }

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->requests->pending()->map(fn ($r) => $this->present($r))->values()]);
    }

    public function decide(Request $request, OvertimeRequest $overtime): JsonResponse
    {
        $data = $request->validate([
            'decision' => 'required|in:Approved,Declined',
            'note' => 'nullable|string|max:500',
        ]);

        try {
            $result = $this->requests->decide($overtime, $data['decision'], $request->user()?->id, $data['note'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->present($result)]);
    }

    private function employee(Request $request): Employee
    {
        $employee = $request->user()?->employee;

        if (! $employee) {
            throw ValidationException::withMessages([
                'employee' => 'This account is not linked to an employee record.',
            ]);
        }

        return $employee;
    }

    private function present(OvertimeRequest $r): array
    {
        $r->loadMissing(['employee.hrDepartment', 'decidedBy']);

        return [
            'id' => $r->id,
            'employeeId' => $r->employee_id,
            'employeeNo' => $r->employee->employee_no ?? null,
            'name' => $r->employee->full_name ?? null,
            'department' => $r->employee->hrDepartment->name ?? null,
            'workDate' => optional($r->work_date)->toDateString(),
            'expectedStartAt' => optional($r->expected_start_at)->toIso8601String(),
            'expectedEndAt' => optional($r->expected_end_at)->toIso8601String(),
            'expectedHours' => $r->expected_start_at && $r->expected_end_at
                ? round($r->expected_start_at->diffInMinutes($r->expected_end_at) / 60, 2)
                : null,
            'reason' => $r->reason,
            'status' => $r->status,
            'decidedBy' => $r->decidedBy->name ?? null,
            'decidedAt' => optional($r->decided_at)->toIso8601String(),
            'decisionNote' => $r->decision_note,
            'submittedAt' => optional($r->created_at)->toIso8601String(),
        ];
    }
}
