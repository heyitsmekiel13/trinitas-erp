<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\BranchUnit;
use App\Models\Employee;
use App\Models\JobRequisition;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Moving an applicant through the pipeline, and hiring one.
 *
 * Recruitment was a list of names with a stage column anybody could type over.
 * The two things that make it a process live here:
 *
 *   - A stage only moves to somewhere it can legally go. Forward one step,
 *     rejected from anywhere, or withdrawn back a step to correct a slip. You
 *     cannot promote a fresh application straight to Hired, which is how
 *     somebody skips the interview that was the point of the pipeline.
 *
 *   - Hiring is a transaction, not a status. It creates the 201 file, issues
 *     the sign-in, counts the seat against the requisition that authorised it,
 *     and closes that requisition when the last seat is taken. Marking
 *     somebody "Hired" without any of that left recruitment and HR disagreeing
 *     about who works here.
 */
class RecruitmentOperations
{
    /** The pipeline, in order. Rejected sits outside it. */
    public const STAGES = [
        'Applied',
        'Screening',
        'Interview',
        'Assessment',
        'Final Interview',
        'Offer',
        'Hired',
    ];

    public function __construct(
        private readonly HrOperations $hr,
        private readonly EmployeeProfile $profile,
        private readonly NotificationDispatcher $notifications,
        private readonly OnboardingTasks $onboarding,
        private readonly Settings $settings,
    ) {}

    /**
     * Which stages this applicant may move to next.
     *
     * Returned to the client so the buttons offered are exactly the moves the
     * server will accept — an option that fails on click is worse than one
     * that was never shown.
     *
     * @return list<string>
     */
    public function allowedMoves(Applicant $applicant): array
    {
        $current = $applicant->stage;

        if ($current === 'Hired') {
            return [];
        }

        if ($current === 'Rejected') {
            // A rejection can be undone — panels change their minds, and the
            // alternative is re-keying the whole application.
            return ['Applied'];
        }

        $index = array_search($current, self::STAGES, true);
        $moves = [];

        if ($index !== false) {
            // Forward one. `Hired` is reached through the hire endpoint, not
            // by advancing, because it has to create a person.
            $next = self::STAGES[$index + 1] ?? null;
            if ($next !== null && $next !== 'Hired') {
                $moves[] = $next;
            }

            // Back one, to correct a mis-click.
            if ($index > 0) {
                $moves[] = self::STAGES[$index - 1];
            }
        }

        $moves[] = 'Rejected';

        return array_values(array_unique($moves));
    }

    /** @throws \RuntimeException when the move is not allowed. */
    public function moveTo(Applicant $applicant, string $stage): Applicant
    {
        if (! in_array($stage, $this->allowedMoves($applicant), true)) {
            throw new \RuntimeException(
                $applicant->stage === 'Hired'
                    ? 'This applicant has already been hired.'
                    : "An applicant at {$applicant->stage} cannot move straight to {$stage}.",
            );
        }

        $applicant->update(['stage' => $stage]);
        $applicant = $applicant->fresh();

        // A rejection is a recruiter's own click on "Not for us" — never
        // triggered by a score on its own. The email fires from here, the one
        // place a rejection is actually recorded, rather than from every
        // screen that might cause one.
        if ($stage === 'Rejected' && $applicant->email) {
            $applicant->loadMissing('jobPosting');

            $this->notifications->dispatchDirect(
                event: 'applicant.rejected',
                to: $applicant->email,
                subject: 'Your application — '.($applicant->jobPosting->title ?? 'update'),
                view: 'emails.application-rejected',
                data: ['applicant' => $applicant, 'posting' => $applicant->jobPosting],
                referenceType: 'Applicant',
                referenceId: $applicant->id,
            );
        }

        return $applicant;
    }

