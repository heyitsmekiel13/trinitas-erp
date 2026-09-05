<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The careers site, and the applicant record an ATS actually needs.
 *
 * Recruitment could raise a vacancy, key a name against it, and hire the
 * person at the end. Three things were missing before that is a hiring system
 * rather than a list:
 *
 *   the advert     A manpower request is an internal authorisation. Nobody
 *                  outside the company can read one, and nothing turned it
 *                  into something a candidate could apply to. `job_postings`
 *                  is the public face of a requisition — written for a reader
 *                  rather than for an approver, and openable on its own URL.
 *
 *   the applicant  `applicants` held a name, an email and a phone number.
 *                  Every question a screener actually asks — where do they
 *                  live, what did they study, how long have they done this,
 *                  when can they start — was not storable, so it lived in
 *                  somebody's inbox. The columns below are the basic details
 *                  an application is not complete without.
 *
 *   the CV         `resume_path` existed and nothing ever wrote to it. A
 *                  resume that is only a file is a file; the parsed text and
 *                  the fields read out of it are what make it searchable, and
 *                  what let a candidate fill a form by uploading one document
 *                  instead of retyping their life into twenty inputs.
 *
 * Nothing read out of a CV is trusted. `resume_parsed` is kept beside the
 * fields it suggested precisely so a recruiter can see what the machine
 * thought and what the person confirmed, and the two never silently merge.
 */
