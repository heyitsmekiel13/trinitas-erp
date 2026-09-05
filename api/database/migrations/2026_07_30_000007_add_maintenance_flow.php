<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The columns Maintenance needs before any of it can actually post.
 *
 * A work order that consumes spare parts has to say which warehouse they came
 * off, or the issue has nowhere to land. A meter-based PM schedule has to
 * remember the reading it was last done at, or "every 250 hours" is a sentence
 * rather than a rule. And an asset cannot show a book value without something
 * to depreciate it over.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assets', function (Blueprint $table) {
            // Straight-line depreciation inputs. Nullable rather than defaulted:
            // an asset with no useful life recorded keeps its book value at
            // acquisition cost instead of quietly writing itself down.
            $table->unsignedSmallInteger('useful_life_years')->nullable()->after('acquisition_cost');
            $table->decimal('salvage_value', 14, 2)->default(0)->after('useful_life_years');
        });

        Schema::table('work_orders', function (Blueprint $table) {
            // Where the spare parts come off. Without it a completed job cannot
            // issue anything and the parts cost would be a typed number.
            $table->foreignId('warehouse_id')->nullable()->after('asset_id')->constrained()->nullOnDelete();
            // The asset's meter at the moment the job was done — what rolls a
            // meter-based schedule forward.
            $table->decimal('meter_reading', 14, 2)->nullable()->after('downtime_hours');
        });

        Schema::table('pm_schedules', function (Blueprint $table) {
            $table->decimal('last_meter', 14, 2)->nullable()->after('last_done_at');
            $table->decimal('next_due_meter', 14, 2)->nullable()->after('next_due_at');
        });

        Schema::table('fuel_logs', function (Blueprint $table) {
            // Distance covered since the previous fill on the same vehicle.
            // Derived, never typed — it is what makes km/L checkable.
            $table->decimal('distance_km', 12, 2)->default(0)->after('odometer');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_logs', fn (Blueprint $table) => $table->dropColumn('distance_km'));

        Schema::table('pm_schedules', function (Blueprint $table) {
            $table->dropColumn(['last_meter', 'next_due_meter']);
        });

        Schema::table('work_orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('warehouse_id');
            $table->dropColumn('meter_reading');
        });

        Schema::table('assets', function (Blueprint $table) {
            $table->dropColumn(['useful_life_years', 'salvage_value']);
        });
    }
};
