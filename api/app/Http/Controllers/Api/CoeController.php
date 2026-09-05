<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CoeRequest;
use App\Models\Employee;
use App\Services\CoeDocuments;
use App\Services\CoeRequests;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * An employee's own Certificate of Employment request, and HR's decision.
 *
 * Mirrors ResignationController's self-service/HR split. `document` only
 * ever serves an already-Issued certificate — generating one for a request
 * HR hasn't approved would put an unauthorized certificate in an
 * employee's hands.
 */
class CoeController extends Controller
{
    public function __construct(
        private readonly CoeRequests $requests,
        private readonly CoeDocuments $documents,
    ) {}

    public function submit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'purpose' => 'nullable|string|max:190',
            'includeSalary' => 'boolean',
            'type' => 'nullable|in:Employment,No Derogatory Record',
        ]);

        try {
            $result = $this->requests->submit(
                $this->employee($request),
                $data['purpose'] ?? null,
                (bool) ($data['includeSalary'] ?? false),
                $data['type'] ?? 'Employment',
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

    public function decide(Request $request, CoeRequest $coe): JsonResponse
    {
        $data = $request->validate([
            'decision' => 'required|in:Issued,Declined',
            'note' => 'nullable|string|max:500',
        ]);

        try {
            $result = $this->requests->decide($coe, $data['decision'], $request->user()?->id, $data['note'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['data' => $this->present($result)]);
    }

    public function document(CoeRequest $coe): JsonResponse|Response
    {
        return $this->buildDocument($coe);
    }

    /** Same document, but only the employee it belongs to may fetch it this way. */
    public function myDocument(Request $request, CoeRequest $coe): JsonResponse|Response
    {
        if ($coe->employee_id !== $this->employee($request)->id) {
            abort(404);
        }

        return $this->buildDocument($coe);
    }

    private function buildDocument(CoeRequest $coe): JsonResponse|Response
    {
        if ($coe->status !== 'Issued') {
            abort(404);
        }

        try {
            $file = $this->documents->certificate($coe);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response($file['bytes'], 200, [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
            'Content-Length' => (string) strlen($file['bytes']),
        ]);
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

    private function present(CoeRequest $r): array
    {
        $r->loadMissing(['employee.hrDepartment', 'decidedBy']);

        return [
            'id' => $r->id,
            'type' => $r->type,
            'employeeId' => $r->employee_id,
            'employeeNo' => $r->employee->employee_no ?? null,
            'name' => $r->employee->full_name ?? null,
            'department' => $r->employee->hrDepartment->name ?? null,
            'purpose' => $r->purpose,
            'includeSalary' => $r->include_salary,
            'status' => $r->status,
            'decidedBy' => $r->decidedBy->name ?? null,
            'decidedAt' => optional($r->decided_at)->toIso8601String(),
            'decisionNote' => $r->decision_note,
            'submittedAt' => optional($r->created_at)->toIso8601String(),
        ];
    }
}
