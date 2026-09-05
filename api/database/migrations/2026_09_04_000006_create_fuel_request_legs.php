<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A trip ticket that isn't one stop.
 *
 * A dispatch that runs Manila → Cebu → Davao before coming home is one
 * authorisation for one vehicle and one driver, not three separate requests
 * that each have to be raised, routed and approved on their own. The header's
 * own single-leg columns (`origin_label` etc.) stay in place — unused going
 * forward, not backfilled, since there's no production data riding on them —
 * and `fuel_requests.origin_label`/`destination_label` are now filled from
 * the first leg's origin and the last leg's destination, so anything still
 * reading the header sees a sensible start-to-end summary of the whole trip.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_request_legs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('fuel_request_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('sequence')->default(0);

            $table->string('origin_label', 255);
            $table->decimal('origin_lat', 10, 6);
            $table->decimal('origin_lng', 10, 6);
            $table->string('destination_label', 255);
            $table->decimal('destination_lat', 10, 6);
            $table->decimal('destination_lng', 10, 6);
            $table->boolean('round_trip')->default(false);

            $table->decimal('distance_km', 8, 2)->default(0);
            $table->unsignedInteger('duration_minutes')->default(0);
            $table->string('route_source', 20)->default('straight-line');

            $table->timestamps();

            $table->index(['fuel_request_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fuel_request_legs');
    }
};
