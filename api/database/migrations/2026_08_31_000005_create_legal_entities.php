<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The registered employer of record — distinct from `business_groups`.
 *
 * A business group (Panadero, Premium Kitchen Equipment, Smart Home) is the
 * operating brand somebody works under; a legal entity is which company's
 * SSS/PhilHealth/Pag-IBIG/BIR registration their contributions are actually
 * filed against. This company runs payroll across several registered
 * employers (its own statutory filings are organised exactly this way,
 * one folder per entity) — the two axes do not line up one-to-one, so this
 * cannot be folded into `business_groups` without losing information.
 *
 * Nullable on `employees` deliberately: an employee with no entity assigned
 * yet is unconfigured, not invalid, and simply will not appear on any
 * per-entity statutory schedule until someone sets it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('legal_entities', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150)->unique();
            $table->string('legal_name', 190)->nullable();
            $table->string('tin', 32)->nullable();
            $table->string('sss_employer_no', 32)->nullable();
            $table->string('philhealth_employer_no', 32)->nullable();
            $table->string('pagibig_employer_no', 32)->nullable();
            $table->string('address', 255)->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::table('employees', function (Blueprint $table) {
            $table->foreignId('legal_entity_id')->nullable()->after('business_group_id')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->dropConstrainedForeignId('legal_entity_id');
        });

        Schema::dropIfExists('legal_entities');
    }
};
