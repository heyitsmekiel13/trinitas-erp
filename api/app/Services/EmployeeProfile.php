<?php

namespace App\Services;

use App\Models\Employee;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * What is still missing from a 201 file, and what it stops.
 *
 * This exists because of a specific failure. Hiring produced an employee
 * record with a name, an email and a salary, and nothing anywhere said the
 * file was incomplete. The TIN was blank, there was no SSS number and no bank
 * account — and the way that surfaced was the first payroll run: a person on
 * the register with no account to pay into, and a statutory remittance that
 * could not name them. By then the cut-off was closing.
 *
 * The fix is not a reminder. It is saying, at the moment the record is created
 * and everywhere it is shown afterwards, exactly which fields are missing and
 * exactly what each one blocks:
 *
 *   blocking    the person cannot actually be paid. No salary for payroll to
 *               compute from, or no bank account on an ATM payee for the bank
 *               file to credit.
 *
 *   attendance  payroll is fine, but nothing can judge whether they were late.
 *               No shift assigned.
 *
 *   statutory   payroll runs, but a government filing will be wrong. A missing
 *               TIN, SSS, PhilHealth or Pag-IBIG number.
 *
 *   record      the file is thin but nothing breaks. No birth date, no
 *               address, no mobile number.
 *
 * The tier matters more than the count. "Six fields missing" tells nobody
 * whether to act today; "cannot be paid" does. Which is also why the tiers
 * have to be honest: the first version called a missing shift blocking, and on
 * a workforce where no shift had ever been assigned that marked all forty-one
 * records unpayable — a warning that loud about something that does not stop
 * payroll is a warning everybody learns to scroll past.
 */
class EmployeeProfile
{
    /**
     * Every field a complete 201 file has, and what its absence costs.
     *
     * Kept as data rather than as a run of ifs so that the same list drives
     * the badge on a row, the banner on a record, the count on the dashboard
     * and the check that refuses to mark a file complete.
     *
     * @return list<array{key: string, label: string, severity: string, why: string}>
     */
    public function requirements(): array
    {
        return [
            ['key' => 'salary', 'label' => 'Salary', 'severity' => 'blocking',
                'why' => 'Payroll has nothing to compute from.'],

            ['key' => 'atm_account', 'label' => 'Bank account', 'severity' => 'blocking',
                'why' => 'They are paid by ATM and the bank file has no account to credit.'],

            /* Its own tier, because its consequence is its own. Payroll
               computes perfectly well without a shift — it reads the punches,
               not the schedule — but nothing can decide whether somebody was
               late, so calling this "cannot be paid" was simply wrong, and on
               a workforce where no shift had ever been assigned it flagged
               every single record as unpayable. */
            ['key' => 'shift_id', 'label' => 'Shift', 'severity' => 'attendance',
                'why' => 'Attendance has no schedule to measure lateness or undertime against.'],

            ['key' => 'tin', 'label' => 'TIN', 'severity' => 'statutory',
                'why' => 'The BIR alphalist cannot name them.'],
            ['key' => 'sss_no', 'label' => 'SSS number', 'severity' => 'statutory',
                'why' => 'The SSS remittance cannot be credited to them.'],
            ['key' => 'philhealth_no', 'label' => 'PhilHealth number', 'severity' => 'statutory',
                'why' => 'The PhilHealth remittance cannot be credited to them.'],
            ['key' => 'pagibig_no', 'label' => 'Pag-IBIG number', 'severity' => 'statutory',
                'why' => 'The Pag-IBIG remittance cannot be credited to them.'],

            ['key' => 'birth_date', 'label' => 'Date of birth', 'severity' => 'record',
                'why' => 'Needed for statutory registration and for the 201 file itself.'],
            ['key' => 'address', 'label' => 'Address', 'severity' => 'record',
                'why' => 'The 201 file has no address on it.'],
            ['key' => 'mobile', 'label' => 'Mobile number', 'severity' => 'record',
                'why' => 'There is no way to reach them outside work.'],
            ['key' => 'email', 'label' => 'Email', 'severity' => 'record',
                'why' => 'Payslips and sign-in details have nowhere to go.'],
        ];
    }

