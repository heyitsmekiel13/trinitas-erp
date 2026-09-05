<?php

namespace App\Services;

use App\Models\CoeRequest;
use App\Models\Employee;
use App\Models\EmployeeCase;

/**
 * An employee's own request for a Certificate of Employment, and HR's
 * decision on it — mirrors ResignationRequests' shape: self-service submit,
 * HR decides. Unlike a resignation, "decide" and "issue" are the same act:
 * there is no follow-on process a COE has to open, so approving one and
 * making the certificate available for download happen together.
 */
class CoeRequests
{
    public function __construct(private readonly NotificationDispatcher $notifications) {}

    /** @throws \RuntimeException when one of this type is already open */
    public function submit(Employee $employee, ?string $purpose, bool $includeSalary, string $type = 'Employment'): CoeRequest
    {
        $existing = CoeRequest::where('employee_id', $employee->id)
            ->where('type', $type)
            ->where('status', 'Pending')
            ->first();

        if ($existing) {
            throw new \RuntimeException(
                $type === 'No Derogatory Record'
                    ? 'You already have a Certificate of No Derogatory Record request awaiting HR.'
                    : 'You already have a Certificate of Employment request awaiting HR.'
            );
        }

        $request = CoeRequest::create([
            'employee_id' => $employee->id,
            'type' => $type,
            'purpose' => $purpose,
            'include_salary' => $includeSalary,
        ])->fresh();

        $this->notifications->dispatch(
            event: 'coe.requested',
            subject: "{$type} certificate requested — {$employee->full_name}",
            view: 'emails.coe-requested',
            data: ['employee' => $employee, 'request' => $request],
            referenceType: 'CoeRequest',
            referenceId: $request->id,
        );

        return $request;
    }

    /** Every request the employee has ever filed, newest first. */
    public function forEmployee(Employee $employee)
    {
        return CoeRequest::where('employee_id', $employee->id)->latest('id')->get();
    }

    /** Every request still waiting on HR, oldest first. */
    public function pending()
    {
        return CoeRequest::where('status', 'Pending')->with('employee.hrDepartment')->oldest()->get();
    }

    /** @throws \RuntimeException when the request has already been decided, or cannot honestly be issued */
    public function decide(CoeRequest $request, string $decision, ?int $decidedBy, ?string $note): CoeRequest
    {
        if ($request->status !== 'Pending') {
            throw new \RuntimeException('This request has already been decided.');
        }

        // A "no derogatory record" certificate is a statement of fact — it
        // cannot be issued while a disciplinary case against this employee
        // is still open, whatever the request itself says.
        if ($decision === 'Issued' && $request->type === 'No Derogatory Record') {
            $openCase = EmployeeCase::where('employee_id', $request->employee_id)
                ->whereNotIn('status', ['Resolved', 'Closed'])
                ->exists();

            if ($openCase) {
                throw new \RuntimeException(
                    'This employee has an open disciplinary case — a no-derogatory-record certificate cannot be '
                    .'issued until it is resolved or closed.'
                );
            }
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
                event: 'coe.decided',
                to: $request->employee->email,
                subject: $decision === 'Issued'
                    ? "Your Certificate of {$request->type} is ready"
                    : "About your Certificate of {$request->type} request",
                view: 'emails.coe-decided',
                data: ['employee' => $request->employee, 'request' => $request],
                referenceType: 'CoeRequest',
                referenceId: $request->id,
            );
        }

        return $request->fresh();
    }
}
