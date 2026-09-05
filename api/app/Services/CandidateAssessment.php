<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\JobPosting;

/**
 * Deciding how well a candidate fits a role, and saying why.
 *
 * What this replaces was a single number: the share of words in the advert
 * that also appeared in the CV. It sorted a list, which is something, but it
 * was indefensible in every way that matters. A CV that repeated the job title
 * six times scored higher than one that had actually done the job. Nobody
 * could see what produced the number, so nobody could argue with it — and a
 * screening figure nobody can argue with is the most dangerous kind, because
 * it gets treated as a judgement instead of a sort order.
 *
 * So this produces an assessment rather than a score:
 *
 *   Every requirement on the advert is checked one at a time, and each comes
 *   back met, partly met, or not met — with the words from the CV that decided
 *   it. A recruiter can disagree with any single line.
 *
 *   The things that are actually comparable are compared as quantities rather
 *   than as text. "At least three years" against a tenure computed from dated
 *   positions is arithmetic. "Graduate of a four-year course" against a parsed
 *   education level is an ordinal comparison. Neither is keyword overlap, and
 *   both are the questions that get asked first.
 *
 *   Anything the CV does not say comes back as *unknown*, never as a fail. A
 *   candidate who left their graduation year off is not less qualified, and
 *   scoring them as if they were is how a good applicant is filtered out by a
 *   parser.
 *
 * The result is still only ever an ordering aid. Nothing here moves an
 * applicant through a stage, and the screen that shows it says so.
 */
class CandidateAssessment
{
    /** Education, in the order that makes one "higher" than another. */
    private const EDUCATION_RANK = [
        'High School' => 1,
        'Vocational' => 2,
        'Associate' => 3,
        'Bachelor' => 4,
        'Master' => 5,
        'Doctorate' => 6,
    ];

    /** Words that carry no meaning in a requirement line. */
    private const STOPWORDS = [
        'and', 'or', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'has', 'had',
        'are', 'was', 'were', 'will', 'must', 'able', 'ability', 'you', 'your', 'our',
        'their', 'they', 'other', 'others', 'related', 'least', 'strong', 'good', 'great',
        'excellent', 'knowledge', 'required', 'requirement', 'requirements', 'preferred',
        'plus', 'advantage', 'candidate', 'candidates', 'applicant', 'applicants',
        'position', 'role', 'job', 'work', 'working', 'company', 'team', 'skills', 'skill',
        'experience', 'experienced', 'years', 'year', 'graduate', 'graduated', 'degree',
        'course', 'holder', 'minimum', 'maximum', 'similar', 'field', 'preferably',
        'willing', 'can', 'able', 'proficient', 'proficiency', 'familiar', 'familiarity',
        'well', 'very', 'high', 'level', 'not', 'but', 'all', 'any', 'both', 'each',
    ];

    /** Spelled-out numbers, because adverts write "at least three years". */
    private const NUMBER_WORDS = [
        'one' => 1, 'two' => 2, 'three' => 3, 'four' => 4, 'five' => 5,
        'six' => 6, 'seven' => 7, 'eight' => 8, 'nine' => 9, 'ten' => 10,
    ];

    /**
     * Evidence that somebody has actually run something, not just done a job.
     *
     * A rank-and-file CV is not expected to say any of these, so this
     * dictionary is only ever consulted for a posting the advert itself marks
     * as supervisory or above — see `isManagerialPosting()`. Scoring a
     * warehouse-crew applicant against "led a team" is exactly the false
     * strictness the advert screen was asked to avoid.
     */
    private const LEADERSHIP_WORDS = [
        'led', 'lead', 'leading', 'leadership', 'managed', 'manage', 'managing',
        'supervised', 'supervising', 'supervisor', 'oversaw', 'oversee', 'overseeing',
        'directed', 'directing', 'headed', 'heading', 'spearheaded', 'mentored', 'mentoring',
        'coached', 'coaching', 'trained', 'delegated', 'orchestrated',
        'built and led', 'reporting to me', 'direct reports', 'p&l', 'profit and loss',
        'budget owner', 'budget responsibility', 'strategic planning', 'stakeholder management',
        'cross-functional', 'change management', 'succession planning', 'performance review',
        'people management', 'staff of', 'headcount',
    ];

    public function __construct(private readonly ResumeParser $parser) {}

