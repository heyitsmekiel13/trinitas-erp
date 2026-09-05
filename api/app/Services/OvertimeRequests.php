<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\OvertimeRequest;

/**
 * An employee's own overtime pre-approval request, and a manager's decision
 * on it. Filed before or during a shift so overtime is authorized in
 * advance rather than only ever discovered afterward on a timesheet — the
 * gap the HR analysis flagged: today `overtime_hours` (see `TimeClock`) is
 * computed purely from punches, after the fact, with no record of whether
 * anyone actually agreed to it beforehand.
 */
class OvertimeRequests
{
    public function __construct(private readonly NotificationDispatcher $notifications) {}

    /** @throws \RuntimeException when one is already pending for that date */
    public function submit(
        Employee $employee,
        string $workDate,
        string $expectedStartAt,
        string $expectedEndAt,
        ?string $reason,
    ): OvertimeRequest {
        $existing = OvertimeRequest::where('employee_id', $employee->id)
            ->where('work_date', $workDate)
            ->where('status', 'Pending')
            ->first();

        if ($existing) {
            throw new \RuntimeException('You already have an overtime request pending for that date.');
        }

        $request = OvertimeRequest::create([
            'employee_id' => $employee->id,
            'work_date' => $workDate,
            'expected_start_at' => $expectedStartAt,
            'expected_end_at' => $expectedEndAt,
            'reason' => $reason,
        ])->fresh();

        $this->notifications->dispatch(
            event: 'overtime.requested',
            subject: "Overtime pre-approval requested — {$employee->full_name}",
            view: 'emails.overtime-requested',
            data: ['employee' => $employee, 'request' => $request],
            referenceType: 'OvertimeRequest',
            referenceId: $request->id,
        );

        return $request;
    }

    /** Every request the employee has filed, newest first. */
    public function forEmployee(Employee $employee)
    {
        return OvertimeRequest::where('employee_id', $employee->id)->latest('work_date')->latest('id')->get();
    }

    /** Every request still waiting on a decision, soonest work date first. */
    public function pending()
    {
        return OvertimeRequest::where('status', 'Pending')->with('employee.hrDepartment')->oldest('work_date')->get();
    }

    /** @throws \RuntimeException when the request has already been decided */
    public function decide(OvertimeRequest $request, string $decision, ?int $decidedBy, ?string $note): OvertimeRequest
    {
        if ($request->status !== 'Pending') {
            throw new \RuntimeException('This request has already been decided.');
        }

        $request->update([
            'status' => $decision,
            'decided_by' => $decidedBy,
            'decided_at' => now(),
            'decision_note' => $note,
        ]);

        $request->loadMissing('employee');

        if ($request->employee->email) {
            $this->notifications->dispatchDirect(
                event: 'overtime.decided',
                to: $request->employee->email,
                subject: $decision === 'Approved'
                    ? 'Your overtime request has been approved'
                    : 'About your overtime request',
                view: 'emails.overtime-decided',
                data: ['employee' => $request->employee, 'request' => $request],
                referenceType: 'OvertimeRequest',
                referenceId: $request->id,
            );
        }

        return $request->fresh();
    }
}
