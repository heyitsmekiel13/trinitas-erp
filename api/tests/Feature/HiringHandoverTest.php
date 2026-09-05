<?php

namespace Tests\Feature;

use App\Models\Applicant;
use App\Models\BranchUnit;
use App\Models\BusinessGroup;
use App\Models\Employee;
use App\Models\HrDepartment;
use App\Models\JobRequisition;
use App\Models\PayrollGroup;
use App\Models\Position;
use App\Models\Shift;
use App\Models\User;
use App\Services\EmployeeProfile;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The handover from recruitment to HR, and the offer that precedes it.
 *
 * Three things are pinned here, each of which was a real gap:
 *
 *   A hire carries the application across. Everything the candidate gave was
 *   being thrown away and re-keyed, which in practice meant not re-keyed.
 *
 *   An incomplete 201 file says so, in the terms that matter — what it blocks,
 *   not how many boxes are empty — and cannot be signed off while payroll
 *   would break on it.
 *
 *   An offer is a record with terms on it, and the salary that was offered is
 *   the salary the 201 file starts on. The two used to be typed separately.
 */
class HiringHandoverTest extends TestCase
{
    use RefreshDatabase;

    private Applicant $applicant;

    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();

        Sanctum::actingAs(User::create([
            'name' => 'HR Officer',
            'email' => 'hr@example.com',
            'password' => bcrypt('secret-for-tests'),
        ]));

        $business = BusinessGroup::create(['code' => 'TFC', 'name' => 'Trinitas']);
        $branch = BranchUnit::create(['code' => 'HO', 'name' => 'Head Office', 'business_group_id' => $business->id]);
        $department = HrDepartment::create(['code' => 'FIN', 'name' => 'Finance']);
        $position = Position::create(['title' => 'Accounting Supervisor']);
        $payroll = PayrollGroup::create([
            'code' => 'MAIN', 'name' => 'Main', 'frequency' => 'S', 'statutory_schedule' => 'second',
        ]);

        $this->ids = [
            'department' => $department->id,
            'branch' => $branch->id,
            'payroll' => $payroll->id,
            'position' => $position->id,
        ];

        $requisition = JobRequisition::create([
            'requisition_no' => 'MRF-2026-0001',
            'position_id' => $position->id,
            'hr_department_id' => $department->id,
            'branch_unit_id' => $branch->id,
            'headcount' => 2,
            'budget_rate' => 38000,
            'status' => 'Approved',
        ]);

