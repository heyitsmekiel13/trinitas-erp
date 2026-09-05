<?php

namespace Tests\Feature;

use App\Models\Applicant;
use App\Models\HrDepartment;
use App\Models\JobPosting;
use App\Models\JobRequisition;
use App\Models\Position;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The recruiter's half: encoding an applicant, and what happens to a CV once
 * it is on file.
 *
 * The behaviour worth pinning down is the one that is easiest to quietly
 * regress: parsed values must never reach the applicant record on their own.
 * A future refactor that "helpfully" merges them would pass every other test
 * in this suite and silently make a machine guess indistinguishable from a
 * checked fact.
 */
class RecruitmentIntakeTest extends TestCase
{
    use RefreshDatabase;

    private const CV = <<<'TXT'
    MARIA CLARA SANTOS
    45 Rizal Avenue, Tagum City, Davao del Norte 8100
    maria.santos@example.com | +63 918 222 3344

    EXPERIENCE
    Warehouse Supervisor at Southline Logistics Corp. 2020 - Present

    EDUCATION
    Ateneo de Davao University
    BS Industrial Engineering, 2019

    SKILLS
    Inventory Management, Forklift, Microsoft Excel
    TXT;

    protected function setUp(): void
    {
        parent::setUp();

        Sanctum::actingAs(User::create([
            'name' => 'HR Officer',
            'email' => 'hr@example.com',
            'password' => bcrypt('secret-for-tests'),
        ]));
    }

