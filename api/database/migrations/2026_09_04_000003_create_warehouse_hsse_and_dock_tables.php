<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Three practice areas the training material treats as foundational and the
 * system had nothing behind: incident tracking, 5S/Kaizen improvement, and
 * dock scheduling. Deliberately plain, generic-resource-shaped tables — none
 * of the three need bespoke workflow logic beyond a status field, so they are
 * registered as ordinary CRUD resources rather than growing a bespoke
 * controller each.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warehouse_incidents', function (Blueprint $table) {
            $table->id();
            $table->string('incident_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignId('reported_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('occurred_on');
            $table->enum('hazard_type', ['MHE', 'Dock', 'Racking', 'Manual Handling', 'Chemical', 'Fire', 'Other']);
            $table->enum('severity', ['Near-miss', 'Minor', 'Moderate', 'Major']);
            $table->string('location', 80)->nullable();
            $table->text('description');
            $table->text('ppe_involved')->nullable();
            $table->text('corrective_action')->nullable();
            $table->enum('status', ['Open', 'Investigating', 'Resolved', 'Closed'])->default('Open');
            $table->dateTime('resolved_at')->nullable();
            $table->timestamps();
        });

        Schema::create('warehouse_suggestions', function (Blueprint $table) {
            $table->id();
            $table->string('suggestion_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignId('raised_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('category', ['5S', 'Safety', 'Efficiency', 'Quality', 'Other']);
            $table->string('zone', 32)->nullable();
            $table->text('description');
            $table->enum('status', ['Submitted', 'Under Review', 'In Progress', 'Implemented', 'Rejected'])->default('Submitted');
            $table->text('impact_note')->nullable();
            $table->timestamps();
        });

        Schema::create('warehouse_5s_audits', function (Blueprint $table) {
            $table->id();
            $table->string('audit_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('zone', 32);
            $table->foreignId('audited_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('audited_on');
            $table->unsignedTinyInteger('sort_score');
            $table->unsignedTinyInteger('set_score');
            $table->unsignedTinyInteger('shine_score');
            $table->unsignedTinyInteger('standardize_score');
            $table->unsignedTinyInteger('sustain_score');
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('dock_appointments', function (Blueprint $table) {
            $table->id();
            $table->string('appointment_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('dock_code', 16);
            $table->dateTime('scheduled_at');
            $table->unsignedSmallInteger('duration_minutes')->default(30);
            $table->enum('type', ['Inbound', 'Outbound']);
            $table->string('reference', 64)->nullable();
            $table->string('carrier', 120)->nullable();
            $table->string('driver', 120)->nullable();
            $table->enum('status', ['Scheduled', 'Checked In', 'In Progress', 'Completed', 'No-show', 'Cancelled'])->default('Scheduled');
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('dock_appointments');
        Schema::dropIfExists('warehouse_5s_audits');
        Schema::dropIfExists('warehouse_suggestions');
        Schema::dropIfExists('warehouse_incidents');
    }
};
