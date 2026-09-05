<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The three fields the real Pag-IBIG "PAGIBIG CONVERTER" upload template
 * asks for beyond what legal_entities already had (name, employer number,
 * address): ZIP code, telephone, and the HDMF branch code ("88 - Davao").
 * Real, employer-specific numbers — entered once here per legal entity
 * rather than typed again on every filing.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('legal_entities', function (Blueprint $table) {
            $table->string('zip_code', 12)->nullable()->after('address');
            $table->string('phone', 32)->nullable()->after('zip_code');
            $table->string('pagibig_branch_code', 64)->nullable()->after('pagibig_employer_no');
        });
    }

    public function down(): void
    {
        Schema::table('legal_entities', function (Blueprint $table) {
            $table->dropColumn(['zip_code', 'phone', 'pagibig_branch_code']);
        });
    }
};
