<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The rest of what an offer letter has to say.
 *
 * The offer already recorded a monthly salary, which is what the 201 file
 * needs. A Philippine offer letter states a **daily** rate and, separately, a
 * daily de minimis allowance — the two are different things in law and only
 * one of them is taxable, so a letter that folds them into a single monthly
 * figure is a letter the first payslip contradicts.
 *
 * The daily rate can be derived from the monthly one through payroll's own
 * working-days factor, and is, when nobody sets it. It is stored rather than
 * only computed because an offer is a document: what was put in writing has to
 * stay what was put in writing, even after somebody changes the factor.
 *
 * The orientation details are here for the same reason. The covering email
 * tells the candidate where and when to turn up, and that is the single most
 * re-read line in the whole message — it cannot be a sentence somebody retypes
 * per candidate.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->decimal('offer_daily_rate', 12, 2)->nullable()->after('offer_salary');
            $table->decimal('offer_de_minimis', 12, 2)->nullable()->after('offer_daily_rate');

            $table->dateTime('offer_orientation_at')->nullable()->after('offer_start_date');
            $table->string('offer_orientation_venue', 255)->nullable()->after('offer_orientation_at');
        });
    }

    public function down(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->dropColumn([
                'offer_daily_rate', 'offer_de_minimis',
                'offer_orientation_at', 'offer_orientation_venue',
            ]);
        });
    }
};
