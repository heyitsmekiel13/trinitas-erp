@extends('emails.layout', ['subject' => 'Test email'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">Your email settings work</p>
    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        This test was sent from Admin &rarr; Email settings at {{ $sentAt }}.
        Sign-in codes, approval requests and payroll notices will reach this mailbox.
    </p>

    <div style="padding:12px 14px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px;
                font-size:13px; color:#046904;">
        SMTP connection successful.
    </div>
@endsection
