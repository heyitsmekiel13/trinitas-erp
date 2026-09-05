<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

/**
 * What a scanned ID badge shows a stranger — no sign-in, on purpose.
 *
 * Deliberately narrow: only what was chosen as publicly disclosable (name,
 * photo, position, department, employee number, active/inactive). Salary,
 * contact details, address and every other 201-file field never reach this
 * controller at all, let alone this response — there is nothing here to
 * accidentally over-fetch.
 */
class PublicEmployeeController extends Controller
{
    public function show(string $token): JsonResponse
    {
        $employee = Employee::withTrashed()
            ->with(['hrDepartment', 'position'])
            ->where('public_id_token', $token)
            ->first();

        abort_unless($employee, 404, 'No badge matches this code.');

        return response()->json([
            'data' => [
                'name' => $employee->full_name,
                'employeeNo' => $employee->employee_no,
                'position' => $employee->position?->title,
                'department' => $employee->hrDepartment?->name,
                'status' => $employee->public_status,
                'photoUrl' => $employee->photo_path ? route('public-files.show', ['path' => $employee->photo_path]) : null,
            ],
        ]);
    }
}
