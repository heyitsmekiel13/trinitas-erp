{{-- Daily digest of new-hire checklist items past their due date — chased
     while the person is still new, not discovered at their first review. --}}
@extends('emails.layout', ['subject' => 'Onboarding tasks overdue'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ count($rows) }} onboarding {{ count($rows) === 1 ? 'task is' : 'tasks are' }} overdue
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        These new hires have checklist items past their due date.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e7ec; border-radius:10px; overflow:hidden;">
        @foreach ($rows as $row)
            <tr>
                <td style="padding:12px 16px; {{ !$loop->last ? 'border-bottom:1px solid #eef1f4;' : '' }}">
                    <div style="font-size:13px; font-weight:600; color:#0d0f14;">{{ $row['employee'] }}</div>
                    <div style="font-size:12px; color:#79808e; margin-top:2px;">
                        {{ $row['task'] }} · was due {{ $row['due'] }}
                    </div>
                </td>
            </tr>
        @endforeach
    </table>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Open their record in HR to mark the item done or check what is holding it up.
    </p>
@endsection