    /**
     * Turns an applicant into an employee.
     *
     * Everything here happens together or not at all: a half-hired person —
     * a 201 file with no sign-in, or a requisition counting a seat against
     * somebody who does not exist — is worse than a failed hire.
     *
     * @param  array<string, mixed>  $details
     * @return array{employee: Employee, credentials: array<string, mixed>, profile: array<string, mixed>}
     */
    public function hire(Applicant $applicant, array $details): array
    {
        if ($applicant->stage === 'Hired') {
            throw new \RuntimeException('This applicant has already been hired.');
        }

        if ($applicant->stage === 'Rejected') {
            throw new \RuntimeException('This applicant was rejected. Move them back into the pipeline first.');
        }

        $requisition = $applicant->jobRequisition;

        // A 201 file has to belong to a department. It normally comes from the
        // requisition that authorised the vacancy; an applicant sourced without
        // one has to be told where they are going before they can be hired.
        $departmentId = $details['departmentId'] ?? $requisition?->hr_department_id;

        if (! $departmentId) {
            throw new \RuntimeException(
                'Choose a department for this hire — the application is not linked to a manpower request that names one.',
            );
        }

        $positionId = $details['positionId'] ?? $applicant->position_id;

        if (! $positionId) {
            throw new \RuntimeException('Choose a position for this hire.');
        }

        // Same reasoning as the department: the 201 file is filed against a
        // branch, and payroll and attendance both read it.
        $branchId = $details['branchId'] ?? $requisition?->branch_unit_id;

        if (! $branchId) {
            throw new \RuntimeException(
                'Choose a branch for this hire — the manpower request does not name one.',
            );
        }

        $branch = BranchUnit::find($branchId);

        // The business group follows from the branch — a branch belongs to one
        // and nobody should be asked to restate it.
        $businessGroupId = $details['businessGroupId'] ?? $branch?->business_group_id;

        if (! $businessGroupId) {
            throw new \RuntimeException('That branch is not assigned to a business group.');
        }

        // The payroll group decides the pay cycle and the statutory schedule,
        // so it is asked for rather than guessed. Getting it wrong pays
        // somebody on the wrong cut-off.
        $payrollGroupId = $details['payrollGroupId'] ?? null;

        if (! $payrollGroupId) {
            throw new \RuntimeException(
                'Choose a payroll group — it decides which cut-off this employee is paid on.',
            );
        }

        $result = DB::transaction(function () use (
            $applicant, $details, $requisition,
            $departmentId, $positionId, $branchId, $businessGroupId, $payrollGroupId,
        ) {
            $employee = Employee::create([
                'employee_no' => $details['employeeNo'] ?? $this->employeeNumber(),
                'first_name' => $details['firstName'],
                'last_name' => $details['lastName'],
                'middle_name' => $details['middleName'] ?? $applicant->middle_name,
                'email' => $details['email'] ?? $applicant->email,
                'mobile' => $details['mobile'] ?? $applicant->phone,
                'position_id' => $positionId,
                'hr_department_id' => $departmentId,
                'branch_unit_id' => $branchId,
                'business_group_id' => $businessGroupId,
                'payroll_group_id' => $payrollGroupId,
                'shift_id' => $details['shiftId'] ?? null,
                'date_hired' => $details['dateHired'] ?? CarbonImmutable::now()->toDateString(),
                // The masterfile's own vocabulary — a new hire starts on
                // probation, which under Philippine law runs six months from
                // this date unless the role is apprenticed or seasonal.
                'employment_status' => $details['employmentStatus'] ?? 'PROBATION',
                // The masterfile column is `salary`; the offer that was
                // accepted comes first, then the requisition's budget rate as
                // the agreed figure when nothing else was negotiated.
                'salary' => $details['salary']
                    ?? ($applicant->offer_salary ? (float) $applicant->offer_salary : null)
                    ?? $requisition?->budget_rate
                    ?? 0,

                /*
                 * Everything the application already told us.
                 *
                 * This used to be dropped on the floor. The candidate had
                 * given their date of birth, their civil status and their
                 * address — on the careers form, or read off their CV and
                 * confirmed by a recruiter — and the 201 file was created
                 * without any of it, to be keyed a second time from a printout
                 * that was sitting in the same system. In practice it was not
                 * keyed a second time.
                 */
                'birth_date' => $applicant->birthdate,
                'civil_status' => $this->civilStatus($applicant->civil_status),
                'address' => $this->address($applicant),

                // The link back. It is what lets the masterfile say this file
                // came from a hire and has never been reviewed, and what keeps
                // the CV reachable from the employee a year later.
                'hired_from_applicant_id' => $applicant->id,

                // Employment is current until `date_separated` says otherwise —
                // there is no status column on the 201 file.
            ]);

            // The sign-in, issued the same way HR issues any other.
            $credentials = $this->hr->resetPassword($employee, null, true);

            $applicant->update(['stage' => 'Hired']);

            if ($requisition) {
                $requisition->increment('filled');
                $requisition->refresh();

                // A requisition with every seat taken is finished. Saying so
                // is what stops recruiters sourcing against a closed vacancy.
                if ($requisition->openings() === 0) {
                    $requisition->update(['status' => 'Filled']);
                } elseif ($requisition->status === 'Approved') {
                    $requisition->update(['status' => 'Sourcing']);
                }
            }

            $employee = $employee->fresh();

            /*
             * What the application could not answer.
             *
             * Handed straight back to whoever pressed Hire, at the one moment
             * they are certainly looking. Everything else about this — the
             * badge on the masterfile row, the panel on the HR dashboard, the
             * bell — exists because people are not always looking; this is the
             * cheap case where they are.
             */
            return [
                'employee' => $employee,
                'credentials' => $credentials,
                'profile' => $this->profile->status($employee) + [
                    'missing' => $this->profile->gaps($employee),
                ],
            ];
        });

        /*
         * Deliberately outside the transaction that just committed.
         *
         * Generating the checklist and sending the welcome email are not
         * things a later failure in the *same* hire should be able to undo —
         * but until this moved here, both ran inside the transaction, before
         * the requisition bookkeeping that follows the sign-in. A failure
         * there would roll the employee back while the candidate had already
         * been emailed credentials for an account that no longer existed.
         * Now nothing here can fire until the hire has actually happened.
         */
        $this->onboarding->generateFor($result['employee']);
        $this->sendWelcome($result['employee'], $result['credentials']);

        return $result;
    }