    /**
     * Assesses one applicant against the posting they applied to.
     *
     * @return array<string, mixed>|null Null when there is no posting to assess against.
     */
    public function forApplicant(Applicant $applicant, ?JobPosting $posting = null): ?array
    {
        $posting ??= $applicant->jobPosting;

        if (! $posting) {
            return null;
        }

        return $this->assess([
            'text' => (string) $applicant->resume_text,
            'skills' => $applicant->skills ?? [],
            'yearsExperience' => $applicant->years_experience === null ? null : (float) $applicant->years_experience,
            'educationLevel' => $applicant->education_level,
            'currentTitle' => $applicant->current_title,
            'positions' => $applicant->resume_parsed['detail']['positions'] ?? [],
            'expectedSalary' => $applicant->expected_salary ? (float) $applicant->expected_salary : null,
        ], $posting);
    }

    /**
     * The assessment itself.
     *
     * @param  array<string, mixed>  $profile
     * @return array<string, mixed>
     */
    public function assess(array $profile, JobPosting $posting): array
    {
        $haystack = $this->haystack($profile);
        $managerial = $this->isManagerialPosting($posting);

        $requirements = $this->requirements($posting, $haystack, $managerial);
        $experience = $this->experienceSignal($posting, $profile, $managerial);
        $education = $this->educationSignal($posting, $profile);
        $skills = $this->skillSignal($posting, $profile, $haystack);
        $relevance = $this->relevanceSignal($posting, $profile);

        /*
         * The weights.
         *
         * Requirements carry the most because they are what the hiring manager
         * actually wrote down. Experience and education are next because they
         * are the two things that are checked as quantities rather than as
         * text, so they are the two least likely to be wrong.
         *
         * A supervisory-or-above posting adds two signals no rank-and-file
         * posting ever sees: whether the CV shows evidence of actually
         * running something, and whether their work history is stable enough
         * to lead a team through. Both come back `unknown` — excluded from
         * the score entirely, not scored as a miss — for anything below
         * supervisor, which is what keeps a warehouse-crew or clerical
         * applicant screened exactly as leniently as before this existed.
         */
        $parts = [
            ['weight' => $managerial ? 32 : 40, 'signal' => $requirements['signal']],
            ['weight' => $managerial ? 16 : 20, 'signal' => $experience],
            ['weight' => 12, 'signal' => $education],
            ['weight' => $managerial ? 13 : 17, 'signal' => $skills['signal']],
            ['weight' => $managerial ? 6 : 8, 'signal' => $relevance],
        ];

        if ($managerial) {
            $parts[] = ['weight' => 13, 'signal' => $this->leadershipSignal($profile)];
            $parts[] = ['weight' => 8, 'signal' => $this->stabilitySignal($profile)];
        }

        /*
         * Unknown signals are left out of both sides of the average rather
         * than scored as zero. An advert that never states an education
         * requirement must not push every candidate down 15 points, and a
         * candidate whose CV omits a graduation year must not be marked as
         * failing to have one.
         */
        $earned = 0.0;
        $available = 0.0;

        foreach ($parts as $part) {
            if ($part['signal']['status'] === 'unknown') {
                continue;
            }

            $earned += $part['weight'] * $part['signal']['ratio'];
            $available += $part['weight'];
        }

        $score = $available > 0 ? (int) round(($earned / $available) * 100) : 0;

        $signals = array_values(array_map(fn ($part) => $part['signal'], $parts));

        $concerns = $this->concerns($posting, $profile, $haystack);

        return [
            'score' => $score,
            'band' => $this->band($score, $available, $requirements['signal']['status'] !== 'unknown'),
            'summary' => $this->summary($score, $available, $experience, $education, $skills, $requirements),
            'confidence' => $available > 0 ? (int) round(($available / 100) * 100) : 0,
            // Whether the leadership/stability signals above were even in
            // play — the screen uses this to explain why two postings score
            // the same candidate on a different set of criteria.
            'managerial' => $managerial,
            'signals' => $signals,
            'requirements' => $requirements['lines'],
            'matchedSkills' => $skills['matched'],
            'missingSkills' => $skills['missing'],
            'concerns' => $concerns,
            'assessedAt' => now()->toIso8601String(),
        ];
    }

