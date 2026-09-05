{{-- To the employee whose offboarding case was called off. --}}
@extends('emails.layout', ['subject' => 'Your offboarding has been cancelled'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Hello {{ $employee->first_name }},
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        Your clearance process has been cancelled — it will not continue, and nothing further is expected from
        you on it.
    </p>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        If you have any questions about your employment status, please speak with HR directly.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Questions about this go to HR directly, not to this address.
    </p>
@endsection
