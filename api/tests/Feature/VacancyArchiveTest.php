<?php

namespace Tests\Feature;

use App\Models\Applicant;
use App\Models\HrDepartment;
use App\Models\JobPosting;
use App\Models\JobRequisition;
use App\Models\Position;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Archiving a vacancy, bringing it back, and destroying it.
 *
 * The behaviour these pin is the one the old delete button got wrong: a
 * manpower request with an advert on the careers site could not be cleared at
 * all, and the refusal told people to go and do two other things first. What
 * has to stay true now is that archiving always works and loses nothing, and
 * that destroying is possible but still refuses where a hire or an application
 * points at the record.
 */
class VacancyArchiveTest extends TestCase
{
    use RefreshDatabase;

    private Position $position;

    private HrDepartment $department;

    protected function setUp(): void
    {
        parent::setUp();

        Sanctum::actingAs(User::create([
            'name' => 'HR Officer',
            'email' => 'hr@example.com',
            'password' => bcrypt('secret-for-tests'),
        ]));

        $this->position = Position::create(['title' => 'Accounting Head']);
        $this->department = HrDepartment::create(['code' => 'FIN', 'name' => 'Finance']);
    }

    private function requisition(array $overrides = []): JobRequisition
    {
        return JobRequisition::create(array_merge([
            'requisition_no' => 'MRF-2026-0005',
            'position_id' => $this->position->id,
            'hr_department_id' => $this->department->id,
            'headcount' => 1,
            'status' => 'Sourcing',
        ], $overrides));
    }

    private function advert(JobRequisition $requisition): JobPosting
    {
        return JobPosting::create([
            'title' => 'Accounting Head',
            'job_requisition_id' => $requisition->id,
            'position_id' => $this->position->id,
            'hr_department_id' => $this->department->id,
            'summary' => 'Runs the accounting team.',
            'openings' => 1,
            'status' => 'Published',
            'published_at' => now(),
        ]);
    }

    /* ------------------------------------------------------------------ */