    /**
     * Whether the advert is for a supervisory role or above — the switch
     * that turns on the stricter, leadership-aware side of this class.
     *
     * Prefers the posting's own `experience_level` (what the person who
     * wrote the advert actually chose) and falls back to the linked
     * position's `is_managerial` flag when the advert left that blank — the
     * same signal `PunchClock`'s overtime-visibility rule reads, so "is this
     * a managerial job" answers the same way everywhere in the app rather
     * than being redecided per screen.
     */
    private function isManagerialPosting(JobPosting $posting): bool
    {
        if (in_array($posting->experience_level, ['Manager', 'Director'], true)) {
            return true;
        }

        if ($posting->experience_level !== null) {
            return false;
        }

        return (bool) ($posting->position?->is_managerial ?? false);
    }

    /* ====================================================================== */
    /* The individual signals */
    /* ====================================================================== */

    /**
     * Every qualification line on the advert, checked one at a time.
     *
     * @return array{signal: array<string, mixed>, lines: list<array<string, mixed>>}
     */
    private function requirements(JobPosting $posting, string $haystack, bool $managerial = false): array
    {
        $lines = $posting->lines('qualifications');

        if ($lines === []) {
            return [
                'signal' => $this->signal('Requirements', 'unknown', 0, 'The advert does not list any.'),
                'lines' => [],
            ];
        }

        // A supervisory posting is read more strictly line by line — a rank-
        // and-file requirement is usually one or two words ("can drive",
        // "willing to do fieldwork") where partial evidence is still useful
        // signal; a managerial requirement is more often a compound claim
        // ("at least 3 years leading a sales team") where half of it being
        // true is a materially weaker match than all of it being true.
        $metBar = $managerial ? 0.75 : 0.6;
        $partialBar = $managerial ? 0.4 : 0.3;

        $checked = [];
        $met = 0.0;

        foreach (array_slice($lines, 0, 15) as $line) {
            $terms = $this->terms($line);

            if ($terms === []) {
                continue;
            }

            $hits = [];

            foreach ($terms as $term) {
                if ($this->mentions($haystack, $term)) {
                    $hits[] = $term;
                }
            }

            $ratio = count($hits) / count($terms);
            $status = $ratio >= $metBar ? 'met' : ($ratio >= $partialBar ? 'partial' : 'missing');

            $met += $status === 'met' ? 1 : ($status === 'partial' ? 0.5 : 0);

            $checked[] = [
                'text' => $line,
                'status' => $status,
                // The words that decided it, so the judgement is auditable
                // rather than a colour on a row.
                'evidence' => array_slice($hits, 0, 6),
            ];
        }

        if ($checked === []) {
            return [
                'signal' => $this->signal('Requirements', 'unknown', 0, 'Nothing checkable in the advert.'),
                'lines' => [],
            ];
        }

        $ratio = $met / count($checked);
        $fullyMet = count(array_filter($checked, fn ($c) => $c['status'] === 'met'));

        return [
            'signal' => $this->signal(
                'Requirements',
                $ratio >= 0.7 ? 'met' : ($ratio >= 0.4 ? 'partial' : 'missing'),
                $ratio,
                "{$fullyMet} of ".count($checked).' met in the CV',
            ),
            'lines' => $checked,
        ];
    }

    /**
     * Years of experience, as arithmetic.
     *
     * @param  array<string, mixed>  $profile
     * @return array<string, mixed>
     */
    private function experienceSignal(JobPosting $posting, array $profile, bool $managerial = false): array
    {
        $wanted = $this->requiredYears($posting);
        $has = $profile['yearsExperience'] ?? null;

        if ($wanted === null) {
            return $has === null
                ? $this->signal('Experience', 'unknown', 0, 'Neither the advert nor the CV says.')
                : $this->signal('Experience', 'met', 1.0, $this->years($has).' of experience; the advert sets no minimum.');
        }

        if ($has === null) {
            return $this->signal(
                'Experience',
                'unknown',
                0,
                "The advert wants {$this->years($wanted)}; the CV does not say how long they have worked.",
            );
        }

        // Meeting the bar is full marks — there is no credit for exceeding it,
        // because "more years" is not the same as "better", and rewarding it
        // quietly sorts older candidates above younger ones.
        if ($has >= $wanted) {
            return $this->signal('Experience', 'met', 1.0, "{$this->years($has)} against {$this->years($wanted)} wanted");
        }

        // Just short is nearly there; half the requirement is not. A
        // managerial shortfall is weighted a shade steeper — the gap between
        // "two years leading a team" and "one year" is a bigger practical
        // difference than the same one-year gap is for a role with no
        // leadership component at all.
        $ratio = $wanted > 0 ? max(0.0, min(1.0, $has / $wanted)) : 1.0;
        $ratio = $managerial ? $ratio ** 1.3 : $ratio;

        return $this->signal(
            'Experience',
            $ratio >= 0.7 ? 'partial' : 'missing',
            $ratio,
            "{$this->years($has)} against {$this->years($wanted)} wanted",
        );
    }