    /**
     * The gaps in one file.
     *
     * @return list<array{key: string, label: string, severity: string, why: string}>
     */
    public function gaps(Employee $employee): array
    {
        $gaps = [];

        foreach ($this->requirements() as $requirement) {
            // A bank account is only required of somebody actually paid into
            // one. Asking a cash payee for an ATM number is a gap that can
            // never be closed, and a permanent warning is a warning nobody
            // reads any more.
            if ($requirement['key'] === 'atm_account' && $employee->payment_mode !== 'ATM') {
                continue;
            }

            // An exemption is a real answer. Somebody genuinely outside a
            // scheme has no number to give, and flagging them forever would
            // teach people to ignore the flag.
            $exempt = match ($requirement['key']) {
                'tin' => (bool) $employee->tax_exempted,
                'sss_no' => (bool) $employee->sss_exempted,
                'philhealth_no' => (bool) $employee->philhealth_exempted,
                'pagibig_no' => (bool) $employee->pagibig_exempted,
                default => false,
            };

            if ($exempt) {
                continue;
            }

            $value = $employee->{$requirement['key']};

            if ($value === null || $value === '' || ($requirement['key'] === 'salary' && (float) $value <= 0)) {
                $gaps[] = $requirement;
            }
        }

        return $gaps;
    }

    /**
     * A one-line verdict on a file, for a list column or a badge.
     *
     * @return array{status: string, gaps: int, blocking: int, statutory: int, summary: string}
     */
    public function status(Employee $employee): array
    {
        $gaps = $this->gaps($employee);

        $blocking = count(array_filter($gaps, fn ($g) => $g['severity'] === 'blocking'));
        $statutory = count(array_filter($gaps, fn ($g) => $g['severity'] === 'statutory'));

        $status = match (true) {
            $blocking > 0 => 'Cannot be paid',
            $statutory > 0 => 'Filings incomplete',
            $gaps !== [] => 'Thin',
            $employee->onboarding_completed_at === null => 'For review',
            default => 'Complete',
        };

        return [
            'status' => $status,
            'gaps' => count($gaps),
            'blocking' => $blocking,
            'statutory' => $statutory,
            'summary' => $this->summary($status, $gaps),
        ];
    }

    /** @param list<array<string, string>> $gaps */
    private function summary(string $status, array $gaps): string
    {
        if ($gaps === []) {
            return $status === 'Complete'
                ? 'The 201 file is complete and has been reviewed.'
                : 'Every field is filled — mark the file reviewed to close it off.';
        }

        $names = implode(', ', array_map(fn ($g) => $g['label'], array_slice($gaps, 0, 4)));
        $more = count($gaps) > 4 ? ' and '.(count($gaps) - 4).' more' : '';

        return "Missing {$names}{$more}.";
    }

    /**
     * Whether the file may be signed off as complete.
     *
     * Only the blocking tier refuses. A missing SSS number is worth chasing
     * and is not worth stopping somebody from closing an otherwise finished
     * file over — an employee who genuinely has not registered yet would leave
     * the record permanently open, and a queue that can never be emptied is a
     * queue people stop looking at.
     */
    public function canComplete(Employee $employee): ?string
    {
        $blocking = array_filter($this->gaps($employee), fn ($g) => $g['severity'] === 'blocking');

        if ($blocking === []) {
            return null;
        }

        $names = implode(', ', array_map(fn ($g) => strtolower($g['label']), $blocking));

        return "Payroll cannot run correctly on this file yet — {$names} still missing. "
            .'Fill those in first; the statutory numbers can follow.';
    }

    /**
     * Every file that still wants attention, worst first.
     *
     * This is what the dashboard panel and the notification feed both read. It
     * deliberately covers more than new hires: a file that was thin before
     * this existed is exactly as unpayable as one created yesterday.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function outstanding(int $limit = 50): Collection
    {
        $employees = Employee::query()
            ->with(['hrDepartment', 'branchUnit', 'position'])
            ->whereNull('onboarding_completed_at')
            ->whereNotIn('employment_status', HrAnalytics::STATUS_INACTIVE)
            ->when(true, fn (Builder $q) => $q->orderByDesc('date_hired'))
            ->limit(400)
            ->get();

        return $employees
            ->map(function (Employee $employee) {
                $status = $this->status($employee);

                return [
                    'id' => $employee->id,
                    'employeeNo' => $employee->employee_no,
                    'name' => $employee->full_name,
                    'position' => $employee->position->title ?? null,
                    'department' => $employee->hrDepartment->name ?? null,
                    'branch' => $employee->branchUnit->name ?? null,
                    'dateHired' => optional($employee->date_hired)->toDateString(),
                    'fromHire' => $employee->hired_from_applicant_id !== null,
                    'daysSinceHired' => $employee->date_hired
                        ? (int) floor($employee->date_hired->diffInDays(now()))
                        : null,
                ] + $status;
            })
            // A file with nothing missing is only here because nobody has said
            // so yet, which is a different and much quieter job.
            ->sortBy(fn (array $row) => [
                match ($row['status']) {
                    'Cannot be paid' => 0,
                    'Filings incomplete' => 1,
                    'Thin' => 2,
                    default => 3,
                },
                -($row['daysSinceHired'] ?? 0),
            ])
            ->take($limit)
            ->values();
    }
}
