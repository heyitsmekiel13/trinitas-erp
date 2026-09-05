<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A personally-owned vehicle's trip isn't fuelled by the company — it's paid
 * back in pesos. `priceFrom()` now branches on effective ownership: a
 * personal-vehicle trip skips litres/fuel_price/estimated_cost entirely and
 * fills these two columns instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            $table->decimal('mileage_rate', 8, 2)->nullable()->after('estimated_cost');
            $table->decimal('mileage_amount', 12, 2)->nullable()->after('mileage_rate');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            $table->dropColumn(['mileage_rate', 'mileage_amount']);
        });
    }
};
