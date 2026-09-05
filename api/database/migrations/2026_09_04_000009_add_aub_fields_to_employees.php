<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two more columns the AUB workbook's ALPHALIST/AUB PAYROLL sheets carry
 * that this ERP had no home for: a standing allowance rate, and a bank code
 * for the rare employee paid into a bank other than AUB. Blank bank code is
 * the default and means exactly what it means on the template — a same-bank
 * AUB transfer.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->decimal('allowance_rate', 10, 2)->nullable()->after('salary');
            $table->string('bank_code', 20)->nullable()->after('atm_account');
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropColumn(['allowance_rate', 'bank_code']);
        });
    }
};
