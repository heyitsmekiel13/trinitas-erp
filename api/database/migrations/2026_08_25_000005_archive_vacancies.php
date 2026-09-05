<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Putting a vacancy away without destroying it.
 *
 * Deleting a manpower request was all-or-nothing, and the guard in front of it
 * refused most of the time — a request with an advert on the careers site, or
 * with anybody sourced against it, could not go. That guard was right about
 * the risk and wrong about the remedy: it told people to close the advert
 * first, which is two jobs to do one, and left them with a list of dead
 * vacancies they could not clear.
 *
 * Archiving is the missing middle. It takes the request off every working list
 * and closes its advert, and it keeps the record — the headcount that was
 * approved, who raised it, and anybody who applied against it. Nothing is
 * lost, and the board stops carrying vacancies nobody is filling.
 *
 * Permanent deletion still exists, and is now reachable: it is a second,
 * deliberate act from inside the archive, and it still refuses when something
 * real points at the record. An approved headcount that produced a hire is an
 * audit document; a request raised by mistake on a Tuesday is not, and only
 * one of those should be destroyable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_requisitions', function (Blueprint $table) {
            $table->softDeletes();

            /* Why it was put away. An archive of unexplained records is a
               list nobody can act on later — "cancelled, budget pulled" and
               "raised by mistake" lead to different decisions when somebody
               asks six months on. */
            $table->string('archived_reason', 255)->nullable();
            $table->foreignId('archived_by')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::table('job_postings', function (Blueprint $table) {
            // The advert follows its request into the archive, so that taking
            // a vacancy off the board also takes it off the internet.
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('job_postings', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });

        Schema::table('job_requisitions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('archived_by');
            $table->dropColumn('archived_reason');
            $table->dropSoftDeletes();
        });
    }
};
