<?php

namespace Database\Seeders;

use App\Models\Account;
use Illuminate\Database\Seeder;

/**
 * The chart of accounts.
 *
 * Reference data, not transactional: a finance module with no accounts cannot
 * post anything, so this belongs beside the statutory rate tables rather than
 * with demo records. Balances are deliberately left at zero — an account's
 * balance is the sum of what has been posted to it, and seeding a figure would
 * make the very first trial balance a lie.
 *
 * Codes follow the ranges a Philippine SMB's external accountant expects:
 * 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expense.
 */
class ChartOfAccountsSeeder extends Seeder
{
    /** code, name, type, subtype, level, postable */
    private const ACCOUNTS = [
        ['1000', 'ASSETS', 'Asset', 'Header', 0, false],
        ['1100', 'Current Assets', 'Asset', 'Header', 1, false],
        ['1110', 'Cash on Hand', 'Asset', 'Cash', 2, true],
        ['1120', 'Cash in Bank — Operating', 'Asset', 'Cash', 2, true],
        ['1121', 'Cash in Bank — Payroll', 'Asset', 'Cash', 2, true],
        ['1130', 'Accounts Receivable — Trade', 'Asset', 'Receivable', 2, true],
        ['1135', 'Allowance for Doubtful Accounts', 'Asset', 'Contra-Asset', 2, true],
        ['1140', 'Merchandise Inventory', 'Asset', 'Inventory', 2, true],
        ['1145', 'Goods in Transit', 'Asset', 'Inventory', 2, true],
        ['1150', 'Input VAT', 'Asset', 'Tax', 2, true],
        ['1160', 'Prepaid Expenses', 'Asset', 'Prepayment', 2, true],
        ['1200', 'Non-Current Assets', 'Asset', 'Header', 1, false],
        ['1210', 'Property, Plant & Equipment', 'Asset', 'Fixed Asset', 2, true],
        ['1215', 'Accumulated Depreciation', 'Asset', 'Contra-Asset', 2, true],
        ['1220', 'Transportation Equipment', 'Asset', 'Fixed Asset', 2, true],

        ['2000', 'LIABILITIES', 'Liability', 'Header', 0, false],
        ['2110', 'Accounts Payable — Trade', 'Liability', 'Payable', 2, true],
        ['2120', 'Accrued Expenses', 'Liability', 'Payable', 2, true],
        ['2130', 'Output VAT', 'Liability', 'Tax', 2, true],
        ['2140', 'Withholding Tax Payable', 'Liability', 'Tax', 2, true],
        ['2150', 'SSS / PhilHealth / Pag-IBIG Payable', 'Liability', 'Statutory', 2, true],
        ['2210', 'Long-term Loans Payable', 'Liability', 'Loan', 2, true],

        ['3000', 'EQUITY', 'Equity', 'Header', 0, false],
        ['3110', 'Share Capital', 'Equity', 'Capital', 2, true],
        ['3120', 'Retained Earnings', 'Equity', 'Earnings', 2, true],

        ['4000', 'REVENUE', 'Revenue', 'Header', 0, false],
        ['4110', 'Sales — Trade', 'Revenue', 'Operating', 2, true],
        ['4120', 'Sales Returns & Allowances', 'Revenue', 'Contra-Revenue', 2, true],
        ['4130', 'Sales Discounts', 'Revenue', 'Contra-Revenue', 2, true],
        ['4200', 'Other Income', 'Revenue', 'Non-operating', 2, true],

        ['5000', 'EXPENSES', 'Expense', 'Header', 0, false],
        ['5110', 'Cost of Goods Sold', 'Expense', 'COGS', 2, true],
        ['5210', 'Salaries & Wages', 'Expense', 'Operating', 2, true],
        ['5220', 'Employee Benefits', 'Expense', 'Operating', 2, true],
        ['5230', 'Rent Expense', 'Expense', 'Operating', 2, true],
        ['5240', 'Utilities', 'Expense', 'Operating', 2, true],
        ['5250', 'Fuel & Transportation', 'Expense', 'Operating', 2, true],
        ['5260', 'Repairs & Maintenance', 'Expense', 'Operating', 2, true],
        ['5270', 'Depreciation Expense', 'Expense', 'Operating', 2, true],
        ['5280', 'Marketing & Advertising', 'Expense', 'Operating', 2, true],
        ['5290', 'Professional Fees', 'Expense', 'Operating', 2, true],
        ['5310', 'Interest Expense', 'Expense', 'Non-operating', 2, true],
    ];

    public function run(): void
    {
        foreach (self::ACCOUNTS as [$code, $name, $type, $subtype, $level, $postable]) {
            Account::updateOrCreate(
                ['code' => $code],
                [
                    'name' => $name,
                    'type' => $type,
                    'subtype' => $subtype,
                    'level' => $level,
                    'is_postable' => $postable,
                    // Assets and expenses increase on the debit side; everything
                    // else increases on the credit side.
                    'normal_balance' => in_array($type, ['Asset', 'Expense'], true) ? 'Debit' : 'Credit',
                    'is_active' => true,
                ],
            );
        }

        // Parents are wired afterwards so the rows can be created in any order.
        foreach (Account::all() as $account) {
            $parentCode = match (true) {
                $account->level === 0 => null,
                $account->level === 1 => substr($account->code, 0, 1).'000',
                // 1110 sits under 1100; 2110 under 2000, which has no
                // intermediate header of its own.
                default => Account::where('code', substr($account->code, 0, 2).'00')->exists()
                    ? substr($account->code, 0, 2).'00'
                    : substr($account->code, 0, 1).'000',
            };

            $parentId = $parentCode ? Account::where('code', $parentCode)->value('id') : null;

            if ($parentId && $parentId !== $account->id) {
                $account->forceFill(['parent_id' => $parentId])->save();
            }
        }
    }
}
