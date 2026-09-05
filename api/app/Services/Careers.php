<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\JobPosting;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The careers site, and what happens when somebody applies through it.
 *
 * Two audiences meet in this class and they want opposite things. A candidate
 * wants to apply in two minutes from a phone, without an account, and to be
 * able to check later whether anything happened. A recruiter wants a complete
 * record with the CV attached, filed against the right vacancy, and no
 * duplicates when the same person applies to three roles.
 *
 * The compromises that fall out of that:
 *
 *   - No sign-in. A careers portal that asks a jobseeker to register loses
 *     most of them at that screen. Identity is the reference code they are
 *     given plus the email they applied with, which is what every job board
 *     does for the same reason.
 *
 *   - Re-applying to the same role updates the application rather than filing
 *     a second one. Somebody who fixes a typo and submits again has not become
 *     two candidates, and a recruiter who has to merge them will not.
 *
 *   - The CV is stored on the private disk and served through a controller.
 *     A resume under a public path is a data-protection incident waiting for
 *     somebody to guess a filename, and these documents carry a home address
 *     and a date of birth.
 */
class Careers
{
    /** Five megabytes. A CV that is bigger than this is a portfolio. */
    public const MAX_RESUME_KILOBYTES = 5_120;

    /** What a browser is allowed to send, and what the reader can do anything with. */
    public const RESUME_MIMES = 'pdf,doc,docx,rtf,txt,png,jpg,jpeg,webp';

    public function __construct(
        private readonly ResumeParser $parser,
        private readonly CandidateAssessment $assessment,
        private readonly NotificationDispatcher $notifications,
    ) {}

    /* ====================================================================== */
    /* The advert */
    /* ====================================================================== */

    /**
     * Every posting a candidate is allowed to see, newest first.
     *
     * @param  array{q?: string|null, department?: string|null, type?: string|null, setup?: string|null, location?: string|null}  $filters
     */
    public function openings(array $filters = []): Collection
    {
        return JobPosting::query()
            ->with(['hrDepartment', 'branchUnit', 'position'])
            ->where('status', 'Published')
            ->whereNotNull('published_at')
            ->where(fn (Builder $q) => $q->whereNull('closes_on')->orWhereDate('closes_on', '>=', now()->toDateString()))
            ->when(
                filled($filters['q'] ?? null),
                fn (Builder $q) => $q->where(function (Builder $sub) use ($filters) {
                    $term = '%'.$filters['q'].'%';
                    $sub->where('title', 'like', $term)
                        ->orWhere('summary', 'like', $term)
                        ->orWhere('qualifications', 'like', $term)
                        ->orWhere('responsibilities', 'like', $term)
                        ->orWhere('location', 'like', $term);
                }),
            )
            ->when(filled($filters['type'] ?? null), fn (Builder $q) => $q->where('employment_type', $filters['type']))
            ->when(filled($filters['setup'] ?? null), fn (Builder $q) => $q->where('work_setup', $filters['setup']))
            ->when(
                filled($filters['location'] ?? null),
                fn (Builder $q) => $q->where('location', 'like', '%'.$filters['location'].'%'),
            )
            ->when(
                filled($filters['department'] ?? null),
                fn (Builder $q) => $q->whereHas('hrDepartment', fn (Builder $sub) => $sub->where('name', $filters['department'])),
            )
            ->orderByDesc('published_at')
            ->get();
    }

    /**
     * One posting as the public page shows it.
     *
     * Nothing internal crosses this boundary: no headcount, no budget rate, no
     * requisition number, and no salary unless the posting says the band may
     * be published.
     *
     * @return array<string, mixed>
     */
    public function presentJob(JobPosting $posting, bool $full = false): array
    {
        $base = [
            'slug' => $posting->slug,
            'title' => $posting->title,
            'department' => $posting->hrDepartment->name ?? null,
            'location' => $posting->location ?: ($posting->branchUnit->name ?? null),
            'employmentType' => $posting->employment_type,
            'workSetup' => $posting->work_setup,
            'experienceLevel' => $posting->experience_level,
            'summary' => $posting->summary,
            'openings' => (int) $posting->openings,
            'postedOn' => optional($posting->published_at)->toDateString(),
            'postedDaysAgo' => $posting->published_at
                ? (int) floor(CarbonImmutable::parse($posting->published_at)->diffInDays(CarbonImmutable::now()))
                : null,
            'closesOn' => optional($posting->closes_on)->toDateString(),
            'salary' => $posting->salary_visible ? [
                'min' => $posting->salary_min === null ? null : (float) $posting->salary_min,
                'max' => $posting->salary_max === null ? null : (float) $posting->salary_max,
            ] : null,
        ];

        if (! $full) {
            return $base;
        }

        return $base + [
            'responsibilities' => $posting->lines('responsibilities'),
            'qualifications' => $posting->lines('qualifications'),
            'benefits' => $posting->lines('benefits'),
        ];
    }