    /**
     * Day-0: the sign-in, in their inbox before anybody has to walk over and
     * say it out loud.
     *
     * Deliberately not `emails.credentials` — that template's copy says the
     * account is not forced to change, which is Admin's own reset flow. A
     * fresh hire's password *is* forced to change on first sign-in, so this
     * is its own template that says the true thing.
     */
    private function sendWelcome(Employee $employee, array $credentials): void
    {
        if (! $employee->email) {
            return;
        }

        $employee->loadMissing(['position', 'hrDepartment']);
        $company = $this->settings->group('company');

        $this->notifications->dispatchDirect(
            event: 'onboarding.welcome',
            to: $employee->email,
            subject: 'Welcome to '.($company['trade_name'] ?? config('app.name')),
            view: 'emails.welcome-aboard',
            data: [
                'employee' => $employee,
                'position' => $employee->position->title ?? null,
                'department' => $employee->hrDepartment->name ?? null,
                'startDate' => optional($employee->date_hired)->format('j F Y') ?? 'soon',
                'username' => $credentials['username'],
                'password' => $credentials['password'],
                'signInUrl' => rtrim((string) ($company['app_url'] ?? config('app.frontend_url', '')), '/') ?: null,
            ],
            referenceType: 'Employee',
            referenceId: $employee->id,
        );
    }

    /**
     * The pipeline as a board: how many sit at each stage, and their age.
     *
     * The age matters more than the count. A candidate parked at Interview for
     * three weeks is the actual problem a recruitment dashboard exists to
     * surface, and a stage total hides it completely.
     */
    public function pipeline(): array
    {
        $applicants = Applicant::query()
            ->with(['position', 'jobRequisition'])
            ->whereNotIn('stage', ['Hired', 'Rejected'])
            ->get();

        $stages = [];

        foreach (self::STAGES as $stage) {
            if ($stage === 'Hired') {
                continue;
            }

            $atStage = $applicants->where('stage', $stage);

            $stages[] = [
                'stage' => $stage,
                'count' => $atStage->count(),
                // Whole days. Carbon 3 returns a float here, which reached the
                // screen as "oldest 13.434934307581019d".
                'oldestDays' => (int) floor(
                    $atStage
                        ->map(fn (Applicant $a) => $a->applied_on
                            ? CarbonImmutable::parse($a->applied_on)->diffInDays(CarbonImmutable::now())
                            : 0)
                        ->max() ?? 0,
                ),
            ];
        }

        return [
            'stages' => $stages,
            'active' => $applicants->count(),
            'hiredThisMonth' => Applicant::where('stage', 'Hired')
                ->where('updated_at', '>=', CarbonImmutable::now()->startOfMonth())
                ->count(),
            'openRequisitions' => JobRequisition::whereIn('status', ['Approved', 'Sourcing'])->count(),
            'seatsToFill' => JobRequisition::whereIn('status', ['Approved', 'Sourcing'])
                ->get()
                ->sum(fn (JobRequisition $r) => $r->openings()),
        ];
    }

    /**
     * The masterfile's civil status code for the application's word.
     *
     * Two vocabularies for one fact: the 201 file stores a single letter,
     * because that is what the bank file and the BIR alphalist expect, and the
     * application asks the question in words. Separated maps to D, which is
     * the masterfile's code for "no longer married" — there is no divorce in
     * Philippine law and no separate code for it.
     */
    private function civilStatus(?string $word): string
    {
        return match ($word) {
            'Married' => 'M',
            'Widowed' => 'W',
            'Separated' => 'D',
            default => 'S',
        };
    }

    /** The applicant's address as the one text line the 201 file holds. */
    private function address(Applicant $applicant): ?string
    {
        $parts = array_filter([
            $applicant->address_line,
            $applicant->city,
            $applicant->province,
            $applicant->postal_code,
        ]);

        return $parts ? implode(', ', $parts) : null;
    }

    /**
     * The next employee number, in whatever format the masterfile already uses.
     *
     * Numbers here are branch-prefixed — UNI1528 — and the prefix is not
     * decoration: the sign-in username is the number with the prefix stripped.
     * So the pattern is read off the existing data and continued, rather than
     * a new scheme being invented alongside it.
     */
    private function employeeNumber(): string
    {
        $existing = Employee::withTrashed()->pluck('employee_no')->filter();

        $prefix = '';
        $highest = 0;
        $width = 4;

        foreach ($existing as $number) {
            if (! preg_match('/^([A-Za-z\-]*)(\d+)$/', (string) $number, $m)) {
                continue;
            }

            $value = (int) $m[2];

            if ($value > $highest) {
                $highest = $value;
                $prefix = $m[1];
                $width = strlen($m[2]);
            }
        }

        // Nothing to follow — start a plain sequence rather than guess a prefix.
        if ($highest === 0) {
            return '1001';
        }

        return $prefix.str_pad((string) ($highest + 1), $width, '0', STR_PAD_LEFT);
    }
}
