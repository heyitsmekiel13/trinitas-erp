<?php

namespace Tests\Feature;

use App\Models\Applicant;
use App\Models\HrDepartment;
use App\Models\JobPosting;
use App\Models\JobRequisition;
use App\Models\Position;
use App\Models\User;
use App\Services\CandidateAssessment;
use App\Services\OfferDocuments;
use App\Services\RoleLibrary;
use App\Services\Settings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The paperwork, and the advert that writes itself.
 *
 * The document tests are structural rather than about wording: a .docx built
 * by hand is a zip of XML, and the failure mode is a file Word refuses to open
 * rather than one that reads badly. So they assert the parts are there, the
 * XML parses, and the candidate's own details actually reached the page.
 */
class OfferDocumentsTest extends TestCase
{
    use RefreshDatabase;

    private function applicant(array $overrides = []): Applicant
    {
        return Applicant::create(array_merge([
            'applicant_no' => 'APP-2026-0001',
            'reference_code' => 'TRN-DOC-0001',
            'full_name' => 'Exekiel Albert Y. Tulio',
            'first_name' => 'Exekiel Albert',
            'middle_name' => 'Y.',
            'last_name' => 'Tulio',
            'email' => 'exekiel@example.com',
            'address_line' => 'Buhangin',
            'city' => 'Davao City',
            'province' => 'Davao del Sur',
            'offer_position' => 'Process Excellence Specialist',
            'offer_salary' => 24090,
            'offer_daily_rate' => 770,
            'offer_de_minimis' => 150,
            'offer_start_date' => '2026-09-01',
            'offer_sent_at' => now(),
            'applied_on' => now()->toDateString(),
            'stage' => 'Offer',
        ], $overrides));
    }

