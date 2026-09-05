{{-- Daily digest to HR: probationary employees at the six-month mark who did
     NOT auto-regularise because of a recent poor review. A decision is
     needed — regularise anyway, extend, or end the contract — the command
     deliberately never decides this on its own. --}}
@extends('emails.layout', ['subject' => 'Regularisation decision needed'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ count($rows) }} probationary {{ count($rows) === 1 ? 'employee needs' : 'employees need' }} a
        regularisation decision
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        Each has passed six months on probation but has a recent review rated Unsatisfactory or Needs Improvement,
        so they were not automatically regularised. Decide: regularise anyway, extend probation, or end the
        contract.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e7ec; border-radius:10px; overflow:hidden;">
        @foreach ($rows as $row)
            <tr>
                <td style="padding:12px 16px; {{ !$loop->last ? 'border-bottom:1px solid #eef1f4;' : '' }}">
                    <div style="font-size:13px; font-weight:600; color:#0d0f14;">{{ $row['employee'] }}</div>
                    <div style="font-size:12px; color:#79808e; margin-top:2px;">
                        {{ $row['employeeNo'] }} · hired {{ $row['hired'] }} · rated {{ $row['rating'] }}
                    </div>
                </td>
            </tr>
        @endforeach
    </table>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Open the employee's record in HR to regularise them or start End of Contract offboarding.
    </p>
@endsection
