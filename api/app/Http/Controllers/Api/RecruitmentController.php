<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Applicant;
use App\Models\JobPosting;
use App\Models\JobRequisition;
use App\Models\PerformanceReview;
use App\Models\Position;
use App\Services\Careers;
use App\Services\JobOffers;
use App\Services\OfferDocuments;
use App\Services\PerformanceOperations;
use App\Services\RecruitmentOperations;
use App\Services\ResumeReader;
use App\Services\ReviewDocuments;
use App\Services\RoleLibrary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The two HR cycles that are processes rather than lists.
 *
 * Recruitment moves an applicant through a pipeline and, at the end of it,
 * creates a person. Performance moves a review through a cycle and, at the end
 * of it, settles a rating. Both are here because both have rules about what
 * may follow what, and neither survives being edited as a status column.
 */
class RecruitmentController extends Controller
{
    public function __construct(
        private readonly RecruitmentOperations $recruitment,
        private readonly PerformanceOperations $performance,
        private readonly Careers $careers,
        private readonly JobOffers $offers,
        private readonly RoleLibrary $roles,
        private readonly OfferDocuments $documents,
        private readonly ResumeReader $resumeReader,
        private readonly ReviewDocuments $reviewDocuments,
    ) {}

    /** Whether scanned/photographed resumes can actually be OCR'd on this host. */
    public function ocrHealth(): JsonResponse
    {
        return response()->json(['data' => $this->resumeReader->ocrHealth()]);
    }

    /* ====================================================================== */
    /* Recruitment */
    /* ====================================================================== */

    /** The board: how many sit at each stage, and how long the oldest has. */
    public function pipeline(): JsonResponse
    {
        return response()->json(['data' => $this->recruitment->pipeline()]);
    }

    /**
     * One applicant: their file, their CV, and the moves the server accepts.
     *
     * The parsed CV is returned beside the confirmed fields rather than merged
     * into them, so the screen can show a recruiter what the document said and
     * what the record says, and offer to copy one into the other. Merging them
     * here would make an unchecked guess indistinguishable from a fact the
     * moment it was read.
     */
    public function applicant(Applicant $applicant): JsonResponse
    {
        return response()->json(['data' => $this->applicantPayload($applicant)]);
    }

