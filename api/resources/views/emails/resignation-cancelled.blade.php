{{-- To HR the moment an employee withdraws their own resignation request. --}}
@extends('emails.layout', ['subject' => 'Resignation withdrawn — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $employee->full_name }} has withdrawn their resignation request.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif —
        the request for an intended last day of
        <strong>{{ $request->intended_last_day->format('j F Y') }}</strong> was withdrawn before a decision was
        made.
    </p>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        No further action is needed — nothing on their record was changed while it was pending.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
