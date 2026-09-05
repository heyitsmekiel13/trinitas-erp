<?php

namespace Tests\Feature;

use App\Models\JobPosting;
use App\Services\CandidateAssessment;
use App\Services\ResumeParser;
use Tests\TestCase;

/**
 * The screening opinion, and the promises it makes.
 *
 * These are not "does the score look about right" tests. Each one pins a
 * property that the previous keyword-overlap version got wrong and that would
 * be easy to lose again: gaps are not experience, unknown is not failure, an
 * empty advert cannot produce a strong match, and every verdict carries the
 * evidence that produced it.
 */
class CandidateAssessmentTest extends TestCase
{
    private const CV = <<<'TXT'
    JUAN MIGUEL DELA CRUZ
    123 Mabini Street, Antipolo City, Rizal 1870
    juan.delacruz@example.com | 0917-555-2841

    EXPERIENCE
    Accounting Supervisor - Pacific Foods Manufacturing Inc. (2019 - 2024)
    Managed accounts payable, payroll processing and BIR filing.

    Junior Accountant, Northline Trading Corp. 2016 - 2019
    Handled bookkeeping and bank reconciliation.

    EDUCATION
    University of the Philippines Diliman
    Bachelor of Science in Accountancy, 2016

    SKILLS
    Accounts Payable, Payroll, BIR Filing, Microsoft Excel, SAP
    TXT;

    private function posting(array $overrides = []): JobPosting
    {
        return new JobPosting(array_merge([
            'title' => 'Accounting Supervisor',
            'qualifications' => "Graduate of BS Accountancy\n"
                ."At least three years in a supervisory role\n"
                ."Proficient in Microsoft Excel and SAP\n"
                .'Experience in BIR filing and payroll processing',
            'summary' => 'Runs the accounting team for the branch.',
            'salary_min' => 35000,
            'salary_max' => 45000,
        ], $overrides));
    }

    /** @return array<string, mixed> */
    private function profile(array $overrides = []): array
    {
        $parsed = app(ResumeParser::class)->parseText(self::CV);

        return array_merge([
            'text' => self::CV,
            'skills' => $parsed['skills'],
            'yearsExperience' => $parsed['fields']['yearsExperience'] ?? null,
            'educationLevel' => $parsed['fields']['educationLevel'] ?? null,
            'currentTitle' => $parsed['fields']['currentTitle'] ?? null,
            'positions' => $parsed['detail']['positions'] ?? [],
            'expectedSalary' => 40000,
        ], $overrides);
    }

    private function assess(array $profileOverrides = [], array $postingOverrides = []): array
    {
        return app(CandidateAssessment::class)
            ->assess($this->profile($profileOverrides), $this->posting($postingOverrides));
    }

    public function test_a_well_matched_candidate_scores_strongly(): void
    {
        $result = $this->assess();

        $this->assertGreaterThanOrEqual(75, $result['score']);
        $this->assertSame('Strong match', $result['band']);
    }

    public function test_every_requirement_comes_back_with_its_evidence(): void
    {
        $result = $this->assess();

        $this->assertCount(4, $result['requirements']);

        foreach ($result['requirements'] as $requirement) {
            $this->assertArrayHasKey('text', $requirement);
            $this->assertContains($requirement['status'], ['met', 'partial', 'missing']);

            // A met requirement must be able to say what met it. A verdict
            // with no evidence behind it is the thing this replaced.
            if ($requirement['status'] === 'met') {
                $this->assertNotEmpty($requirement['evidence']);
            }
        }
    }

    public function test_the_years_requirement_is_read_from_the_advert_and_compared(): void
    {
        $short = $this->assess(['yearsExperience' => 1.0]);
        $long = $this->assess(['yearsExperience' => 9.0]);

        $signal = fn (array $result) => collect($result['signals'])->firstWhere('label', 'Experience');

        $this->assertSame('missing', $signal($short)['status']);
        $this->assertStringContainsString('3 years wanted', $signal($short)['detail']);

        $this->assertSame('met', $signal($long)['status']);
        $this->assertGreaterThan($short['score'], $long['score']);
    }

    public function test_exceeding_the_requirement_is_not_rewarded_over_meeting_it(): void
    {
        // Otherwise the score quietly sorts longer careers above better fits,
        // which is age discrimination wearing a number.
        $meets = $this->assess(['yearsExperience' => 3.0]);
        $far = $this->assess(['yearsExperience' => 25.0]);

        $this->assertSame($meets['score'], $far['score']);
    }

    public function test_a_gap_between_jobs_is_not_counted_as_experience(): void
    {
        $parsed = app(ResumeParser::class)->parseText(<<<'TXT'
        EXPERIENCE
        Accounting Clerk - Alpha Trading (2015 - 2016)
        Accounting Supervisor - Beta Foods (2024 - 2025)
        TXT);

        // 2015-2016 and 2024-2025 is roughly two years of work, not ten.
        $this->assertNotNull($parsed['fields']['yearsExperience']);
        $this->assertLessThan(4, $parsed['fields']['yearsExperience']);

        $result = $this->assess([
            'yearsExperience' => $parsed['fields']['yearsExperience'],
            'positions' => $parsed['detail']['positions'],
        ]);

        $this->assertNotEmpty(array_filter(
            $result['concerns'],
            fn (string $c) => str_contains($c, 'gap'),
        ));
    }

    public function test_what_the_cv_does_not_say_is_unknown_rather_than_failed(): void
    {
        $silent = $this->assess(['educationLevel' => null]);

        $education = collect($silent['signals'])->firstWhere('label', 'Education');

        $this->assertSame('unknown', $education['status']);

        // And an unknown must not drag the score down: a candidate who left
        // their education off is not a candidate who failed the requirement.
        $failed = $this->assess(['educationLevel' => 'High School']);

        $this->assertGreaterThan($failed['score'], $silent['score']);
    }

    public function test_an_advert_with_no_requirements_cannot_produce_a_strong_match(): void
    {
        $result = $this->assess([], ['qualifications' => '']);

        $this->assertNotSame('Strong match', $result['band']);
        $this->assertStringContainsString('no requirements', $result['summary']);
    }

    public function test_a_salary_above_the_band_is_a_note_not_a_penalty(): void
    {
        $within = $this->assess(['expectedSalary' => 40000]);
        $above = $this->assess(['expectedSalary' => 90000]);

        $this->assertSame($within['score'], $above['score']);
        $this->assertNotEmpty(array_filter(
            $above['concerns'],
            fn (string $c) => str_contains($c, 'above the band'),
        ));
    }

    public function test_a_wholly_unrelated_advert_scores_poorly(): void
    {
        $result = $this->assess([], [
            'title' => 'Registered Nurse',
            'qualifications' => "Graduate of BS Nursing\nValid PRC licence\nAt least two years in a hospital setting\nBLS and ACLS certified",
        ]);

        $this->assertLessThan(55, $result['score']);
        $this->assertNotSame('Strong match', $result['band']);
    }

    public function test_skills_are_matched_on_one_canonical_name(): void
    {
        // "MS Excel" on the advert and "Microsoft Excel" on the CV are the
        // same skill; matching them as strings would call it missing.
        $result = $this->assess(
            ['skills' => ['Microsoft Excel']],
            ['qualifications' => 'Proficient in MS Excel'],
        );

        $this->assertContains('Microsoft Excel', $result['matchedSkills']);
        $this->assertSame([], $result['missingSkills']);
    }
}
