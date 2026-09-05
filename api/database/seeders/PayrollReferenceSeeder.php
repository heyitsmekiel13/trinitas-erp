<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the company's real operating structure and the statutory rate tables.
 *
 * Reference rows come from the AUB payroll masterfile the client provided.
 * Obvious typos in that file (PANDERO, ACOUNTING MANAGER, AREA ASUPERVISOR)
 * are deliberately NOT seeded — the importer flags them so they get corrected
 * at source rather than becoming permanent duplicate records.
 */
class PayrollReferenceSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        /* ------------------------------ Groups ------------------------------ */
        $groups = ['PANADERO' => 'Panadero (JBYL)', 'PREMIUM KITCHEN EQUIPMENT' => 'Premium Kitchen Equipment', 'SMART HOME' => 'Smart Home'];
        foreach ($groups as $code => $name) {
            DB::table('business_groups')->updateOrInsert(
                ['code' => $code],
                ['name' => $name, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            );
        }
        $groupIds = DB::table('business_groups')->pluck('id', 'code');

        /* ---------------------------- Departments --------------------------- */
        foreach (['JBYL', 'ACCOUNTING', 'WAREHOUSE', 'OPERATIONS', 'HR DEPARTMENT', 'MAINTENANCE', 'PROCUREMENT', 'SALES', 'PERFORMANCE AND PROCESS'] as $dept) {
            DB::table('hr_departments')->updateOrInsert(
                ['code' => $dept],
                ['name' => $dept, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            );
        }

        /* ------------------------------ Branches ---------------------------- */
        $jbylBranches = [
            'AGTON', 'BALIOK', 'BANSALAN', 'CABANTIAN', 'CORONON', 'CROSSING BAYABAS', 'DIGOS APLAYA',
            'KAPUTIAN', 'KM 5 BUHANGIN', 'MAKILALA 1', 'MAKILALA 2', 'MANDUG', 'MIDSAYAP', 'MLANG',
            'OPERATIONS', 'PADADA', 'PEÑAPLATA 1', 'PEÑAPLATA 2', 'SAMAL 1', 'SAMAL 2', 'SAN ANTONIO',
            'SANDAWA', 'SOUTH 1', 'SOUTH 2', 'SULOP', 'SUNSCOR', 'TORIL',
        ];
        foreach ($jbylBranches as $branch) {
            DB::table('branch_units')->updateOrInsert(
                ['code' => "JBYL-{$branch}"],
                [
                    'name' => "JBYL {$branch}",
                    'business_group_id' => $groupIds['PANADERO'],
                    'is_active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            );
        }
        DB::table('branch_units')->updateOrInsert(
            ['code' => 'PKE'],
            ['name' => 'Premium Kitchen Equipment', 'business_group_id' => $groupIds['PREMIUM KITCHEN EQUIPMENT'], 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
        );
        DB::table('branch_units')->updateOrInsert(
            ['code' => 'SMART HOMES'],
            ['name' => 'Smart Homes', 'business_group_id' => $groupIds['SMART HOME'], 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
        );

        /* ------------------------------ Positions --------------------------- */
        $positions = [
            // title => [level, managerial]
            'CASHIER' => [1, false], 'TRAINEE CASHIER' => [1, false], 'CASHIER LIBOTER' => [1, false],
            'BAKER' => [1, false], 'TRAINEE BAKER' => [1, false], 'HEAD BAKER' => [1, false],
            'CREW TRAINER' => [1, false], 'TEAM LEADER' => [1, false], 'TRAINEE TL' => [1, false],
            'BRANCH TECHNICIAN' => [1, false], 'WAREHOUSE PERSONNEL' => [1, false], 'SERVICE TECHNICIAN' => [1, false],
            'AREA SUPERVISOR' => [2, true], 'AUDIT SUPERVISOR' => [2, true], 'ACCOUNTING SUPERVISOR' => [2, true],
            'TECHNICAL SUPERVISOR' => [2, true], 'WAREHOUSE SUPERVISOR' => [2, true],
            'TRAINING AND DEVELOPMENT SUPERVISOR' => [2, true], 'ACCOUNTING HEAD' => [2, true],
            'HR COMPENSATION AND BENEFITS OFFICER' => [2, true],
            'AREA MANAGER' => [3, true], 'OPERATION MANAGER' => [3, true], 'ACCOUNTING MANAGER' => [3, true],
            'HR MANAGER' => [3, true], 'SALES MANAGER' => [3, true], 'PROCUREMENT MANAGER' => [3, true],
            'BUSINESS DEVELOPMENT MANAGER' => [3, true], 'QMS TRAINING MANAGER' => [3, true],
            'PERFORMANCE AND PROCESS MANAGER' => [3, true],
            'TRAINING & DEVELOPMENT COMPLIANCE MANAGER' => [3, true],
        ];
        foreach ($positions as $title => [$level, $managerial]) {
            DB::table('positions')->updateOrInsert(
                ['title' => $title],
                ['level' => $level, 'is_managerial' => $managerial, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            );
        }

        /* --------------------------- Payroll groups ------------------------- */
        $payrollGroups = [
            ['code' => 'TOP MANAGEMENT', 'name' => 'Top Management', 'confidential' => true],
            ['code' => 'PANADERO RANK AND FILE', 'name' => 'Panadero Rank and File', 'confidential' => false],
            ['code' => 'PKE RANK AND FILE', 'name' => 'PKE Rank and File', 'confidential' => false],
        ];
        foreach ($payrollGroups as $group) {
            DB::table('payroll_groups')->updateOrInsert(
                ['code' => $group['code']],
                [
                    'name' => $group['name'],
                    'frequency' => 'S',
                    'statutory_schedule' => 'second',
                    'is_confidential' => $group['confidential'],
                    'is_active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            );
        }

        $this->seedStatutory($now);
    }

    /** Rates in force as of the 2026 payroll year. */
    private function seedStatutory($now): void
    {
        $effective = '2025-01-01';

        $settings = [
            'SSS' => [
                'reference' => 'SSS Circular 2024-006',
                'config' => [
                    'total_rate' => 0.15, 'employee_rate' => 0.05, 'employer_rate' => 0.10,
                    'msc_floor' => 5000, 'msc_ceiling' => 35000, 'msc_step' => 500,
                    'ec_floor' => 10, 'ec_ceiling' => 30, 'ec_threshold' => 15000,
                    'wisp_threshold' => 20000,
                ],
            ],
            'PHILHEALTH' => [
                'reference' => 'UHC Act RA 11223 premium schedule',
                'config' => ['rate' => 0.05, 'floor' => 10000, 'ceiling' => 100000, 'employee_share' => 0.5],
            ],
            'PAGIBIG' => [
                'reference' => 'HDMF Circular 460',
                'config' => [
                    'max_fund_salary' => 10000, 'lower_bracket' => 1500,
                    'employee_rate_low' => 0.01, 'employee_rate_high' => 0.02, 'employer_rate' => 0.02,
                ],
            ],
            'BIR' => [
                'reference' => 'BIR RR 8-2018 (TRAIN), table effective 2023-01-01',
                'config' => ['minimum_wage_exempt' => true, 'thirteenth_month_exclusion' => 90000],
            ],
        ];

        $birId = null;
        foreach ($settings as $agency => $data) {
            DB::table('statutory_settings')->updateOrInsert(
                ['agency' => $agency, 'effective_from' => $effective],
                [
                    'reference' => $data['reference'],
                    'config' => json_encode($data['config']),
                    'is_active' => true,
                    'created_at' => $now,
                    'updated_at' => $now,
                ],
            );
            if ($agency === 'BIR') {
                $birId = DB::table('statutory_settings')
                    ->where('agency', 'BIR')->where('effective_from', $effective)->value('id');
            }
        }

        /* Withholding tax table, TRAIN Law, effective 1 January 2023. */
        $tables = [
            'daily' => [[0, 0, 0], [685, 0, 0.15], [1096, 61.65, 0.20], [2192, 280.85, 0.25], [5479, 1102.60, 0.30], [21918, 6034.30, 0.35]],
            'weekly' => [[0, 0, 0], [4808, 0, 0.15], [7692, 432.60, 0.20], [15385, 1971.20, 0.25], [38462, 7740.45, 0.30], [153846, 42355.65, 0.35]],
            'semi-monthly' => [[0, 0, 0], [10417, 0, 0.15], [16667, 937.50, 0.20], [33333, 4270.70, 0.25], [83333, 16770.70, 0.30], [333333, 91770.70, 0.35]],
            'monthly' => [[0, 0, 0], [20833, 0, 0.15], [33333, 1875.00, 0.20], [66667, 8541.80, 0.25], [166667, 33541.80, 0.30], [666667, 183541.80, 0.35]],
        ];

        DB::table('withholding_brackets')->where('statutory_setting_id', $birId)->delete();
        foreach ($tables as $frequency => $brackets) {
            foreach ($brackets as $i => [$over, $baseTax, $rate]) {
                DB::table('withholding_brackets')->insert([
                    'statutory_setting_id' => $birId,
                    'frequency' => $frequency,
                    'bracket' => $i + 1,
                    'over' => $over,
                    'base_tax' => $baseTax,
                    'rate' => $rate,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }

        /* SSS ladder, generated from the circular's rules rather than typed. */
        $sssId = DB::table('statutory_settings')->where('agency', 'SSS')->where('effective_from', $effective)->value('id');
        DB::table('sss_brackets')->where('statutory_setting_id', $sssId)->delete();

        $rows = [];
        for ($msc = 5000; $msc <= 35000; $msc += 500) {
            $from = $msc === 5000 ? 0 : $msc - 250;
            $to = $msc === 35000 ? null : $msc + 249.99;
            $rows[] = [
                'statutory_setting_id' => $sssId,
                'compensation_from' => $from,
                'compensation_to' => $to,
                'salary_credit' => $msc,
                'employee_share' => round($msc * 0.05, 2),
                'employer_share' => round($msc * 0.10, 2),
                'employer_ec' => $msc >= 15000 ? 30 : 10,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 50) as $chunk) {
            DB::table('sss_brackets')->insert($chunk);
        }
    }
}
