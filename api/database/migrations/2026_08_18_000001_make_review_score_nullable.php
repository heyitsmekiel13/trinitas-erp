<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * An unassessed review must have no score, not a score of zero.
 *
 * The column was NOT NULL DEFAULT 0.00, which quietly defeated the rule that a
 * review cannot be completed before it has been scored: the guard tests for
 * null, and the database made sure it never saw one. The consequence was not
 * cosmetic — a review nobody ever filled in could be walked to Completed and
 * would settle its band from a score of zero, permanently filing an employee
 * who was never assessed as "Unsatisfactory".
 *
 * Zero stays a legal score. It just has to be somebody's decision rather than
 * the absence of one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('performance_reviews', function (Blueprint $table) {
            $table->decimal('score', 4, 2)->nullable()->default(null)->change();
        });

        // Anything still open and sitting at the old default was never scored.
        // A completed review keeps its zero: that one may have been meant.
        DB::table('performance_reviews')
            ->where('status', '!=', 'Completed')
            ->where('score', 0)
            ->update(['score' => null]);
    }

    public function down(): void
    {
        DB::table('performance_reviews')->whereNull('score')->update(['score' => 0]);

        Schema::table('performance_reviews', function (Blueprint $table) {
            $table->decimal('score', 4, 2)->default(0)->nullable(false)->change();
        });
    }
};
