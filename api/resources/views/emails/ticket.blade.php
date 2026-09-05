@extends('emails.layout', ['subject' => $headline])

@php
    $tone = match ($ticket->priority) {
        'Urgent' => ['#c2142b', '#fff1f2'],
        'High' => ['#eda100', '#fff8e8'],
        default => ['#2a78d6', '#eef5fd'],
    };
@endphp

@section('content')
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
            <td style="background:{{ $tone[1] }}; border-radius:999px; padding:5px 12px;">
                <span style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:{{ $tone[0] }};">
                    {{ $ticket->priority }} · {{ $ticket->category }}
                </span>
            </td>
        </tr>
    </table>

    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">{{ $headline }}</p>
    <p style="margin:0 0 20px; font-size:13px; line-height:1.6; color:#4b5262;">
        Hello {{ $user->name }} — {{ $lead }}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8f9fb; border:1px solid #e4e7ec; border-radius:12px;">
        <tr>
            <td style="padding:16px 18px;">
                <div style="font-family:ui-monospace,'Cascadia Mono',Menlo,monospace; font-size:11px; color:#79808e;">
                    {{ $ticket->reference }}
                </div>
                <div style="font-size:15px; font-weight:600; color:#0d0f14; margin-top:4px;">{{ $ticket->subject }}</div>

                @if (!empty($bodyText))
                    <div style="margin-top:12px; padding-top:12px; border-top:1px solid #e4e7ec;
                                font-size:13px; line-height:1.6; color:#4b5262; white-space:pre-wrap;">{{ $bodyText }}</div>
                @endif

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                    <tr>
                        <td width="50%">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Status</div>
                            <div style="font-size:13px; color:#0d0f14; margin-top:2px;">{{ $ticket->status }}</div>
                        </td>
                        <td width="50%">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Raised</div>
                            <div style="font-size:13px; color:#0d0f14; margin-top:2px;">{{ $ticket->created_at?->format('j M Y') }}</div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    @if (!empty($ctaUrl) && \Illuminate\Support\Str::startsWith($ctaUrl, ['http://', 'https://']))
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
            <tr>
                <td style="background:linear-gradient(135deg,#ff5c68 0%,#e11d34 48%,#9d1024 100%); border-radius:10px;">
                    <a href="{{ $ctaUrl }}"
                       style="display:inline-block; padding:11px 22px; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none;">
                        {{ $ctaLabel ?? 'Open the ticket' }}
                    </a>
                </td>
            </tr>
        </table>
    @endif

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Replying to this email does nothing — answer on the ticket so the whole conversation stays in one place.
    </p>
@endsection
