<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The trip ticket — asking for fuel before the trip rather than recording it after.
 *
 * `fuel_logs` already captures an issuance: litres went into a truck, here is
 * the receipt. What it cannot answer is the question a fleet actually argues
 * about — was that amount of fuel reasonable for where the truck was going?
 * Without a stated origin and destination there is nothing to check the litres
 * against, so an over-issue is invisible until the monthly economy figure
 * drifts and nobody can say which trip did it.
 *
 * A request is raised against a route. The distance, the duration and the
 * suggested litres are all computed from that route and the vehicle's own
 * economy, and they are stored on the row rather than recalculated later —
 * an approval is a decision about numbers that were on screen at the time, and
 * a routing service that returns 4 km further next week must not silently
 * rewrite what somebody signed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_requests', function (Blueprint $table) {
            $table->id();
            $table->string('reference', 24)->unique();

            $table->foreignId('vehicle_id')->constrained()->cascadeOnDelete();
            /* Any employee may be named as the driver, not only the fleet's
               assigned ones — a delivery covered by somebody from the warehouse
               is the ordinary case, and forcing the roster made people put the
               real driver in the notes field. */
            $table->foreignId('driver_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('requested_by_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('purpose', 190);
            $table->dateTime('depart_at')->nullable();

            /* The route, as chosen. Labels are kept beside the coordinates so a
               printed form still reads as an address after a geocoder changes
               its mind about what that pin is called. */
            $table->string('origin_label', 255);
            $table->decimal('origin_lat', 10, 7);
            $table->decimal('origin_lng', 10, 7);
            $table->string('destination_label', 255);
            $table->decimal('destination_lat', 10, 7);
            $table->decimal('destination_lng', 10, 7);
            $table->boolean('round_trip')->default(true);

            $table->decimal('distance_km', 10, 2)->default(0);
            $table->unsignedInteger('duration_minutes')->default(0);
            /* Which service produced the figures — a road route and a
               straight-line estimate are both "distance", and approving the
               second as though it were the first under-fuels the truck. */
            $table->enum('route_source', ['google', 'osrm', 'straight-line'])->default('straight-line');

            $table->decimal('km_per_litre', 6, 2)->default(0);
            $table->unsignedTinyInteger('reserve_pct')->default(10);
            $table->decimal('suggested_litres', 10, 2)->default(0);
            $table->decimal('fuel_price', 10, 2)->default(0);
            $table->decimal('estimated_cost', 12, 2)->default(0);

            /* What was actually authorised, which is not always what was asked
               for. Null until a decision is made. */
            $table->decimal('approved_litres', 10, 2)->nullable();

            $table->enum('status', ['Draft', 'Submitted', 'Approved', 'Rejected', 'Issued', 'Cancelled'])
                ->default('Draft');

            $table->foreignId('approved_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('approved_by_role', 120)->nullable();
            $table->dateTime('decided_at')->nullable();
            $table->text('decision_note')->nullable();

            /* Set once the approved request has produced an issuance, so the
               two documents are one chain rather than two lists. */
            $table->foreignId('fuel_log_id')->nullable()->constrained('fuel_logs')->nullOnDelete();

            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['status', 'depart_at']);
            $table->index(['vehicle_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_requests');
    }
};
