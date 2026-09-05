{{-- To the employee once HR has decided — worded differently for each
     outcome rather than one generic "your request was processed" notice. --}}
@extends('emails.layout', ['subject' => $request->status === 'Approved' ? 'Your resignation has been approved' : 'About your resignation request'])

@section('content')
    @if ($request->status === 'Approved')
        <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
            Your resignation has been approved, {{ $employee->first_name }}.
        </p>
        <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
            Your intended last day of <strong>{{ $request->intended_last_day->format('j F Y') }}</strong> has been
            confirmed. A clearance checklist has been started for you — property turnover, department clearance and
            your final pay — and you'll separately receive the exit checklist explaining what to expect.
        </p>
    @else
        <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
            About your resignation request, {{ $employee->first_name }}.
        </p>
        <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
            Your request submitted for an intended last day of
            <strong>{{ $request->intended_last_day->format('j F Y') }}</strong> was not approved as filed. Please
            speak with HR directly about next steps.
        </p>
    @endif

    @if ($request->decision_note)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Note from HR
                    </div>
                    <div style="font-size:13px; color:#4b5262; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $request->decision_note }}</div>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Questions about this go to HR directly, not to this address.
    </p>
@endsection
