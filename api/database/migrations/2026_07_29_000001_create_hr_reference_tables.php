<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reference tables for the HR masterfile.
 *
 * These exist as real rows rather than free text so a typo in an upload
 * ("PANDERO", "ACOUNTING MANAGER") is rejected at import instead of silently
 * creating a duplicate business unit.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_groups', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 120);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('hr_departments', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('name', 120);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('branch_units', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('name', 120);
            $table->foreignId('business_group_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->string('city', 80)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('positions', function (Blueprint $table) {
            $table->id();
            $table->string('title', 150)->unique();
            $table->unsignedTinyInteger('level')->default(1);
            $table->boolean('is_managerial')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('payroll_groups', function (Blueprint $table) {
            $table->id();
            $table->string('code', 64)->unique();
            $table->string('name', 120);
            // Semi-monthly (S), monthly (M), weekly (W), bi-monthly (MM).
            $table->enum('frequency', ['S', 'M', 'W', 'MM'])->default('S');
            // Which cutoff carries the monthly statutory deduction.
            $table->enum('statutory_schedule', ['first', 'second', 'split'])->default('second');
            $table->boolean('is_confidential')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_groups');
        Schema::dropIfExists('positions');
        Schema::dropIfExists('branch_units');
        Schema::dropIfExists('hr_departments');
        Schema::dropIfExists('business_groups');
    }
};
