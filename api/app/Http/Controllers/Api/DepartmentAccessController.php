<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DepartmentAccessRule;
use App\Models\HrDepartment;
use App\Services\AuditLogger;
use App\Services\DepartmentAccessGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The mapping `DepartmentAccessGuard` reads: which nav departments each
 * real org-chart department may see.
 *
 * Deliberately one row per `HrDepartment`, upserted — there is no "create"
 * here distinct from "update", because every department already exists on
 * the org chart the moment it has employees; what is being edited is only
 * whether a rule for it has been set yet.
 */
class DepartmentAccessController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Every HR department, with its current rule (or none). */
    public function index(): JsonResponse
    {
        $departments = HrDepartment::with('accessRule')->orderBy('name')->get();

        return response()->json([
            'data' => [
                'departments' => $departments->map(fn (HrDepartment $d) => [
                    'id' => $d->id,
                    'code' => $d->code,
                    'name' => $d->name,
                    'allowedDepartments' => $d->accessRule->allowed_departments ?? [],
                    'seesAll' => (bool) ($d->accessRule->sees_all ?? false),
                    'configured' => $d->accessRule !== null,
                ])->values(),
                'availableDepartments' => DepartmentAccessGuard::DEPARTMENTS,
            ],
        ]);
    }

    public function update(Request $request, HrDepartment $hrDepartment): JsonResponse
    {
        $data = $request->validate([
            'allowedDepartments' => ['sometimes', 'array'],
            'allowedDepartments.*' => ['string', Rule::in(DepartmentAccessGuard::DEPARTMENTS)],
            'seesAll' => ['sometimes', 'boolean'],
        ]);

        $rule = DepartmentAccessRule::updateOrCreate(
            ['hr_department_id' => $hrDepartment->id],
            [
                'allowed_departments' => $data['allowedDepartments'] ?? [],
                'sees_all' => $data['seesAll'] ?? false,
            ],
        );

        $this->audit->log(
            'updated department access',
            'HrDepartment',
            $hrDepartment->id,
            $hrDepartment->name,
            'admin',
            ['allowedDepartments' => $rule->allowed_departments, 'seesAll' => $rule->sees_all],
        );

        return response()->json([
            'data' => [
                'id' => $hrDepartment->id,
                'allowedDepartments' => $rule->allowed_departments ?? [],
                'seesAll' => (bool) $rule->sees_all,
                'configured' => true,
            ],
        ]);
    }
}