    /** @param array<string, mixed> $profile */
    private function educationSignal(JobPosting $posting, array $profile): array
    {
        $wanted = $this->requiredEducation($posting);
        $has = $profile['educationLevel'] ?? null;

        if ($wanted === null) {
            return $has
                ? $this->signal('Education', 'met', 1.0, "{$has}; the advert sets no requirement.")
                : $this->signal('Education', 'unknown', 0, 'The advert sets no requirement.');
        }

        if (! $has) {
            return $this->signal('Education', 'unknown', 0, "The advert wants a {$wanted}; the CV does not say.");
        }

        $wantedRank = self::EDUCATION_RANK[$wanted] ?? 0;
        $hasRank = self::EDUCATION_RANK[$has] ?? 0;

        if ($hasRank >= $wantedRank) {
            return $this->signal('Education', 'met', 1.0, "{$has} meets the {$wanted} asked for");
        }

        // One step below is a conversation; two is not.
        $gap = $wantedRank - $hasRank;

        return $this->signal(
            'Education',
            $gap === 1 ? 'partial' : 'missing',
            $gap === 1 ? 0.5 : 0.0,
            "{$has} against a {$wanted} asked for",
        );
    }

    /**
     * Skill coverage: which of the advert's named skills the CV shows.
     *
     * @param  array<string, mixed>  $profile
     * @return array{signal: array<string, mixed>, matched: list<string>, missing: list<string>}
     */
    private function skillSignal(JobPosting $posting, array $profile, string $haystack): array
    {
        $wanted = $this->postingSkills($posting);

        if ($wanted === []) {
            return [
                'signal' => $this->signal('Skills', 'unknown', 0, 'The advert names none specifically.'),
                'matched' => [],
                'missing' => [],
            ];
        }

        $held = [];
        foreach ($profile['skills'] ?? [] as $skill) {
            $held[$this->parser->fold($this->parser->canonicalSkill((string) $skill))] = true;
        }

        $matched = [];
        $missing = [];

        foreach ($wanted as $skill) {
            $key = $this->parser->fold($skill);

            // Listed on the application, or simply written somewhere in the CV
            // — a skill demonstrated in a job description counts as much as one
            // typed into a Skills section.
            if (isset($held[$key]) || $this->mentions($haystack, $key)) {
                $matched[] = $skill;
            } else {
                $missing[] = $skill;
            }
        }

        $ratio = count($matched) / count($wanted);

        return [
            'signal' => $this->signal(
                'Skills',
                $ratio >= 0.7 ? 'met' : ($ratio >= 0.35 ? 'partial' : 'missing'),
                $ratio,
                count($matched).' of '.count($wanted).' named skills',
            ),
            'matched' => $matched,
            'missing' => $missing,
        ];
    }

    /**
     * Whether they have held this kind of job before.
     *
     * Compared against every title in the work history, not just the current
     * one: somebody who supervised a warehouse for four years and is currently
     * driving has done the job, and the top entry alone would say they had not.
     *
     * @param  array<string, mixed>  $profile
     */
    private function relevanceSignal(JobPosting $posting, array $profile): array
    {
        $wanted = $this->terms($posting->title);

        if ($wanted === []) {
            return $this->signal('Similar role', 'unknown', 0, 'Nothing distinctive in the job title.');
        }

        $titles = [];

        if (! empty($profile['currentTitle'])) {
            $titles[] = (string) $profile['currentTitle'];
        }

        foreach ($profile['positions'] ?? [] as $position) {
            if (! empty($position['title'])) {
                $titles[] = (string) $position['title'];
            }
        }

        if ($titles === []) {
            return $this->signal('Similar role', 'unknown', 0, 'No job titles were read from the CV.');
        }

        $best = 0.0;
        $bestTitle = null;

        foreach (array_unique($titles) as $title) {
            $folded = $this->parser->fold($title);
            $hits = 0;

            foreach ($wanted as $term) {
                if ($this->mentions($folded, $term)) {
                    $hits++;
                }
            }

            $ratio = $hits / count($wanted);

            if ($ratio > $best) {
                $best = $ratio;
                $bestTitle = $title;
            }
        }

        return $this->signal(
            'Similar role',
            $best >= 0.6 ? 'met' : ($best >= 0.3 ? 'partial' : 'missing'),
            $best,
            $bestTitle && $best > 0
                ? "Held \"{$bestTitle}\""
                : 'No comparable title in the work history',
        );
    }

