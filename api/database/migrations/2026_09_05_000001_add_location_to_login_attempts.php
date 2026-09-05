<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The browser's own GPS/Wi-Fi-assisted location, on top of the IP address
 * `login_attempts` already carried — an IP resolves to a city or an ISP's
 * exchange at best (see `GeoGuard`/`AccessLocations`); this is what the
 * device itself reports, to within metres when granted.
 *
 * Nullable throughout: the browser's permission prompt can be denied, or
 * simply never answered before the person moves on, and a login that
 * happened is still a login either way.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('login_attempts', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('country_code');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            $table->unsignedInteger('location_accuracy_m')->nullable()->after('longitude');
        });
    }

    public function down(): void
    {
        Schema::table('login_attempts', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude', 'location_accuracy_m']);
        });
    }
};
