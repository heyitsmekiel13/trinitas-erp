<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ComplianceReview;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The other side of the compliance desk.
 *
 * Deliberately not behind the `process-office` middleware, and deliberately a
 * separate controller. Everything in ComplianceController is the office
 * reading about other people; everything here is one person reading about
 * themselves, and mixing the two in one file is how a filter eventually gets
 * missed and somebody sees a register they should not.
 *
 * The scope is narrow on purpose:
 *
 *   - Only reviews about the signed-in account. Never taken from a parameter,
 *     the same rule the HR self-service routes follow.
 *   - Only reviews the office has deliberately disclosed. An undisclosed
 *     verdict stays internal, because the register only gets recorded honestly
 *     if it is not written under argument.
 *   - Observations — the flag register — are never exposed here at all. Those
 *     are what the data shows; a review is what the office concluded, and only
 *     the second one is ever used in a decision about somebody.
 */
class MyComplianceController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /**
     * Reviews shared with me.
     *
     * Returns an empty list rather than a 403 when there are none, because
     * "nothing has been shared with you" is the ordinary case and should read
     * as calm rather than as a refusal.
     */
    public function index(Request $request): JsonResponse
    {
        $reviews = $this->scope($request)
            ->with(['task:id,reference,title,due_date,completed_at', 'project:id,name', 'reviewer:id,name'])
            ->orderByDesc('disclosed_at')
            ->limit(100)
            ->get();

        return response()->json(['data' => [
            'awaitingResponse' => $reviews->where('response_status', 'Awaiting response')->count(),
            'reviews' => $reviews->map(fn (ComplianceReview $r) => [
                'id' => $r->id,
                'reference' => $r->task?->reference,
                'title' => $r->task?->title,
                'project' => $r->project?->name,
                'verdict' => $r->verdict,
                'timelinessDays' => $r->timeliness_days,
                'qualityScore' => $r->quality_score,
                'findings' => $r->findings,
                'actionRequired' => $r->action_required,
                'followUpOn' => $r->follow_up_on?->toDateString(),
                'dueDate' => $r->task?->due_date?->toDateString(),
                'completedOn' => $r->task?->completed_at?->toDateString(),
                // Who signed it. A finding nobody's name is on is one nobody
                // can be asked about.
                'reviewer' => $r->reviewer?->name,
                'disclosedAt' => $r->disclosed_at?->toIso8601String(),
                'status' => $r->response_status,
                'myResponse' => $r->subject_response,
                'myRespondedAt' => $r->subject_responded_at?->toIso8601String(),
                'officeReply' => $r->office_reply,
                'officeRepliedAt' => $r->office_replied_at?->toIso8601String(),
                'canRespond' => $r->response_status === 'Awaiting response',
            ])->all(),
        ]]);
    }

    /**
     * My answer to a review.
     *
     * Accepting and disputing are both recorded rather than only the second,
     * because an unanswered review and an accepted one are different facts and
     * the office needs to be able to tell them apart when it chases.
     *
     * Editable until the office replies. Somebody who fires off "this is
     * nonsense" and then thinks better of it should be able to say what they
     * actually mean; once it has been answered, the exchange is the record.
     */
    public function respond(Request $request, ComplianceReview $review): JsonResponse
    {
        $this->assertMine($request, $review);

        abort_if(
            in_array($review->response_status, ['Accepted', 'Closed'], true),
            422,
            'This has already been answered by the office and is closed.',
        );

        $data = $request->validate([
            'response' => 'required|string|max:4000',
            'accept' => 'required|boolean',
        ]);

        $review->update([
            'subject_response' => $data['response'],
            'subject_responded_at' => now(),
            // Accepting closes it outright — there is nothing for the office to
            // answer. Disputing leaves it open and waiting on them.
            'response_status' => $data['accept'] ? 'Accepted' : 'Disputed',
        ]);

        $this->audit->log(
            $data['accept'] ? 'accepted a compliance verdict' : 'disputed a compliance verdict',
            'ComplianceReview',
            $review->id,
            $review->task?->reference,
            'process',
        );

        return response()->json(['data' => ['id' => $review->id, 'status' => $review->response_status]]);
    }

    /* -------------------------------- Access ------------------------------- */

    /**
     * Disclosed reviews about the signed-in account, and nothing else.
     *
     * The two conditions are the whole access model for this controller.
     */
    private function scope(Request $request)
    {
        return ComplianceReview::query()
            ->where('subject_id', $request->user()->id)
            ->whereNotNull('disclosed_at');
    }

    private function assertMine(Request $request, ComplianceReview $review): void
    {
        abort_unless(
            $review->subject_id === $request->user()->id && $review->isDisclosed(),
            404,
            'Not found.',
        );
    }
}
