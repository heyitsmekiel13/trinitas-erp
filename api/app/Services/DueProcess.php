<?php

namespace App\Services;

use App\Models\EmployeeCase;
use Carbon\CarbonImmutable;

/**
 * Where a disciplinary case stands against the process the law requires.
 *
 * Philippine dismissals are tested on two things: whether there was a valid
 * cause, and whether the employee got due process. The first is a judgement
 * this system cannot make. The second is a sequence of dated steps, and that
 * is exactly what software is good at holding.
 *
 * The sequence, for a just cause (Labour Code art. 297, DOLE D.O. 147-15):
 *
 *   1. First written notice — the NTE. States the specific acts complained of
 *      and gives the employee at least five calendar days to answer.
 *   2. A real opportunity to be heard — a written explanation, and a hearing
 *      where one is requested or where the facts are genuinely in dispute.
 *   3. Second written notice — the decision, stating the findings and the
 *      penalty.
 *
 * Authorised causes (redundancy, retrenchment, closure, disease) are a
 * different track: thirty days' written notice to both the employee and the
 * DOLE regional office, plus separation pay. The twin-notice rule does not
 * apply to them, which is why the two are told apart here.
 *
 * This computes and reports. It never blocks: an employer who has skipped a
 * step needs to see that clearly, not be prevented from recording what
 * actually happened.
 *
 * Not legal advice — a process aid. The periods below are the statutory
 * minimums; company policy or a CBA may require more.
 */
class DueProcess
{
    /** Minimum the employee gets to answer the first notice. */
    public const EXPLANATION_DAYS = 5;

    /** Maximum a preventive suspension may run unpaid. */
    public const PREVENTIVE_SUSPENSION_DAYS = 30;

    /** Notice owed to the employee and to DOLE for an authorised cause. */
    public const AUTHORISED_CAUSE_NOTICE_DAYS = 30;

    /**
     * Case types that are authorised causes rather than misconduct.
     *
     * These end an employment for a business reason, not a fault, so they
     * follow the notice-and-separation-pay track instead of twin notices.
     */
    private const AUTHORISED_CAUSES = ['Redundancy', 'Retrenchment', 'Closure', 'Disease'];

    /**
     * The steps for one case, each with whether it is done and what is next.
     *
     * @return array<string, mixed>
     */
    public function forCase(EmployeeCase $case): array
    {
        $authorised = in_array($case->type, self::AUTHORISED_CAUSES, true);

        return [
            'track' => $authorised ? 'authorised-cause' : 'just-cause',
            'steps' => $authorised ? $this->authorisedCauseSteps($case) : $this->justCauseSteps($case),
            'warnings' => $this->warnings($case, $authorised),
            'complete' => $this->isComplete($case, $authorised),
        ];
    }

    /* ====================================================================== */

