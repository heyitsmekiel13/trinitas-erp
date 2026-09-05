<?php

namespace Database\Seeders;

use App\Models\DeductionType;
use Illuminate\Database\Seeder;

/**
 * The non-statutory deductions a Philippine payroll actually carries.
 *
 * Priority is the order they are collected in when a cut-off will not cover
 * everything. Government loans come first because they are obligations the
 * employer is remitting on the employee's behalf and cannot quietly skip;
 * company-owed amounts follow; discretionary items come last, since a canteen
 * tab deferring to next cut-off is the least harmful outcome.
 */
class DeductionTypeSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            ['code' => 'SSS-LOAN', 'name' => 'SSS Salary Loan', 'is_loan' => true, 'priority' => 10,
             'notes' => 'Remitted to SSS against the member loan.'],
            ['code' => 'SSS-CALAM', 'name' => 'SSS Calamity Loan', 'is_loan' => true, 'priority' => 15],
            ['code' => 'HDMF-MPL', 'name' => 'Pag-IBIG Multi-Purpose Loan', 'is_loan' => true, 'priority' => 20],
            ['code' => 'HDMF-CALAM', 'name' => 'Pag-IBIG Calamity Loan', 'is_loan' => true, 'priority' => 25],

            ['code' => 'COMPANY-LOAN', 'name' => 'Company Loan', 'is_loan' => true, 'priority' => 40],
            ['code' => 'CASH-ADVANCE', 'name' => 'Cash Advance (Vale)', 'is_loan' => true, 'priority' => 45],
            ['code' => 'UNIFORM', 'name' => 'Uniform', 'is_loan' => true, 'priority' => 50],
            ['code' => 'EQUIPMENT', 'name' => 'Equipment / Tools', 'is_loan' => true, 'priority' => 55],
            ['code' => 'SHORTAGE', 'name' => 'Cash Shortage', 'is_loan' => true, 'priority' => 60,
             'notes' => 'Requires the employee\'s written acknowledgement before it may be deducted.'],

            // Named to match the AUB payroll workbook's own charge columns —
            // added so an arrangement under one of these lands in that
            // column when the workbook is generated, instead of falling
            // into "Others". What each charge is *for* is a business
            // decision outside this system; this only gives it a place to be
            // itemised once it is entered.
            ['code' => 'OWNERSHIP-LOAN', 'name' => 'Ownership Loan', 'is_loan' => true, 'priority' => 65],
            ['code' => 'DISTRI-CHARGE', 'name' => 'Distribution Charges', 'is_loan' => false, 'priority' => 70],
            ['code' => 'COMMI-CHARGE', 'name' => 'Commission Charges', 'is_loan' => false, 'priority' => 72],
            ['code' => 'HOLDINGS-CHARGE', 'name' => 'Holdings Charges', 'is_loan' => false, 'priority' => 74],
            ['code' => 'RENT', 'name' => 'Rent', 'is_loan' => false, 'priority' => 76],

            ['code' => 'CANTEEN', 'name' => 'Canteen / Purchases', 'is_loan' => false, 'priority' => 80],
            ['code' => 'UNION-DUES', 'name' => 'Union Dues', 'is_loan' => false, 'priority' => 85],
            ['code' => 'HMO', 'name' => 'HMO Share', 'is_loan' => false, 'priority' => 90],
            ['code' => 'OTHER', 'name' => 'Other Deduction', 'is_loan' => false, 'priority' => 100],
        ];

        foreach ($types as $type) {
            DeductionType::updateOrCreate(['code' => $type['code']], $type + ['is_active' => true]);
        }
    }
}
