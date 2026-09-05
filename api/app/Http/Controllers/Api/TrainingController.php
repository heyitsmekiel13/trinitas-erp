<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TrainingSession;
use App\Models\User;
use App\Services\TrainingOperations;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Training sessions, their roster, and the certificates they issue.
 *
 * The registry could serve the list, but none of what makes this useful is a
 * CRUD operation — enrolling a group, marking a room, and issuing certificates
 * from what was marked are all behaviour, so they live here.
 */
class TrainingController extends Controller
{
    public function __construct(private readonly TrainingOperations $training) {}

    /** Sessions, newest first, with how the roster stands. */
    public function index(Request $request): JsonResponse
    {
        $sessions = TrainingSession::query()
            ->with('course')
            ->withCount([
                'attendees',
                'attendees as attended_count' => fn ($q) => $q->where('status', 'Attended'),
            ])
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->orderByDesc('scheduled_on')
            ->limit(200)
            ->get();

        return response()->json(['data' => $sessions->map(fn (TrainingSession $s) => $this->present($s))]);
    }

    public function show(TrainingSession $session): JsonResponse
    {
        return response()->json(['data' => $this->present($session, withRoster: true)]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'trainingCourseId' => 'required|integer|exists:training_courses,id',
            'title' => 'nullable|string|max:190',
            'scheduledOn' => 'required|date',
            'endsOn' => 'nullable|date|after_or_equal:scheduledOn',
            'startsAt' => 'nullable|date_format:H:i',
            'finishesAt' => 'nullable|date_format:H:i',
            'venue' => 'nullable|string|max:190',
            'trainer' => 'nullable|string|max:190',
            'capacity' => 'nullable|integer|min:1|max:1000',
            'passingScore' => 'nullable|numeric|min:0|max:100',
            'notes' => 'nullable|string|max:2000',
            'employeeIds' => 'nullable|array',
            'employeeIds.*' => 'integer|exists:employees,id',
        ]);

        $session = TrainingSession::create([
            'session_no' => $this->training->sessionNumber(),
            'training_course_id' => $data['trainingCourseId'],
            'title' => $data['title'] ?? null,
            'scheduled_on' => $data['scheduledOn'],
            'ends_on' => $data['endsOn'] ?? null,
            'starts_at' => $data['startsAt'] ?? null,
            'finishes_at' => $data['finishesAt'] ?? null,
            'venue' => $data['venue'] ?? null,
            'trainer' => $data['trainer'] ?? null,
            'capacity' => $data['capacity'] ?? null,
            'passing_score' => $data['passingScore'] ?? null,
            'notes' => $data['notes'] ?? null,
        ]);

        if (! empty($data['employeeIds'])) {
            $this->training->enrol($session, $data['employeeIds']);
        }

