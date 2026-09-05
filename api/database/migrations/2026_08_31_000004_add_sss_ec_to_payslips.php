<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SSS's Employees' Compensation contribution — ₱10 or ₱30 a month per
 * employee depending on salary credit, employer-paid, and legally a
 * separate remittance line from the regular SSS employer share (see
 * `sss_brackets.employer_ec`, seeded and already correct — this is the
 * first migration to actually give a payslip somewhere to put it).
 *
 * `PayrollEngine` already folded it into `employer_cost` silently, so the
 * money was never wrong — only invisible. Every SSS-facing figure downstream
 * (the payslip, the remittance schedule, the run header) read `sss_employer`
 * alone and under-stated what SSS actually expects by exactly this amount.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->decimal('sss_ec', 12, 2)->default(0)->after('sss_employer');
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn('sss_ec');
        });
    }
};