    /** @return array<int, array<string, mixed>> */
    private function justCauseSteps(EmployeeCase $case): array
    {
        $due = $case->nte_response_due_on ? CarbonImmutable::parse($case->nte_response_due_on) : null;

        return [
            [
                'key' => 'nte',
                'title' => 'First notice issued (NTE)',
                'detail' => 'A written notice stating the specific acts or omissions, and giving at least '
                    .self::EXPLANATION_DAYS.' calendar days to answer.',
                'done' => $case->nte_issued_on !== null,
                'on' => optional($case->nte_issued_on)->toDateString(),
                'note' => $due ? 'Answer due '.$due->format('j M Y') : null,
            ],
            [
                'key' => 'explanation',
                'title' => 'Written explanation received',
                'detail' => 'The employee’s answer. If none is given by the deadline, record that — proceeding '
                    .'without an answer is allowed; proceeding without having asked is not.',
                'done' => $case->explanation_received_on !== null,
                'on' => optional($case->explanation_received_on)->toDateString(),
                'note' => null,
            ],
            [
                'key' => 'hearing',
                'title' => 'Hearing or conference',
                'detail' => 'Required where the employee asks for one, where company rules or a CBA require it, '
                    .'or where the facts are genuinely disputed.',
                'done' => $case->hearing_held_on !== null,
                'on' => optional($case->hearing_held_on)->toDateString(),
                'note' => $case->hearing_on && ! $case->hearing_held_on
                    ? 'Scheduled '.CarbonImmutable::parse($case->hearing_on)->format('j M Y')
                    : null,
            ],
            [
                'key' => 'decision',
                'title' => 'Second notice issued (decision)',
                'detail' => 'A written decision setting out the findings and the penalty, served on the employee.',
                'done' => $case->decision_on !== null,
                'on' => optional($case->decision_on)->toDateString(),
                'note' => $case->penalty,
            ],
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function authorisedCauseSteps(EmployeeCase $case): array
    {
        return [
            [
                'key' => 'employee-notice',
                'title' => 'Written notice to the employee',
                'detail' => 'At least '.self::AUTHORISED_CAUSE_NOTICE_DAYS
                    .' calendar days before the separation takes effect.',
                'done' => $case->nte_issued_on !== null,
                'on' => optional($case->nte_issued_on)->toDateString(),
                'note' => null,
            ],
            [
                'key' => 'dole-notice',
                'title' => 'Written notice to the DOLE regional office',
                'detail' => 'Served on the same '.self::AUTHORISED_CAUSE_NOTICE_DAYS
                    .'-day timetable as the employee’s copy. Both are required.',
                'done' => $case->dole_notified_on !== null,
                'on' => optional($case->dole_notified_on)->toDateString(),
                'note' => null,
            ],
            [
                'key' => 'decision',
                'title' => 'Separation recorded',
                'detail' => 'The effective date, and the separation pay computed for the cause relied on.',
                'done' => $case->decision_on !== null,
                'on' => optional($case->decision_on)->toDateString(),
                'note' => $case->penalty,
            ],
        ];
    }

    /**
     * What is wrong with this file, stated plainly.
     *
     * @return array<int, array{level: string, message: string}>
     */
    private function warnings(EmployeeCase $case, bool $authorised): array
    {
        $out = [];
        $today = CarbonImmutable::now()->startOfDay();

        if ($authorised) {
            foreach ([['nte_issued_on', 'the employee'], ['dole_notified_on', 'the DOLE regional office']] as [$field, $who]) {
                if ($case->$field && $case->decision_on) {
                    $days = CarbonImmutable::parse($case->$field)->diffInDays(CarbonImmutable::parse($case->decision_on));
                    if ($days < self::AUTHORISED_CAUSE_NOTICE_DAYS) {
                        $out[] = [
                            'level' => 'critical',
                            'message' => "Only {$days} days between notifying {$who} and the effective date. "
                                .self::AUTHORISED_CAUSE_NOTICE_DAYS.' are required.',
                        ];
                    }
                }
            }

            return $out;
        }

        // The five-day answer period, measured from the first notice.
        if ($case->nte_issued_on && $case->nte_response_due_on) {
            $given = CarbonImmutable::parse($case->nte_issued_on)
                ->diffInDays(CarbonImmutable::parse($case->nte_response_due_on));

            if ($given < self::EXPLANATION_DAYS) {
                $out[] = [
                    'level' => 'critical',
                    'message' => "The notice gave {$given} days to answer. At least "
                        .self::EXPLANATION_DAYS.' calendar days are required.',
                ];
            }
        }

        // A decision reached before the employee's time to answer had run.
        if ($case->decision_on && $case->nte_response_due_on
            && CarbonImmutable::parse($case->decision_on)->lt(CarbonImmutable::parse($case->nte_response_due_on))) {
            $out[] = [
                'level' => 'critical',
                'message' => 'The decision is dated before the deadline for the employee’s explanation.',
            ];
        }

        // A decision with no first notice at all.
        if ($case->decision_on && ! $case->nte_issued_on) {
            $out[] = [
                'level' => 'critical',
                'message' => 'A decision was recorded but no first notice was ever issued.',
            ];
        }

        // An answer that was asked for and never chased.
        if ($case->nte_response_due_on && ! $case->explanation_received_on && ! $case->decision_on
            && CarbonImmutable::parse($case->nte_response_due_on)->lt($today)) {
            $out[] = [
                'level' => 'warning',
                'message' => 'The deadline to answer has passed with no explanation recorded. '
                    .'Note that it was not received, then proceed.',
            ];
        }

        // Preventive suspension running past its limit.
        if ($case->preventive_suspension_from) {
            $from = CarbonImmutable::parse($case->preventive_suspension_from);
            $to = $case->preventive_suspension_to ? CarbonImmutable::parse($case->preventive_suspension_to) : $today;
            $days = $from->diffInDays($to);

            if ($days > self::PREVENTIVE_SUSPENSION_DAYS) {
                $out[] = [
                    'level' => 'critical',
                    'message' => "Preventive suspension has run {$days} days. Beyond "
                        .self::PREVENTIVE_SUSPENSION_DAYS.' days the employee must be reinstated or paid.',
                ];
            }
        }

        return $out;
    }

    private function isComplete(EmployeeCase $case, bool $authorised): bool
    {
        if ($authorised) {
            return $case->nte_issued_on && $case->dole_notified_on && $case->decision_on;
        }

        return $case->nte_issued_on && $case->decision_on;
    }
}
