<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Training as something that actually happens on a date.
 *
 * A course was the only thing the system knew about — "Forklift Safety",
 * valid 24 months. There was no way to say it ran on the 12th, that nine
 * people sat in the room, that seven of them turned up, and that those seven
 * are now certified until 2028. `certificate_path` existed on the record and
 * was never written by anything.
 *
 *   training_sessions   one run of a course: when, where, who taught it
 *   training_attendees  the roster for that run, and who actually came
 *   training_records    unchanged in purpose — the certification itself,
 *                       now issued by completing a session rather than typed
 *
 * Attendance and certification are deliberately separate tables. Sitting in
 * the room is a fact about a day; being certified is a status that outlives
 * the session and expires on its own schedule. Collapsing them would mean
 * losing the roster the moment a certificate lapsed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('training_sessions', function (Blueprint $table) {
            $table->id();
            $table->string('session_no', 32)->unique();
            $table->foreignId('training_course_id')->constrained()->cascadeOnDelete();
            // Overrides the course name when a run has its own billing, e.g.
            // "Forklift Safety — Night Crew, Batch 3".
            $table->string('title', 190)->nullable();
            $table->date('scheduled_on');
            $table->date('ends_on')->nullable();
            $table->time('starts_at')->nullable();
            $table->time('finishes_at')->nullable();
            $table->string('venue', 190)->nullable();
            // Free text: the trainer is often an outside provider, not staff.
            $table->string('trainer', 190)->nullable();
            $table->unsignedSmallInteger('capacity')->nullable();
            $table->decimal('passing_score', 5, 2)->nullable();
            $table->text('notes')->nullable();
            $table->enum('status', ['Scheduled', 'Ongoing', 'Completed', 'Cancelled'])->default('Scheduled');
            // Stamped when certificates were issued, so it cannot happen twice.
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'scheduled_on']);
        });

        Schema::create('training_attendees', function (Blueprint $table) {
            $table->id();
            $table->foreignId('training_session_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            // Enrolled is the intention; the rest are what happened.
            $table->enum('status', ['Enrolled', 'Attended', 'Absent', 'Excused'])->default('Enrolled');
            $table->decimal('score', 5, 2)->nullable();
            $table->string('remarks', 255)->nullable();
            $table->timestamp('marked_at')->nullable();
            $table->timestamps();

            // One seat per person per run.
            $table->unique(['training_session_id', 'employee_id']);
            $table->index('employee_id');
        });

        Schema::table('training_records', function (Blueprint $table) {
            // Which run issued this certificate. Null for the historical
            // records that were entered by hand before sessions existed.
            $table->foreignId('training_session_id')->nullable()->constrained()->nullOnDelete();
            $table->string('certificate_no', 40)->nullable()->unique();
            $table->timestamp('issued_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('training_records', function (Blueprint $table) {
            $table->dropConstrainedForeignId('training_session_id');
            $table->dropColumn(['certificate_no', 'issued_at']);
        });

        Schema::dropIfExists('training_attendees');
        Schema::dropIfExists('training_sessions');
    }
};
