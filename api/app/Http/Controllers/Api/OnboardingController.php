<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Task;
use App\Models\TaskNotice;
use App\Services\EmployeeDocumentChecklist;
use App\Services\EmployeeProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * The 201 files that are not finished yet, and the notice that says so.
 *
 * Two endpoints with one job between them: make an incomplete employee record
 * impossible to not notice.
 *
 * `outstanding` is the queue — every file with something missing, worst first,
 * read by the panel on the HR dashboard and by the masterfile banner.
 *
 * `notifications` is the bell in the top bar. It was showing four hard-coded
 * examples about invoices and purchase orders that did not exist, which is
 * worse than an empty bell: it taught everybody that the red dot means
 * nothing. It now carries only things that are actually true of this database
 * and actually belong to the person reading it.
 */
class OnboardingController extends Controller
{
    public function __construct(
        private readonly EmployeeProfile $profile,
        private readonly EmployeeDocumentChecklist $documents,
    ) {}

    /** Every 201 file still waiting on somebody, worst first. */
    public function outstanding(): JsonResponse
    {
        $rows = $this->profile->outstanding();

        return response()->json([
            'data' => [
                'employees' => $rows,
                'counts' => [
                    'total' => $rows->count(),
                    'blocking' => $rows->where('status', 'Cannot be paid')->count(),
                    'statutory' => $rows->where('status', 'Filings incomplete')->count(),
                    'fromHire' => $rows->where('fromHire', true)->count(),
                ],
            ],
        ]);
    }

    /** One file, with every gap spelled out and what each one blocks. */
    public function show(Employee $employee): JsonResponse
    {
        $employee->loadMissing(['hrDepartment', 'branchUnit', 'position', 'hiredFromApplicant']);

        return response()->json([
            'data' => [
                'id' => $employee->id,
                'employeeNo' => $employee->employee_no,
                'name' => $employee->full_name,
                'dateHired' => optional($employee->date_hired)->toDateString(),
                'completedAt' => optional($employee->onboarding_completed_at)->toIso8601String(),
                'missing' => $this->profile->gaps($employee),
                'blockedReason' => $this->profile->canComplete($employee),
                /* Where the record came from. A hire carries an application
                   behind it, and that application has the CV, the assessment
                   and the details the candidate gave — all of which is worth
                   one click from here rather than a search. */
                'applicantId' => $employee->hired_from_applicant_id,
                'applicantCode' => $employee->hiredFromApplicant->applicant_no ?? null,
            ] + $this->profile->status($employee),
        ]);
    }

    /**
     * Signs a 201 file off as complete.
     *
     * Deliberately a person's act rather than a flag the system sets when the
     * last column is filled. A file can have every field populated and still
     * be wrong — a transposed TIN, a bank account belonging to somebody's
     * previous employer — and the only thing that makes it right is somebody
     * having looked at it and said so.
     */
    public function complete(Request $request, Employee $employee): JsonResponse
    {
        if ($refusal = $this->profile->canComplete($employee)) {
            return response()->json(['message' => $refusal], 422);
        }

        $employee->update([
            'onboarding_completed_at' => now(),
            'onboarding_completed_by' => $request->user()?->id,
        ]);

        return $this->show($employee->fresh());
    }

    /** Puts a signed-off file back in the queue, when something was wrong. */
    public function reopen(Employee $employee): JsonResponse
    {
        $employee->update(['onboarding_completed_at' => null, 'onboarding_completed_by' => null]);

        return $this->show($employee->fresh());
    }

    /* ====================================================================== */

