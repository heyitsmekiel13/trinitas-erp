<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\ResignationRequest;
use App\Services\ResignationRequests;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * An employee's own resignation request, and HR's decision on it.
 *
 * `submit`/`mine` are self-service — the employee is resolved from the
 * signed-in account, the same way `HrController::fileLeave` never takes an
 * employee id. `index`/`decide` are HR's side, mirroring `OffboardingController`.
 */
class ResignationController extends Controller
{
    public function __construct(private readonly ResignationRequests $requests) {}

    public function submit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'intendedLastDay' => 'required|date|after:today',
            'reason' => 'nullable|string|max:2000',
        ]);

        try {
            $result = $this->requests->submit($this->employee($request), $data['intendedLastDay'], $data['reason'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->present($result)], 201);
    }

    public function mine(Request $request): JsonResponse
    {
        $latest = $this->requests->latestFor($this->employee($request));

        return response()->json(['data' => $latest ? $this->present($latest) : null]);
    }

    public function cancel(Request $request): JsonResponse
    {
        try {
            $result = $this->requests->cancel($this->employee($request));
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->present($result)]);
    }

    public function index(): JsonResponse
    {
        return response()->json(['data' => $this->requests->pending()->map(fn ($r) => $this->present($r))->values()]);
    }

    public function decide(Request $request, ResignationRequest $resignation): JsonResponse
    {
        $data = $request->validate([
            'decision' => 'required|in:Approved,Declined',
            'note' => 'nullable|string|max:500',
        ]);

        try {
            $result = $this->requests->decide($resignation, $data['decision'], $request->user()?->id, $data['note'] ?? null);
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

    private function present(ResignationRequest $r): array
    {
        $r->loadMissing(['employee.hrDepartment', 'decidedBy']);

        return [
            'id' => $r->id,
            'employeeId' => $r->employee_id,
            'employeeNo' => $r->employee->employee_no ?? null,
            'name' => $r->employee->full_name ?? null,
            'department' => $r->employee->hrDepartment->name ?? null,
            'intendedLastDay' => optional($r->intended_last_day)->toDateString(),
            'reason' => $r->reason,
            'status' => $r->status,
            'decidedBy' => $r->decidedBy->name ?? null,
            'decidedAt' => optional($r->decided_at)->toIso8601String(),
            'decisionNote' => $r->decision_note,
            'offboardingCaseId' => $r->offboarding_case_id,
            'submittedAt' => optional($r->created_at)->toIso8601String(),
        ];
    }
}