    /**
     * One applicant as JSON.
     *
     * Split out of `applicant()` so that an action which changes the record —
     * sending an offer, say — can hand back the whole updated applicant
     * alongside a message about what it just did, rather than the client
     * having to re-fetch and hope.
     *
     * @return array<string, mixed>
     */
    private function applicantPayload(Applicant $applicant): array
    {
        $applicant->loadMissing(['position', 'jobRequisition.hrDepartment', 'jobPosting', 'recruiter']);

        $parsed = $applicant->resume_parsed ?? [];

        return [
            'id' => $applicant->id,
            'code' => $applicant->applicant_no,
            'reference' => $applicant->reference_code,
            'name' => $applicant->full_name,
            'firstName' => $applicant->first_name,
            'middleName' => $applicant->middle_name,
            'lastName' => $applicant->last_name,
            'email' => $applicant->email,
            'phone' => $applicant->phone,
            'position' => $applicant->position->title ?? null,
            'positionId' => $applicant->position_id,
            'requisition' => $applicant->jobRequisition->requisition_no ?? null,
            'department' => $applicant->jobRequisition->hrDepartment->name ?? null,
            'posting' => $applicant->jobPosting->title ?? null,
            'postingSlug' => $applicant->jobPosting->slug ?? null,
            'source' => $applicant->source,
            'appliedVia' => $applicant->applied_via,
            'applied' => optional($applicant->applied_on)->toDateString(),
            'stage' => $applicant->stage,
            'rating' => $applicant->rating === null ? null : (float) $applicant->rating,
            'expectedSalary' => $applicant->expected_salary === null ? null : (float) $applicant->expected_salary,
            'recruiter' => $applicant->recruiter->full_name ?? null,

            'personal' => [
                'birthdate' => optional($applicant->birthdate)->toDateString(),
                'gender' => $applicant->gender,
                'civilStatus' => $applicant->civil_status,
                'nationality' => $applicant->nationality,
                'addressLine' => $applicant->address_line,
                'city' => $applicant->city,
                'province' => $applicant->province,
                'postalCode' => $applicant->postal_code,
            ],
            'background' => [
                'educationLevel' => $applicant->education_level,
                'school' => $applicant->school,
                'course' => $applicant->course,
                'yearGraduated' => $applicant->year_graduated,
                'yearsExperience' => $applicant->years_experience === null ? null : (float) $applicant->years_experience,
                'currentEmployer' => $applicant->current_employer,
                'currentTitle' => $applicant->current_title,
                'availableFrom' => optional($applicant->available_from)->toDateString(),
                'linkedinUrl' => $applicant->linkedin_url,
                'portfolioUrl' => $applicant->portfolio_url,
            ],
            'skills' => $applicant->skills ?? [],
            'coverLetter' => $applicant->cover_letter,
            'screeningNotes' => $applicant->screening_notes,
            'matchScore' => $applicant->match_score,
            /* The assessment behind that number: which requirement was
                   met and on what evidence, how the years and the education
                   compare, and what simply is not known. Sent whole so the
                   screen can show the reasoning rather than the verdict. */
            'assessment' => $applicant->assessment,
            'consentedAt' => optional($applicant->consented_at)->toDateString(),

            'resume' => $applicant->resume_path ? [
                'filename' => $applicant->resume_original_name,
                'mime' => $applicant->resume_mime,
                'bytes' => $applicant->resume_bytes,
                'uploadedAt' => optional($applicant->resume_uploaded_at)->toIso8601String(),
                'status' => $applicant->resume_status,
                'confidence' => (int) $applicant->resume_confidence,
                'method' => $parsed['method'] ?? null,
                'notes' => $parsed['notes'] ?? [],
                /* What the parser read, kept as a suggestion. The screen
                       shows each one beside the stored value with a control to
                       accept it — never applied silently. */
                'parsedFields' => $parsed['fields'] ?? [],
                'parsedSkills' => $parsed['skills'] ?? [],
                /* The work history, education and licences read out of the
                       document — a list, not a form field, so it is shown
                       rather than offered as a suggestion to accept. */
                'positions' => $parsed['detail']['positions'] ?? [],
                'education' => $parsed['detail']['education'] ?? [],
                'certifications' => $parsed['detail']['certifications'] ?? [],
                'languages' => $parsed['detail']['languages'] ?? [],
                /* The first part of the extracted text, so a recruiter can
                       satisfy themselves the right document was read without
                       downloading it. */
                'excerpt' => mb_substr((string) $applicant->resume_text, 0, 1200),
            ] : null,

            /* The offer, when one has gone out. Kept beside the pipeline
                   stage rather than folded into it: "moved to Offer" and "said
                   yes" are different facts, and only one of them belongs to
                   the candidate. */
            'offer' => $applicant->offer_sent_at ? [
                'position' => $applicant->offer_position,
                'salary' => $applicant->offer_salary === null ? null : (float) $applicant->offer_salary,
                'startDate' => optional($applicant->offer_start_date)->toDateString(),
                'expiresOn' => optional($applicant->offer_expires_on)->toDateString(),
                'notes' => $applicant->offer_notes,
                'sentAt' => optional($applicant->offer_sent_at)->toIso8601String(),
                'response' => $applicant->offer_response,
                'respondedAt' => optional($applicant->offer_responded_at)->toIso8601String(),
                'declineReason' => $applicant->offer_decline_reason,
            ] : null,

            'allowedMoves' => $this->recruitment->allowedMoves($applicant),
            'canHire' => in_array($applicant->stage, ['Offer', 'Final Interview'], true),
        ];
    }