    /**
     * Evidence of having actually led something — only ever computed when
     * the posting is supervisory or above (see `isManagerialPosting`).
     *
     * Two things count: the leadership vocabulary itself, and title
     * progression — somebody whose work history moves from "Associate" to
     * "Senior Associate" to "Team Lead" at the same employer has demonstrated
     * exactly what a leadership dictionary can only infer.
     *
     * @param  array<string, mixed>  $profile
     */
    private function leadershipSignal(array $profile): array
    {
        // Deliberately not the full haystack: that one folds in the skill
        // dictionary, and stemmed matching against "Warehouse Management" or
        // "Change Management" — both legitimate SKILL_DICTIONARY entries —
        // matches "manage/managed/managing" every time, crediting leadership
        // for an inventory skill. The narrative — what the CV actually says
        // in prose, plus the job titles themselves — is what a leadership
        // claim should be read from.
        $narrative = $this->parser->fold(implode(' ', array_filter([
            (string) ($profile['text'] ?? ''),
            (string) ($profile['currentTitle'] ?? ''),
            ...array_map(fn ($p) => (string) ($p['title'] ?? ''), $profile['positions'] ?? []),
        ])));

        $hits = 0;

        foreach (self::LEADERSHIP_WORDS as $word) {
            if ($this->mentions($narrative, $this->parser->fold($word))) {
                $hits++;
            }
        }

        // A team size ("team of 8", "12 direct reports", "staff of 20")
        // is the single strongest sentence a CV can offer here — it is a
        // specific, checkable claim rather than a verb somebody chose.
        $hasTeamSize = (bool) preg_match('/\b(?:team|staff|department|crew)\s+of\s+\d{1,3}\b|\b\d{1,3}\s+(?:direct\s+reports|subordinates|personnel)\b/i', $narrative);

        $progressed = $this->titleProgressed($profile['positions'] ?? []);

        $ratio = min(1.0, ($hits / 6) + ($hasTeamSize ? 0.35 : 0) + ($progressed ? 0.25 : 0));

        if ($hits === 0 && ! $hasTeamSize && ! $progressed) {
            return $this->signal('Leadership evidence', 'missing', 0.0, 'No leadership language, team size or title progression found in the CV.');
        }

        $detail = array_filter([
            $hits > 0 ? "{$hits} leadership term(s) used" : null,
            $hasTeamSize ? 'states a team/staff size' : null,
            $progressed ? 'titles progress toward more senior ones' : null,
        ]);

        return $this->signal(
            'Leadership evidence',
            $ratio >= 0.6 ? 'met' : 'partial',
            $ratio,
            implode('; ', $detail),
        );
    }

    /**
     * Whether somebody who has led a role before tends to stay in it.
     *
     * Not a judgement on job-hopping in general — a rank-and-file worker
     * moving between contracts is the Philippine labour market working
     * normally, which is exactly why this is never computed for that case.
     * For a supervisory hire specifically, a pattern of sub-year stints is
     * worth a recruiter's attention before an offer goes out, not after.
     *
     * @param  array<string, mixed>  $profile
     */
    private function stabilitySignal(array $profile): array
    {
        $positions = array_filter($profile['positions'] ?? [], fn ($p) => ! empty($p['months']));

        if (count($positions) < 2) {
            return $this->signal('Tenure stability', 'unknown', 0, 'Not enough dated positions to judge a pattern.');
        }

        $months = array_map(fn ($p) => (int) $p['months'], $positions);
        $average = array_sum($months) / count($months);

        if ($average >= 24) {
            return $this->signal('Tenure stability', 'met', 1.0, round($average / 12, 1).' years average per role.');
        }

        if ($average >= 12) {
            return $this->signal('Tenure stability', 'partial', 0.6, round($average / 12, 1).' years average per role.');
        }

        return $this->signal(
            'Tenure stability',
            'missing',
            0.2,
            round($average, 0).' months average per role — worth asking about directly rather than assuming a reason.',
        );
    }

