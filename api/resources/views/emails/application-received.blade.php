{{-- Sent the moment an application lands, so nobody wonders whether it went
     through. Deliberately short: this is an acknowledgement, not a decision. --}}
@extends('emails.layout', ['subject' => 'We received your application'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Thanks for applying, {{ $applicant->first_name }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        We received your application for <strong>{{ $posting->title ?? 'the role' }}</strong> and it is now with our
        recruitment team.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
        <tr>
            <td style="padding:16px 18px;">
                <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                    Your reference
                </div>
                <div style="font-size:22px; font-weight:700; color:#0d0f14; margin-top:2px; letter-spacing:0.02em;">
                    {{ $applicant->reference_code }}
                </div>
                <div style="font-size:12px; color:#79808e; margin-top:6px;">
                    Keep this — you will need it, together with this email address, to check your status.
                </div>
            </td>
        </tr>
    </table>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        We review every application against the role's requirements. If you look like a fit, someone from our team
        will reach out to arrange next steps. If we decide not to move forward, we will let you know either way —
        you will not be left wondering.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic acknowledgement. Replying to it does nothing — use your reference and this email
        address on the careers site to check your status at any time.
    </p>
@endsection
