{{-- To HR the moment an employee requests a COE or a no-derogatory-record
     certificate — a decision is needed either way. --}}
@extends('emails.layout', ['subject' => $request->type . ' certificate requested — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $employee->full_name }} has requested a Certificate of {{ $request->type }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif
        @if($request->purpose) — for {{ $request->purpose }}@endif
        @if($request->include_salary) (salary to be included) @endif
    </p>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        Open Certificates in HR to issue or decline this request.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
