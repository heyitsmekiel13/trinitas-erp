<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Everything a fresh install needs to be usable: access control, the company's
 * operating structure, and the statutory rate tables.
 *
 * Deliberately contains no transactional data — a new system should start
 * empty and be filled by real work, not by demo records that later have to be
 * hunted down and deleted.
 */
class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->call([
            PlatformSeeder::class,
            PayrollReferenceSeeder::class,
            DeductionTypeSeeder::class,
            ChartOfAccountsSeeder::class,
            HrReferenceSeeder::class,
            DocumentTypeSeeder::class,
            ApprovalRuleSeeder::class,
        ]);
    }
}
