{{-- To HR/Finance the moment a separation starts — the internal counterpart
     to the exit notice the departing employee gets. --}}
@extends('emails.layout', ['subject' => 'Offboarding started — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Offboarding started for {{ $employee->full_name }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif —
        reason: <strong>{{ $case->reason }}</strong>@if($case->last_working_day), last working day
        <strong>{{ $case->last_working_day->format('j F Y') }}</strong>@endif.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        A clearance checklist has been generated — property turnover, access revocation, department clearance,
        and the final pay handoff to Payroll. Open Offboarding in HR to work through it.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
