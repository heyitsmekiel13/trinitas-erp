<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\ResignationRequest;

/**
 * An employee's own word that they intend to leave, and HR's decision on it.
 *
 * Deliberately two steps rather than one. Submitting is not resigning — it is
 * telling HR, the way it always happened by conversation before this existed.
 * Nothing about the 201 file, the sign-in, or the offboarding checklist moves
 * until HR approves it; only the approval calls `OffboardingOperations`,
 * which is the one place a case is actually opened. A request an employee
 * changes their mind about, or one HR talks them out of, never has to be
 * unwound out of the real offboarding machinery, because it was never in it.
 */
class ResignationRequests
{
    public function __construct(
        private readonly OffboardingOperations $offboarding,
        private readonly NotificationDispatcher $notifications,
    ) {}

    /** @throws \RuntimeException when one is already open */
    public function submit(Employee $employee, string $intendedLastDay, ?string $reason): ResignationRequest
    {
        $existing = ResignationRequest::where('employee_id', $employee->id)
            ->where('status', 'Pending')
            ->first();

        if ($existing) {
            throw new \RuntimeException('You already have a resignation request awaiting a decision.');
        }

        // `fresh()`: `status` has no value in the insert (it comes from the
        // column's DB default), so the in-memory object right after create()
        // reports it as blank — the confirmation the employee sees would show
        // an empty status badge on the request they just filed.
        $request = ResignationRequest::create([
            'employee_id' => $employee->id,
            'intended_last_day' => $intendedLastDay,
            'reason' => $reason,
        ])->fresh();

        $this->notifications->dispatch(
            event: 'resignation.submitted',
            subject: "Resignation submitted — {$employee->full_name}",
            view: 'emails.resignation-submitted',
            data: ['employee' => $employee, 'request' => $request],
            referenceType: 'ResignationRequest',
            referenceId: $request->id,
        );

        return $request;
    }

    /** The employee's own most recent request, or null if they have never filed one. */
    public function latestFor(Employee $employee): ?ResignationRequest
    {
        return ResignationRequest::where('employee_id', $employee->id)->latest('id')->first();
    }

    /** @throws \RuntimeException when the request has already been decided */
    public function decide(
        ResignationRequest $request,
        string $decision,
        ?int $decidedBy,
        ?string $note,
    ): ResignationRequest {
        if ($request->status !== 'Pending') {
            throw new \RuntimeException('This request has already been decided.');
        }

        $request->loadMissing('employee');

        $case = null;

        if ($decision === 'Approved') {
            $case = $this->offboarding->initiate(
                $request->employee,
                'Resignation',
                $request->intended_last_day->toDateString(),
                $decidedBy,
            );
        }

        $request->update([
            'status' => $decision,
            'decided_by' => $decidedBy,
            'decided_at' => now(),
            'decision_note' => $note,
            'offboarding_case_id' => $case?->id,
        ]);

        if ($request->employee->email) {
            $this->notifications->dispatchDirect(
                event: 'resignation.decided',
                to: $request->employee->email,
                subject: $decision === 'Approved' ? 'Your resignation has been approved' : 'About your resignation request',
                view: 'emails.resignation-decided',
                data: ['employee' => $request->employee, 'request' => $request],
                referenceType: 'ResignationRequest',
                referenceId: $request->id,
            );
        }

        return $request->fresh();
    }

    /** Every request still waiting on HR, oldest first. */
    public function pending()
    {
        return ResignationRequest::where('status', 'Pending')
            ->with('employee.hrDepartment')
            ->oldest()
            ->get();
    }

    /**
     * The employee withdrawing their own request before HR has decided.
     *
     * Only reachable while `Pending` — once HR has approved it, the
     * offboarding case it opened is the thing that has to be cancelled (see
     * `OffboardingOperations::cancel()`), not this request retroactively.
     *
     * @throws \RuntimeException when there is nothing pending to withdraw
     */
    public function cancel(Employee $employee): ResignationRequest
    {
        $request = ResignationRequest::where('employee_id', $employee->id)
            ->where('status', 'Pending')
            ->first();

        if (! $request) {
            throw new \RuntimeException('You do not have a resignation request awaiting a decision.');
        }

        $request->update(['status' => 'Cancelled']);

        $this->notifications->dispatch(
            event: 'resignation.cancelled',
            subject: "Resignation withdrawn — {$employee->full_name}",
            view: 'emails.resignation-cancelled',
            data: ['employee' => $employee, 'request' => $request],
            referenceType: 'ResignationRequest',
            referenceId: $request->id,
        );

        return $request->fresh();
    }
}
