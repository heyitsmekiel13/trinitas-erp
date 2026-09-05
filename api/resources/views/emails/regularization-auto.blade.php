{{-- To the employee, the moment probation resolves in their favour
     automatically — the law regularises them at six months regardless of
     whether anyone updates a system, so this is a confirmation, not news. --}}
@extends('emails.layout', ['subject' => 'You are now a regular employee'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        Congratulations, {{ $employee->first_name }}.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        Your probationary period ended {{ $regularizedOn }} and you are now a
        <strong>regular employee</strong>@if($position) as {{ $position }}@endif. This carries the full benefits
        and security of tenure that come with regular status.
    </p>

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        No action is needed from you — this is confirmed automatically. If you have any questions, reach out to HR.
    </p>
@endsection
