<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Day-to-day HR: attendance, leave, recruitment, performance, training and
 * employee relations.
 *
 * Attendance is stored per employee per day. The semi-monthly totals the
 * payroll engine consumes are aggregated from here into employee_timecards,
 * so payroll can always be traced back to the days that produced it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->string('name', 64);              // Day 8:00-17:00
            $table->time('starts_at');
            $table->time('ends_at');
            $table->unsignedSmallInteger('break_minutes')->default(60);
            $table->unsignedSmallInteger('grace_minutes')->default(0);
            $table->boolean('is_night_shift')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('attendance_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->date('work_date');
            $table->foreignId('shift_id')->nullable()->constrained()->nullOnDelete();

            $table->time('time_in')->nullable();
            $table->time('time_out')->nullable();
            $table->decimal('hours_worked', 6, 2)->default(0);
            $table->decimal('overtime_hours', 6, 2)->default(0);
            $table->decimal('night_diff_hours', 6, 2)->default(0);
            $table->unsignedSmallInteger('late_minutes')->default(0);
            $table->unsignedSmallInteger('undertime_minutes')->default(0);

            $table->enum('status', ['Present', 'Late', 'Absent', 'On Leave', 'Rest Day', 'Holiday'])->default('Present');
            $table->enum('source', ['Biometric', 'Manual', 'Import'])->default('Biometric');
            $table->string('remarks', 190)->nullable();
            $table->timestamps();

            $table->unique(['employee_id', 'work_date']);
            $table->index('work_date');
        });

        Schema::create('holidays', function (Blueprint $table) {
            $table->id();
            $table->date('holiday_date');
            $table->string('name', 150);
            $table->enum('type', ['Regular', 'Special Non-Working', 'Local'])->default('Regular');
            // Null means nationwide; otherwise it applies to one branch only.
            $table->foreignId('branch_unit_id')->nullable()->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->index('holiday_date');
        });

        Schema::create('leave_types', function (Blueprint $table) {
            $table->id();
            $table->string('code', 24)->unique();
            $table->string('name', 96);
            $table->unsignedTinyInteger('annual_credits')->default(0);
            $table->boolean('is_paid')->default(true);
            $table->boolean('requires_attachment')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('leave_balances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('leave_type_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('year');
            $table->decimal('credits', 6, 2)->default(0);
            $table->decimal('used', 6, 2)->default(0);
            $table->decimal('balance', 6, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'leave_type_id', 'year'], 'leave_bal_emp_type_year_unique');
        });

        Schema::create('leave_requests', function (Blueprint $table) {
            $table->id();
            $table->string('request_no', 32)->unique();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('leave_type_id')->constrained()->restrictOnDelete();
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('days', 5, 2);
            $table->decimal('balance_before', 6, 2)->default(0);
            $table->string('reason', 255)->nullable();
            $table->foreignId('approver_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('filed_on');
            $table->timestamp('decided_at')->nullable();
            $table->enum('status', ['Draft', 'For Approval', 'Approved', 'Rejected', 'Cancelled'])->default('Draft');
            $table->timestamps();

            $table->index(['employee_id', 'start_date']);
            $table->index('status');
        });

        Schema::create('job_requisitions', function (Blueprint $table) {
            $table->id();
            $table->string('requisition_no', 32)->unique();
            $table->foreignId('position_id')->constrained()->restrictOnDelete();
            $table->foreignId('hr_department_id')->constrained()->restrictOnDelete();
            $table->foreignId('branch_unit_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('headcount')->default(1);
            $table->unsignedTinyInteger('filled')->default(0);
            $table->date('needed_by')->nullable();
            $table->decimal('budget_rate', 12, 2)->default(0);
            $table->foreignId('requested_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Draft', 'For Approval', 'Approved', 'Sourcing', 'Filled', 'Cancelled'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('applicants', function (Blueprint $table) {
            $table->id();
            $table->string('applicant_no', 32)->unique();
            $table->string('full_name', 150);
            $table->string('email', 150)->nullable();
            $table->string('phone', 40)->nullable();
            $table->foreignId('job_requisition_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('position_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('source', ['Referral', 'Job Board', 'Walk-in', 'Agency', 'Social Media', 'University'])->default('Walk-in');
            $table->date('applied_on');
            $table->enum('stage', ['Applied', 'Screening', 'Interview', 'Assessment', 'Final Interview', 'Offer', 'Hired', 'Rejected'])
                ->default('Applied');
            $table->decimal('rating', 3, 1)->default(0);
            $table->decimal('expected_salary', 12, 2)->default(0);
            $table->foreignId('recruiter_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->string('resume_path', 255)->nullable();
            $table->timestamps();

            $table->index('stage');
        });

        Schema::create('performance_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->string('period', 48);
            $table->foreignId('reviewer_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('score', 4, 2)->default(0);
            $table->enum('rating', ['Outstanding', 'Exceeds Expectations', 'Meets Expectations', 'Needs Improvement', 'Unsatisfactory'])
                ->nullable();
            $table->date('due_date')->nullable();
            $table->text('strengths')->nullable();
            $table->text('development_areas')->nullable();
            $table->enum('status', ['Not Started', 'Self-Assessment', 'Manager Review', 'Calibration', 'Completed'])
                ->default('Not Started');
            $table->timestamps();

            $table->unique(['employee_id', 'period']);
        });

        Schema::create('training_courses', function (Blueprint $table) {
            $table->id();
            $table->string('name', 190)->unique();
            $table->enum('type', ['Safety', 'Technical', 'Compliance', 'Leadership', 'Systems', 'Certification'])->default('Technical');
            $table->string('provider', 150)->nullable();
            // Null means the certificate does not lapse.
            $table->unsignedSmallInteger('validity_months')->nullable();
            $table->boolean('is_mandatory')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('training_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->foreignId('training_course_id')->constrained()->restrictOnDelete();
            $table->date('completed_on')->nullable();
            $table->date('expires_on')->nullable();
            $table->unsignedTinyInteger('score')->nullable();
            $table->string('certificate_path', 255)->nullable();
            $table->enum('status', ['Enrolled', 'In Progress', 'Completed', 'Expiring Soon', 'Expired'])->default('Enrolled');
            $table->timestamps();

            $table->index(['employee_id', 'status']);
            $table->index('expires_on');
        });

        Schema::create('employee_cases', function (Blueprint $table) {
            $table->id();
            $table->string('case_no', 32)->unique();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->enum('type', ['Tardiness', 'Absence Without Leave', 'Policy Violation', 'Safety Incident', 'Performance', 'Grievance'])
                ->default('Policy Violation');
            $table->date('reported_on');
            $table->enum('severity', ['Minor', 'Moderate', 'Major', 'Grave'])->default('Minor');
            $table->enum('action', ['Verbal Warning', 'Written Warning', 'Final Warning', 'Suspension', 'Coaching', 'Under Review'])
                ->default('Under Review');
            $table->text('details')->nullable();
            $table->foreignId('handled_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('hearing_on')->nullable();
            $table->enum('status', ['Open', 'Notice Issued', 'Hearing Scheduled', 'Resolved', 'Closed'])->default('Open');
            $table->timestamps();

            $table->index(['employee_id', 'status']);
        });

        /* ---- Small additions the warehouse and maintenance modules need ---- */

        Schema::table('items', function (Blueprint $table) {
            // Spare parts live in the same item master but are surfaced under
            // Maintenance rather than Sales.
            $table->boolean('is_spare_part')->default(false)->after('abc_class');
        });

        Schema::create('label_print_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('job_no', 32)->unique();
            $table->enum('template', ['SKU Label', 'Bin Label', 'Pallet Label', 'Price Tag', 'Batch Label'])->default('SKU Label');
            $table->foreignId('warehouse_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedInteger('quantity')->default(0);
            $table->string('printer', 96)->nullable();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['Queued', 'Printing', 'Completed', 'Failed'])->default('Queued');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('label_print_jobs');
        Schema::table('items', function (Blueprint $table) {
            $table->dropColumn('is_spare_part');
        });
        Schema::dropIfExists('employee_cases');
        Schema::dropIfExists('training_records');
        Schema::dropIfExists('training_courses');
        Schema::dropIfExists('performance_reviews');
        Schema::dropIfExists('applicants');
        Schema::dropIfExists('job_requisitions');
        Schema::dropIfExists('leave_requests');
        Schema::dropIfExists('leave_balances');
        Schema::dropIfExists('leave_types');
        Schema::dropIfExists('holidays');
        Schema::dropIfExists('attendance_records');
        Schema::dropIfExists('shifts');
    }
};
