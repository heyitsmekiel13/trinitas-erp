<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Route planning for deliveries.
 *
 * A delivery has to answer three questions before a truck leaves: how far, how
 * long, and how much fuel. That needs coordinates on both ends, a fuel figure
 * on the vehicle, and somewhere to keep the answer so the plan a dispatcher
 * approved is the plan on record — recomputing it later against a moved pin
 * would quietly rewrite history.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('warehouses', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('region');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            // The origin a new delivery starts from unless told otherwise.
            $table->boolean('is_default_origin')->default(false)->after('longitude');
        });

        Schema::table('customers', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('region');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
        });

        Schema::table('assets', function (Blueprint $table) {
            // Litres per 100 km is how fleet operators quote consumption, but
            // km per litre is how Philippine drivers talk about it. Stored as
            // km/L for that reason.
            $table->decimal('km_per_litre', 6, 2)->nullable()->after('meter_unit');
            $table->unsignedInteger('payload_pallets')->nullable()->after('km_per_litre');
        });

        Schema::table('deliveries', function (Blueprint $table) {
            $table->foreignId('origin_warehouse_id')->nullable()->after('sales_order_id')
                ->constrained('warehouses')->nullOnDelete();

            // The plan as calculated when the delivery was saved.
            $table->decimal('distance_km', 8, 2)->nullable()->after('scheduled_at');
            $table->boolean('round_trip')->default(true)->after('distance_km');
            $table->unsignedInteger('eta_minutes')->nullable()->after('round_trip');
            $table->decimal('fuel_litres', 8, 2)->nullable()->after('eta_minutes');
            $table->decimal('fuel_cost', 10, 2)->nullable()->after('fuel_litres');
        });
    }

    public function down(): void
    {
        Schema::table('deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('origin_warehouse_id');
            $table->dropColumn(['distance_km', 'round_trip', 'eta_minutes', 'fuel_litres', 'fuel_cost']);
        });

        Schema::table('assets', fn (Blueprint $table) => $table->dropColumn(['km_per_litre', 'payload_pallets']));
        Schema::table('customers', fn (Blueprint $table) => $table->dropColumn(['latitude', 'longitude']));
        Schema::table('warehouses', fn (Blueprint $table) => $table->dropColumn(['latitude', 'longitude', 'is_default_origin']));
    }
};
