<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\TrainingAttendee;
use App\Models\TrainingRecord;
use App\Models\TrainingSession;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Running a training and certifying the people who sat through it.
 *
 * The shape of the process, which is the whole point of the module:
 *
 *   1. Schedule a session against a course.
 *   2. Enrol the people who are meant to attend.
 *   3. On the day, mark who actually turned up — and score them if the
 *      course has a passing mark.
 *   4. Complete the session. Everybody marked Attended (and passing, where a
 *      score is required) gets a certificate issued automatically, dated from
 *      the session and expiring on the course's own validity.
 *
 * Step 4 is the one worth being careful about. Certificates are the record an
 * auditor asks for, so issuing is idempotent — completing a session twice
 * updates the existing certificates rather than minting duplicates — and a
 * session that has already issued cannot silently re-issue under new numbers.
 */
class TrainingOperations
{
    /** Enrols people onto a session, skipping anyone already on the roster. */
    public function enrol(TrainingSession $session, array $employeeIds): int
    {
        $existing = $session->attendees()->pluck('employee_id')->all();
        $added = 0;

        foreach (array_diff(array_unique($employeeIds), $existing) as $employeeId) {
            $session->attendees()->create([
                'employee_id' => $employeeId,
                'status' => 'Enrolled',
            ]);
            $added++;
        }

        return $added;
    }

    public function removeAttendee(TrainingSession $session, int $employeeId): void
    {
        $session->attendees()->where('employee_id', $employeeId)->delete();
    }

    /**
     * Records who turned up.
     *
     * @param  array<int, array{employeeId: int, status: string, score?: float|null, remarks?: string|null}>  $marks
     */
    public function markAttendance(TrainingSession $session, array $marks): int
    {
        $updated = 0;

        foreach ($marks as $mark) {
            $attendee = $session->attendees()->where('employee_id', $mark['employeeId'])->first();

            if (! $attendee) {
                continue;
            }

            $attendee->update([
                'status' => $mark['status'],
                'score' => $mark['score'] ?? $attendee->score,
                'remarks' => $mark['remarks'] ?? $attendee->remarks,
                'marked_at' => now(),
            ]);
            $updated++;
        }

        // The session is under way the moment somebody is marked.
        if ($updated && $session->status === 'Scheduled') {
            $session->update(['status' => 'Ongoing']);
        }

        return $updated;
    }

    /**
     * Closes the session and issues the certificates.
     *
     * @return array{issued: int, skipped: int, certificates: array<int, array<string, mixed>>}
     */
    public function complete(TrainingSession $session, User $actor): array
    {
        $session->loadMissing('course');
        $course = $session->course;

        return DB::transaction(function () use ($session, $course, $actor) {
            $issued = 0;
            $skipped = 0;
            $certificates = [];

            $completedOn = CarbonImmutable::parse($session->ends_on ?? $session->scheduled_on);

            // Validity is the course's own — a first-aid card lapses on a
            // different clock from a forklift licence. No validity means the
            // certification does not expire.
            $expiresOn = $course?->validity_months
                ? $completedOn->addMonths((int) $course->validity_months)
                : null;

            foreach ($session->attendees()->with('employee')->get() as $attendee) {
                if (! $this->earnsCertificate($attendee, $session)) {
                    $skipped++;

                    continue;
                }

                // Keyed on the session and person, so completing twice
                // corrects the certificate instead of minting a second one.
                $record = TrainingRecord::firstOrNew([
                    'training_session_id' => $session->id,
                    'employee_id' => $attendee->employee_id,
                ]);

                $record->fill([
                    'training_course_id' => $session->training_course_id,
                    'completed_on' => $completedOn->toDateString(),
                    'expires_on' => $expiresOn?->toDateString(),
                    'score' => $attendee->score,
                    // The stored status records that the training was finished.
                    // Whether the certificate is still in force is a question
                    // about today's date, so it is computed on read rather than
                    // frozen here and left to go stale.
                    'status' => 'Completed',
                    'issued_at' => now(),
                ]);

                $record->certificate_no ??= $this->certificateNumber($completedOn);
                $record->save();

                $issued++;
                $certificates[] = [
                    'employee' => $attendee->employee->full_name ?? null,
                    'employeeNo' => $attendee->employee->employee_no ?? null,
                    'certificateNo' => $record->certificate_no,
                    'expiresOn' => $record->expires_on,
                ];
            }

            $session->update([
                'status' => 'Completed',
                'completed_at' => now(),
                'completed_by' => $actor->id,
            ]);

            return compact('issued', 'skipped', 'certificates');
        });
    }

