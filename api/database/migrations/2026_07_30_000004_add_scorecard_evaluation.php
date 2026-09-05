<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records when a supplier was last scored.
 *
 * The scorecard columns were always meant to be derived — the original
 * migration says "recomputed nightly from receipts and invoices" — but nothing
 * ever wrote them, so every supplier carried whatever number was seeded. A
 * score with no timestamp cannot be trusted: you cannot tell a supplier who is
 * genuinely at 92% from one whose figure predates the last six deliveries.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            $table->timestamp('scorecard_updated_at')->nullable()->after('scorecard');
            // How many orders the on-time figure is based on. A 100% rate from
            // one delivery is not the same claim as 100% from forty.
            $table->unsignedInteger('scorecard_sample')->default(0)->after('scorecard_updated_at');
        });
    }

    public function down(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            $table->dropColumn(['scorecard_updated_at', 'scorecard_sample']);
        });
    }
};
