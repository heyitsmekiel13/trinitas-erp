<?php

namespace Database\Seeders;

use App\Models\ApprovalRule;
use App\Models\Role;
use Illuminate\Database\Seeder;

/**
 * A starting approval matrix.
 *
 * These thresholds were previously a hardcoded list on the Admin screen — they
 * looked like configuration but nothing could be changed and nothing enforced
 * them. Seeding them makes the same defaults real and editable.
 *
 * Routed to roles rather than named people on purpose: staff change, and an
 * approval chain pointing at somebody who left is how a document gets stuck.
 */
class ApprovalRuleSeeder extends Seeder
{
    /** document type, name, from, to (null = no ceiling), step, role code */
    private const RULES = [
        ['purchase_requisition', 'Requisitions up to 100k — department head', 0, 100000, 1, 'procurement-manager'],
        ['purchase_requisition', 'Requisitions over 100k — procurement manager', 100000.01, 500000, 2, 'procurement-manager'],
        ['purchase_requisition', 'Requisitions over 500k — finance manager', 500000.01, null, 3, 'finance-manager'],

        ['purchase_order', 'All purchase orders — procurement manager', 0, null, 1, 'procurement-manager'],

        ['sales_order', 'Orders over credit limit — sales manager', 0, null, 1, 'sales-manager'],

        ['stock_transfer', 'Inter-branch transfers — warehouse manager', 0, null, 1, 'warehouse-manager'],
        ['cycle_count', 'Count variances over 50k — warehouse manager', 50000.01, null, 1, 'warehouse-manager'],

        ['work_order', 'Parts cost over 25k — maintenance manager', 25000.01, null, 1, 'maintenance-manager'],

        ['journal_entry', 'Manual journals — accountant', 0, null, 1, 'accountant'],
        ['journal_entry', 'Manual journals — finance manager', 0, null, 2, 'finance-manager'],

        ['expense_claim', 'Claims over 10k — accountant', 10000.01, null, 1, 'accountant'],

        ['leave_request', 'Leave up to 3 days — HR officer', 0, 3, 1, 'hr-officer'],
        ['leave_request', 'Leave over 3 days — HR manager', 3.01, null, 2, 'hr-manager'],

        ['payroll_run', 'Every payroll run — HR manager', 0, null, 1, 'hr-manager'],
        ['payroll_run', 'Every payroll run — finance manager', 0, null, 2, 'finance-manager'],
    ];

    public function run(): void
    {
        $roles = Role::pluck('id', 'code');

        foreach (self::RULES as [$type, $name, $min, $max, $step, $roleCode]) {
            ApprovalRule::updateOrCreate(
                ['document_type' => $type, 'name' => $name],
                [
                    'min_amount' => $min,
                    'max_amount' => $max,
                    'step' => $step,
                    'approver_role_id' => $roles[$roleCode] ?? null,
                    'is_active' => true,
                ],
            );
        }
    }
}
