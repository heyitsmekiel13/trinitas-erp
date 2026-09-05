<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The paper trail Philippine labour law actually requires.
 *
 * A case previously recorded the offence, a severity and an action. None of
 * that is what a case turns on if it is ever questioned: what matters is
 * whether the employee was told what they were accused of, given a real
 * chance to answer, and informed of the decision — the twin-notice rule.
 *
 * These columns record each of those steps and when it happened, so the file
 * either shows due process was observed or shows plainly that it was not.
 * DOLE Department Order 147-15 is the reference for the periods; the dates
 * live here and the guidance sits in the interface next to them.
 *
 * Preventive suspension is separate because it is not a penalty — it removes
 * somebody from the floor while a case is investigated, and it runs on its own
 * 30-day limit regardless of how the case is eventually decided.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_cases', function (Blueprint $table) {
            // First notice: what they are accused of, and by when to answer.
            $table->date('nte_issued_on')->nullable()->after('reported_on');
            $table->date('nte_response_due_on')->nullable()->after('nte_issued_on');
            $table->text('nte_details')->nullable()->after('nte_response_due_on');

            // The employee's side of it.
            $table->date('explanation_received_on')->nullable()->after('nte_details');
            $table->text('explanation')->nullable()->after('explanation_received_on');

            // The chance to be heard.
            $table->date('hearing_held_on')->nullable()->after('hearing_on');
            $table->text('hearing_notes')->nullable()->after('hearing_held_on');

            // Second notice: the findings and the penalty.
            $table->date('decision_on')->nullable()->after('hearing_notes');
            $table->text('decision_findings')->nullable()->after('decision_on');
            $table->string('penalty', 80)->nullable()->after('decision_findings');

            // Removal from the floor pending investigation — capped at 30 days.
            $table->date('preventive_suspension_from')->nullable();
            $table->date('preventive_suspension_to')->nullable();

            // Authorised-cause separations need DOLE served too, 30 days ahead.
            $table->date('dole_notified_on')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('employee_cases', function (Blueprint $table) {
            $table->dropColumn([
                'nte_issued_on', 'nte_response_due_on', 'nte_details',
                'explanation_received_on', 'explanation',
                'hearing_held_on', 'hearing_notes',
                'decision_on', 'decision_findings', 'penalty',
                'preventive_suspension_from', 'preventive_suspension_to',
                'dole_notified_on',
            ]);
        });
    }
};
