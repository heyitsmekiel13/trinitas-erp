<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The two ends of a hire: the offer that starts it, and the 201 file that is
 * left half-finished by it.
 *
 * Hiring created an employee from four fields — two names, an email and a
 * mobile — and threw the rest of the application away. Everything the
 * candidate had already given, and everything the CV had already been read
 * for, had to be keyed again from scratch into the masterfile. In practice it
 * was not keyed again: the 201 file sat with a blank TIN and no SSS number
 * until the first payroll run failed, because nothing anywhere said it was
 * incomplete.
 *
 * So two things are recorded here.
 *
 *   Provenance. `hired_from_applicant_id` is the link back to the application,
 *   which is what lets the masterfile say "this record was created from a hire
 *   and has never been reviewed" — and what makes the CV reachable from the
 *   employee a year later.
 *
 *   Review. `onboarding_completed_at` is somebody saying the file is now
 *   right. It is deliberately a person's act rather than a derived flag: a
 *   file can have every column filled and still be wrong, and the only thing
 *   that makes it right is somebody having looked.
 *
 * The offer columns hang off the applicant rather than the employee because an
 * offer is made to a candidate, and about a third of them are declined — an
 * offer that produced an employee record before it was accepted would fill the
 * masterfile with people who never worked here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employees', function (Blueprint $table) {
            $table->foreignId('hired_from_applicant_id')->nullable()->after('date_hired')
                ->constrained('applicants')->nullOnDelete();

            $table->timestamp('onboarding_completed_at')->nullable()->after('hired_from_applicant_id');
            $table->foreignId('onboarding_completed_by')->nullable()->after('onboarding_completed_at')
                ->constrained('users')->nullOnDelete();

            $table->index('onboarding_completed_at');
        });

        Schema::table('applicants', function (Blueprint $table) {
            /* What was offered, kept as the offer rather than as the eventual
               201 file: the figure that was actually put in writing is the one
               that gets argued about, and it is not always what the employee
               ends up on. */
            $table->decimal('offer_salary', 12, 2)->nullable();
            $table->date('offer_start_date')->nullable();
            $table->date('offer_expires_on')->nullable();
            $table->string('offer_position', 150)->nullable();
            $table->text('offer_notes')->nullable();

            $table->timestamp('offer_sent_at')->nullable();
            $table->foreignId('offer_sent_by')->nullable()->constrained('users')->nullOnDelete();

            /* The candidate's answer, and when. Recorded rather than inferred
               from the stage, because "moved to Offer" and "said yes" are
               different facts and only one of them is the candidate's. */
            $table->enum('offer_response', ['Accepted', 'Declined'])->nullable();
            $table->timestamp('offer_responded_at')->nullable();
            $table->string('offer_decline_reason', 255)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->dropConstrainedForeignId('offer_sent_by');
            $table->dropColumn([
                'offer_salary', 'offer_start_date', 'offer_expires_on', 'offer_position',
                'offer_notes', 'offer_sent_at', 'offer_response', 'offer_responded_at',
                'offer_decline_reason',
            ]);
        });

        Schema::table('employees', function (Blueprint $table) {
            $table->dropIndex(['onboarding_completed_at']);
            $table->dropConstrainedForeignId('onboarding_completed_by');
            $table->dropConstrainedForeignId('hired_from_applicant_id');
            $table->dropColumn('onboarding_completed_at');
        });
    }
};