    public function test_archiving_takes_the_vacancy_and_its_advert_down(): void
    {
        // Exactly the case the old delete refused on.
        $requisition = $this->requisition();
        $advert = $this->advert($requisition);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive", [
            'reason' => 'Budget pulled for the quarter.',
        ])->assertOk()->assertJsonPath('data.adverts', 1);

        // Off the board, and off the internet.
        $this->assertSame(0, JobRequisition::where('id', $requisition->id)->count());
        $this->assertSame(0, JobPosting::where('id', $advert->id)->count());
        $this->getJson('/api/v1/careers/jobs')->assertJsonCount(0, 'data.jobs');

        // But kept, with the reason.
        $archived = JobRequisition::onlyTrashed()->find($requisition->id);

        $this->assertNotNull($archived);
        $this->assertSame('Budget pulled for the quarter.', $archived->archived_reason);
        $this->assertSame('Cancelled', $archived->status);
    }

    public function test_archiving_says_who_is_still_in_the_pipeline(): void
    {
        $requisition = $this->requisition();

        Applicant::create([
            'applicant_no' => 'APP-1', 'full_name' => 'Juan Dela Cruz',
            'job_requisition_id' => $requisition->id,
            'applied_on' => now()->toDateString(), 'stage' => 'Interview',
        ]);

        // A recruiter who has just archived a vacancy with somebody mid-
        // interview needs to know now, not next week.
        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")
            ->assertOk()
            ->assertJsonPath('data.applicants', 1);
    }

    public function test_restoring_brings_the_advert_back_as_a_draft(): void
    {
        $requisition = $this->requisition();
        $advert = $this->advert($requisition);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();
        $this->postJson("/api/v1/hr/vacancy-archive/{$requisition->id}/restore")->assertOk();

        $this->assertSame('Approved', JobRequisition::find($requisition->id)->status);

        /* Never re-published. It was taken off the site by an act somebody
           meant; putting it back in front of the public is a second decision. */
        $advert->refresh();

        $this->assertSame('Draft', $advert->status);
        $this->assertNull($advert->published_at);
        $this->getJson('/api/v1/careers/jobs')->assertJsonCount(0, 'data.jobs');
    }

    public function test_a_vacancy_can_finally_be_deleted_from_the_archive(): void
    {
        $requisition = $this->requisition();
        $advert = $this->advert($requisition);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();
        $this->deleteJson("/api/v1/hr/vacancy-archive/{$requisition->id}")->assertOk();

        // Gone for good, and the advert with it — an advert nobody applied to
        // has no life of its own once its request is destroyed.
        $this->assertSame(0, JobRequisition::withTrashed()->where('id', $requisition->id)->count());
        $this->assertSame(0, JobPosting::withTrashed()->where('id', $advert->id)->count());
    }

    public function test_nothing_is_deleted_straight_from_the_board(): void
    {
        $requisition = $this->requisition();

        // Not archived yet, so the archive route does not know it.
        $this->deleteJson("/api/v1/hr/vacancy-archive/{$requisition->id}")->assertNotFound();

        // And the generic delete points at the archive rather than refusing
        // with nothing to do about it.
        $response = $this->deleteJson("/api/v1/hr/requisitions/{$requisition->id}");

        $response->assertStatus(422);
        $this->assertStringContainsString('archived', $response->json('message'));
        $this->assertSame(1, JobRequisition::where('id', $requisition->id)->count());
    }

    public function test_a_vacancy_that_produced_a_hire_stays_in_the_archive(): void
    {
        $requisition = $this->requisition(['headcount' => 2, 'filled' => 1]);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();

        $response = $this->deleteJson("/api/v1/hr/vacancy-archive/{$requisition->id}");

        $response->assertStatus(422);
        $this->assertStringContainsString('hire', $response->json('message'));
        $this->assertSame(1, JobRequisition::onlyTrashed()->where('id', $requisition->id)->count());
    }

    public function test_a_vacancy_with_applicants_stays_in_the_archive(): void
    {
        $requisition = $this->requisition();

        Applicant::create([
            'applicant_no' => 'APP-1', 'full_name' => 'Juan Dela Cruz',
            'job_requisition_id' => $requisition->id,
            'applied_on' => now()->toDateString(), 'stage' => 'Rejected',
        ]);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();

        // Even a rejected one: their application still points at the vacancy.
        $this->deleteJson("/api/v1/hr/vacancy-archive/{$requisition->id}")->assertStatus(422);
    }

    public function test_an_advert_somebody_applied_to_stays_in_the_archive(): void
    {
        $requisition = $this->requisition();
        $advert = $this->advert($requisition);

        Applicant::create([
            'applicant_no' => 'APP-1', 'full_name' => 'Juan Dela Cruz',
            'job_posting_id' => $advert->id,
            'applied_on' => now()->toDateString(), 'stage' => 'Applied',
        ]);

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();

        $response = $this->deleteJson("/api/v1/hr/vacancy-archive/{$requisition->id}");

        $response->assertStatus(422);
        $this->assertStringContainsString('applied', $response->json('message'));
    }

    public function test_the_archive_lists_what_can_and_cannot_be_deleted(): void
    {
        $clear = $this->requisition(['requisition_no' => 'MRF-2026-0005']);
        $hired = $this->requisition(['requisition_no' => 'MRF-2026-0006', 'headcount' => 2, 'filled' => 1]);

        $this->postJson("/api/v1/hr/requisitions/{$clear->id}/archive")->assertOk();
        $this->postJson("/api/v1/hr/requisitions/{$hired->id}/archive")->assertOk();

        $response = $this->getJson('/api/v1/hr/vacancy-archive');

        $response->assertOk()
            ->assertJsonPath('data.counts.total', 2)
            // The screen disables the delete on one of them, and says why.
            ->assertJsonPath('data.counts.deletable', 1);
    }

    public function test_an_archived_advert_still_holds_its_slug(): void
    {
        /*
         * The unique index on `slug` does not care that a row is soft-deleted.
         * Without checking archived adverts too, the next advert of the same
         * name would be refused by the database with a constraint error
         * nobody could act on.
         */
        $first = $this->requisition();
        $advert = $this->advert($first);

        $this->postJson("/api/v1/hr/requisitions/{$first->id}/archive")->assertOk();

        $second = $this->requisition(['requisition_no' => 'MRF-2026-0006']);
        $again = $this->advert($second);

        $this->assertNotSame($advert->slug, $again->slug);
        $this->assertSame('accounting-head-2', $again->slug);
    }

    public function test_an_archived_vacancy_is_off_every_working_list(): void
    {
        $requisition = $this->requisition();

        $this->getJson('/api/v1/hr/requisitions')->assertJsonCount(1, 'data');

        $this->postJson("/api/v1/hr/requisitions/{$requisition->id}/archive")->assertOk();

        $this->getJson('/api/v1/hr/requisitions')->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/hr/job-postings')->assertJsonCount(0, 'data');
    }
}
