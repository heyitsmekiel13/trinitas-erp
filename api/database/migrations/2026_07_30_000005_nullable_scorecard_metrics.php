<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Lets a scorecard metric say "no data" instead of "zero".
 *
 * These columns were NOT NULL DEFAULT 0, which forced a supplier who has never
 * completed a delivery to be recorded at 0% on-time — indistinguishable from
 * one who is late every single time. The composite score already excluded
 * missing components; the stored columns and the list did not, so the screen
 * libelled every new supplier.
 *
 * `scorecard` was an unsignedTinyInteger, so 86.1 was truncated to 86 and
 * anything over 255 would have overflowed. A score is a percentage with one
 * decimal, so that is what it is now stored as.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            $table->decimal('on_time_rate', 5, 2)->nullable()->default(null)->change();
            $table->decimal('quality_rate', 5, 2)->nullable()->default(null)->change();
            $table->decimal('price_index', 6, 2)->nullable()->default(null)->change();
            $table->decimal('scorecard', 4, 1)->nullable()->default(null)->change();
        });

        // Existing rows carry seeded figures no evaluation produced. Clearing
        // them makes "never scored" visible rather than dressing up a guess.
        DB::table('suppliers')
            ->whereNull('scorecard_updated_at')
            ->update([
                'on_time_rate' => null,
                'quality_rate' => null,
                'price_index' => null,
                'scorecard' => null,
            ]);
    }

    public function down(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            $table->decimal('on_time_rate', 5, 2)->default(0)->change();
            $table->decimal('quality_rate', 5, 2)->default(0)->change();
            $table->decimal('price_index', 6, 2)->default(100)->change();
            $table->unsignedTinyInteger('scorecard')->default(0)->change();
        });
    }
};