    /**
     * The bell.
     *
     * Every item is a real row with a real link, and each one is something the
     * reader can do something about. Two sources for now, and both are things
     * that otherwise surface too late:
     *
     *   201 files that cannot be paid, or whose statutory numbers are missing.
     *   Work assigned to this person that is due today or already overdue.
     *
     * Deliberately not "everything that happened". A feed that lists events
     * nobody has to act on is a feed people stop opening, and then the one
     * item that mattered is three scrolls down.
     */
    public function notifications(Request $request): JsonResponse
    {
        $items = [];

        $user = $request->user();

        /* --- Incomplete 201 files ------------------------------------- */
        $files = $this->profile->outstanding(10);

        $blocking = $files->where('status', 'Cannot be paid');
        $statutory = $files->where('status', 'Filings incomplete');

        if ($blocking->isNotEmpty()) {
            $items[] = [
                'id' => 'onboarding-blocking',
                'tone' => 'critical',
                'title' => $blocking->count() === 1
                    ? "{$blocking->first()['name']} cannot be paid yet"
                    : "{$blocking->count()} employees cannot be paid yet",
                'meta' => 'HR · 201 file incomplete',
                'detail' => $blocking->first()['summary'],
                'link' => '/hr/employees',
            ];
        }

        if ($statutory->isNotEmpty()) {
            $items[] = [
                'id' => 'onboarding-statutory',
                'tone' => 'warning',
                'title' => $statutory->count() === 1
                    ? "{$statutory->first()['name']} is missing a statutory number"
                    : "{$statutory->count()} 201 files are missing statutory numbers",
                'meta' => 'HR · SSS, PhilHealth, Pag-IBIG or TIN',
                'detail' => 'The remittance cannot be credited to them.',
                'link' => '/hr/employees',
            ];
        }

        $newHires = $files->where('fromHire', true);

        if ($newHires->isNotEmpty() && $blocking->isEmpty() && $statutory->isEmpty()) {
            $items[] = [
                'id' => 'onboarding-review',
                'tone' => 'info',
                'title' => $newHires->count() === 1
                    ? "{$newHires->first()['name']}'s 201 file needs a review"
                    : "{$newHires->count()} new hires need their 201 file reviewed",
                'meta' => 'HR · created from a hire',
                'detail' => 'Everything the application gave is already in. Check it and sign it off.',
                'link' => '/hr/employees',
            ];
        }

        /* --- 201 documents missing or lapsing --------------------------- */
        $docRows = $this->documents->outstanding(10);
        $missingDocs = $docRows->where('missing', '>', 0);
        $expiring = $docRows->where('expiringSoon', '>', 0);

        if ($missingDocs->isNotEmpty()) {
            $items[] = [
                'id' => 'documents-missing',
                'tone' => 'warning',
                'title' => $missingDocs->count() === 1
                    ? "{$missingDocs->first()['name']} has a document missing"
                    : "{$missingDocs->count()} employees have 201 documents missing",
                'meta' => 'HR · 201 file (documents)',
                'detail' => 'A required document has not been uploaded or verified yet.',
                'link' => '/hr/documents',
            ];
        }

        if ($expiring->isNotEmpty()) {
            $items[] = [
                'id' => 'documents-expiring',
                'tone' => 'warning',
                'title' => $expiring->count() === 1
                    ? "{$expiring->first()['name']} has a document expiring soon"
                    : "{$expiring->count()} employees have a document expiring soon",
                'meta' => 'HR · 201 file (documents)',
                'detail' => 'Renew it before it lapses.',
                'link' => '/hr/documents',
            ];
        }

        /* --- Somebody did something to you ------------------------------ */
        if ($user) {
            $notices = TaskNotice::where('user_id', $user->id)
                ->whereIn('kind', ['assigned', 'mentioned', 'escalation'])
                ->whereNull('read_at')
                ->where('sent_on', '>=', now()->subDays(14)->toDateString())
                ->with('task:id,reference,title,project_id')
                ->orderByDesc('created_at')
                ->limit(10)
                ->get();

            foreach ($notices as $notice) {
                if (! $notice->task) {
                    continue;
                }

                $items[] = [
                    'id' => 'notice-'.$notice->id,
                    'noticeId' => $notice->id,
                    // Not 'info' — these are unread facts about this person
                    // specifically, and the bell's dot only means something if
                    // an assignment nobody has looked at yet lights it up.
                    'tone' => 'warning',
                    'title' => match ($notice->kind) {
                        'assigned' => 'A task was assigned to you',
                        'mentioned' => 'You were mentioned in a comment',
                        default => 'Escalation on a task',
                    },
                    'meta' => 'Process · '.$notice->task->reference,
                    'detail' => $notice->task->title,
                    'link' => '/tasks?task='.$notice->task_id,
                ];
            }
        }

        /* --- My work, when it is late --------------------------------- */
        if ($user) {
            $due = Task::query()
                ->where('assignee_id', $user->id)
                ->whereNull('completed_at')
                ->whereNotNull('due_date')
                ->whereDate('due_date', '<=', now()->toDateString())
                ->orderBy('due_date')
                ->limit(5)
                ->get();

            if ($due->isNotEmpty()) {
                $overdue = $due->filter(fn (Task $t) => $t->due_date->isBefore(now()->startOfDay()));

                $items[] = [
                    'id' => 'tasks-due',
                    'tone' => $overdue->isNotEmpty() ? 'warning' : 'info',
                    'title' => $overdue->isNotEmpty()
                        ? $overdue->count().' of your tasks '.($overdue->count() === 1 ? 'is' : 'are').' overdue'
                        : $due->count().' of your tasks '.($due->count() === 1 ? 'is' : 'are').' due today',
                    'meta' => 'My work',
                    'detail' => $due->first()->title,
                    'link' => '/tasks',
                ];
            }
        }

        return response()->json([
            'data' => [
                'items' => $items,
                // Drives the dot on the bell. Zero means no dot, which is the
                // point: a permanent red dot is not a notification.
                'unread' => count(array_filter($items, fn ($i) => $i['tone'] !== 'info')),
            ],
        ]);
    }

    /** Clicking a bell item for a real event dismisses it — the aggregate cards have no such state. */
    public function readNotice(Request $request, TaskNotice $notice): JsonResponse
    {
        abort_unless($notice->user_id === $request->user()->id, 403);

        $notice->update(['read_at' => now()]);

        return response()->json(['data' => ['id' => $notice->id]]);
    }
}
