{{-- To HR and Finance the moment a wage order is applied — who was raised
     to the new floor, and from what. --}}
@extends('emails.layout', ['subject' => 'Wage order applied — ' . count($rows) . ' employee(s) adjusted'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $order->label }} has been applied.
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        New daily rate <strong>₱{{ number_format((float) $order->daily_rate, 2) }}</strong>, effective
        {{ $order->effective_date->format('j F Y') }}. {{ count($rows) }} employee(s) below that rate were raised to
        it.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e7ec; border-radius:10px; overflow:hidden;">
        @foreach ($rows as $row)
            <tr>
                <td style="padding:12px 16px; {{ !$loop->last ? 'border-bottom:1px solid #eef1f4;' : '' }}">
                    <div style="font-size:13px; font-weight:600; color:#0d0f14;">{{ $row['employee'] }}</div>
                    <div style="font-size:12px; color:#79808e; margin-top:2px;">
                        {{ $row['employeeNo'] }} · ₱{{ number_format($row['oldDailyRate'], 2) }} →
                        ₱{{ number_format($row['newDailyRate'], 2) }} per day
                    </div>
                </td>
            </tr>
        @endforeach
    </table>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Payroll will reflect the new rate from the next cut-off. This is an automatic notice.
    </p>
@endsection
