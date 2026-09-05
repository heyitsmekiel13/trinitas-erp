<?php

namespace Tests\Feature;

use App\Models\Applicant;
use App\Models\JobPosting;
use App\Services\ResumeParser;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The careers site, end to end.
 *
 * These cover the things that would be expensive to get wrong and are not
 * obvious from reading the code: that a draft cannot be seen from outside,
 * that an application from the internet cannot arrive anywhere but stage
 * Applied, that the status lookup will not confirm an email address to
 * somebody who does not already have the reference, and that re-applying
 * updates rather than duplicating.
 */
class CareersPortalTest extends TestCase
{
    use RefreshDatabase;

    private function posting(array $overrides = []): JobPosting
    {
        return JobPosting::create(array_merge([
            'title' => 'Accounting Supervisor',
            'location' => 'Antipolo City',
            'employment_type' => 'Full-time',
            'work_setup' => 'On-site',
            'experience_level' => 'Mid-Senior',
            'summary' => 'Runs the accounting team for the Rizal branch.',
            'qualifications' => "Graduate of BS Accountancy\nAt least three years supervising",
            'responsibilities' => "Prepare monthly statements\nSupervise two assistants",
            'salary_min' => 35000,
            'salary_max' => 45000,
            'salary_visible' => true,
            'openings' => 2,
            'status' => 'Published',
            'published_at' => now(),
        ], $overrides));
    }

    /** @return array<string, mixed> */
    private function application(JobPosting $posting, array $overrides = []): array
    {
        return array_merge([
            'slug' => $posting->slug,
            'firstName' => 'Juan',
            'lastName' => 'Dela Cruz',
            'email' => 'juan.delacruz@example.com',
            'phone' => '09175552841',
            'city' => 'Antipolo City',
            'province' => 'Rizal',
            'consent' => true,
        ], $overrides);
    }

    public function test_only_published_postings_are_listed(): void
    {
        $this->posting();
        $this->posting(['title' => 'Warehouse Clerk', 'status' => 'Draft', 'published_at' => null]);
        $this->posting(['title' => 'Closed Role', 'status' => 'Closed']);

        $response = $this->getJson('/api/v1/careers/jobs');

        $response->assertOk();
        $this->assertCount(1, $response->json('data.jobs'));
        $this->assertSame('Accounting Supervisor', $response->json('data.jobs.0.title'));
    }

    public function test_a_posting_past_its_closing_date_is_gone(): void
    {
        $posting = $this->posting(['closes_on' => now()->subDay()->toDateString()]);

        $this->getJson('/api/v1/careers/jobs')->assertJsonCount(0, 'data.jobs');
        $this->getJson("/api/v1/careers/jobs/{$posting->slug}")->assertNotFound();
    }

    public function test_the_public_advert_never_carries_internal_figures(): void
    {
        $posting = $this->posting(['salary_visible' => false]);

        $response = $this->getJson("/api/v1/careers/jobs/{$posting->slug}");

        $response->assertOk();
        $this->assertNull($response->json('data.salary'));

        // Nothing from the control side of the record leaks into the advert.
        foreach (['headcount', 'budgetRate', 'requisition', 'postedBy', 'id'] as $internal) {
            $this->assertArrayNotHasKey($internal, $response->json('data'));
        }

        // The list body is split into lines for the page to render.
        $this->assertSame(
            ['Graduate of BS Accountancy', 'At least three years supervising'],
            $response->json('data.qualifications'),
        );
    }

