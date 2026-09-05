<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The 201 file.
 *
 * Column set mirrors the AUB payroll upload template one-for-one, so an
 * export is a straight projection of this table and an import needs no
 * mapping layer. Statutory identifiers are stored as strings — they carry
 * leading zeros and are identifiers, never numbers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employees', function (Blueprint $table) {
            $table->id();
            $table->string('employee_no', 32)->unique();

            // Name is stored in parts because the bank file requires them split.
            $table->string('first_name', 80);
            $table->string('middle_name', 80)->nullable();
            $table->string('last_name', 80);
            $table->string('suffix', 16)->nullable();

            $table->date('birth_date')->nullable();
            $table->enum('civil_status', ['S', 'M', 'D', 'W'])->default('S');

            $table->foreignId('business_group_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('hr_department_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('branch_unit_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('position_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('payroll_group_id')->constrained()->cascadeOnUpdate()->restrictOnDelete();
            $table->foreignId('reports_to_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->unsignedTinyInteger('level')->default(1);
            $table->string('cost_center', 64)->nullable();
            $table->enum('employment_status', ['PROBATION', 'REGULAR', 'RESIGNED', 'TERMINATED'])->default('PROBATION');
            $table->date('date_hired');
            $table->date('date_separated')->nullable();

            // Statutory registration. Each carries its own exemption flag
            // because exemptions are granted per agency, not per employee.
            $table->string('tin', 32)->nullable();
            $table->boolean('tax_exempted')->default(false);
            $table->string('sss_no', 32)->nullable();
            $table->boolean('sss_exempted')->default(false);
            $table->string('philhealth_no', 32)->nullable();
            $table->boolean('philhealth_exempted')->default(false);
            $table->string('pagibig_no', 32)->nullable();
            $table->boolean('pagibig_exempted')->default(false);

            // Compensation. `salary` is an hourly rate when `per_hour` is true.
            $table->decimal('salary', 12, 4);
            $table->boolean('per_hour')->default(false);
            $table->boolean('minimum_wage_earner')->default(false);
            $table->boolean('confidential')->default(false);

            $table->enum('payment_mode', ['ATM', 'CASH', 'CHEQUE'])->default('ATM');
            $table->string('atm_account', 32)->nullable();

            $table->string('email', 150)->nullable();
            $table->string('mobile', 32)->nullable();
            $table->text('address')->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['payroll_group_id', 'employment_status']);
            $table->index('branch_unit_id');
            $table->index('last_name');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employees');
    }
};