        return response()->json(['data' => $this->present($session->fresh(['course']), withRoster: true)], 201);
    }

    public function update(Request $request, TrainingSession $session): JsonResponse
    {
        if ($session->status === 'Completed') {
            return response()->json([
                'message' => 'This session has already issued certificates. Reopen it before changing the details.',
            ], 422);
        }

        $data = $request->validate([
            'title' => 'nullable|string|max:190',
            'scheduledOn' => 'nullable|date',
            'endsOn' => 'nullable|date',
            'venue' => 'nullable|string|max:190',
            'trainer' => 'nullable|string|max:190',
            'capacity' => 'nullable|integer|min:1|max:1000',
            'passingScore' => 'nullable|numeric|min:0|max:100',
            'notes' => 'nullable|string|max:2000',
            'status' => 'nullable|in:Scheduled,Ongoing,Cancelled',
        ]);

        $session->update(array_filter([
            'title' => $data['title'] ?? null,
            'scheduled_on' => $data['scheduledOn'] ?? null,
            'ends_on' => $data['endsOn'] ?? null,
            'venue' => $data['venue'] ?? null,
            'trainer' => $data['trainer'] ?? null,
            'capacity' => $data['capacity'] ?? null,
            'passing_score' => $data['passingScore'] ?? null,
            'notes' => $data['notes'] ?? null,
            'status' => $data['status'] ?? null,
        ], fn ($v) => $v !== null));

        return response()->json(['data' => $this->present($session->fresh(['course']), withRoster: true)]);
    }

    /* ====================================================================== */
    /* Roster */
    /* ====================================================================== */

    public function enrol(Request $request, TrainingSession $session): JsonResponse
    {
        $data = $request->validate([
            'employeeIds' => 'required|array|min:1',
            'employeeIds.*' => 'integer|exists:employees,id',
        ]);

        if ($session->status === 'Completed') {
            return response()->json([
                'message' => 'Certificates have been issued for this session. Reopen it to change the roster.',
            ], 422);
        }

        if ($session->capacity) {
            // Only the people not already on the roster count towards the
            // room — re-submitting a list that overlaps it is not a request
            // for more seats.
            $already = $session->attendees()->pluck('employee_id')->all();
            $joining = array_diff(array_unique($data['employeeIds']), $already);
            $after = count($already) + count($joining);

            if ($after > $session->capacity) {
                return response()->json([
                    'message' => "That would put {$after} people in a room set for {$session->capacity}.",
                ], 422);
            }
        }

        $added = $this->training->enrol($session, $data['employeeIds']);

        return response()->json(['data' => ['added' => $added, 'session' => $this->present($session->fresh(['course']), withRoster: true)]]);
    }

    public function removeAttendee(TrainingSession $session, int $employee): JsonResponse
    {
        if ($session->status === 'Completed') {
            return response()->json(['message' => 'Certificates have been issued for this session.'], 422);
        }

        $this->training->removeAttendee($session, $employee);

        return response()->json(['data' => $this->present($session->fresh(['course']), withRoster: true)]);
    }

    /** Records who turned up, and their scores where the course is assessed. */
    public function markAttendance(Request $request, TrainingSession $session): JsonResponse
    {
        $data = $request->validate([
            'marks' => 'required|array|min:1',
            'marks.*.employeeId' => 'required|integer',
            'marks.*.status' => 'required|in:Enrolled,Attended,Absent,Excused',
            'marks.*.score' => 'nullable|numeric|min:0|max:100',
            'marks.*.remarks' => 'nullable|string|max:255',
        ]);

        if ($session->status === 'Completed') {
            return response()->json([
                'message' => 'Certificates have been issued. Reopen the session to change attendance.',
            ], 422);
        }

        $updated = $this->training->markAttendance($session, $data['marks']);

        return response()->json(['data' => ['updated' => $updated, 'session' => $this->present($session->fresh(['course']), withRoster: true)]]);
    }

    /**
     * Closes the session and issues certificates to everybody who attended.
     *
     * The response names who was certified and who was skipped, because
     * "issued 7 of 9" without saying which two is not an answer HR can act on.
     */
    public function complete(Request $request, TrainingSession $session): JsonResponse
    {
        if ($session->status === 'Cancelled') {
            return response()->json(['message' => 'This session was cancelled.'], 422);
        }

        if (! $session->attendees()->where('status', 'Attended')->exists()) {
            return response()->json([
                'message' => 'Nobody is marked as having attended, so there is nothing to certify.',
            ], 422);
        }

        /** @var User $actor */
        $actor = $request->user();

        $result = $this->training->complete($session, $actor);

        return response()->json([
            'data' => $result + ['session' => $this->present($session->fresh(['course']), withRoster: true)],
        ]);
    }

    /** Reopens a completed session so attendance can be corrected. */
    public function reopen(TrainingSession $session): JsonResponse
    {
        $session->update(['status' => 'Ongoing', 'completed_at' => null, 'completed_by' => null]);

        return response()->json(['data' => $this->present($session->fresh(['course']), withRoster: true)]);
    }

    /* ====================================================================== */

    private function present(TrainingSession $session, bool $withRoster = false): array
    {
        $session->loadMissing('course');

        $base = [
            'id' => $session->id,
            'sessionNo' => $session->session_no,
            'title' => $session->displayTitle(),
            'course' => $session->course->name ?? null,
            'courseId' => $session->training_course_id,
            'type' => $session->course->type ?? null,
            'provider' => $session->course->provider ?? null,
            'validityMonths' => $session->course->validity_months ?? null,
            'scheduledOn' => optional($session->scheduled_on)->toDateString(),
            'endsOn' => optional($session->ends_on)->toDateString(),
            'startsAt' => $session->starts_at ? substr((string) $session->starts_at, 0, 5) : null,
            'finishesAt' => $session->finishes_at ? substr((string) $session->finishes_at, 0, 5) : null,
            'venue' => $session->venue,
            'trainer' => $session->trainer,
            'capacity' => $session->capacity,
            'passingScore' => $session->passing_score === null ? null : (float) $session->passing_score,
            'notes' => $session->notes,
            'status' => $session->status,
            'completedAt' => $session->completed_at?->toIso8601String(),
            'enrolled' => $session->attendees_count ?? $session->attendees()->count(),
            'attended' => $session->attended_count ?? $session->attendees()->where('status', 'Attended')->count(),
        ];

        if (! $withRoster) {
            return $base;
        }

        $certificates = $session->records()->pluck('certificate_no', 'employee_id');

        $base['roster'] = $session->attendees()
            ->with('employee.hrDepartment')
            ->get()
            ->sortBy(fn ($a) => $a->employee->full_name ?? '')
            ->map(fn ($a) => [
                'employeeId' => $a->employee_id,
                'name' => $a->employee->full_name ?? 'Unknown',
                'employeeNo' => $a->employee->employee_no ?? null,
                'department' => $a->employee->hrDepartment->name ?? null,
                'status' => $a->status,
                'score' => $a->score === null ? null : (float) $a->score,
                'remarks' => $a->remarks,
                'certificateNo' => $certificates[$a->employee_id] ?? null,
            ])
            ->values();

        return $base;
    }
}
