<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Room for an assessment rather than a score.
 *
 * `match_score` was the whole of the screening opinion: one integer, produced
 * by counting how many words the advert and the CV had in common. It sorted a
 * list, and it could not be argued with, which is the wrong combination — a
 * number nobody can interrogate gets read as a judgement rather than as an
 * ordering.
 *
 * The column stays, because a single figure is what a list column needs. What
 * changes is that it is now the headline of something written down: which
 * requirement was met and on what evidence, how the years compare, where the
 * education lands, which named skills are missing, and what is simply not
 * known. `assessment` holds that, so every number on the screen can be opened.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->json('assessment')->nullable()->after('match_score');

            /* The band, denormalised out of the JSON so the pipeline can
               filter and sort on it without every row being decoded first. */
            $table->string('assessment_band', 24)->nullable()->after('assessment');

            $table->index(['job_posting_id', 'match_score']);
        });
    }

    public function down(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->dropIndex(['job_posting_id', 'match_score']);
            $table->dropColumn(['assessment', 'assessment_band']);
        });
    }
};
