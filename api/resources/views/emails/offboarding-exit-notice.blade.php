{{-- To the departing employee — what happens next, stated plainly rather
     than left for them to ask HR about. --}}
@extends('emails.layout', ['subject' => 'Your clearance checklist'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Hello {{ $employee->first_name }},
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        This confirms your @if($case->reason === 'Resignation') resignation @elseif($case->reason === 'Termination') separation @else departure @endif
        is being processed
        @if($case->last_working_day)
            , with a last working day of <strong>{{ $case->last_working_day->format('j F Y') }}</strong>
        @endif
        .
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
        <tr>
            <td style="padding:16px 18px;">
                <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e; margin-bottom:8px;">
                    Before you go
                </div>
                <div style="font-size:13px; line-height:1.9; color:#0d0f14;">
                    • Return any company property — ID, tools, uniform, keys<br>
                    • Complete clearance with HR, Finance and your department head<br>
                    • Your exit interview will be scheduled separately<br>
                    • Your final pay is computed once clearance is complete
                </div>
            </td>
        </tr>
    </table>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        A Certificate of Employment is available on request — ask HR and it will be issued within a few
        working days.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Questions about any of this go to HR directly, not to this address.
    </p>
@endsection
