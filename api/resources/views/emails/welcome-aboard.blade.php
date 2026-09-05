{{-- The Day-0 welcome, sent the moment a hire creates the 201 file and the
     sign-in. Unlike emails.credentials (issued from Admin, not forced to
     change), a fresh hire's account IS forced to change on first sign-in —
     so the copy has to say that, not the opposite. --}}
@extends('emails.layout', ['subject' => 'Welcome to ' . ($companyName ?? 'the team')])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Welcome aboard, {{ $employee->first_name }}.
    </p>

    <p style="margin:0 0 20px; font-size:13px; line-height:1.6; color:#4b5262;">
        Your record is set up as <strong>{{ $position ?? 'a new hire' }}</strong>@if($department) in
        <strong>{{ $department }}</strong>@endif, starting {{ $startDate }}. Here is how to sign in.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8f9fb; border:1px solid #e4e7ec; border-radius:12px;">
        <tr>
            <td style="padding:16px 18px;">
                <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Username</div>
                <div style="font-family:ui-monospace,'Cascadia Mono',Menlo,monospace; font-size:17px;
                            font-weight:700; color:#0d0f14; margin-top:3px;">{{ $username }}</div>
            </td>
        </tr>
        <tr>
            <td style="padding:0 18px 16px;">
                <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Temporary password</div>
                <div style="font-family:ui-monospace,'Cascadia Mono',Menlo,monospace; font-size:20px;
                            font-weight:700; letter-spacing:0.08em; color:#9d1024; margin-top:3px;">{{ $password }}</div>
            </td>
        </tr>
    </table>

    @if ($signInUrl)
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
            <tr>
                <td style="background:linear-gradient(135deg,#ff5c68 0%,#e11d34 48%,#9d1024 100%); border-radius:10px;">
                    <a href="{{ $signInUrl }}"
                       style="display:inline-block; padding:11px 22px; color:#ffffff; font-size:14px;
                              font-weight:600; text-decoration:none;">Sign in</a>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:20px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        <strong>You will be asked to choose your own password the first time you sign in.</strong>
        The one above only works for that first sign-in.
    </p>

    <p style="margin:14px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        Before your first day, please have your government IDs and other 201-file documents ready — your HR
        contact will let you know exactly what's needed to complete your file.
    </p>

    <p style="margin:14px 0 0; font-size:12px; line-height:1.6; color:#79808e;">
        Keep this message private, and delete it once you have signed in. Were you not expecting this? Tell HR —
        somebody has set up an account in your name.
    </p>
@endsection
