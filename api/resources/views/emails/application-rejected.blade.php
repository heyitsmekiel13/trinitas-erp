{{-- Sent only when a recruiter confirms the move to Rejected — never
     automatically. Polite and specific enough to not read as a form letter,
     without inventing a reason nobody actually gave. --}}
@extends('emails.layout', ['subject' => 'Your application — ' . ($posting->title ?? 'update')])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Thank you for your interest, {{ $applicant->first_name }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        We appreciate the time you put into applying for <strong>{{ $posting->title ?? 'the role' }}</strong> and for
        the interest you showed in joining us. After reviewing your application, we have decided not to move
        forward with it on this occasion.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        This is rarely a reflection of ability — it usually comes down to how closely a particular application
        matched what a specific role needed at the time. We keep applications on file and would welcome you applying
        again for a role that fits.
    </p>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        We wish you the best in your job search, and thank you again for considering us.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Reference {{ $applicant->reference_code }}. This is an automatic notice sent by our recruitment team;
        replying to it does nothing.
    </p>
@endsection