    public function test_a_bulleted_advert_does_not_break_the_response(): void
    {
        /*
         * The bug this pins was a 500 on publishing, and on the public page
         * for any advert whose list used typographic bullets.
         *
         * `ltrim($line, "-•*	 ")` treats its mask as bytes, and "•" is three
         * of them. A line opening with an em dash — which shares two leading
         * bytes with it — came back missing them and starting on an orphan
         * continuation byte, so it was no longer valid UTF-8 and `json_encode`
         * refused the whole response.
         */
        $posting = $this->posting([
            'responsibilities' => '• Prepare the monthly statements
– Supervise two assistants
— And a dash',
            'qualifications' => '* Graduate of BS Accountancy
·  Proficient in Microsoft Excel
—',
            'benefits' => '— HMO on regularisation
•
– 13th month pay',
        ]);

        $response = $this->getJson("/api/v1/careers/jobs/{$posting->slug}");

        $response->assertOk();

        $this->assertSame(
            ['Prepare the monthly statements', 'Supervise two assistants', 'And a dash'],
            $response->json('data.responsibilities'),
        );

        // A line that was only a bullet leaves nothing, and an empty bullet on
        // an advert is worse than no bullet.
        $this->assertSame(
            ['Graduate of BS Accountancy', 'Proficient in Microsoft Excel'],
            $response->json('data.qualifications'),
        );
        $this->assertSame(
            ['HMO on regularisation', '13th month pay'],
            $response->json('data.benefits'),
        );
    }

    public function test_applying_creates_an_applicant_at_the_first_stage(): void
    {
        $posting = $this->posting();

        $response = $this->postJson('/api/v1/careers/apply', $this->application($posting));

        $response->assertCreated();

        $applicant = Applicant::first();

        $this->assertSame('Juan Dela Cruz', $applicant->full_name);
        $this->assertSame('Applied', $applicant->stage);
        $this->assertSame('Careers Portal', $applicant->applied_via);
        $this->assertSame($posting->id, $applicant->job_posting_id);
        $this->assertNotNull($applicant->consented_at);
        $this->assertSame($response->json('data.reference'), $applicant->reference_code);
    }

    public function test_an_application_cannot_choose_its_own_stage_or_rating(): void
    {
        $posting = $this->posting();

        $this->postJson('/api/v1/careers/apply', $this->application($posting, [
            'stage' => 'Offer',
            'rating' => 5,
            'recruiterId' => 1,
        ]))->assertCreated();

        $applicant = Applicant::first();

        $this->assertSame('Applied', $applicant->stage);
        $this->assertEquals(0, $applicant->rating);
        $this->assertNull($applicant->recruiter_id);
    }

    public function test_consent_is_required(): void
    {
        $posting = $this->posting();

        $this->postJson('/api/v1/careers/apply', $this->application($posting, ['consent' => false]))
            ->assertStatus(422)
            ->assertJsonValidationErrors('consent');
    }

    public function test_reapplying_updates_the_same_application(): void
    {
        $posting = $this->posting();

        $this->postJson('/api/v1/careers/apply', $this->application($posting))->assertCreated();

        $second = $this->postJson('/api/v1/careers/apply', $this->application($posting, [
            'phone' => '09991112222',
        ]));

        $second->assertCreated();
        $this->assertTrue($second->json('data.updated'));
        $this->assertSame(1, Applicant::count());
        $this->assertSame('09991112222', Applicant::first()->phone);
    }

    public function test_a_rejected_candidate_applying_again_is_a_new_application(): void
    {
        $posting = $this->posting();

        $this->postJson('/api/v1/careers/apply', $this->application($posting))->assertCreated();

        Applicant::first()->update(['stage' => 'Rejected']);

        $this->postJson('/api/v1/careers/apply', $this->application($posting))->assertCreated();

        $this->assertSame(2, Applicant::count());
    }

    public function test_status_needs_both_the_reference_and_the_email(): void
    {
        $posting = $this->posting();

        $reference = $this->postJson('/api/v1/careers/apply', $this->application($posting))
            ->json('data.reference');

        $this->postJson('/api/v1/careers/status', [
            'reference' => $reference,
            'email' => 'juan.delacruz@example.com',
        ])->assertOk()->assertJsonPath('data.status', 'Received');

        // A right code with the wrong address is the same answer as a wrong
        // code, so this cannot be used to discover who applied.
        $this->postJson('/api/v1/careers/status', [
            'reference' => $reference,
            'email' => 'someone@else.com',
        ])->assertNotFound();

        $this->postJson('/api/v1/careers/status', [
            'reference' => 'TRN-XXX-YYYY',
            'email' => 'juan.delacruz@example.com',
        ])->assertNotFound();
    }