    public function test_the_intake_form_creates_a_full_applicant_record(): void
    {
        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $response = $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'middleName' => 'Clara',
            'lastName' => 'Santos',
            'email' => 'maria.santos@example.com',
            'phone' => '09182223344',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
            'city' => 'Tagum City',
            'province' => 'Davao del Norte',
            'educationLevel' => 'Bachelor',
            'school' => 'Ateneo de Davao University',
            'course' => 'BS Industrial Engineering',
            'yearGraduated' => 2019,
            'yearsExperience' => 6,
            'currentTitle' => 'Warehouse Supervisor',
            'skills' => ['Forklift', 'Inventory Management'],
            'screeningNotes' => 'Strong on the warehouse side.',
        ]);

        $response->assertCreated();

        $applicant = Applicant::first();

        $this->assertSame('Maria Clara Santos', $applicant->full_name);
        $this->assertSame('HR Encoded', $applicant->applied_via);
        $this->assertSame('Applied', $applicant->stage);
        $this->assertSame('Davao del Norte', $applicant->province);
        $this->assertSame(['Forklift', 'Inventory Management'], $applicant->skills);
        $this->assertSame('Strong on the warehouse side.', $applicant->screening_notes);
    }

    public function test_a_parsed_cv_is_kept_as_a_suggestion_not_written_to_the_record(): void
    {
        Storage::fake('local');

        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $parse = $this->post('/api/v1/hr/recruitment/parse-resume', [
            'resume' => UploadedFile::fake()->createWithContent('maria-cv.txt', self::CV),
        ]);

        $parse->assertOk()->assertJsonPath('data.status', 'Parsed');

        // The recruiter keys a corrected surname and ignores the rest.
        $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'lastName' => 'Reyes-Santos',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
            'resumeToken' => $parse->json('data.token'),
        ])->assertCreated();

        $applicant = Applicant::first();

        // What the person typed stands. The CV said "Santos"; nobody agreed.
        $this->assertSame('Reyes-Santos', $applicant->last_name);
        $this->assertNull($applicant->province);
        $this->assertNull($applicant->school);

        // But it is all on record as a suggestion, ready to be offered.
        $this->assertSame('Santos', $applicant->resume_parsed['fields']['lastName']);
        $this->assertSame('Davao del Norte', $applicant->resume_parsed['fields']['province']);

        $detail = $this->getJson("/api/v1/hr/applicants/{$applicant->id}/detail");

        $detail->assertOk();
        $this->assertSame('Reyes-Santos', $detail->json('data.lastName'));
        $this->assertSame('Santos', $detail->json('data.resume.parsedFields.lastName'));
        $this->assertNotEmpty($detail->json('data.resume.excerpt'));
    }

    public function test_a_recruiter_can_accept_a_suggestion_one_field_at_a_time(): void
    {
        Storage::fake('local');

        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $parse = $this->post('/api/v1/hr/recruitment/parse-resume', [
            'resume' => UploadedFile::fake()->createWithContent('maria-cv.txt', self::CV),
        ]);

        $created = $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'lastName' => 'Santos',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
            'resumeToken' => $parse->json('data.token'),
        ]);

        $id = $created->json('data.id');

        $this->patchJson("/api/v1/hr/applicants/{$id}/details", [
            'province' => 'Davao del Norte',
        ])->assertOk()->assertJsonPath('data.personal.province', 'Davao del Norte');

        $applicant = Applicant::find($id);

        $this->assertSame('Davao del Norte', $applicant->province);
        // Only what was sent. The other suggestions are untouched.
        $this->assertNull($applicant->school);
    }

    public function test_details_cannot_move_an_applicant_through_the_pipeline(): void
    {
        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $id = $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'lastName' => 'Santos',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
        ])->json('data.id');

        $this->patchJson("/api/v1/hr/applicants/{$id}/details", ['stage' => 'Offer'])->assertOk();

        $this->assertSame('Applied', Applicant::find($id)->stage);
    }

    public function test_replacing_a_cv_removes_the_file_it_replaced(): void
    {
        Storage::fake('local');

        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $id = $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'lastName' => 'Santos',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
        ])->json('data.id');

        $this->post("/api/v1/hr/applicants/{$id}/resume", [
            'resume' => UploadedFile::fake()->createWithContent('first.txt', self::CV),
        ])->assertOk();

        $first = Applicant::find($id)->resume_path;
        Storage::disk('local')->assertExists($first);

        $this->post("/api/v1/hr/applicants/{$id}/resume", [
            'resume' => UploadedFile::fake()->createWithContent('second.txt', self::CV),
        ])->assertOk();

        $applicant = Applicant::find($id);

        $this->assertSame('second.txt', $applicant->resume_original_name);
        $this->assertNotSame($first, $applicant->resume_path);
        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($applicant->resume_path);
    }

    public function test_a_cv_is_only_downloadable_by_somebody_signed_in(): void
    {
        Storage::fake('local');

        $position = Position::create(['title' => 'Warehouse Supervisor']);

        $id = $this->postJson('/api/v1/hr/recruitment/intake', [
            'firstName' => 'Maria',
            'lastName' => 'Santos',
            'positionId' => $position->id,
            'source' => 'Walk-in',
            'appliedOn' => now()->toDateString(),
        ])->json('data.id');

        $this->post("/api/v1/hr/applicants/{$id}/resume", [
            'resume' => UploadedFile::fake()->createWithContent('cv.txt', self::CV),
        ])->assertOk();

        $this->get("/api/v1/hr/applicants/{$id}/resume")->assertOk();

        // A resume carries a home address and a date of birth. It has no
        // shareable URL, and no unauthenticated route to it.
        app('auth')->forgetGuards();
        $this->app['auth']->guard('sanctum')->forgetUser();

        $this->getJson("/api/v1/hr/applicants/{$id}/resume", ['Authorization' => 'Bearer nonsense'])
            ->assertUnauthorized();
    }

    public function test_publishing_a_posting_needs_something_written_in_it(): void
    {
        $bare = JobPosting::create(['title' => 'Mystery Role', 'openings' => 1]);

        $this->postJson("/api/v1/hr/job-postings/{$bare->id}/publish")
            ->assertStatus(422);

        $bare->update(['summary' => 'Runs the accounting team for the Rizal branch.']);

        $this->postJson("/api/v1/hr/job-postings/{$bare->id}/publish")->assertOk();

        $bare->refresh();

        $this->assertSame('Published', $bare->status);
        $this->assertNotNull($bare->published_at);
    }

    public function test_a_posting_drafted_from_a_requisition_inherits_it(): void
    {
        $position = Position::create(['title' => 'Accounting Supervisor']);
        $department = HrDepartment::create(['code' => 'FIN', 'name' => 'Finance']);

        $requisition = JobRequisition::create([
            'requisition_no' => 'MRF-2026-0001',
            'position_id' => $position->id,
            'hr_department_id' => $department->id,
            'headcount' => 3,
            'status' => 'Approved',
        ]);

        $response = $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/posting");

        $response->assertCreated();
        $this->assertSame('Accounting Supervisor', $response->json('data.title'));
        $this->assertSame(3, $response->json('data.openings'));

        // Asked for twice, the same advert comes back rather than a duplicate.
        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/posting")->assertOk();
        $this->assertSame(1, JobPosting::count());
    }
}