        $this->applicant = Applicant::create([
            'applicant_no' => 'APP-2026-0001',
            'reference_code' => 'TRN-ABC-1234',
            'full_name' => 'Juan Miguel Dela Cruz',
            'first_name' => 'Juan', 'middle_name' => 'Miguel', 'last_name' => 'Dela Cruz',
            'email' => 'juan.delacruz@example.com',
            'phone' => '09175552841',
            'birthdate' => '1994-03-14',
            'civil_status' => 'Married',
            'address_line' => '123 Mabini Street',
            'city' => 'Antipolo City',
            'province' => 'Rizal',
            'postal_code' => '1870',
            'position_id' => $position->id,
            'job_requisition_id' => $requisition->id,
            'applied_on' => now()->subMonth()->toDateString(),
            'stage' => 'Final Interview',
        ]);
    }

    private function hire(array $overrides = []): array
    {
        return $this->postJson("/api/v1/hr/applicants/{$this->applicant->id}/hire", array_merge([
            'firstName' => 'Juan',
            'lastName' => 'Dela Cruz',
            'payrollGroupId' => $this->ids['payroll'],
        ], $overrides))->json('data');
    }

    /* ------------------------------------------------------------------ */

    public function test_a_hire_carries_the_application_into_the_201_file(): void
    {
        $this->hire();

        $employee = Employee::first();

        $this->assertSame('Miguel', $employee->middle_name);
        $this->assertSame('juan.delacruz@example.com', $employee->email);
        $this->assertSame('09175552841', $employee->mobile);
        $this->assertSame('1994-03-14', $employee->birth_date->toDateString());
        // The masterfile stores a letter; the application asks in words.
        $this->assertSame('M', $employee->civil_status);
        $this->assertSame('123 Mabini Street, Antipolo City, Rizal, 1870', $employee->address);

        // And the route back to the CV and the assessment.
        $this->assertSame($this->applicant->id, $employee->hired_from_applicant_id);
    }

    public function test_the_hire_says_what_the_application_could_not_answer(): void
    {
        $result = $this->hire();

        $this->assertArrayHasKey('profile', $result);

        $missing = collect($result['profile']['missing'])->pluck('key');

        // Nothing on an application can supply these.
        foreach (['tin', 'sss_no', 'philhealth_no', 'pagibig_no', 'shift_id'] as $key) {
            $this->assertTrue($missing->contains($key), "expected {$key} to be reported missing");
        }

        // And nothing it *did* supply is reported missing.
        foreach (['birth_date', 'address', 'mobile', 'email'] as $key) {
            $this->assertFalse($missing->contains($key), "{$key} came from the application and should be filled");
        }

        $this->assertSame('Cannot be paid', $result['profile']['status']);
    }

    public function test_the_salary_defaults_to_the_offer_that_was_accepted(): void
    {
        $this->applicant->update(['offer_salary' => 42000, 'offer_sent_at' => now()]);

        $this->hire();

        // Not the requisition's 38,000 budget rate — the figure actually put
        // in writing to the candidate is the one they agreed to.
        $this->assertEqualsWithDelta(42000.0, (float) Employee::first()->salary, 0.01);
    }

    public function test_a_file_that_would_break_payroll_cannot_be_signed_off(): void
    {
        $this->hire();

        $employee = Employee::first();

        $this->postJson("/api/v1/hr/employees/{$employee->id}/onboarding/complete")
            ->assertStatus(422);

        $this->assertNull($employee->refresh()->onboarding_completed_at);
    }

    public function test_a_file_with_only_statutory_gaps_may_be_signed_off(): void
    {
        // A missing SSS number is worth chasing and not worth leaving a record
        // permanently open over — somebody genuinely unregistered would never
        // be closable, and a queue that cannot be emptied stops being read.
        $this->hire();

        $employee = Employee::first();
        $shift = Shift::create(['name' => 'Day 8:00-17:00', 'starts_at' => '08:00', 'ends_at' => '17:00']);

        $employee->update(['shift_id' => $shift->id, 'atm_account' => '000123456789']);

        $this->postJson("/api/v1/hr/employees/{$employee->id}/onboarding/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'Filings incomplete');

        $this->assertNotNull($employee->refresh()->onboarding_completed_at);
    }

    public function test_a_cash_payee_is_never_asked_for_a_bank_account(): void
    {
        $this->hire();

        $employee = Employee::first();
        $employee->update(['payment_mode' => 'CASH']);

        $missing = collect(app(EmployeeProfile::class)->gaps($employee->fresh()))->pluck('key');

        $this->assertFalse($missing->contains('atm_account'));
    }

    public function test_an_exemption_is_an_answer_not_a_gap(): void
    {
        $this->hire();

        $employee = Employee::first();
        $employee->update(['sss_exempted' => true, 'tax_exempted' => true]);

        $missing = collect(app(EmployeeProfile::class)->gaps($employee->fresh()))->pluck('key');

        $this->assertFalse($missing->contains('sss_no'));
        $this->assertFalse($missing->contains('tin'));
    }

    public function test_the_outstanding_queue_and_the_bell_both_name_the_problem(): void
    {
        $this->hire();

        $this->getJson('/api/v1/hr/onboarding')
            ->assertOk()
            ->assertJsonPath('data.counts.blocking', 1)
            ->assertJsonPath('data.counts.fromHire', 1);

        $bell = $this->getJson('/api/v1/notifications')->assertOk();

        $this->assertGreaterThan(0, $bell->json('data.unread'));
        $this->assertStringContainsString('cannot be paid', $bell->json('data.items.0.title'));
    }

    /* ------------------------------------------------------------------ */

    public function test_sending_an_offer_records_the_terms_and_moves_the_stage(): void
    {
        Mail::fake();

        $response = $this->postJson("/api/v1/hr/applicants/{$this->applicant->id}/offer", [
            'salary' => 42000,
            'startDate' => now()->addWeeks(2)->toDateString(),
            'expiresOn' => now()->addWeek()->toDateString(),
            'notes' => 'Probationary for six months.',
        ]);

        $response->assertOk();

        $this->applicant->refresh();

        $this->assertEqualsWithDelta(42000.0, (float) $this->applicant->offer_salary, 0.01);
        $this->assertNotNull($this->applicant->offer_sent_at);
        $this->assertSame('Offer', $this->applicant->stage);
        $this->assertNull($this->applicant->offer_response);
    }

    public function test_an_offer_cannot_be_sent_without_an_email_address(): void
    {
        $this->applicant->update(['email' => null]);

        $this->postJson("/api/v1/hr/applicants/{$this->applicant->id}/offer", ['salary' => 42000])
            ->assertStatus(422);

        $this->assertNull($this->applicant->refresh()->offer_sent_at);
    }

    public function test_the_candidate_answers_with_the_reference_and_email_together(): void
    {
        $this->applicant->update([
            'offer_salary' => 42000, 'offer_sent_at' => now(), 'stage' => 'Offer',
        ]);

        // The wrong email against a right code is the same answer as a wrong
        // code, so a forwarded link is useless on its own.
        $this->postJson('/api/v1/careers/offer/respond', [
            'reference' => 'TRN-ABC-1234',
            'email' => 'someone@else.com',
            'decision' => 'Accepted',
        ])->assertNotFound();

        $this->postJson('/api/v1/careers/offer/respond', [
            'reference' => 'TRN-ABC-1234',
            'email' => 'juan.delacruz@example.com',
            'decision' => 'Accepted',
        ])->assertOk();

        $this->assertSame('Accepted', $this->applicant->refresh()->offer_response);
    }

    public function test_declining_ends_the_application_and_frees_the_seat(): void
    {
        $this->applicant->update(['offer_sent_at' => now(), 'stage' => 'Offer']);

        $this->postJson('/api/v1/careers/offer/respond', [
            'reference' => 'TRN-ABC-1234',
            'email' => 'juan.delacruz@example.com',
            'decision' => 'Declined',
            'reason' => 'Took another role closer to home.',
        ])->assertOk();

        $this->applicant->refresh();

        $this->assertSame('Declined', $this->applicant->offer_response);
        $this->assertSame('Rejected', $this->applicant->stage);
        $this->assertSame('Took another role closer to home.', $this->applicant->offer_decline_reason);
    }

    public function test_an_offer_cannot_be_answered_twice(): void
    {
        $this->applicant->update([
            'offer_sent_at' => now(), 'stage' => 'Offer',
            'offer_response' => 'Accepted', 'offer_responded_at' => now(),
        ]);

        $this->postJson('/api/v1/careers/offer/respond', [
            'reference' => 'TRN-ABC-1234',
            'email' => 'juan.delacruz@example.com',
            'decision' => 'Declined',
        ])->assertStatus(422);

        $this->assertSame('Accepted', $this->applicant->refresh()->offer_response);
    }

    public function test_an_expired_offer_refuses(): void
    {
        $this->applicant->update([
            'offer_sent_at' => now()->subWeeks(3),
            'offer_expires_on' => now()->subWeek()->toDateString(),
            'stage' => 'Offer',
        ]);

        $this->postJson('/api/v1/careers/offer/respond', [
            'reference' => 'TRN-ABC-1234',
            'email' => 'juan.delacruz@example.com',
            'decision' => 'Accepted',
        ])->assertStatus(422);

        $this->assertNull($this->applicant->refresh()->offer_response);
    }
}
