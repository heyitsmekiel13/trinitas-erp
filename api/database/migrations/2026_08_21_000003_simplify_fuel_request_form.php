<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the two fields nobody fills in.
 *
 * `form_no` and `fpof_control_no` came straight off the paper pad, and on
 * paper they earn their place: the serial is pre-printed so a torn-off sheet
 * can be matched to its book, and the control number is how Finance files it.
 *
 * Neither survives the move off paper. The system already issues its own
 * reference (FR-2026-0003) which is unique, sequential and impossible to
 * mistype, so the pad serial is a second identity for the same document — and
 * a second identity is a reconciliation problem, not a feature. The control
 * number was blank on every request raised so far, which is the usual fate of
 * a field that exists because the form has always had it.
 *
 * The department the request is charged to replaces both in usefulness, and
 * that one is now filled in automatically.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            $table->dropColumn(['form_no', 'fpof_control_no']);
        });
    }

    public function down(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            $table->string('form_no', 24)->nullable()->after('reference');
            $table->string('fpof_control_no', 32)->nullable()->after('form_no');
        });
    }
};