    /**
     * Whether the work history's titles read as moving upward — the same
     * employer keeping somebody on and giving them a bigger title is a
     * stronger leadership signal than any single word choice.
     *
     * @param  list<array<string, mixed>>  $positions
     */
    private function titleProgressed(array $positions): bool
    {
        $seniorWords = ['senior', 'sr.', 'lead', 'head', 'chief', 'principal', 'manager', 'supervisor', 'director', 'assistant manager'];

        $byEmployer = [];
        foreach ($positions as $position) {
            $employer = $this->parser->fold((string) ($position['employer'] ?? ''));
            $title = mb_strtolower((string) ($position['title'] ?? ''));

            if ($employer === '' || $title === '') {
                continue;
            }

            $byEmployer[$employer][] = $title;
        }

        foreach ($byEmployer as $titles) {
            if (count($titles) < 2) {
                continue;
            }

            $seniorCount = 0;
            foreach ($titles as $title) {
                foreach ($seniorWords as $word) {
                    if (str_contains($title, $word)) {
                        $seniorCount++;
                        break;
                    }
                }
            }

            // At least one title at that employer reads senior, and not
            // every title does — otherwise "Manager" listed twice for the
            // same stint (a header and a bullet both parsed as separate
            // entries) would falsely read as a promotion.
            if ($seniorCount > 0 && $seniorCount < count($titles)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Things worth knowing that are not part of the score.
     *
     * A salary expectation above the band is not a worse candidate — it is a
     * conversation to have before the interview rather than after it. Keeping
     * it out of the number and in front of the recruiter is the difference
     * between screening and hiding.
     *
     * @param  array<string, mixed>  $profile
     * @return list<string>
     */
    private function concerns(JobPosting $posting, array $profile, string $haystack): array
    {
        $concerns = [];

        $expected = $profile['expectedSalary'] ?? null;

        if ($expected && $posting->salary_max && $expected > (float) $posting->salary_max) {
            $concerns[] = 'Expects ₱'.number_format($expected)
                .', above the band top of ₱'.number_format((float) $posting->salary_max).'.';
        }

        if ($expected && $posting->salary_min && $expected < (float) $posting->salary_min * 0.6) {
            $concerns[] = 'Expects well under the band — worth checking they have read the role correctly.';
        }

        if (trim($haystack) === '') {
            $concerns[] = 'No readable CV text, so this is assessed on the application form alone.';
        }

        // Gaps are a fact, not a fault — but an unexplained two-year gap is
        // the first thing an interviewer asks about, so it is surfaced.
        $gap = $this->longestGapMonths($profile['positions'] ?? []);

        if ($gap >= 18) {
            $concerns[] = 'A gap of about '.round($gap / 12, 1).' years between dated positions.';
        }

        return $concerns;
    }

    /** @param list<array<string, mixed>> $positions */
    private function longestGapMonths(array $positions): int
    {
        $spans = [];

        foreach ($positions as $position) {
            if (empty($position['from'])) {
                continue;
            }

            $from = $this->monthIndex((string) $position['from']);
            $to = ! empty($position['current'])
                ? $this->monthIndex(date('Y-m'))
                : $this->monthIndex((string) ($position['to'] ?? $position['from']));

            if ($from !== null && $to !== null && $to >= $from) {
                $spans[] = [$from, $to];
            }
        }

        if (count($spans) < 2) {
            return 0;
        }

        usort($spans, fn ($a, $b) => $a[0] <=> $b[0]);

        $gap = 0;
        $end = $spans[0][1];

        foreach (array_slice($spans, 1) as [$start, $finish]) {
            $gap = max($gap, $start - $end - 1);
            $end = max($end, $finish);
        }

        return max(0, $gap);
    }

    /* ====================================================================== */
    /* Reading the advert */
    /* ====================================================================== */

    /** The minimum years the advert asks for, if it asks for any. */
    private function requiredYears(JobPosting $posting): ?float
    {
        $text = implode("\n", [$posting->qualifications, $posting->summary, $posting->title]);

        $words = implode('|', array_keys(self::NUMBER_WORDS));
        $count = "(\\d{1,2}|{$words})";

        /*
         * Two shapes, and both are needed.
         *
         * "At least three years in a supervisory role" never says the word
         * "experience", and requiring it — which the first version did — meant
         * the single most common way a Philippine advert states its minimum
         * went unread, and every applicant was scored as though the role had
         * no requirement at all.
         */
        $patterns = [
            // A qualifier makes it a minimum whatever follows.
            '/(?:at\\s+least|minimum(?:\\s+of)?|min\\.?|over|more\\s+than|not\\s+less\\s+than)\\s+'
                ."{$count}\\s*(?:\\+|plus)?\\s*(?:-|–|to)?\\s*(?:\\d{1,2})?\\s*(?:years?|yrs?)\\b/i",
            // Without one, the word "experience" is what makes it a minimum
            // rather than a description of the job.
            "/{$count}\\s*(?:\\+|plus)?\\s*(?:-|–|to)?\\s*(?:\\d{1,2})?\\s*(?:years?|yrs?)\\b"
                .'[^.\\n]{0,40}?(?:experience|exp\\b)/i',
        ];

        $m = null;

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $text, $found)) {
                $m = $found;
                break;
            }
        }

        if ($m === null) {
            return null;
        }

        $value = self::NUMBER_WORDS[strtolower($m[1])] ?? (float) $m[1];

        // "20 years" in a Philippine advert is a typo far more often than a
        // requirement, and treating it as real fails everybody.
        return $value > 0 && $value <= 15 ? (float) $value : null;
    }