return new class extends Migration
{
    public function up(): void
    {
        /*
         * The advert. One per role being sourced, optionally tied to the
         * manpower request that authorised it.
         *
         * Deliberately not the same row as the requisition: a requisition is
         * an internal control document with a headcount and a budget rate on
         * it, and publishing that verbatim would put the salary band and the
         * approver's name on the internet.
         */
        Schema::create('job_postings', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 160)->unique();
            $table->string('title', 150);
            $table->foreignId('job_requisition_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('position_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('hr_department_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('branch_unit_id')->nullable()->constrained()->nullOnDelete();

            $table->string('location', 150)->nullable();
            $table->enum('employment_type', ['Full-time', 'Part-time', 'Contract', 'Project-based', 'Internship'])
                ->default('Full-time');
            $table->enum('work_setup', ['On-site', 'Hybrid', 'Remote'])->default('On-site');
            $table->enum('experience_level', ['Entry level', 'Associate', 'Mid-Senior', 'Manager', 'Director'])
                ->default('Entry level');

            $table->text('summary')->nullable();
            $table->text('responsibilities')->nullable();
            $table->text('qualifications')->nullable();
            $table->text('benefits')->nullable();

            /* A band, and whether the band is fit to publish. Philippine job
               boards mostly show one; a company that does not want to is not
               forced to blank the field and lose the figure internally. */
            $table->decimal('salary_min', 12, 2)->nullable();
            $table->decimal('salary_max', 12, 2)->nullable();
            $table->boolean('salary_visible')->default(false);

            $table->unsignedSmallInteger('openings')->default(1);
            $table->enum('status', ['Draft', 'Published', 'Closed'])->default('Draft');
            $table->timestamp('published_at')->nullable();
            $table->date('closes_on')->nullable();
            $table->unsignedInteger('views')->default(0);
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['status', 'published_at']);
        });

        Schema::table('applicants', function (Blueprint $table) {
            $table->foreignId('job_posting_id')->nullable()->after('job_requisition_id')
                ->constrained()->nullOnDelete();

            /* How the application arrived. `source` is the recruiter's own
               vocabulary and stays untouched; this says whether a human typed
               the row or the candidate did, which is a different question and
               the one that matters when the two disagree. */
            $table->enum('applied_via', ['Careers Portal', 'HR Encoded'])->default('HR Encoded')->after('source');

            /* What the candidate is looked up by from outside. Random rather
               than sequential — it is handed to the applicant, and APP-0007
               would tell them how many people applied before them. */
            $table->string('reference_code', 24)->nullable()->unique()->after('applicant_no');

            /* Name, kept in parts as well as whole. `full_name` is what the
               board shows; the parts are what the 201 file needs at hire, and
               splitting a string on spaces at that point gets middle names
               wrong for half the country. */
            $table->string('first_name', 80)->nullable()->after('full_name');
            $table->string('middle_name', 80)->nullable()->after('first_name');
            $table->string('last_name', 80)->nullable()->after('middle_name');

            $table->date('birthdate')->nullable();
            $table->enum('gender', ['Male', 'Female', 'Prefer not to say'])->nullable();
            $table->enum('civil_status', ['Single', 'Married', 'Widowed', 'Separated'])->nullable();
            $table->string('nationality', 60)->nullable();

            $table->string('address_line', 190)->nullable();
            $table->string('city', 120)->nullable();
            $table->string('province', 120)->nullable();
            $table->string('postal_code', 12)->nullable();

            $table->enum('education_level', [
                'High School', 'Vocational', 'Associate', 'Bachelor', 'Master', 'Doctorate',
            ])->nullable();
            $table->string('school', 150)->nullable();
            $table->string('course', 150)->nullable();
            $table->unsignedSmallInteger('year_graduated')->nullable();

            $table->decimal('years_experience', 4, 1)->nullable();
            $table->string('current_employer', 150)->nullable();
            $table->string('current_title', 150)->nullable();
            $table->date('available_from')->nullable();
            $table->decimal('current_salary', 12, 2)->nullable();

            $table->string('linkedin_url', 190)->nullable();
            $table->string('portfolio_url', 190)->nullable();
            $table->text('cover_letter')->nullable();

            /* Skills as a list, because "PHP, MySQL" in a text column is a
               field nobody can filter on, and a resume parser produces a list
               anyway. */
            $table->json('skills')->nullable();

            /* The CV itself, and everything read out of it. `resume_text` is
               the extracted plain text — it is what makes a keyword search
               across applications possible at all — and `resume_parsed` is the
               structured guess, kept separately from the confirmed columns. */
            $table->string('resume_original_name', 190)->nullable();
            $table->string('resume_mime', 120)->nullable();
            $table->unsignedInteger('resume_bytes')->nullable();
            $table->timestamp('resume_uploaded_at')->nullable();
            $table->longText('resume_text')->nullable();
            $table->json('resume_parsed')->nullable();
            $table->enum('resume_status', ['None', 'Parsed', 'Unreadable'])->default('None');
            $table->unsignedTinyInteger('resume_confidence')->default(0);

            /* Screening. A note the recruiter writes, and the match the server
               computed against the posting — shown side by side so a high
               keyword match never passes for a human judgement. */
            $table->unsignedTinyInteger('match_score')->nullable();
            $table->text('screening_notes')->nullable();

            /* RA 10173. Consent to hold the application is recorded with the
               application, not assumed from the fact that one arrived. */
            $table->timestamp('consented_at')->nullable();

            $table->index('job_posting_id');
            $table->index('email');
        });
    }

    public function down(): void
    {
        Schema::table('applicants', function (Blueprint $table) {
            $table->dropConstrainedForeignId('job_posting_id');
            $table->dropIndex(['email']);
            $table->dropColumn([
                'applied_via', 'reference_code',
                'first_name', 'middle_name', 'last_name',
                'birthdate', 'gender', 'civil_status', 'nationality',
                'address_line', 'city', 'province', 'postal_code',
                'education_level', 'school', 'course', 'year_graduated',
                'years_experience', 'current_employer', 'current_title',
                'available_from', 'current_salary',
                'linkedin_url', 'portfolio_url', 'cover_letter', 'skills',
                'resume_original_name', 'resume_mime', 'resume_bytes',
                'resume_uploaded_at', 'resume_text', 'resume_parsed',
                'resume_status', 'resume_confidence',
                'match_score', 'screening_notes', 'consented_at',
            ]);
        });

        Schema::dropIfExists('job_postings');
    }
};
