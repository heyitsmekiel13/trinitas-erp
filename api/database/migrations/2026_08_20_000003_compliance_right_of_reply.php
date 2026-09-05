<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A right of reply, and a route into due process.
 *
 * The register is confidential by design and stays that way: an observation
 * the subject can argue with before it is written is an observation that never
 * gets written. That is defensible for *what the data shows*.
 *
 * It is not defensible for a *verdict about a person* that then influences a
 * rating, a promotion or a penalty. There was a silent path from an automated
 * flag to somebody's record with no way for them to see it, let alone answer
 * it — and the HR module next door already implements the DOLE twin-notice
 * trail precisely because that path is not allowed to be silent.
 *
 * Two changes, and the distinction between them is the whole point.
 *
 *   - Disclosure is deliberate and one-way. The office decides a review will
 *     be used, discloses it, and from that moment the subject can read it and
 *     respond. An undisclosed review remains internal. Nothing is disclosed
 *     automatically, because most reviews never leave the office.
 *
 *   - Escalation hands the matter to the existing disciplinary process rather
 *     than inventing a second one. `escalated_case_id` points at the
 *     employee_cases row that then carries the notice to explain, the hearing
 *     and the decision. The process office establishes the facts; it does not
 *     get to impose consequences on its own.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('compliance_reviews', function (Blueprint $table) {
            // Disclosure.
            $table->timestamp('disclosed_at')->nullable()->after('reviewed_at');
            $table->foreignId('disclosed_by')->nullable()->after('disclosed_at')->constrained('users')->nullOnDelete();

            /*
             * Where the conversation has got to.
             *
             * `Internal` is the default and means the subject has never seen
             * it. The others only exist after disclosure, which is why the
             * column cannot simply be inferred from whether a response is
             * present — "disclosed and not yet answered" is a real state and
             * the one the office needs to chase.
             */
            $table->enum('response_status', ['Internal', 'Awaiting response', 'Accepted', 'Disputed', 'Closed'])
                ->default('Internal')
                ->after('disclosed_by');

            $table->text('subject_response')->nullable()->after('response_status');
            $table->timestamp('subject_responded_at')->nullable()->after('subject_response');

            // The office's answer to that response, so a dispute ends with a
            // reasoned reply rather than silence.
            $table->text('office_reply')->nullable()->after('subject_responded_at');
            $table->timestamp('office_replied_at')->nullable()->after('office_reply');
            $table->foreignId('office_replied_by')->nullable()->after('office_replied_at')->constrained('users')->nullOnDelete();

            // The disciplinary case this became, where it went that far.
            $table->foreignId('escalated_case_id')->nullable()->after('office_replied_by')
                ->constrained('employee_cases')->nullOnDelete();

            $table->index(['subject_id', 'response_status'], 'compliance_reviews_subject_state');
        });
    }

    public function down(): void
    {
        Schema::table('compliance_reviews', function (Blueprint $table) {
            $table->dropIndex('compliance_reviews_subject_state');
            $table->dropConstrainedForeignId('escalated_case_id');
            $table->dropConstrainedForeignId('office_replied_by');
            $table->dropConstrainedForeignId('disclosed_by');
            $table->dropColumn([
                'disclosed_at', 'response_status', 'subject_response',
                'subject_responded_at', 'office_reply', 'office_replied_at',
            ]);
        });
    }
};