    /** The education level the advert asks for, if it asks. */
    private function requiredEducation(JobPosting $posting): ?string
    {
        $text = mb_strtolower(implode("\n", [$posting->qualifications, $posting->summary]));

        $signals = [
            'Doctorate' => ['doctorate', 'ph.d', 'phd'],
            'Master' => ["master's", 'masters', 'master of', 'mba'],
            'Bachelor' => [
                'bachelor', 'four-year course', '4-year course', 'college graduate',
                'degree holder', 'graduate of bs', 'graduate of ba', 'bs ', 'ab ',
            ],
            'Associate' => ['associate degree', 'two-year course', '2-year course'],
            'Vocational' => ['vocational', 'tesda', 'nc ii', 'nc iii', 'technical course'],
            'High School' => ['high school graduate', 'senior high', 'k-12 graduate'],
        ];

        foreach ($signals as $level => $needles) {
            foreach ($needles as $needle) {
                if (str_contains($text, $needle)) {
                    return $level;
                }
            }
        }

        return null;
    }

    /**
     * The skills the advert names, using the same dictionary the CV was read
     * with, so both sides are speaking the same vocabulary.
     *
     * @return list<string>
     */
    private function postingSkills(JobPosting $posting): array
    {
        $text = implode("\n", [
            $posting->title, $posting->qualifications, $posting->responsibilities, $posting->summary,
        ]);

        $found = $this->parser->parseText($text)['skills'] ?? [];

        return array_values(array_slice($found, 0, 12));
    }

    /* ====================================================================== */

    /**
     * Everything known about the candidate, folded into one searchable blob.
     *
     * @param  array<string, mixed>  $profile
     */
    private function haystack(array $profile): string
    {
        $parts = [(string) ($profile['text'] ?? '')];

        foreach ($profile['skills'] ?? [] as $skill) {
            $parts[] = (string) $skill;
        }

        $parts[] = (string) ($profile['currentTitle'] ?? '');

        foreach ($profile['positions'] ?? [] as $position) {
            $parts[] = (string) ($position['title'] ?? '');
            $parts[] = (string) ($position['employer'] ?? '');
        }

        return $this->parser->fold(implode(' ', $parts));
    }

    /**
     * The words in a requirement worth matching on.
     *
     * @return list<string>
     */
    private function terms(?string $line): array
    {
        if (! $line) {
            return [];
        }

        preg_match_all('/[a-zA-Z][a-zA-Z0-9+#.]{2,}/', mb_strtolower($line), $matches);

        $terms = [];

        foreach ($matches[0] ?? [] as $word) {
            $word = rtrim($word, '.');

            if (strlen($word) < 3 || in_array($word, self::STOPWORDS, true)) {
                continue;
            }

            $terms[$word] = true;
        }

        return array_values(array_slice(array_keys($terms), 0, 12));
    }

    /**
     * Whether a term appears, allowing for the endings English puts on words.
     *
     * "supervising" in an advert and "supervisor" on a CV are the same claim,
     * and an exact match would call it a miss.
     */
    private function mentions(string $haystack, string $term): bool
    {
        if ($term === '') {
            return false;
        }

        $stem = $this->stem($term);

        if (strlen($stem) < 3) {
            return str_contains($haystack, $term);
        }

        return (bool) preg_match('/(?<![a-z0-9])'.preg_quote($stem, '/').'[a-z]{0,5}(?![a-z])/', $haystack);
    }

