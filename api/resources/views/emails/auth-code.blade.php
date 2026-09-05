@extends('emails.layout', ['subject' => 'Your sign-in code'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">Your sign-in code</p>
    <p style="margin:0 0 20px; font-size:13px; line-height:1.6; color:#4b5262;">
        Hello {{ $user->name }} — use this code to finish signing in.
    </p>

    <div style="text-align:center; padding:18px; background:#fff1f2; border:1px solid #ffc7cd; border-radius:12px;">
        <div style="font-family:ui-monospace,'Cascadia Mono',Menlo,monospace; font-size:30px;
                    font-weight:700; letter-spacing:0.34em; color:#9d1024;">{{ $code }}</div>
    </div>

    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        It expires in {{ $minutes }} minutes and can only be used once.
    </p>

    <p style="margin:14px 0 0; font-size:12px; line-height:1.6; color:#79808e;">
        Did not try to sign in? Someone may have your password — change it and tell your administrator.
    </p>
@endsection