    /**
     * Reads a CV for the intake form, without creating an applicant.
     *
     * The same stash-and-token flow the careers site uses, so the recruiter
     * uploads once: the parse comes back to fill the form, and the token
     * carries the file through to whichever applicant is created or updated.
     */
    public function parseResume(Request $request): JsonResponse
    {
        $request->validate([
            'resume' => 'required|file|max:'.Careers::MAX_RESUME_KILOBYTES.'|mimes:'.Careers::RESUME_MIMES,
        ]);

        ['token' => $token, 'parse' => $parse] = $this->careers->stashResume($request->file('resume'));

        return response()->json([
            'data' => [
                'token' => $token,
                'status' => $parse['status'],
                // How it was read. "ocr" is worth showing: a recognised scan
                // is materially less reliable than an extracted PDF, and the
                // recruiter checking the fields should know which they have.
                'method' => $parse['method'],
                'confidence' => $parse['confidence'],
                'fields' => $parse['fields'],
                'skills' => $parse['skills'],
                'notes' => $parse['notes'],
                'filename' => $request->file('resume')->getClientOriginalName(),
            ],
        ]);
    }

    /**
     * Creates an applicant from the HR intake form.
     *
     * Separate from the registry's generic create because this one carries the
     * full personal record and can pick up a stashed CV. The registry route
     * still exists and still works — a quick name-and-number entry does not
     * need this — but nothing that arrives here is treated as more trusted
     * than what a candidate typed themselves.
     */
    public function intake(Request $request): JsonResponse
    {
        $data = $request->validate([
            'firstName' => 'required|string|max:80',
            'middleName' => 'nullable|string|max:80',
            'lastName' => 'required|string|max:80',
            'email' => 'nullable|email|max:150',
            'phone' => 'nullable|string|max:40',

            'positionId' => 'required|integer|exists:positions,id',
            'requisitionId' => 'nullable|integer|exists:job_requisitions,id',
            'source' => 'required|in:Referral,Job Board,Walk-in,Agency,Social Media,University',
            'appliedOn' => 'required|date',

            'birthdate' => 'nullable|date|before:today',
            'gender' => 'nullable|in:Male,Female,Prefer not to say',
            'civilStatus' => 'nullable|in:Single,Married,Widowed,Separated',
            'nationality' => 'nullable|string|max:60',
            'addressLine' => 'nullable|string|max:190',
            'city' => 'nullable|string|max:120',
            'province' => 'nullable|string|max:120',
            'postalCode' => 'nullable|string|max:12',

            'educationLevel' => 'nullable|in:High School,Vocational,Associate,Bachelor,Master,Doctorate',
            'school' => 'nullable|string|max:150',
            'course' => 'nullable|string|max:150',
            'yearGraduated' => 'nullable|integer|min:1950|max:'.(date('Y') + 6),

            'yearsExperience' => 'nullable|numeric|min:0|max:60',
            'currentEmployer' => 'nullable|string|max:150',
            'currentTitle' => 'nullable|string|max:150',
            'availableFrom' => 'nullable|date',
            'currentSalary' => 'nullable|numeric|min:0',
            'expectedSalary' => 'nullable|numeric|min:0',

            'linkedinUrl' => 'nullable|url|max:190',
            'portfolioUrl' => 'nullable|url|max:190',
            'coverLetter' => 'nullable|string|max:4000',
            'skills' => 'nullable|array|max:30',
            'skills.*' => 'string|max:40',
            'screeningNotes' => 'nullable|string|max:2000',

            'resumeToken' => 'nullable|string|max:64',
            'consent' => 'nullable|boolean',
        ]);

        $result = $this->careers->apply(
            $data,
            null,
            null,
            $data['resumeToken'] ?? null,
            'HR Encoded',
        );

        $applicant = $result['applicant'];

        if (! empty($data['screeningNotes'])) {
            $applicant->update(['screening_notes' => $data['screeningNotes']]);
        }

        return response()->json([
            'data' => [
                'id' => $applicant->id,
                'code' => $applicant->applicant_no,
                'name' => $applicant->full_name,
                'stage' => $applicant->stage,
                'resumeAttached' => $result['resumeAttached'],
            ],
        ], 201);
    }

