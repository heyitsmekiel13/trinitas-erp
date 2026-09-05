<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Two gaps in the same story: an employee who filed a resignation and
 * changed their mind before HR decided had no way to say so, and HR had no
 * way to close out an offboarding case that turns out not to be happening —
 * `OffboardingOperations::close()` only ever means "clearance finished",
 * and refuses to run until it actually has. `outcome` is what lets history
 * tell a completed separation apart from an aborted one; `Cancelled` on the
 * resignation itself is the employee's own withdrawal, distinct from `Declined`
 * (HR said no) — the record should be able to say which one happened.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE resignation_requests MODIFY status ENUM('Pending','Approved','Declined','Cancelled') NOT NULL DEFAULT 'Pending'");

        Schema::table('offboarding_cases', function (Blueprint $table) {
            $table->enum('outcome', ['Completed', 'Cancelled'])->nullable()->after('closed_at');
            $table->string('cancel_reason', 500)->nullable()->after('outcome');
        });
    }

    public function down(): void
    {
        Schema::table('offboarding_cases', function (Blueprint $table) {
            $table->dropColumn(['outcome', 'cancel_reason']);
        });

        DB::statement("ALTER TABLE resignation_requests MODIFY status ENUM('Pending','Approved','Declined') NOT NULL DEFAULT 'Pending'");
    }
};