    public function test_a_cv_is_read_stored_and_attached_through_the_token(): void
    {
        Storage::fake('local');

        $posting = $this->posting();

        $cv = <<<'TXT'
        JUAN MIGUEL DELA CRUZ
        123 Mabini Street, Antipolo City, Rizal 1870
        juan.delacruz@example.com | 0917-555-2841

        EXPERIENCE
        Accounting Supervisor - Pacific Foods Manufacturing Inc. (2019 - Present)
        Managed accounts payable, payroll processing and BIR filing.

        EDUCATION
        University of the Philippines Diliman
        Bachelor of Science in Accountancy, 2016

        SKILLS
        Accounts Payable, Payroll, Microsoft Excel, SAP
        TXT;

        // Multipart, so the upload goes through `post` rather than `postJson`.
        $parse = $this->post('/api/v1/careers/resume/parse', [
            'resume' => UploadedFile::fake()->createWithContent('juan-cv.txt', $cv),
        ]);

        $parse->assertOk();
        $parse->assertJsonPath('data.status', 'Parsed');

        $fields = $parse->json('data.fields');

        $this->assertSame('juan.delacruz@example.com', $fields['email']);
        $this->assertSame('09175552841', $fields['phone']);
        $this->assertSame('Dela Cruz', $fields['lastName']);
        $this->assertSame('Rizal', $fields['province']);
        $this->assertSame('Bachelor', $fields['educationLevel']);

        $this->postJson('/api/v1/careers/apply', $this->application($posting, [
            'resumeToken' => $parse->json('data.token'),
        ]))->assertCreated()->assertJsonPath('data.resumeAttached', true);

        $applicant = Applicant::first();

        $this->assertSame('juan-cv.txt', $applicant->resume_original_name);
        $this->assertSame('Parsed', $applicant->resume_status);
        $this->assertNotEmpty($applicant->skills);
        $this->assertGreaterThan(0, $applicant->match_score);
        Storage::disk('local')->assertExists($applicant->resume_path);
    }

    public function test_an_unreadable_upload_still_files_the_application(): void
    {
        Storage::fake('local');

        $posting = $this->posting();

        $parse = $this->post('/api/v1/careers/resume/parse', [
            'resume' => UploadedFile::fake()->createWithContent('scan.txt', 'xx'),
        ]);

        $parse->assertOk()->assertJsonPath('data.status', 'Unreadable');
        $this->assertNotEmpty($parse->json('data.notes'));

        $this->postJson('/api/v1/careers/apply', $this->application($posting, [
            'resumeToken' => $parse->json('data.token'),
        ]))->assertCreated()->assertJsonPath('data.resumeAttached', true);

        $this->assertSame('Unreadable', Applicant::first()->resume_status);
    }

    public function test_the_parser_reads_a_philippine_cv(): void
    {
        $parsed = app(ResumeParser::class)->parseText(<<<'TXT'
        MARIA CLARA SANTOS
        45 Rizal Avenue, Barangay Poblacion, Tagum City, Davao del Norte 8100
        maria.santos@example.com | +63 918 222 3344

        PERSONAL INFORMATION
        Date of Birth: July 9, 1997
        Civil Status: Single
        Nationality: Filipino

        EXPERIENCE
        Warehouse Supervisor at Southline Logistics Corp. 2020 - Present

        EDUCATION
        Ateneo de Davao University
        BS Industrial Engineering, 2019

        SKILLS
        Inventory Management, Forklift, Microsoft Excel
        TXT);

        $fields = $parsed['fields'];

        $this->assertSame('Maria', $fields['firstName']);
        $this->assertSame('Santos', $fields['lastName']);
        $this->assertSame('09182223344', $fields['phone']);
        $this->assertSame('1997-07-09', $fields['birthdate']);
        $this->assertSame('Single', $fields['civilStatus']);
        $this->assertSame('Davao del Norte', $fields['province']);
        $this->assertSame('Tagum City', $fields['city']);
        $this->assertSame('8100', $fields['postalCode']);
        $this->assertSame('Warehouse Supervisor', $fields['currentTitle']);
        $this->assertContains('Forklift', $parsed['skills']);
        $this->assertGreaterThan(50, $parsed['confidence']);
    }
}