    /* ====================================================================== */
    /* Applying */
    /* ====================================================================== */

    /**
     * Files an application.
     *
     * @param  array<string, mixed>  $data
     * @param  string|null  $resumeToken  A CV already uploaded to `stashResume`.
     * @return array{applicant: Applicant, duplicate: bool, resumeAttached: bool}
     */
    public function apply(
        array $data,
        ?JobPosting $posting = null,
        ?UploadedFile $resume = null,
        ?string $resumeToken = null,
        string $via = 'Careers Portal',
    ): array {
        return DB::transaction(function () use ($data, $posting, $resume, $resumeToken, $via) {
            $email = strtolower(trim((string) ($data['email'] ?? '')));

            // Somebody re-submitting for the same role is correcting their
            // application, not starting a second one. Only an application
            // still in play is reused — a candidate rejected last year who
            // applies again is a new application, and should be.
            $existing = $email !== '' && $posting
                ? Applicant::where('job_posting_id', $posting->id)
                    ->whereRaw('LOWER(email) = ?', [$email])
                    ->whereNotIn('stage', ['Hired', 'Rejected'])
                    ->first()
                : null;

            $applicant = $existing ?: new Applicant([
                'applicant_no' => $this->applicantNumber(),
                'reference_code' => Applicant::newReferenceCode(),
                'stage' => 'Applied',
                'applied_on' => now()->toDateString(),
            ]);

            $applicant->fill($this->attributes($data, $posting, $via));
            $applicant->save();

            $attached = false;

            if ($resume) {
                $this->attachResume($applicant, $resume, null, $posting);
                $attached = true;
            } elseif ($resumeToken) {
                $attached = $this->attachStashed($applicant, $resumeToken, $posting);
            }

            /* Assessed even when no CV came with it. An application filled in
               by hand still states years of experience, an education level and
               a list of skills — enough to answer most of what the advert
               asks, and a candidate who typed rather than uploaded should not
               drop off the bottom of the list for it. */
            $applicant = $attached ? $applicant->fresh() : $this->assess($applicant->fresh(), $posting);

            // Only a genuinely new application gets the acknowledgement — a
            // candidate correcting a typo and re-submitting already knows it
            // went through, and a second "we received this" reads as the
            // system not remembering them.
            if (! $existing && $applicant->email) {
                $this->notifications->dispatchDirect(
                    event: 'applicant.received',
                    to: $applicant->email,
                    subject: 'We received your application — '.($posting->title ?? 'Trinitas'),
                    view: 'emails.application-received',
                    data: ['applicant' => $applicant, 'posting' => $posting],
                    referenceType: 'Applicant',
                    referenceId: $applicant->id,
                );
            }

            return [
                'applicant' => $applicant,
                'duplicate' => (bool) $existing,
                'resumeAttached' => $attached,
            ];
        });
    }

