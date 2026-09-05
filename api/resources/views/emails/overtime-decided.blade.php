{{-- To the employee once their overtime request has been decided. --}}
@extends('emails.layout', ['subject' => $request->status === 'Approved' ? 'Your overtime request has been approved' : 'About your overtime request'])

@section('content')
    @if ($request->status === 'Approved')
        <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
            Your overtime request has been approved, {{ $employee->first_name }}.
        </p>
        <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
            {{ $request->work_date->format('j F Y') }}, {{ $request->expected_start_at->format('g:i A') }} to
            {{ $request->expected_end_at->format('g:i A') }} is authorized.
        </p>
    @else
        <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
            About your overtime request, {{ $employee->first_name }}.
        </p>
        <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
            Your request for {{ $request->work_date->format('j F Y') }} was not approved. Please speak with your
            supervisor about next steps.
        </p>
    @endif

    @if ($request->decision_note)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Note
                    </div>
                    <div style="font-size:13px; color:#4b5262; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $request->decision_note }}</div>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Questions about this go to your supervisor directly, not to this address.
    </p>
@endsection
