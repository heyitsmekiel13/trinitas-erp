<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Geo-fencing by place rather than only by address.
 *
 * A country rule is blunt and an IP rule is brittle — office broadband is
 * rarely on a static address. An `area` rule sits between them: a point and a
 * radius, so "the Davao operation" can be expressed once and keep working when
 * the ISP hands out a new address.
 *
 * The coordinates come from the same lookup that already resolves the country,
 * which means the fence is only ever as precise as IP geolocation itself —
 * city-level at best. The radius default reflects that honestly rather than
 * inviting somebody to draw a 500-metre circle round the building and expect it
 * to hold.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('geo_rules', function (Blueprint $table) {
            $table->decimal('latitude', 10, 7)->nullable()->after('value');
            $table->decimal('longitude', 10, 7)->nullable()->after('latitude');
            // Generous by default: IP geolocation routinely lands a request at
            // the provider's exchange rather than the building it came from.
            $table->unsignedSmallInteger('radius_km')->default(25)->after('longitude');
            $table->string('city', 120)->nullable()->after('radius_km');
            $table->string('region', 120)->nullable()->after('city');
        });

        self::mysqlOnly("ALTER TABLE geo_rules MODIFY COLUMN kind
            ENUM('country', 'ip', 'cidr', 'area') NOT NULL DEFAULT 'country'");
    }

    public function down(): void
    {
        self::mysqlOnly("ALTER TABLE geo_rules MODIFY COLUMN kind
            ENUM('country', 'ip', 'cidr') NOT NULL DEFAULT 'country'");

        Schema::table('geo_rules', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude', 'radius_km', 'city', 'region']);
        });
    }

    /**
     * Runs a statement only on MySQL.
     *
     * The statements below are MySQL's own syntax for widening an enum in
     * place, which the schema builder cannot express. Every other driver skips
     * them: SQLite has no MODIFY COLUMN, and the test suite runs on an
     * in-memory SQLite database — without this guard the whole migration set
     * fails before the first test.
     */
    private static function mysqlOnly(string $sql): void
    {
        if (DB::connection()->getDriverName() === 'mysql') {
            DB::statement($sql);
        }
    }
};
