<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Applicant;
use App\Models\JobPosting;
use App\Services\Careers;
use App\Services\JobOffers;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The careers site: everything a candidate can reach without an account.
 *
 * Every route here is public, which is the whole point and also the whole
 * risk. So the surface is kept as small as it can be and each endpoint is
 * throttled on the route:
 *
 *   - Postings expose only what `Careers::presentJob` allows out. There is no
 *     endpoint that takes an id, only a slug, and nothing internal — headcount,
 *     budget rate, the requisition number, the approver — is reachable.
 *
 *   - Applying writes one applicant row and one file. It cannot set a stage, a
 *     rating, a recruiter or a source, so an application arriving from the
 *     internet can never appear further along the pipeline than Applied.
 *
 *   - Checking a status needs the reference code *and* the email it was filed
 *     with. One without the other returns the same "not found" as a wrong
 *     pair, so this cannot be used to test whether an address applied here.
 */
class CareersController extends Controller
{
    public function __construct(
        private readonly Careers $careers,
        private readonly JobOffers $offers,
    ) {}

    /** Every open role, with the filters a jobseeker actually uses. */
    public function jobs(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => 'nullable|string|max:80',
            'department' => 'nullable|string|max:80',
            'type' => 'nullable|string|max:40',
            'setup' => 'nullable|string|max:40',
            'location' => 'nullable|string|max:80',
        ]);

        $jobs = $this->careers->openings($filters);

        return response()->json([
            'data' => [
                'jobs' => $jobs->map(fn (JobPosting $job) => $this->careers->presentJob($job))->values(),
                // The facet lists come from what is actually posted, so the
                // filter bar never offers a department with nothing under it.
                'departments' => $jobs->pluck('hrDepartment.name')->filter()->unique()->sort()->values(),
                'locations' => $jobs
                    ->map(fn (JobPosting $job) => $job->location ?: ($job->branchUnit->name ?? null))
                    ->filter()->unique()->sort()->values(),
                'types' => $jobs->pluck('employment_type')->filter()->unique()->sort()->values(),
                'setups' => $jobs->pluck('work_setup')->filter()->unique()->sort()->values(),
            ],
        ]);
    }

    /** One posting, in full. */
    public function job(string $slug): JsonResponse
    {
        $posting = JobPosting::with(['hrDepartment', 'branchUnit', 'position'])
            ->where('slug', $slug)
            ->first();

        if (! $posting || ! $posting->isOpen()) {
            return response()->json(['message' => 'That role is no longer open.'], 404);
        }

        // Counted without touching `updated_at`, so a popular advert does not
        // keep re-sorting itself to the top of the recruiter's list.
        $posting->newQuery()->whereKey($posting->id)->update(['views' => $posting->views + 1]);

        return response()->json(['data' => $this->careers->presentJob($posting, full: true)]);
    }

    /**
     * Reads a CV and hands back what it found, without creating anything.
     *
     * The candidate sees these values in the form as editable fields, never as
     * a finished application — the parser is a typing aid, and the person is
     * still the author of their own details.
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
                'method' => $parse['method'],
                'confidence' => $parse['confidence'],
                'fields' => $parse['fields'],
                'skills' => $parse['skills'],
                'notes' => $parse['notes'],
                'filename' => $request->file('resume')->getClientOriginalName(),
            ],
        ]);
    }

    /** Files an application against a published posting. */
    public function apply(Request $request): JsonResponse
    {
        $data = $request->validate([
            'slug' => 'required|string|exists:job_postings,slug',

            'firstName' => 'required|string|max:80',
            'middleName' => 'nullable|string|max:80',
            'lastName' => 'required|string|max:80',
            'email' => 'required|email|max:150',
            'phone' => 'required|string|max:40',

            'birthdate' => 'nullable|date|before:today',
            'gender' => 'nullable|in:Male,Female,Prefer not to say',
            'civilStatus' => 'nullable|in:Single,Married,Widowed,Separated',
            'nationality' => 'nullable|string|max:60',

            'addressLine' => 'nullable|string|max:190',
            'city' => 'required|string|max:120',
            'province' => 'required|string|max:120',
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
            'coverLetter' => 'nullable|string|max:4000',
            'skills' => 'nullable|array|max:30',
            'skills.*' => 'string|max:40',

            'resumeToken' => 'nullable|string|max:64',
            'resume' => 'nullable|file|max:'.Careers::MAX_RESUME_KILOBYTES.'|mimes:'.Careers::RESUME_MIMES,

            // RA 10173. Recorded, not assumed.
            'consent' => 'accepted',
        ]);

        $posting = JobPosting::where('slug', $data['slug'])->firstOrFail();

        if (! $posting->isOpen()) {
            return response()->json(['message' => 'That role has closed. Have a look at what else is open.'], 422);
        }

        $result = $this->careers->apply(
            $data,
            $posting,
            $request->file('resume'),
            $data['resumeToken'] ?? null,
            'Careers Portal',
        );

        $applicant = $result['applicant'];

        return response()->json([
            'data' => [
                'reference' => $applicant->reference_code,
                'name' => $applicant->composedName(),
                'role' => $posting->title,
                'appliedOn' => optional($applicant->applied_on)->toDateString(),
                'resumeAttached' => $result['resumeAttached'],
                'updated' => $result['duplicate'],
                'message' => $result['duplicate']
                    ? 'You had already applied for this role, so we updated the application you have with us rather than filing a second one.'
                    : 'Your application is in. Keep the reference below — it is how you check on it.',
            ],
        ], 201);
    }

    /**
     * The candidate's answer to an offer.
     *
     * Guarded exactly as the status lookup is: the reference code and the
     * email it was filed with, together. That pair is the whole credential, so
     * a forwarded link is useless on its own — which matters more here than on
     * the status page, because this one changes something.
     */
    public function respondToOffer(Request $request): JsonResponse
    {
        $data = $request->validate([
            'reference' => 'required|string|max:24',
            'email' => 'required|email|max:150',
            'decision' => 'required|in:Accepted,Declined',
            'reason' => 'nullable|string|max:255',
        ]);

        $applicant = Applicant::query()
            ->where('reference_code', strtoupper(trim($data['reference'])))
            ->whereRaw('LOWER(email) = ?', [strtolower(trim($data['email']))])
            ->first();

        if (! $applicant) {
            // The same answer as a wrong code, for the same reason as the
            // status lookup: otherwise this says whether an address applied.
            return response()->json([
                'message' => 'No application matches that reference and email address.',
            ], 404);
        }

        try {
            $this->offers->respond($applicant, $data['decision'], $data['reason'] ?? null);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'data' => [
                'decision' => $data['decision'],
                'message' => $data['decision'] === 'Accepted'
                    ? 'Thank you — we have told the recruiter, and they will be in touch about your first day.'
                    : 'Thank you for letting us know. The recruiter has been told, and you are welcome to apply again.',
            ],
        ]);
    }

    /** Where a candidate finds out what happened to their application. */
    public function status(Request $request): JsonResponse
    {
        $data = $request->validate([
            'reference' => 'required|string|max:24',
            'email' => 'required|email|max:150',
        ]);

        $status = $this->careers->status($data['reference'], $data['email']);

        if (! $status) {
            // Deliberately the same answer for a wrong code and a wrong email:
            // otherwise this endpoint tells anybody who asks whether a given
            // person applied here.
            return response()->json([
                'message' => 'No application matches that reference and email address.',
            ], 404);
        }

        return response()->json(['data' => $status]);
    }
}
