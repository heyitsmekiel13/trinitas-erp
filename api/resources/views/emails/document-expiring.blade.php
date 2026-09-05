{{-- Daily digest of 201 documents lapsing within 30 days, so a renewal is
     chased with weeks to spare instead of discovered the day it lapses. --}}
@extends('emails.layout', ['subject' => 'Employee documents expiring soon'])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ count($rows) }} {{ count($rows) === 1 ? 'document is' : 'documents are' }} expiring within 30 days
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        Renew these before the expiry date so the 201 file does not fall out of compliance.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4e7ec; border-radius:10px; overflow:hidden;">
        @foreach ($rows as $row)
            <tr>
                <td style="padding:12px 16px; {{ !$loop->last ? 'border-bottom:1px solid #eef1f4;' : '' }}">
                    <div style="font-size:13px; font-weight:600; color:#0d0f14;">{{ $row['employee'] }}</div>
                    <div style="font-size:12px; color:#79808e; margin-top:2px;">
                        {{ $row['document'] }} · expires {{ $row['expiry'] }}
                    </div>
                </td>
            </tr>
        @endforeach
    </table>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Open the 201 Files screen in HR to upload the renewed document.
    </p>
@endsection
