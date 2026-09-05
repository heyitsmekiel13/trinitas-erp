<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Maintenance.
 *
 * Assets cover the delivery fleet, material handling, cold chain and facility
 * equipment. Work orders and downtime are separate records because a single
 * breakdown can spawn several jobs, and downtime is what the business actually
 * feels.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 190);
            $table->enum('category', ['Delivery Vehicle', 'Material Handling', 'Facility', 'Cold Chain', 'Power', 'IT Equipment'])
                ->default('Facility');
            $table->foreignId('warehouse_id')->nullable()->constrained()->nullOnDelete();

            $table->date('acquired_on')->nullable();
            $table->decimal('acquisition_cost', 14, 2)->default(0);
            $table->decimal('book_value', 14, 2)->default(0);

            $table->decimal('meter_reading', 14, 2)->default(0);
            $table->enum('meter_unit', ['km', 'hours'])->default('hours');

            $table->enum('criticality', ['High', 'Medium', 'Low'])->default('Medium');
            $table->enum('condition', ['Excellent', 'Good', 'Fair', 'Poor'])->default('Good');
            $table->date('last_service_at')->nullable();
            $table->date('next_service_at')->nullable();
            $table->foreignId('assigned_to')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Operational', 'Under Maintenance', 'Breakdown', 'Retired'])->default('Operational');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'category']);
            $table->index('next_service_at');
        });

        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->string('plate_no', 24)->unique();
            $table->string('model', 120)->nullable();
            $table->foreignId('driver_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('odometer', 14, 2)->default(0);
            $table->decimal('km_since_service', 12, 2)->default(0);
            $table->decimal('fuel_efficiency', 6, 2)->default(0);   // km per litre
            $table->date('registration_expiry')->nullable();
            $table->date('insurance_expiry')->nullable();
            $table->enum('status', ['Available', 'On Trip', 'Under Maintenance', 'Breakdown', 'Retired'])->default('Available');
            $table->timestamps();
        });

        Schema::create('pm_schedules', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->string('task', 190);
            $table->enum('frequency', ['Weekly', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'Meter'])->default('Monthly');
            // Set when frequency is Meter — e.g. every 5,000 km or 250 hours.
            $table->decimal('meter_interval', 12, 2)->nullable();
            $table->date('last_done_at')->nullable();
            $table->date('next_due_at')->nullable();
            $table->foreignId('assigned_to')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('compliance_pct', 5, 2)->default(0);
            $table->enum('status', ['Scheduled', 'Due', 'Overdue', 'Completed', 'Inactive'])->default('Scheduled');
            $table->timestamps();

            $table->index('next_due_at');
        });

        Schema::create('work_orders', function (Blueprint $table) {
            $table->id();
            $table->string('wo_no', 32)->unique();
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->foreignId('pm_schedule_id')->nullable()->constrained()->nullOnDelete();
            $table->string('summary', 190);
            $table->text('description')->nullable();
            $table->enum('type', ['Corrective', 'Preventive', 'Inspection', 'Calibration', 'Emergency'])->default('Corrective');
            $table->enum('priority', ['Critical', 'High', 'Medium', 'Low'])->default('Medium');

            $table->dateTime('reported_at');
            $table->dateTime('due_at')->nullable();
            $table->dateTime('completed_at')->nullable();
            $table->foreignId('technician_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->decimal('downtime_hours', 8, 2)->default(0);
            $table->decimal('labor_cost', 12, 2)->default(0);
            $table->decimal('parts_cost', 12, 2)->default(0);
            $table->enum('status', ['Open', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Cancelled'])->default('Open');
            $table->timestamps();

            $table->index(['status', 'reported_at']);
        });

        /** Spare parts consumed by a job, drawn from warehouse stock. */
        Schema::create('work_order_parts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('work_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 12, 2);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->decimal('line_total', 12, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('fuel_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vehicle_id')->constrained()->cascadeOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('logged_at');
            $table->decimal('litres', 10, 2);
            $table->decimal('cost', 12, 2);
            $table->decimal('odometer', 14, 2)->default(0);
            $table->decimal('km_per_litre', 6, 2)->default(0);
            $table->string('station', 120)->nullable();
            // Set when consumption deviates from the vehicle's rolling average.
            $table->boolean('is_flagged')->default(false);
            $table->timestamps();

            $table->index(['vehicle_id', 'logged_at']);
        });

        Schema::create('downtime_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->foreignId('work_order_id')->nullable()->constrained()->nullOnDelete();
            $table->dateTime('occurred_at');
            $table->string('cause', 190);
            $table->decimal('hours', 8, 2)->default(0);
            $table->enum('impact', ['Deliveries delayed', 'Reduced throughput', 'None', 'Line stopped', 'Cold chain risk'])
                ->default('None');
            $table->string('root_cause', 190)->nullable();
            $table->decimal('cost_impact', 14, 2)->default(0);
            $table->enum('status', ['Under Investigation', 'Resolved', 'Recurring'])->default('Under Investigation');
            $table->timestamps();

            $table->index(['asset_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('downtime_events');
        Schema::dropIfExists('fuel_logs');
        Schema::dropIfExists('work_order_parts');
        Schema::dropIfExists('work_orders');
        Schema::dropIfExists('pm_schedules');
        Schema::dropIfExists('vehicles');
        Schema::dropIfExists('assets');
    }
};
