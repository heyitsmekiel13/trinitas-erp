<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\Employee;
use App\Models\EmployeeDeduction;
use App\Models\PayrollGroup;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use Illuminate\Database\Eloquent\Model;

/**
 * The edits and deletions the generic resource writer must refuse.
 *
 * The writer is deliberately generic: name a table in the registry, get a list
 * screen and a form. That is the right default for a customer or a position,
 * where the worst case of a bad delete is retyping a row. It is the wrong
 * default for payroll, where the same code path would happily delete a run
 * that has already paid forty people, or reassign a computed run to a
 * different cut-off and leave its payslips pointing at the old one.
 *
 * So the rules live here rather than in the config. Two reasons:
 *
 *   - `config/erp.php` has to stay serialisable. A closure in there breaks
 *     `php artisan config:cache`, which is the sort of failure that only shows
 *     up in production.
 *
 *   - These are business rules with reasons, and a reason needs somewhere to
 *     be written down. "Only a draft run may be edited" is a sentence; a
 *     `'guard' => true` flag is not.
 *
 * A guard returns null to allow, or the message the user should see. The
 * message is written for the person who clicked the button — it says what
 * stopped them and what to do instead, never "constraint violation".
 */
class ResourceGuards
{
    /**
     * Why this record may not be changed. Null when it may.
     *
     * Called before validation, so a refusal costs nothing and the message is
     * never buried under a list of field errors.
     */
    public function forUpdate(string $resource, Model $record): ?string
    {
        return match ($resource) {
            'hr/payroll-runs' => $this->payrollRunUpdate($record),
            'hr/payroll-periods' => $this->payrollPeriodUpdate($record),
            default => null,
        };
    }

    /** Why this record may not be deleted. Null when it may. */
    public function forDelete(string $resource, Model $record): ?string
    {
        return match ($resource) {
            'hr/payroll-runs' => $this->payrollRunDelete($record),
            'hr/payroll-periods' => $this->payrollPeriodDelete($record),
            'hr/payroll-groups' => $this->payrollGroupDelete($record),
            'hr/requisitions' => $this->requisitionDelete($record),
            'hr/job-postings' => $this->postingDelete($record),
            default => null,
        };
    }

    /* ------------------------------------------------------- recruitment */

    /**
     * A manpower request is archived, not deleted, from the board.
     *
     * The first version of this refused outright — a request with an advert
     * was told to close the advert first, one with applicants was told to
     * cancel instead — and both were correct about the risk and useless as an
     * answer. People were left with a board of dead vacancies and two jobs to
     * do to clear each one, so nobody cleared any.
     *
     * Archiving does the whole job in one act and loses nothing, so the
     * generic delete is pointed at it rather than being made to work. Actually
     * destroying a record is a second, deliberate step from inside the
     * archive, where `VacancyArchive::blockedFrom` decides.
     */
    private function requisitionDelete(Model $record): ?string
    {
        return "{$record->requisition_no} is archived rather than deleted from the board — that takes it off "
            .'every working list and its advert off the careers site, and keeps the record. '
            .'Use Archive on the vacancy, then delete it for good from the archive if you need to.';
    }

    /**
     * An advert that has taken applications is part of their record.
     *
     * The candidate applied to a specific set of words, and the assessment on
     * their file was measured against them. Deleting the posting would leave
     * both unexplainable. Closing it takes it off the site and keeps the
     * history.
     */
    private function postingDelete(Model $record): ?string
    {
        $applicants = Applicant::where('job_posting_id', $record->getKey())->count();

        if ($applicants > 0) {
            return "\"{$record->title}\" has {$applicants} application"
                .($applicants === 1 ? '' : 's')
                .' against it. Close the advert instead — that takes it off the careers site and keeps '
                .'what each candidate applied to.';
        }

        return null;
    }

    /* ---------------------------------------------------------------- runs */

