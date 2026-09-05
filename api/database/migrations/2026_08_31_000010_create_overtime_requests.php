<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Overtime pre-approval — filed before or during a shift, decided by a
 * manager. Deliberately does not touch how `TimeClock`/`PayrollEngine`
 * compute `overtime_hours`: that stays read from punches, exactly as
 * before. This table is the record of what was actually authorized, sitting
 * alongside the worked-hours figure rather than replacing it, so a manager
 * reviewing a cut-off can see approved-vs-actual without payroll's own
 * computation changing underneath it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('overtime_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->date('work_date');
            $table->dateTime('expected_start_at');
            $table->dateTime('expected_end_at');
            $table->text('reason')->nullable();
            $table->enum('status', ['Pending', 'Approved', 'Declined'])->default('Pending');
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->timestamps();

            $table->index(['employee_id', 'work_date']);
            $table->index(['employee_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('overtime_requests');
    }
};