    /** The document's text, pulled back out of the zip. */
    private function textOf(string $bytes): string
    {
        $path = tempnam(sys_get_temp_dir(), 'test');
        file_put_contents($path, $bytes);

        $zip = new \ZipArchive;
        $this->assertTrue($zip->open($path) === true, 'the document should be a readable zip');

        foreach (['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'] as $part) {
            $this->assertNotFalse($zip->getFromName($part), "missing part: {$part}");
        }

        $xml = (string) $zip->getFromName('word/document.xml');
        $zip->close();
        @unlink($path);

        // Word rejects a document whose XML does not parse, and a stray
        // ampersand in somebody's employer name is exactly how that happens.
        $this->assertNotFalse(simplexml_load_string($xml), 'document.xml should be well-formed');

        return html_entity_decode(strip_tags(preg_replace('/<w:p\b[^>]*>/', "\n", $xml) ?? $xml), ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    public function test_the_offer_letter_states_the_terms_that_were_recorded(): void
    {
        app(Settings::class)->set('company', 'signatory_name', 'Jett Bernard Y. Lu');

        $text = $this->textOf(app(OfferDocuments::class)->offerLetter($this->applicant())['bytes']);

        $this->assertStringContainsString('EXEKIEL ALBERT Y. TULIO', $text);
        $this->assertStringContainsString('Process Excellence Specialist', $text);
        $this->assertStringContainsString('September 1, 2026', $text);
        $this->assertStringContainsString('180 days (6 months)', $text);

        // The daily figures, and the total of the two.
        $this->assertStringContainsString('770.00', $text);
        $this->assertStringContainsString('150.00', $text);
        $this->assertStringContainsString('920.00', $text);

        $this->assertStringContainsString('Jett Bernard Y. Lu', $text);
        $this->assertStringContainsString('Signature over Printed Name', $text);
    }

    public function test_the_medical_requirement_is_fit_to_work_and_nothing_more(): void
    {
        $text = $this->textOf(app(OfferDocuments::class)->offerLetter($this->applicant())['bytes']);

        $this->assertStringContainsString('Medical Certificate (Fit to Work)', $text);

        // Naming a panel of tests on an offer letter commits the company to
        // requiring them, and most roles here do not need them.
        foreach (['Urinalysis', 'Fecalysis', 'Pregnancy Test', 'Drug Test', 'Chest X-Ray', 'Hepa B'] as $test) {
            $this->assertStringNotContainsString($test, $text);
        }
    }

    public function test_the_daily_rate_is_derived_when_it_is_not_given(): void
    {
        $applicant = $this->applicant(['offer_daily_rate' => null, 'offer_de_minimis' => null]);

        $text = $this->textOf(app(OfferDocuments::class)->offerLetter($applicant)['bytes']);

        // 24,090 x 12 / 313 working days = 923.58 a day, through payroll's
        // own factor — so the figure in the letter is the one the first
        // payslip will produce rather than a second opinion about it.
        $this->assertStringContainsString('923.58', $text);
    }

    public function test_the_referral_slip_carries_no_compensation(): void
    {
        // It is handed across a clinic reception desk. A receptionist has no
        // business reading somebody's salary.
        $text = $this->textOf(app(OfferDocuments::class)->referralSlip($this->applicant())['bytes']);

        $this->assertStringContainsString('Exekiel Albert Y. Tulio', $text);
        $this->assertStringContainsString('Fit to Work', $text);

        foreach (['770', '150', '920', '24,090'] as $figure) {
            $this->assertStringNotContainsString($figure, $text);
        }
    }

    public function test_a_name_with_an_ampersand_does_not_break_the_document(): void
    {
        $applicant = $this->applicant([
            'offer_position' => 'Research & Development Officer',
            'offer_notes' => 'Reporting to R&D, <not> a template placeholder.',
        ]);

        $text = $this->textOf(app(OfferDocuments::class)->offerLetter($applicant)['bytes']);

        $this->assertStringContainsString('Research & Development Officer', $text);
    }

    public function test_the_letter_downloads_as_a_word_file(): void
    {
        Sanctum::actingAs(User::create([
            'name' => 'HR', 'email' => 'hr@example.com', 'password' => bcrypt('secret-for-tests'),
        ]));

        $applicant = $this->applicant();

        $this->get("/api/v1/hr/applicants/{$applicant->id}/offer/document")
            ->assertOk()
            ->assertHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            );
    }

    /* ------------------------------------------------------------------ */

    public function test_an_advert_is_drafted_from_the_role_and_its_level(): void
    {
        $library = app(RoleLibrary::class);

        $supervisor = $library->draft(null, null, 'Accounting Supervisor');
        $clerk = $library->draft(null, null, 'Accounting Clerk');

        $this->assertSame('Mid-Senior', $supervisor['experienceLevel']);
        $this->assertSame('Entry level', $clerk['experienceLevel']);

        // A supervisor's advert asks for supervisory experience; a clerk's
        // does not, and welcomes people starting out.
        $this->assertStringContainsString('supervisory role', $supervisor['qualifications']);
        $this->assertStringContainsString('Fresh graduates', $clerk['qualifications']);

        // And both are recognisably about accounting.
        $this->assertStringContainsString('BIR', $supervisor['responsibilities']);
    }

    public function test_the_drafted_qualifications_are_readable_by_the_assessment(): void
    {
        /*
         * The whole point of phrasing them this way. An advert written by the
         * library has to be one the screening can actually score against, or
         * every applicant to it comes back "not enough to say".
         */
        $draft = app(RoleLibrary::class)->draft(null, null, 'Warehouse Supervisor');

        $posting = new JobPosting([
            'title' => $draft['title'],
            'qualifications' => $draft['qualifications'],
            'summary' => $draft['summary'],
        ]);

        $result = app(CandidateAssessment::class)->assess([
            'text' => 'Warehouse Supervisor with six years running a distribution warehouse. '
                .'Inventory management, forklift certified, cycle counting.',
            'skills' => ['Inventory Management', 'Forklift'],
            'yearsExperience' => 6.0,
            'educationLevel' => 'Bachelor',
            'currentTitle' => 'Warehouse Supervisor',
            'positions' => [],
        ], $posting);

        $experience = collect($result['signals'])->firstWhere('label', 'Experience');

        // The years requirement was read out of the drafted advert, not
        // guessed — which is what "3 years wanted" proves.
        $this->assertSame('met', $experience['status']);
        $this->assertStringContainsString('3 years wanted', $experience['detail']);
        $this->assertNotSame('Not enough to say', $result['band']);
    }

    public function test_an_approved_budget_rate_beats_the_indicative_range(): void
    {
        $position = Position::create(['title' => 'Warehouse Checker']);
        $department = HrDepartment::create(['code' => 'OPS', 'name' => 'Operations']);

        $requisition = JobRequisition::create([
            'requisition_no' => 'MRF-2026-0001',
            'position_id' => $position->id,
            'hr_department_id' => $department->id,
            'headcount' => 1,
            'budget_rate' => 20000,
            'status' => 'Approved',
        ]);

        $withBudget = app(RoleLibrary::class)->draft($position, $requisition);
        $without = app(RoleLibrary::class)->draft($position, null);

        $this->assertSame('budget', $withBudget['salaryBasis']);
        $this->assertSame('indicative', $without['salaryBasis']);

        // Built around the company's own approved figure rather than a market
        // guess — publishing a made-up band is worse than publishing none.
        $this->assertEqualsWithDelta(18000, $withBudget['salaryMin'], 1);
        $this->assertEqualsWithDelta(23000, $withBudget['salaryMax'], 1);
    }
}