    /**
     * A run may only be re-pointed while it is still a draft.
     *
     * Once computed, the run has payslips hanging off it that were calculated
     * against a specific cut-off's dates and a specific group's members.
     * Changing either afterwards does not recompute them — it just makes the
     * register describe a payroll that was never run.
     */
    private function payrollRunUpdate(Model $record): ?string
    {
        /** @var PayrollRun $record */
        if ($record->status === 'Draft') {
            return null;
        }

        return match ($record->status) {
            'Computed' => "Run {$record->run_no} has already been computed. "
                .'Delete it and start a new one if the cut-off or group is wrong.',
            'Approved' => "Run {$record->run_no} has been approved and cannot be changed. "
                .'It has to be released or deleted before anything else happens to it.',
            default => "Run {$record->run_no} has been released — the wages are paid. "
                .'Correct it with an adjustment on the next run, not by editing this one.',
        };
    }

    /**
     * Deleting a run is only ever safe before anybody has been paid.
     *
     * A computed run can go: its payslips are a calculation and nothing has
     * left the bank. Approved is the line — somebody has signed it — and
     * released is money out of the door, which is a reversal, not a delete.
     */
    private function payrollRunDelete(Model $record): ?string
    {
        /** @var PayrollRun $record */
        if (in_array($record->status, ['Draft', 'Computed'], true)) {
            return null;
        }

        return $record->status === 'Approved'
            ? "Run {$record->run_no} has been approved by somebody. Deleting an approved register "
                .'would remove the thing they signed. Raise it with whoever approved it.'
            : "Run {$record->run_no} has been released and the wages are paid. A paid run is part of "
                .'the record — reverse it on the next cut-off rather than deleting it.';
    }

    /* ------------------------------------------------------------- periods */

    /** A closed cut-off has been paid against; its dates are now history. */
    private function payrollPeriodUpdate(Model $record): ?string
    {
        /** @var PayrollPeriod $record */
        return $record->status === 'Closed'
            ? "Cut-off {$record->code} is closed — a run against it has already been released. "
                .'Reopening it would let a second payroll be run over wages that are already paid.'
            : null;
    }

    private function payrollPeriodDelete(Model $record): ?string
    {
        /** @var PayrollPeriod $record */
        $runs = PayrollRun::where('payroll_period_id', $record->getKey())->count();

        return $runs > 0
            ? "Cut-off {$record->code} has {$runs} payroll run"
                .($runs === 1 ? '' : 's')
                .' against it. Delete those first, or leave the cut-off in place — an empty one costs nothing.'
            : null;
    }

    /* -------------------------------------------------------------- groups */

    /**
     * A group with people in it is load-bearing.
     *
     * `employees.payroll_group_id` is required, so removing the group either
     * fails at the database or orphans the rows depending on how the foreign
     * key is set up. Neither is a thing to discover halfway through a payroll
     * run, so it is refused here with the headcount in the message.
     */
    private function payrollGroupDelete(Model $record): ?string
    {
        /** @var PayrollGroup $record */
        $employees = Employee::where('payroll_group_id', $record->getKey())->count();

        if ($employees > 0) {
            return "{$record->name} has {$employees} employee"
                .($employees === 1 ? '' : 's')
                .' assigned. Move them to another group first — payroll cannot run on a group that is not there.';
        }

        $runs = PayrollRun::where('payroll_group_id', $record->getKey())->count();

        return $runs > 0
            ? "{$record->name} has {$runs} payroll run"
                .($runs === 1 ? '' : 's')
                .' in its history. Deleting it would leave those runs without a group name.'
            : null;
    }

    /* --------------------------------------------------------------- misc */

    /**
     * Kept alongside the payroll rules because it is the same class of
     * mistake: a deduction type that loans are still being collected against.
     */
    public function deductionTypeInUse(Model $record): ?string
    {
        $arrangements = EmployeeDeduction::where('deduction_type_id', $record->getKey())->count();

        return $arrangements > 0
            ? "This deduction is on {$arrangements} employee arrangement"
                .($arrangements === 1 ? '' : 's')
                .'. Deactivate it instead — deleting it would detach the collections already made.'
            : null;
    }
}