    /**
     * Crude suffix stripping. Enough to join "filing" to "file".
     *
     * The adjective endings matter as much as the verb ones, and leaving them
     * out was a real miss: an advert asking for "a supervisory role" against a
     * CV that says "Supervisor" was scored as not met, while the experience
     * signal beside it said the same requirement was satisfied. Two parts of
     * one screen disagreeing is worse than either being wrong.
     */
    private function stem(string $word): string
    {
        $suffixes = [
            'ements', 'ations', 'ation', 'ement', 'ical', 'ance', 'ence',
            'ory', 'ary', 'ity', 'ive', 'ings', 'ing', 'ies', 'ers', 'er',
            'ed', 'es', 'ly', 's',
        ];

        foreach ($suffixes as $suffix) {
            if (strlen($word) > strlen($suffix) + 3 && str_ends_with($word, $suffix)) {
                return substr($word, 0, -strlen($suffix));
            }
        }

        return $word;
    }

    private function monthIndex(string $ym): ?int
    {
        if (! preg_match('/^(\d{4})-(\d{2})$/', $ym, $m)) {
            return null;
        }

        return ((int) $m[1]) * 12 + ((int) $m[2]) - 1;
    }

    /** @return array<string, mixed> */
    private function signal(string $label, string $status, float $ratio, string $detail): array
    {
        return [
            'label' => $label,
            'status' => $status,
            'ratio' => max(0.0, min(1.0, $ratio)),
            'detail' => $detail,
        ];
    }

    /**
     * The band, which is what a recruiter reads instead of the number.
     *
     * A score built from very little evidence does not get to say "Strong" —
     * it says so few things were checkable that the answer is unknown, which
     * is the honest reading of an advert with no requirements on it.
     */
    private function band(int $score, float $available, bool $hasRequirements): string
    {
        if ($available < 25) {
            return 'Not enough to say';
        }

        /* An advert that lists no requirements cannot produce a strong match.
           Everybody scored full marks on it, which made the band meaningless
           exactly where it was most likely to be trusted — a hurried posting
           with the qualifications box left empty. */
        if (! $hasRequirements) {
            return $score >= 50 ? 'Possible' : 'Weak match';
        }

        return match (true) {
            $score >= 75 => 'Strong match',
            $score >= 50 => 'Possible',
            default => 'Weak match',
        };
    }

    /**
     * @param  array<string, mixed>  $experience
     * @param  array<string, mixed>  $education
     * @param  array{signal: array<string, mixed>, matched: list<string>, missing: list<string>}  $skills
     * @param  array{signal: array<string, mixed>, lines: list<array<string, mixed>>}  $requirements
     */
    private function summary(
        int $score,
        float $available,
        array $experience,
        array $education,
        array $skills,
        array $requirements,
    ): string {
        if ($available < 25) {
            return 'The advert does not say enough for this to be assessed. Read the CV.';
        }

        if ($requirements['signal']['status'] === 'unknown') {
            return 'The advert lists no requirements, so there is little to assess against — '
                .'write the qualifications on the posting and re-assess.';
        }

        $strong = [];
        $weak = [];

        foreach ([$requirements['signal'], $experience, $education, $skills['signal']] as $signal) {
            if ($signal['status'] === 'met') {
                $strong[] = mb_strtolower($signal['label']);
            } elseif ($signal['status'] === 'missing') {
                $weak[] = mb_strtolower($signal['label']);
            }
        }

        $sentence = $score >= 75
            ? 'Fits the advert on the points it states.'
            : ($score >= 50 ? 'Fits some of the advert.' : 'Little of what the advert asks for is evidenced.');

        if ($strong !== []) {
            $sentence .= ' Meets: '.implode(', ', $strong).'.';
        }

        if ($weak !== []) {
            $sentence .= ' Short on: '.implode(', ', $weak).'.';
        }

        return $sentence;
    }

    private function years(float $value): string
    {
        $rounded = round($value, 1);
        $text = $rounded == (int) $rounded ? (string) (int) $rounded : (string) $rounded;

        return $text.' '.($rounded == 1.0 ? 'year' : 'years');
    }
}