    /**
     * The applicant columns for a submitted form.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function attributes(array $data, ?JobPosting $posting, string $via): array
    {
        $first = trim((string) ($data['firstName'] ?? ''));
        $middle = trim((string) ($data['middleName'] ?? ''));
        $last = trim((string) ($data['lastName'] ?? ''));

        $full = trim(implode(' ', array_filter([$first, $middle, $last])));

        $attributes = [
            'full_name' => $full !== '' ? $full : trim((string) ($data['name'] ?? 'Unnamed applicant')),
            'first_name' => $first ?: null,
            'middle_name' => $middle ?: null,
            'last_name' => $last ?: null,
            'email' => $data['email'] ?? null,
            'phone' => $data['phone'] ?? null,
            'applied_via' => $via,

            'birthdate' => $data['birthdate'] ?? null,
            'gender' => $data['gender'] ?? null,
            'civil_status' => $data['civilStatus'] ?? null,
            'nationality' => $data['nationality'] ?? null,

            'address_line' => $data['addressLine'] ?? null,
            'city' => $data['city'] ?? null,
            'province' => $data['province'] ?? null,
            'postal_code' => $data['postalCode'] ?? null,

            'education_level' => $data['educationLevel'] ?? null,
            'school' => $data['school'] ?? null,
            'course' => $data['course'] ?? null,
            'year_graduated' => $data['yearGraduated'] ?? null,

            'years_experience' => $data['yearsExperience'] ?? null,
            'current_employer' => $data['currentEmployer'] ?? null,
            'current_title' => $data['currentTitle'] ?? null,
            'available_from' => $data['availableFrom'] ?? null,
            'current_salary' => $data['currentSalary'] ?? null,
            'expected_salary' => $data['expectedSalary'] ?? 0,

            'linkedin_url' => $data['linkedinUrl'] ?? null,
            'portfolio_url' => $data['portfolioUrl'] ?? null,
            'cover_letter' => $data['coverLetter'] ?? null,
            'skills' => $data['skills'] ?? null,
        ];

        if ($posting) {
            $attributes['job_posting_id'] = $posting->id;
            $attributes['job_requisition_id'] = $posting->job_requisition_id;
            $attributes['position_id'] = $posting->position_id;
        } else {
            // An HR-encoded application names its own vacancy.
            $attributes['job_requisition_id'] = $data['requisitionId'] ?? null;
            $attributes['position_id'] = $data['positionId'] ?? null;
        }

        if (! empty($data['source'])) {
            $attributes['source'] = $data['source'];
        } elseif ($via === 'Careers Portal') {
            // The recruiter's own vocabulary has no "our own website" in it,
            // and Job Board is the nearest true thing. `applied_via` carries
            // the precise answer.
            $attributes['source'] = 'Job Board';
        }

        if (! empty($data['appliedOn'])) {
            $attributes['applied_on'] = $data['appliedOn'];
        }

        if (! empty($data['consent'])) {
            $attributes['consented_at'] = now();
        }

        return array_filter(
            $attributes,
            fn ($value) => $value !== null && $value !== '',
        );
    }

    /**
     * Reads an uploaded CV and holds on to it, without creating anything.
     *
     * This is what makes "upload your CV and the form fills itself" possible
     * on one upload rather than two. The candidate uploads once; the parse and
     * the file are held under a token while they check the fields and finish
     * the form; submitting quotes the token instead of sending five megabytes
     * up a mobile connection for the second time.
     *
     * Nothing here is a record. If the applicant closes the tab, the temporary
     * file expires with the cache entry and no half-application is left behind
     * for somebody to wonder about.
     *
     * @return array{token: string, parse: array<string, mixed>}
     */
    public function stashResume(UploadedFile $file): array
    {
        $parse = $this->parser->parseUpload($file);

        $token = (string) Str::uuid();
        $path = $file->store('resumes/pending', 'local');

        cache()->put("careers.resume.{$token}", [
            'path' => $path,
            'originalName' => Str::limit($file->getClientOriginalName(), 180, ''),
            'mime' => $file->getMimeType(),
            'bytes' => $file->getSize(),
            'parse' => $parse,
        ], now()->addHours(3));

        return ['token' => $token, 'parse' => $parse];
    }

    /**
     * Moves a stashed CV onto an applicant.
     *
     * A token that has expired is not an error the applicant can do anything
     * about beyond re-uploading, so it is reported as `false` and the
     * application still goes through — an application without its CV is worth
     * more than no application.
     */
    public function attachStashed(Applicant $applicant, string $token, ?JobPosting $posting = null): bool
    {
        $held = cache()->pull("careers.resume.{$token}");

        if (! is_array($held) || ! Storage::disk('local')->exists($held['path'])) {
            return false;
        }

        $destination = 'resumes/'.now()->format('Y/m').'/'.basename($held['path']);

        Storage::disk('local')->move($held['path'], $destination);

        $this->recordResume($applicant, [
            'path' => $destination,
            'originalName' => $held['originalName'],
            'mime' => $held['mime'],
            'bytes' => $held['bytes'],
        ], $held['parse'], $posting);

        return true;
    }