    /**
     * Corrects an applicant's details.
     *
     * This is what the "accept what the CV said" control on the screen calls:
     * the recruiter chooses which suggestions to take and this writes exactly
     * those. The stage is not writable here — it moves through `moveApplicant`,
     * which is what keeps the pipeline order meaningful.
     */
    public function updateApplicant(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'firstName' => 'nullable|string|max:80',
            'middleName' => 'nullable|string|max:80',
            'lastName' => 'nullable|string|max:80',
            'email' => 'nullable|email|max:150',
            'phone' => 'nullable|string|max:40',
            'birthdate' => 'nullable|date|before:today',
            'gender' => 'nullable|in:Male,Female,Prefer not to say',
            'civilStatus' => 'nullable|in:Single,Married,Widowed,Separated',
            'nationality' => 'nullable|string|max:60',
            'addressLine' => 'nullable|string|max:190',
            'city' => 'nullable|string|max:120',
            'province' => 'nullable|string|max:120',
            'postalCode' => 'nullable|string|max:12',
            'educationLevel' => 'nullable|in:High School,Vocational,Associate,Bachelor,Master,Doctorate',
            'school' => 'nullable|string|max:150',
            'course' => 'nullable|string|max:150',
            'yearGraduated' => 'nullable|integer|min:1950|max:'.(date('Y') + 6),
            'yearsExperience' => 'nullable|numeric|min:0|max:60',
            'currentEmployer' => 'nullable|string|max:150',
            'currentTitle' => 'nullable|string|max:150',
            'availableFrom' => 'nullable|date',
            'expectedSalary' => 'nullable|numeric|min:0',
            'linkedinUrl' => 'nullable|url|max:190',
            'portfolioUrl' => 'nullable|url|max:190',
            'skills' => 'nullable|array|max:30',
            'skills.*' => 'string|max:40',
            'screeningNotes' => 'nullable|string|max:2000',
            'rating' => 'nullable|numeric|between:0,5',
        ]);

        $columns = [
            'firstName' => 'first_name', 'middleName' => 'middle_name', 'lastName' => 'last_name',
            'email' => 'email', 'phone' => 'phone', 'birthdate' => 'birthdate', 'gender' => 'gender',
            'civilStatus' => 'civil_status', 'nationality' => 'nationality',
            'addressLine' => 'address_line', 'city' => 'city', 'province' => 'province',
            'postalCode' => 'postal_code', 'educationLevel' => 'education_level',
            'school' => 'school', 'course' => 'course', 'yearGraduated' => 'year_graduated',
            'yearsExperience' => 'years_experience', 'currentEmployer' => 'current_employer',
            'currentTitle' => 'current_title', 'availableFrom' => 'available_from',
            'expectedSalary' => 'expected_salary', 'linkedinUrl' => 'linkedin_url',
            'portfolioUrl' => 'portfolio_url', 'skills' => 'skills',
            'screeningNotes' => 'screening_notes', 'rating' => 'rating',
        ];

        $changes = [];

        foreach ($columns as $field => $column) {
            // Only what was sent. A form that submits ten fields must not
            // blank the twenty it does not know about.
            if ($request->has($field)) {
                $changes[$column] = $data[$field] ?? null;
            }
        }

        if ($changes) {
            $applicant->update($changes);

            // The display name follows the parts whenever the parts change.
            if (array_intersect_key($changes, array_flip(['first_name', 'middle_name', 'last_name']))) {
                $applicant->refresh();
                $applicant->update(['full_name' => $applicant->composedName()]);
            }

            /* Correcting the years, the education or the skills changes the
               answer to "does this person fit the advert". Leaving yesterday's
               verdict beside today's facts is worse than having none, because
               it still looks current. */
            if (array_intersect_key($changes, array_flip([
                'years_experience', 'education_level', 'skills', 'current_title', 'expected_salary',
            ]))) {
                $this->careers->assess($applicant->fresh());
            }
        }

        return $this->applicant($applicant->fresh());
    }

    /** Re-reads one applicant against the advert as it now stands. */
    public function reassessApplicant(Applicant $applicant): JsonResponse
    {
        return $this->applicant($this->careers->assess($applicant));
    }

    /* ====================================================================== */
    /* The offer */
    /* ====================================================================== */

    /**
     * The offer as it would go out, without sending it.
     *
     * Built from the same method the email uses, so what a recruiter reads
     * before pressing send is what the candidate receives. A preview assembled
     * separately is a preview that eventually lies.
     */
    public function previewOffer(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'position' => 'nullable|string|max:150',
            'salary' => 'nullable|numeric|min:0|max:10000000',
            'startDate' => 'nullable|date',
            'expiresOn' => 'nullable|date',
            'notes' => 'nullable|string|max:2000',
            'dailyRate' => 'nullable|numeric|min:0|max:100000',
            'deMinimis' => 'nullable|numeric|min:0|max:100000',
            'orientationAt' => 'nullable|date',
            'orientationVenue' => 'nullable|string|max:255',
        ]);

        /* Filled onto an unsaved copy, so a preview of terms somebody is still
           typing never touches the record. */
        $draft = $applicant->replicate();
        $draft->id = $applicant->id;
        $draft->offer_position = $data['position'] ?? $applicant->offer_position;
        $draft->offer_salary = $data['salary'] ?? $applicant->offer_salary;
        $draft->offer_start_date = $data['startDate'] ?? $applicant->offer_start_date;
        $draft->offer_expires_on = $data['expiresOn'] ?? $applicant->offer_expires_on;
        $draft->offer_notes = $data['notes'] ?? $applicant->offer_notes;
        $draft->offer_daily_rate = $data['dailyRate'] ?? $applicant->offer_daily_rate;
        $draft->offer_de_minimis = $data['deMinimis'] ?? $applicant->offer_de_minimis;
        $draft->offer_orientation_at = $data['orientationAt'] ?? $applicant->offer_orientation_at;
        $draft->offer_orientation_venue = $data['orientationVenue'] ?? $applicant->offer_orientation_venue;

        return response()->json(['data' => $this->offers->present($draft)]);
    }

    /** Records the offer and emails it to the candidate. */
    public function sendOffer(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'position' => 'nullable|string|max:150',
            'salary' => 'required|numeric|min:0|max:10000000',
            'startDate' => 'nullable|date|after_or_equal:today',
            'expiresOn' => 'nullable|date|after:today',
            'notes' => 'nullable|string|max:2000',
            'dailyRate' => 'nullable|numeric|min:0|max:100000',
            'deMinimis' => 'nullable|numeric|min:0|max:100000',
            'orientationAt' => 'nullable|date',
            'orientationVenue' => 'nullable|string|max:255',
        ]);

        try {
            $result = $this->offers->send($applicant, $data, $request->user());
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'data' => $this->applicantPayload($result['applicant']) + [
                'offerSent' => $result['sent'],
                'offerMessage' => $result['message'],
            ],
        ]);
    }

    /**
     * The offer letter as a file, for reading before it is sent.
     *
     * The same document the candidate receives, built by the same code. A
     * recruiter who wants to check the wording of a 180-day probation clause
     * before it goes to somebody's inbox should not have to send it to
     * themselves first.
     */
    public function offerDocument(Request $request, Applicant $applicant): Response
    {
        $which = $request->query('document') === 'referral' ? 'referral' : 'letter';

        $file = $which === 'referral'
            ? $this->documents->referralSlip($applicant)
            : $this->documents->offerLetter($applicant);

        return response($file['bytes'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
            'Content-Length' => (string) strlen($file['bytes']),
        ]);
    }

    /**
     * Records an answer a recruiter was told directly.
     *
     * The candidate answering for themselves through the link in the email is
     * the better record, and this exists because a good half of them phone
     * instead.
     */
    public function recordOfferResponse(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'decision' => 'required|in:Accepted,Declined',
            'reason' => 'nullable|string|max:255',
        ]);

        try {
            $this->offers->respond($applicant, $data['decision'], $data['reason'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->applicant($applicant->fresh());
    }

    /** Attaches or replaces an applicant's CV, and re-reads it. */
    public function uploadResume(Request $request, Applicant $applicant): JsonResponse
    {
        $request->validate([
            'resume' => 'required|file|max:'.Careers::MAX_RESUME_KILOBYTES.'|mimes:'.Careers::RESUME_MIMES,
        ]);

        $this->careers->attachResume($applicant, $request->file('resume'));

        return $this->applicant($applicant->fresh());
    }

    /**
     * Streams a CV back to the recruiter who asked for it.
     *
     * Behind the ordinary bearer token rather than a signed URL: unlike a chat
     * photo this is never rendered by an `<img>` that cannot send a header, and
     * a resume is not a document that should have a shareable link at all.
     */
    public function resume(Applicant $applicant): StreamedResponse
    {
        abort_unless($applicant->resume_path, 404, 'No CV has been uploaded for this applicant.');
        abort_unless(Storage::disk('local')->exists($applicant->resume_path), 404, 'That file is no longer here.');

        return Storage::disk('local')->response(
            $applicant->resume_path,
            $applicant->resume_original_name ?: 'resume',
            ['Content-Type' => $applicant->resume_mime ?: 'application/octet-stream'],
            // PDFs open in the browser tab; everything else downloads under the
            // name it was uploaded with.
            str_contains((string) $applicant->resume_mime, 'pdf') ? 'inline' : 'attachment',
        );
    }

    /* ====================================================================== */
    /* Job postings */
    /* ====================================================================== */

    /**
     * Drafts the words of an advert from the role itself.
     *
     * A manpower request already knows the position, the department and the
     * budget. Typing the posting from nothing at the end of that form is what
     * produces adverts with a title and an empty body, or three lines copied
     * off the last one — and both are why a vacancy sits unfilled.
     *
     * Nothing is saved. The draft goes back to whoever is filling the form,
     * who reads it and decides whether to publish: an advert generated and
     * posted without anybody looking is worse than an empty one, because it is
     * wrong at length.
     */
    public function draftAdvert(Request $request): JsonResponse
    {
        $data = $request->validate([
            'positionId' => 'nullable|integer|exists:positions,id',
            'requisitionId' => 'nullable|integer|exists:job_requisitions,id',
            'title' => 'nullable|string|max:150',
        ]);

        $requisition = ! empty($data['requisitionId'])
            ? JobRequisition::with(['position', 'hrDepartment', 'branchUnit'])->find($data['requisitionId'])
            : null;

        $position = ! empty($data['positionId'])
            ? Position::find($data['positionId'])
            : $requisition?->position;

        if (! $position && blank($data['title'] ?? null)) {
            return response()->json([
                'message' => 'Choose the position first — the advert is written from the role.',
            ], 422);
        }

        return response()->json([
            'data' => $this->roles->draft($position, $requisition, $data['title'] ?? null),
        ]);
    }

    /**
     * Puts a posting on the careers site, or takes it off.
     *
     * Publishing is a deliberate act with a date on it rather than a status
     * anybody can type, because it is the moment the role becomes visible to
     * the public — and because "when did we post this" is the first question
     * asked about a vacancy that is not attracting anybody.
     */
    public function publishPosting(Request $request, JobPosting $posting): JsonResponse
    {
        $data = $request->validate(['closesOn' => 'nullable|date|after:today']);

        if (blank($posting->summary) && blank($posting->qualifications)) {
            return response()->json([
                'message' => 'Write at least a summary or the qualifications before publishing — an empty advert attracts nobody worth interviewing.',
            ], 422);
        }

        $posting->update([
            'status' => 'Published',
            'published_at' => $posting->published_at ?? now(),
            'closes_on' => $data['closesOn'] ?? $posting->closes_on,
        ]);

        // The requisition it came from is now being sourced against.
        if ($posting->jobRequisition && $posting->jobRequisition->status === 'Approved') {
            $posting->jobRequisition->update(['status' => 'Sourcing']);
        }

        return response()->json(['data' => $this->careers->presentJob($posting->fresh(), full: true)]);
    }

    /**
     * Re-reads every application on a posting against the advert as it now
     * stands.
     *
     * The assessment is a comparison between two documents, and editing the
     * advert changes one of them. Without this, tightening "three years" to
     * "five" leaves fifty applicants carrying a verdict measured against a
     * requirement that no longer exists — and nothing on the screen would say
     * so, because a stale score looks exactly like a fresh one.
     */
    public function reassessPosting(JobPosting $posting): JsonResponse
    {
        $applicants = Applicant::where('job_posting_id', $posting->id)
            ->whereNotIn('stage', ['Hired', 'Rejected'])
            ->get();

        $bands = [];

        foreach ($applicants as $applicant) {
            $assessed = $this->careers->assess($applicant, $posting);
            $band = $assessed->assessment_band ?? 'Not assessed';
            $bands[$band] = ($bands[$band] ?? 0) + 1;
        }

        arsort($bands);

        return response()->json([
            'data' => [
                'assessed' => $applicants->count(),
                'bands' => $bands,
            ],
        ]);
    }

    public function closePosting(JobPosting $posting): JsonResponse
    {
        $posting->update(['status' => 'Closed']);

        return response()->json(['data' => ['slug' => $posting->slug, 'status' => 'Closed']]);
    }

    /**
     * Drafts a posting from a manpower request.
     *
     * The requisition already knows the role, the department and the branch.
     * Copying them across is the difference between publishing a vacancy in a
     * minute and retyping the whole thing — and it is what keeps the advert
     * and the authorisation pointing at the same job.
     */
    public function postingFromRequisition(Request $request, JobRequisition $requisition): JsonResponse
    {
        $requisition->loadMissing(['position', 'hrDepartment', 'branchUnit']);

        $existing = JobPosting::where('job_requisition_id', $requisition->id)->first();

        if ($existing) {
            return response()->json([
                'data' => $this->careers->presentJob($existing, full: true),
                'message' => 'This manpower request already has an advert.',
            ]);
        }

        $title = $requisition->position->title ?? 'Vacancy';

        $posting = JobPosting::create([
            'title' => $title,
            'slug' => JobPosting::uniqueSlug($title),
            'job_requisition_id' => $requisition->id,
            'position_id' => $requisition->position_id,
            'hr_department_id' => $requisition->hr_department_id,
            'branch_unit_id' => $requisition->branch_unit_id,
            'location' => $requisition->branchUnit->name ?? null,
            'openings' => max(1, $requisition->openings()),
            'status' => 'Draft',
            'posted_by' => $request->user()?->id,
        ]);

        return response()->json(['data' => $this->careers->presentJob($posting, full: true)], 201);
    }

    public function moveApplicant(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'stage' => 'required|string|max:40',
        ]);

        try {
            $this->recruitment->moveTo($applicant, $data['stage']);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->applicant($applicant->fresh());
    }

    /**
     * Hires an applicant: 201 file, sign-in, and the requisition's seat.
     *
     * The issued password comes back once, here, because it is never stored in
     * a readable form and this is the only moment it can be handed over.
     */
    public function hire(Request $request, Applicant $applicant): JsonResponse
    {
        $data = $request->validate([
            'firstName' => 'required|string|max:80',
            'lastName' => 'required|string|max:80',
            'middleName' => 'nullable|string|max:80',
            'employeeNo' => 'nullable|string|max:32|unique:employees,employee_no',
            'email' => 'nullable|email|max:150',
            'mobile' => 'nullable|string|max:40',
            'positionId' => 'nullable|integer|exists:positions,id',
            'departmentId' => 'nullable|integer|exists:hr_departments,id',
            'branchId' => 'nullable|integer|exists:branch_units,id',
            'businessGroupId' => 'nullable|integer|exists:business_groups,id',
            'payrollGroupId' => 'nullable|integer|exists:payroll_groups,id',
            'shiftId' => 'nullable|integer|exists:shifts,id',
            'dateHired' => 'nullable|date',
            // The masterfile's own vocabulary. Validated here so a wrong value
            // is a message rather than a truncated-column error from MySQL.
            'employmentStatus' => 'nullable|in:PROBATION,REGULAR,RESIGNED,TERMINATED',
            'salary' => 'nullable|numeric|min:0',
        ]);

        try {
            $result = $this->recruitment->hire($applicant, $data);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'data' => [
                'employee' => [
                    'id' => $result['employee']->id,
                    'employeeNo' => $result['employee']->employee_no,
                    'name' => $result['employee']->full_name,
                    'dateHired' => optional($result['employee']->date_hired)->toDateString(),
                ],
                'credentials' => $result['credentials'],
                /* What the application could not answer, so the dialog that
                   just created this person can say so rather than leaving it
                   to be discovered by a failed payroll run. */
                'profile' => $result['profile'],
            ],
        ], 201);
    }

    /* ====================================================================== */
    /* Performance */
    /* ====================================================================== */

    public function performanceSummary(): JsonResponse
    {
        return response()->json(['data' => $this->performance->summary()]);
    }

    /**
     * Opens a review cycle for a department, or for the whole company.
     *
     * Safe to re-run: anybody who already has a review for the period keeps
     * the one they have.
     */
    public function openCycle(Request $request): JsonResponse
    {
        $data = $request->validate([
            'period' => 'required|string|max:40',
            'dueDate' => 'nullable|date',
            'departmentId' => 'nullable|integer|exists:hr_departments,id',
        ]);

        return response()->json([
            'data' => $this->performance->openCycle(
                $data['period'],
                $data['dueDate'] ?? null,
                $data['departmentId'] ?? null,
            ),
        ], 201);
    }

    public function review(PerformanceReview $review): JsonResponse
    {
        $review->loadMissing(['employee.hrDepartment', 'employee.position', 'reviewer']);

        return response()->json([
            'data' => [
                'id' => $review->id,
                'employee' => $review->employee->full_name ?? null,
                'employeeNo' => $review->employee->employee_no ?? null,
                'department' => $review->employee->hrDepartment->name ?? null,
                'position' => $review->employee->position->title ?? null,
                'period' => $review->period,
                'reviewer' => $review->reviewer->full_name ?? null,
                'dueDate' => optional($review->due_date)->toDateString(),
                'score' => $review->score === null ? null : (float) $review->score,
                'rating' => $review->rating,
                'strengths' => $review->strengths,
                'developmentAreas' => $review->development_areas,
                'status' => $review->status,
                'allowedMoves' => $this->performance->allowedMoves($review),
                // What the band would be if it closed on this score — shown
                // while scoring so the rating is never a surprise.
                'projectedRating' => $this->performance->ratingFor(
                    $review->score === null ? null : (float) $review->score,
                ),
            ],
        ]);
    }

    public function scoreReview(Request $request, PerformanceReview $review): JsonResponse
    {
        $data = $request->validate([
            'score' => 'required|numeric|between:0,5',
            'strengths' => 'nullable|string|max:2000',
            'developmentAreas' => 'nullable|string|max:2000',
        ]);

        $this->performance->score(
            $review,
            (float) $data['score'],
            $data['strengths'] ?? null,
            $data['developmentAreas'] ?? null,
        );

        return $this->review($review->fresh());
    }

    public function moveReview(Request $request, PerformanceReview $review): JsonResponse
    {
        $data = $request->validate(['status' => 'required|string|max:40']);

        try {
            $this->performance->moveTo($review, $data['status']);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return $this->review($review->fresh());
    }

    /** The signed record a completed review leaves behind — refuses on anything still open. */
    public function reviewDocument(PerformanceReview $review): JsonResponse|Response
    {
        try {
            $file = $this->reviewDocuments->document($review);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response($file['bytes'], 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$file['filename'].'"',
            'Content-Length' => (string) strlen($file['bytes']),
        ]);
    }
}
