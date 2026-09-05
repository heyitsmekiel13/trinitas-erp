<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\JobRequisition;
use App\Services\VacancyArchive;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The archive: where a vacancy goes instead of being deleted, and where it is
 * eventually deleted from.
 *
 * Two steps rather than one, on purpose. Archiving is safe, reversible and
 * always allowed, so it can be the button on the board. Destroying a record is
 * neither, so it lives one level in — and by the time somebody reaches it they
 * have looked at the vacancy twice.
 *
 * Route model binding here has to include trashed records: everything except
 * `archive` operates on something that is already archived, and the default
 * binding would answer 404 for exactly the rows these endpoints exist to act
 * on.
 */
class VacancyArchiveController extends Controller
{
    public function __construct(private readonly VacancyArchive $archive) {}

    /** Everything in the archive, and whether each one can still be destroyed. */
    public function index(): JsonResponse
    {
        $rows = $this->archive->archived();

        return response()->json([
            'data' => [
                'requisitions' => $rows,
                'counts' => [
                    'total' => $rows->count(),
                    'deletable' => $rows->whereNull('blockedFrom')->count(),
                ],
            ],
        ]);
    }

    /** Takes a vacancy off the board, and its advert off the careers site. */
    public function store(Request $request, JobRequisition $requisition): JsonResponse
    {
        $data = $request->validate([
            'reason' => 'nullable|string|max:255',
        ]);

        $result = $this->archive->archive($requisition, $data['reason'] ?? null, $request->user());

        return response()->json([
            'data' => [
                'no' => $result['requisition']->requisition_no,
                'adverts' => $result['adverts'],
                'applicants' => $result['applicants'],
                'message' => $result['message'],
            ],
        ]);
    }

    /** Brings one back. Its advert returns as a draft, never re-published. */
    public function restore(int $requisition): JsonResponse
    {
        $record = JobRequisition::onlyTrashed()->findOrFail($requisition);

        $this->archive->restore($record);

        return response()->json([
            'data' => [
                'no' => $record->requisition_no,
                'message' => "{$record->requisition_no} is back on the board. Any advert it had is a draft — "
                    .'publish it again from Job Postings when you are ready.',
            ],
        ]);
    }

    /** Destroys the record for good, and the advert with it. */
    public function destroy(int $requisition): JsonResponse
    {
        $record = JobRequisition::onlyTrashed()->findOrFail($requisition);
        $number = $record->requisition_no;

        try {
            $this->archive->destroy($record);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'data' => ['no' => $number, 'message' => "{$number} has been deleted for good."],
        ]);
    }
}