    /**
     * Stores the CV, and everything read out of it.
     *
     * The parse is passed in when the caller already ran one — the careers
     * form parses on upload so it can pre-fill the fields, and re-reading the
     * same document at submit would be a second copy of the same work.
     *
     * @param  array<string, mixed>|null  $parse
     */
    public function attachResume(
        Applicant $applicant,
        UploadedFile $file,
        ?array $parse = null,
        ?JobPosting $posting = null,
    ): Applicant {
        $parse ??= $this->parser->parseUpload($file);

        $path = $file->store('resumes/'.now()->format('Y/m'), 'local');

        return $this->recordResume($applicant, [
            'path' => $path,
            'originalName' => Str::limit($file->getClientOriginalName(), 180, ''),
            'mime' => $file->getMimeType(),
            'bytes' => $file->getSize(),
        ], $parse, $posting);
    }

    /**
     * Writes the CV columns, whichever route the file arrived by.
     *
     * @param  array{path: string, originalName: string, mime: ?string, bytes: ?int}  $meta
     * @param  array<string, mixed>  $parse
     */
    private function recordResume(Applicant $applicant, array $meta, array $parse, ?JobPosting $posting): Applicant
    {
        // Replacing a CV replaces the file too — an orphaned document nobody
        // can reach from the record is exactly the data nobody remembers to
        // delete when they should.
        if ($applicant->resume_path && $applicant->resume_path !== $meta['path']) {
            Storage::disk('local')->delete($applicant->resume_path);
        }

        $posting ??= $applicant->jobPosting;

        $applicant->update([
            'resume_path' => $meta['path'],
            'resume_original_name' => $meta['originalName'],
            'resume_mime' => $meta['mime'],
            'resume_bytes' => $meta['bytes'],
            'resume_uploaded_at' => now(),
            'resume_text' => $parse['text'] ?? null,
            'resume_parsed' => [
                'fields' => $parse['fields'] ?? [],
                'skills' => $parse['skills'] ?? [],
                // The structured findings — the work history with its dates,
                // the education entries, the licences. Not form fields, so
                // they live here rather than in `fields`.
                'detail' => $parse['detail'] ?? [],
                'method' => $parse['method'] ?? 'none',
                'notes' => $parse['notes'] ?? [],
                'readAt' => now()->toIso8601String(),
            ],
            'resume_status' => $parse['status'] ?? 'None',
            'resume_confidence' => (int) ($parse['confidence'] ?? 0),
        ]);

        // A CV that named skills the applicant never typed is still worth
        // keeping — it is the searchable part of the record.
        if (empty($applicant->skills) && ! empty($parse['skills'])) {
            $applicant->update(['skills' => $parse['skills']]);
        }

        return $this->assess($applicant->fresh(), $posting);
    }

    /**
     * Re-reads the fit between an applicant and the role they applied to.
     *
     * Run whenever either side changes: a new CV, corrected details, or an
     * edited advert. An assessment that is stale in one of those three ways is
     * worse than none, because it looks current.
     */
    public function assess(Applicant $applicant, ?JobPosting $posting = null): Applicant
    {
        $assessment = $this->assessment->forApplicant($applicant, $posting);

        if ($assessment === null) {
            // Nothing to assess against — an applicant encoded by HR against a
            // position rather than an advert. Clear any stale verdict rather
            // than leaving one that refers to a posting they are not on.
            $applicant->update(['assessment' => null, 'assessment_band' => null, 'match_score' => null]);

            return $applicant->fresh();
        }

        $applicant->update([
            'assessment' => $assessment,
            'assessment_band' => $assessment['band'],
            'match_score' => $assessment['score'],
        ]);

        return $applicant->fresh();
    }

    /* ====================================================================== */
    /* Looking an application up from outside */
    /* ====================================================================== */

