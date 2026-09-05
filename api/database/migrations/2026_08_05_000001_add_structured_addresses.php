<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A delivery address people can actually write down.
 *
 * Coordinates were being typed by hand, which asked a sales clerk to open
 * Google Maps, right-click the pin, and copy two ten-digit decimals into a
 * form. Nobody did it, so most customers had no coordinates and the delivery
 * planner had nothing to route.
 *
 * The address is now captured the way a Philippine address is actually
 * written — street, barangay, city, province — and the coordinates are derived
 * from it. They remain on the record because routing needs them; they are
 * simply no longer somebody's data-entry chore.
 *
 * `geocoded_at` and `geocode_source` exist so the planner can tell a surveyed
 * coordinate from a guess. A pin resolved to a barangay centre is fine for
 * sequencing a run and useless for the last hundred metres, and the difference
 * has to be visible rather than assumed.
 */
return new class extends Migration
{
    /** Both tables carry an address and both feed the delivery planner. */
    private const TABLES = ['customers', 'suppliers'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $blueprint) use ($table) {
                $blueprint->string('barangay', 120)->nullable()->after('address');
                $blueprint->string('province', 120)->nullable()->after('city');
                $blueprint->string('postal_code', 16)->nullable()->after('province');

                // How the coordinates on this row were arrived at.
                $blueprint->timestamp('geocoded_at')->nullable();
                $blueprint->string('geocode_source', 32)->nullable();
                // What the provider thinks it matched, kept so somebody can see
                // that "Poblacion" landed in the wrong province.
                $blueprint->string('geocode_label', 255)->nullable();
                // rooftop | street | locality | region — how far to trust it.
                $blueprint->string('geocode_precision', 16)->nullable();

                if ($table === 'suppliers') {
                    // Customers already have these; suppliers never did.
                    $blueprint->decimal('latitude', 10, 7)->nullable();
                    $blueprint->decimal('longitude', 10, 7)->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $blueprint) use ($table) {
                $blueprint->dropColumn([
                    'barangay', 'province', 'postal_code',
                    'geocoded_at', 'geocode_source', 'geocode_label', 'geocode_precision',
                ]);

                if ($table === 'suppliers') {
                    $blueprint->dropColumn(['latitude', 'longitude']);
                }
            });
        }
    }
};
