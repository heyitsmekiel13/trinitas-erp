@extends('emails.layout', ['subject' => 'Your sign-in details'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">Your sign-in details</p>
    <p style="margin:0 0 20px; font-size:13px; line-height:1.6; color:#4b5262;">
        Hello {{ $user->name ?: $username }} — an account has been set up for you on {{ $companyName }}.
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

    {{-- The wording follows what the password actually is.

         Accounts are now issued the last four digits of the person's mobile
         number and are not forced to change it, so the old copy — "you will be
         asked to choose your own password the first time you sign in", and an
         expiry in hours — described a system that no longer exists. Telling
         somebody their password expires when it does not is how a working
         account turns into a support ticket. --}}
    @if (($passwordSource ?? null) === 'phone')
        <p style="margin:20px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
            <strong>That is the last four digits of your mobile number.</strong>
            It does not expire, and you will not be made to change it — but you can, any time, from
            <strong>your name in the top right → Change password</strong>. Please do, since anyone who knows your
            number can work this one out.
        </p>
    @else
        <p style="margin:20px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
            <strong>Type the password above exactly as it appears.</strong>
            You will not be made to change it, but you can at any time from
            <strong>your name in the top right → Change password</strong>.
        </p>
    @endif

    <p style="margin:14px 0 0; font-size:12px; line-height:1.6; color:#79808e;">
        Keep this message private, and delete it once you have signed in. Nobody from
        {{ $companyName }} will ever ask you for your password.
    </p>

    <p style="margin:10px 0 0; font-size:12px; line-height:1.6; color:#79808e;">
        Were you not expecting this? Tell your administrator — somebody has set up an account in your name.
    </p>
@endsection
