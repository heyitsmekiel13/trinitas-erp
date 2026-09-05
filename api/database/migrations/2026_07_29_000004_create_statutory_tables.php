<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Statutory rates, held as data rather than code.
 *
 * SSS, PhilHealth, Pag-IBIG and BIR all reissue their tables by circular.
 * Storing them with an effectivity date means a rate change is a data entry
 * task for HR, and historic payroll recomputes against the table that was in
 * force on its pay date.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('statutory_settings', function (Blueprint $table) {
            $table->id();
            $table->enum('agency', ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR']);
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->string('reference', 190)->nullable();   // the circular number
            // Agency-specific values: rates, floors, ceilings, share splits.
            $table->json('config');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['agency', 'effective_from']);
        });

        Schema::create('withholding_brackets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('statutory_setting_id')->constrained()->cascadeOnDelete();
            $table->enum('frequency', ['daily', 'weekly', 'semi-monthly', 'monthly']);
            $table->unsignedTinyInteger('bracket');
            $table->decimal('over', 14, 2);
            $table->decimal('base_tax', 14, 2);
            $table->decimal('rate', 6, 4);
            $table->timestamps();

            $table->index(['statutory_setting_id', 'frequency', 'over']);
        });

        Schema::create('sss_brackets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('statutory_setting_id')->constrained()->cascadeOnDelete();
            $table->decimal('compensation_from', 12, 2);
            $table->decimal('compensation_to', 12, 2)->nullable();
            $table->decimal('salary_credit', 12, 2);
            $table->decimal('employee_share', 12, 2);
            $table->decimal('employer_share', 12, 2);
            $table->decimal('employer_ec', 12, 2)->default(0);
            $table->timestamps();

            $table->index(['statutory_setting_id', 'compensation_from']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sss_brackets');
        Schema::dropIfExists('withholding_brackets');
        Schema::dropIfExists('statutory_settings');
    }
};
