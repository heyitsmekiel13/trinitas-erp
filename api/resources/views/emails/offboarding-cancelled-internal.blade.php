{{-- To HR/Finance when an open offboarding case is called off. --}}
@extends('emails.layout', ['subject' => 'Offboarding cancelled — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Offboarding cancelled for {{ $employee->full_name }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif —
        the clearance case opened for a {{ strtolower($case->reason) }} has been closed as cancelled, not
        completed.
    </p>

    @if($case->cancel_reason)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Reason
                    </div>
                    <div style="font-size:13px; color:#0d0f14; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $case->cancel_reason }}</div>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        No further clearance action is expected on this case. If this employee is in fact continuing, confirm
        their 201 file's employment status reflects that.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
