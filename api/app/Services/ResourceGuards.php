<?php

namespace App\Services;

use App\Models\Applicant;
use App\Models\Employee;
use App\Models\EmployeeDeduction;
use App\Models\LeaveRequest;
use App\Models\PayrollGroup;
use App\Models\PayrollPeriod;
use App\Models\PayrollRun;
use App\Models\PurchaseOrder;
use App\Models\PurchaseRequisition;
use App\Models\SalesOrder;
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
    /** Why this record may not be created. Null when it may. */
    public function forCreate(string $resource, array $input): ?string
    {
        return match ($resource) {
            'hr/leaves' => $this->leaveCreate($input),
            'procurement/requisitions' => $this->purchaseRequisitionCreate($input),
            'procurement/orders' => $this->purchaseOrderCreate($input),
            'sales/orders' => $this->salesOrderCreate($input),
            default => null,
        };
    }

    /**
     * Why this record may not be changed. Null when it may.
     *
     * Called before validation, so a refusal costs nothing and the message is
     * never buried under a list of field errors. `$input` is the raw request
     * body — most resources here never look at it, but one whose "approve"
     * is just this same update setting `status` to Approved needs to see
     * what is actually changing, not only the record as it stood before.
     */
    public function forUpdate(string $resource, Model $record, array $input = []): ?string
    {
        return match ($resource) {
            'hr/payroll-runs' => $this->payrollRunUpdate($record),
            'hr/payroll-periods' => $this->payrollPeriodUpdate($record),
            'hr/leaves' => $this->leaveUpdate($record),
            'procurement/requisitions' => $this->purchaseRequisitionUpdate($record, $input),
            'procurement/orders' => $this->purchaseOrderUpdate($record, $input),
            'sales/orders' => $this->salesOrderUpdate($record),
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
            'hr/leaves' => $this->leaveDelete($record),
            'procurement/requisitions' => $this->purchaseRequisitionDelete($record),
            'procurement/orders' => $this->purchaseOrderDelete($record),
            'sales/orders' => $this->salesOrderDelete($record),
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

    /* ---------------------------------------------------------------- leave */

    /**
     * The role-based access rules' first template — see the phased plan:
     * rank-and-file may file and correct their own request only up to the
     * moment it is actually submitted, their own supervisor or HR can act on
     * it from there, and an approved request is a decision on the record
     * rather than a draft to keep editing.
     */
    private function leaveCreate(array $input): ?string
    {
        $user = auth()->user();
        if (! $user || $user->hasPermission('hr.create')) {
            return null;
        }

        $requestedId = $input['employeeId'] ?? null;

        if ($user->employee_id && (int) $requestedId === (int) $user->employee_id) {
            return null;
        }

        return 'You can only file a leave request for yourself. Ask HR to file one on someone else\'s behalf.';
    }

    private function leaveUpdate(Model $record): ?string
    {
        /** @var LeaveRequest $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        // Your own request is a self-service question, not a functional-role
        // one: an HR Officer's own `hr.edit` exists so they can process other
        // people's records, not so it lets them skip the same lock everyone
        // else's own request is held to. Only "is it still a draft" governs
        // your own record — the checks below are for everyone else's.
        if ($record->employee_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This request has already been submitted ({$record->status}) and can only be corrected by your supervisor or HR.";
        }

        if ($user->canActOnRecordOf($record->employee, 'hr.edit')) {
            return null;
        }

        return 'You may only edit your own leave requests, or ones your position lets you act on.';
    }

    private function leaveDelete(Model $record): ?string
    {
        /** @var LeaveRequest $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        // Same self-service reasoning as `leaveUpdate`: your own request is
        // governed by whether it is still a draft, never by a functional
        // role that exists to let you process other people's records.
        if ($record->employee_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This request has already been submitted ({$record->status}) — withdraw it through a decision instead of deleting it.";
        }

        if ($record->status !== 'Approved' && $user->canActOnRecordOf($record->employee, 'hr.edit')) {
            return null;
        }

        return $record->status === 'Approved'
            ? 'An approved leave request is part of the record and cannot be deleted — cancel it instead.'
            : 'Only your own draft, or your supervisor or HR, can remove this request.';
    }

    /* ------------------------------------------------------- procurement */

    /**
     * The role-based access rules' second template, same shape as leave
     * requests: raise and correct your own while it is still a draft, your
     * own supervisor or Procurement from there. Approving one here is not a
     * separate action — `status` reaching Approved or Rejected through this
     * same generic update is the decision, so that is the one transition
     * this watches for specifically, on top of the ordinary edit rule.
     */
    private function purchaseRequisitionCreate(array $input): ?string
    {
        $user = auth()->user();
        if (! $user || $user->hasPermission('procurement.create')) {
            return null;
        }

        $requestedId = $input['requestedById'] ?? null;

        if ($user->employee_id && (int) $requestedId === (int) $user->employee_id) {
            return null;
        }

        return 'You can only raise a requisition for your own work. Ask Procurement to raise one on someone else\'s behalf.';
    }

    private function purchaseRequisitionUpdate(Model $record, array $input): ?string
    {
        /** @var PurchaseRequisition $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        // A decision — Approved or Rejected — needs approval authority
        // specifically, whatever else about this same update would
        // otherwise be allowed.
        $decidingTo = $input['status'] ?? null;
        if (in_array($decidingTo, ['Approved', 'Rejected'], true) && $decidingTo !== $record->status) {
            return $user->canActOnRecordOf($record->requester, 'procurement.approve')
                ? null
                : 'You are not authorized to decide this requisition.';
        }

        // Your own requisition is a self-service question while it is still
        // a draft — same reasoning as a leave request's own draft lock, and
        // not something a functional role should be able to skip on their
        // own paperwork.
        if ($record->requested_by === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This requisition has already been submitted ({$record->status}) and can only be corrected by your supervisor or Procurement.";
        }

        if ($user->canActOnRecordOf($record->requester, 'procurement.edit')) {
            return null;
        }

        return 'You may only edit your own requisitions, or ones your position lets you act on.';
    }

    private function purchaseRequisitionDelete(Model $record): ?string
    {
        /** @var PurchaseRequisition $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        if ($record->requested_by === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This requisition has already been submitted ({$record->status}) — reject it through a decision instead of deleting it.";
        }

        if ($record->status !== 'Approved' && $user->canActOnRecordOf($record->requester, 'procurement.edit')) {
            return null;
        }

        return $record->status === 'Approved'
            ? 'An approved requisition is part of the record and cannot be deleted — reject or convert it instead.'
            : 'Only your own draft, or your supervisor or Procurement, can remove this requisition.';
    }

    /**
     * A purchase order is the same shape as a requisition — approving it
     * is this same update reaching Approved, so that transition specifically
     * needs approval authority regardless of who raised it.
     */
    private function purchaseOrderCreate(array $input): ?string
    {
        $user = auth()->user();
        if (! $user || $user->hasPermission('procurement.create')) {
            return null;
        }

        $requestedId = $input['buyerId'] ?? null;

        if ($user->employee_id && (int) $requestedId === (int) $user->employee_id) {
            return null;
        }

        return 'You can only raise a purchase order under your own name. Ask Procurement to raise one on someone else\'s behalf.';
    }

    private function purchaseOrderUpdate(Model $record, array $input): ?string
    {
        /** @var PurchaseOrder $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        $decidingTo = $input['status'] ?? null;
        if (in_array($decidingTo, ['Approved', 'Cancelled'], true) && $decidingTo !== $record->status) {
            return $user->canActOnRecordOf($record->buyer, 'procurement.approve')
                ? null
                : 'You are not authorized to decide this purchase order.';
        }

        if ($record->buyer_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This order has already been submitted ({$record->status}) and can only be corrected by your supervisor or Procurement.";
        }

        if ($user->canActOnRecordOf($record->buyer, 'procurement.edit')) {
            return null;
        }

        return 'You may only edit your own purchase orders, or ones your position lets you act on.';
    }

    private function purchaseOrderDelete(Model $record): ?string
    {
        /** @var PurchaseOrder $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        if (in_array($record->status, ['Partial', 'Completed'], true)) {
            return "{$record->po_no} has already been {$record->status} — cancel it instead of deleting a live commitment.";
        }

        if ($record->buyer_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This order has already been submitted ({$record->status}) — cancel it through a decision instead of deleting it.";
        }

        if ($record->status !== 'Approved' && $user->canActOnRecordOf($record->buyer, 'procurement.edit')) {
            return null;
        }

        return $record->status === 'Approved'
            ? 'An approved purchase order is a commitment to a supplier and cannot be deleted — cancel it instead.'
            : 'Only your own draft, or your supervisor or Procurement, can remove this order.';
    }

    /* ------------------------------------------------------------- sales */

    /**
     * A third template of the same shape — sales orders have no separate
     * approval step of their own (confirming one is the rep's own act, not
     * a decision somebody else makes), so this is the plainer half of the
     * pattern: your own while it is a draft, your sales manager or
     * supervisor from the moment it is confirmed and a customer is
     * expecting it.
     */
    private function salesOrderCreate(array $input): ?string
    {
        $user = auth()->user();
        if (! $user || $user->hasPermission('sales.create')) {
            return null;
        }

        $requestedId = $input['salesRepId'] ?? null;

        if ($user->employee_id && (int) $requestedId === (int) $user->employee_id) {
            return null;
        }

        return 'You can only raise an order under your own name. Ask your sales manager to raise one for someone else.';
    }

    private function salesOrderUpdate(Model $record): ?string
    {
        /** @var SalesOrder $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        if ($record->sales_rep_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This order has already been confirmed ({$record->status}) and can only be changed by your sales manager.";
        }

        if ($user->canActOnRecordOf($record->salesRep, 'sales.edit')) {
            return null;
        }

        return 'You may only edit your own orders, or ones your position lets you act on.';
    }

    private function salesOrderDelete(Model $record): ?string
    {
        /** @var SalesOrder $record */
        $user = auth()->user();
        if (! $user) {
            return 'Sign in again to make this change.';
        }

        // Fulfilment already under way is a data-integrity line, not a
        // rank one — nobody deletes an order the warehouse has picked
        // against.
        if (in_array($record->status, ['Partial', 'Delivered'], true)) {
            return "{$record->order_no} is already {$record->status} — cancel it instead of deleting a live fulfilment.";
        }

        if ($record->sales_rep_id === $user->employee_id) {
            return $record->status === 'Draft'
                ? null
                : "This order has already been confirmed ({$record->status}) — cancel it instead of deleting it.";
        }

        if ($user->canActOnRecordOf($record->salesRep, 'sales.edit')) {
            return null;
        }

        return 'Only your own draft, or your sales manager, can remove this order.';
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
