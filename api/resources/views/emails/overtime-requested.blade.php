{{-- To HR/the approver the moment an employee requests overtime pre-approval. --}}
@extends('emails.layout', ['subject' => 'Overtime pre-approval requested — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $employee->full_name }} is requesting overtime pre-approval.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif —
        {{ $request->work_date->format('j F Y') }},
        {{ $request->expected_start_at->format('g:i A') }} to {{ $request->expected_end_at->format('g:i A') }}.
    </p>

    @if ($request->reason)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Reason given
                    </div>
                    <div style="font-size:13px; color:#0d0f14; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $request->reason }}</div>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        Open Timekeeping in HR to decide before the shift starts.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
