<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `HOLD PAYROLL` and `Retro adjustment` on the AUB workbook — genuinely new
 * figures, not derivable from anything already on a payslip. `hold_amount`
 * is what stays behind when this cut-off releases; it is read by the AUB
 * export and by nothing in the payslip's own gross/net arithmetic, which is
 * deliberate — a hold changes what goes out the door, not what was earned.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->decimal('hold_amount', 12, 2)->default(0)->after('net_pay');
            $table->decimal('retro_adjustment', 12, 2)->default(0)->after('hold_amount');
        });
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn(['hold_amount', 'retro_adjustment']);
        });
    }
};