    /**
     * What a candidate is told about their own application.
     *
     * Stage names are the internal pipeline's, translated: "Assessment" means
     * something to a recruiter and nothing to the person waiting. Rejections
     * are stated plainly rather than left as silence, because the alternative
     * is somebody refreshing this page for four months.
     *
     * @return array<string, mixed>|null
     */
    public function status(string $reference, string $email): ?array
    {
        $applicant = Applicant::query()
            ->with('jobPosting')
            ->where('reference_code', strtoupper(trim($reference)))
            ->whereRaw('LOWER(email) = ?', [strtolower(trim($email))])
            ->first();

        if (! $applicant) {
            return null;
        }

        $public = [
            'Applied' => ['Received', 'Your application is in. Nobody has looked at it yet.'],
            'Screening' => ['Under review', 'A recruiter is reading your application.'],
            'Interview' => ['Interview stage', 'You have reached the interview stage. Expect a call to arrange it.'],
            'Assessment' => ['Assessment', 'You are being assessed for the role — this usually means a test or a practical.'],
            'Final Interview' => ['Final interview', 'You are at the final interview stage.'],
            'Offer' => ['Offer', 'An offer is being prepared for you.'],
            'Hired' => ['Hired', 'You have been hired. Welcome.'],
            'Rejected' => ['Not moving forward', 'We are not taking this application further. Thank you for your time — you are welcome to apply again.'],
        ];

        [$label, $message] = $public[$applicant->stage] ?? ['In progress', 'Your application is being processed.'];

        // The 'Offer' row above assumes one is still being written — true
        // only until it is actually sent, and flatly wrong once the
        // candidate has already answered it. Both this card and the offer
        // panel below it read the same record, so they must not be able to
        // disagree the way "an offer is being prepared for you" sitting
        // directly above "You accepted this offer" did.
        if ($applicant->stage === 'Offer' && $applicant->offer_sent_at) {
            [$label, $message] = match ($applicant->offer_response) {
                'Accepted' => ['Offer accepted', 'You accepted this offer. We will be in touch about your first day.'],
                'Declined' => ['Offer declined', 'You declined this offer. Thank you for letting us know.'],
                default => ['Offer', 'You have an offer — see below.'],
            };
        }

        return [
            'reference' => $applicant->reference_code,
            'name' => $applicant->composedName(),
            'role' => $applicant->jobPosting->title ?? null,
            'appliedOn' => optional($applicant->applied_on)->toDateString(),
            'updatedOn' => optional($applicant->updated_at)->toDateString(),
            'status' => $label,
            'message' => $message,
            'closed' => in_array($applicant->stage, ['Hired', 'Rejected'], true),
            'resumeOnFile' => (bool) $applicant->resume_path,

            /* An offer that is still open. The candidate can answer it right
               here, which is the same thing the links in the email do — the
               email gets lost, and this page does not. */
            'offer' => $applicant->offer_sent_at ? [
                'position' => $applicant->offer_position,
                'salary' => $applicant->offer_salary === null ? null : (float) $applicant->offer_salary,
                'startDate' => optional($applicant->offer_start_date)->toDateString(),
                'expiresOn' => optional($applicant->offer_expires_on)->toDateString(),
                'notes' => $applicant->offer_notes,
                'response' => $applicant->offer_response,
                'expired' => $applicant->offer_expires_on
                    ? CarbonImmutable::parse($applicant->offer_expires_on)->endOfDay()->isPast()
                    : false,
                'awaitingAnswer' => $applicant->offer_response === null
                    && (! $applicant->offer_expires_on
                        || CarbonImmutable::parse($applicant->offer_expires_on)->endOfDay()->isFuture()),
            ] : null,
        ];
    }

    /* ====================================================================== */

    /** Matches the numbering the registry issues, so both routes agree. */
    private function applicantNumber(): string
    {
        $stem = 'APP-'.date('Y').'-';

        $last = Applicant::query()
            ->where('applicant_no', 'like', $stem.'%')
            ->orderByDesc('applicant_no')
            ->lockForUpdate()
            ->value('applicant_no');

        $next = $last ? ((int) Str::afterLast($last, '-')) + 1 : 1;

        return $stem.str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }
}