    /**
     * Whether this attendee has earned a certificate.
     *
     * Turning up is necessary. Where the course sets a passing score it is
     * also required — certifying somebody who failed the assessment is how a
     * certificate stops meaning anything.
     */
    private function earnsCertificate(TrainingAttendee $attendee, TrainingSession $session): bool
    {
        if ($attendee->status !== 'Attended') {
            return false;
        }

        if ($session->passing_score === null) {
            return true;
        }

        return $attendee->score !== null && (float) $attendee->score >= (float) $session->passing_score;
    }

    /** Sequential per year: CERT-2026-0001. */
    private function certificateNumber(CarbonImmutable $on): string
    {
        $year = $on->year;

        $last = TrainingRecord::query()
            ->where('certificate_no', 'like', "CERT-{$year}-%")
            ->orderByDesc('certificate_no')
            ->value('certificate_no');

        $next = $last ? ((int) substr($last, -4)) + 1 : 1;

        return sprintf('CERT-%d-%04d', $year, $next);
    }

    /** Sequential per year: TRN-2026-0001. */
    public function sessionNumber(): string
    {
        $year = CarbonImmutable::now()->year;

        $last = TrainingSession::withTrashed()
            ->where('session_no', 'like', "TRN-{$year}-%")
            ->orderByDesc('session_no')
            ->value('session_no');

        $next = $last ? ((int) substr($last, -4)) + 1 : 1;

        return sprintf('TRN-%d-%04d', $year, $next);
    }

    /**
     * An employee's certifications, for their own page.
     *
     * Expiry is computed rather than trusted: a record stored as "Valid" two
     * years ago is not valid today, and the person looking at their own
     * training page is exactly who needs to know that.
     */
    public function certificatesFor(Employee $employee): array
    {
        return TrainingRecord::query()
            ->with(['course', 'session'])
            ->where('employee_id', $employee->id)
            ->orderByDesc('completed_on')
            ->get()
            ->map(function (TrainingRecord $r) {
                $expires = $r->expires_on ? CarbonImmutable::parse($r->expires_on) : null;
                $daysLeft = $expires?->diffInDays(CarbonImmutable::now(), false);

                return [
                    'id' => $r->id,
                    'course' => $r->course->name ?? 'Training',
                    'type' => $r->course->type ?? null,
                    'provider' => $r->course->provider ?? null,
                    'mandatory' => (bool) ($r->course->is_mandatory ?? false),
                    'certificateNo' => $r->certificate_no,
                    'completedOn' => optional($r->completed_on)->toDateString(),
                    'expiresOn' => $expires?->toDateString(),
                    'score' => $r->score === null ? null : (float) $r->score,
                    'venue' => $r->session->venue ?? null,
                    'trainer' => $r->session->trainer ?? null,
                    // Null when the certification does not expire at all.
                    'daysUntilExpiry' => $expires ? -1 * (int) $daysLeft : null,
                    'state' => match (true) {
                        $expires === null => 'Valid',
                        $expires->isPast() => 'Expired',
                        $expires->diffInDays(CarbonImmutable::now(), false) > -60 => 'Expiring soon',
                        default => 'Valid',
                    },
                ];
            })
            ->all();
    }
}
