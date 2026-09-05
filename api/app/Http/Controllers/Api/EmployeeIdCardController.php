<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * The company ID badge: a photo, the 201-file basics, and a QR code that
 * resolves to {@see PublicEmployeeController} — publicly viewable, so anyone
 * who scans it can confirm the person still works here without calling HR.
 *
 * The photo lives on the `public` disk, unlike 201-file documents (`local`
 * — see EmployeeDocumentController): a badge photo is meant to be shown to
 * whoever scans the card, so "public" here is the correct sensitivity, not
 * a shortcut around it.
 */
class EmployeeIdCardController extends Controller
{
    private const MAX_KILOBYTES = 4096; // 4MB — a phone photo, generously.

    private const MIMES = 'jpg,jpeg,png,webp';

    public function __construct(private readonly AuditLogger $audit) {}

    /** Everything the card designer needs to lay out one badge. */
    public function show(Employee $employee): JsonResponse
    {
        $employee->loadMissing(['hrDepartment', 'position', 'branchUnit']);

        return response()->json(['data' => $this->present($employee)]);
    }

    public function uploadPhoto(Request $request, Employee $employee): JsonResponse
    {
        $request->validate([
            'photo' => ['required', 'image', 'mimes:'.self::MIMES, 'max:'.self::MAX_KILOBYTES],
        ]);

        $path = $request->file('photo')->store("employee-photos/{$employee->id}", 'public');

        if ($employee->photo_path && Storage::disk('public')->exists($employee->photo_path)) {
            Storage::disk('public')->delete($employee->photo_path);
        }

        $employee->update(['photo_path' => $path]);
        $this->audit->log('updated ID photo', 'Employee', $employee->id, $employee->full_name, 'hr');

        return response()->json(['data' => $this->present($employee->fresh(['hrDepartment', 'position', 'branchUnit']))]);
    }

    /** Invalidates every badge printed so far — the lost/compromised-card action. */
    public function regenerateToken(Employee $employee): JsonResponse
    {
        $employee->public_id_token = null;
        $employee->ensurePublicToken();

        $this->audit->log('reissued ID badge QR code', 'Employee', $employee->id, $employee->full_name, 'hr');

        return response()->json(['data' => $this->present($employee->fresh(['hrDepartment', 'position', 'branchUnit']))]);
    }

    private function present(Employee $employee): array
    {
        return [
            'id' => $employee->id,
            'employeeNo' => $employee->employee_no,
            'name' => $employee->full_name,
            'position' => $employee->position?->title,
            'department' => $employee->hrDepartment?->name,
            'branch' => $employee->branchUnit?->name,
            'status' => $employee->public_status,
            'photoUrl' => $employee->photo_path ? route('public-files.show', ['path' => $employee->photo_path]) : null,
            'publicToken' => $employee->ensurePublicToken(),
        ];
    }
}
