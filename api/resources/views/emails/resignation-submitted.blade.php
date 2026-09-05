{{-- To HR the moment an employee submits — nothing has happened to their
     record yet, this is only the notice that a decision is needed. --}}
@extends('emails.layout', ['subject' => 'Resignation submitted — ' . $employee->full_name])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $employee->full_name }} has submitted a resignation request.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $employee->employee_no }}@if($employee->hrDepartment) · {{ $employee->hrDepartment->name }}@endif —
        intended last day <strong>{{ $request->intended_last_day->format('j F Y') }}</strong>.
    </p>

    @if ($request->reason)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Reason given
                    </div>
                    <div style="font-size:13px; color:#0d0f14; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $request->reason }}</div>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:0; font-size:13px; line-height:1.6; color:#4b5262;">
        Nothing has changed on their record yet — approving this is what starts the clearance checklist. Open
        Offboarding in HR to decide.
    </p>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        This is an automatic notice. Replying to it does nothing.
    </p>
@endsection
