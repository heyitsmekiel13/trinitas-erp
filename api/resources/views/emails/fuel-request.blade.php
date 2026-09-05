{{-- The decision on a fuel request.

     Written so the driver can act on it from the phone without opening the
     ERP: the litres authorised, the route, and who signed for it are all in
     the body rather than behind a link. --}}
@extends('emails.layout', ['subject' => $request->reference . ' ' . strtolower($request->status)])

@php
    $approved = $request->status === 'Approved';
    $tone = $approved ? ['#137a4d', '#e8f6ef'] : ['#c2142b', '#fff1f2'];
    $litres = $approved ? (float) ($request->approved_litres ?? $request->suggested_litres) : 0.0;
    $trimmed = $approved && $litres + 0.01 < (float) $request->suggested_litres;
    $eta = $request->eta;
@endphp

@section('content')
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
            <td style="background:{{ $tone[1] }}; border-radius:999px; padding:5px 12px;">
                <span style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:{{ $tone[0] }};">
                    {{ $request->status }} · {{ $request->reference }}
                </span>
            </td>
        </tr>
    </table>

    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">
        {{ $approved ? 'Your fuel request has been approved.' : 'Your fuel request was not approved.' }}
    </p>

    <p style="margin:0 0 16px; font-size:13px; line-height:1.6; color:#4b5262;">
        {{ $request->purpose }} — {{ $request->vehicle?->plate_no ?? 'no vehicle' }}@if ($request->driver), driven by {{ $request->driver->full_name }}@endif.
    </p>

    @if ($approved)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border:1px solid #e4e7ec; border-radius:10px;">
            <tr>
                <td style="padding:16px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Fuel authorised
                    </div>
                    <div style="font-size:26px; font-weight:700; color:#0d0f14; margin-top:2px;">
                        {{ number_format($litres, 2) }} litres
                    </div>
                    @if ($trimmed)
                        {{-- Said plainly. A driver who leaves expecting the figure they
                             asked for and finds less in the tank is a breakdown waiting
                             to be blamed on the approver. --}}
                        <div style="font-size:12px; color:#a86b00; margin-top:6px;">
                            This is less than the {{ number_format((float) $request->suggested_litres, 2) }} litres
                            requested. Plan the trip on the approved figure.
                        </div>
                    @endif
                </td>
            </tr>
        </table>
    @endif

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin:0 0 16px; border:1px solid #e4e7ec; border-radius:10px;">
        <tr>
            <td style="padding:14px 18px; border-bottom:1px solid #eef1f4;">
                <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">Route</div>
                <div style="font-size:13px; color:#0d0f14; margin-top:4px; line-height:1.6;">
                    {{ $request->origin_label }}<br>
                    <span style="color:#79808e;">↓ {{ $request->round_trip ? 'return trip' : 'one way' }}</span><br>
                    {{ $request->destination_label }}
                </div>
            </td>
        </tr>
        <tr>
            <td style="padding:14px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                        <td width="33%" style="vertical-align:top;">
                            <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">Distance</div>
                            <div style="font-size:14px; font-weight:600; color:#0d0f14; margin-top:2px;">
                                {{ number_format((float) $request->distance_km, 1) }} km
                            </div>
                        </td>
                        <td width="33%" style="vertical-align:top;">
                            <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">Travel time</div>
                            <div style="font-size:14px; font-weight:600; color:#0d0f14; margin-top:2px;">
                                {{ intdiv($request->duration_minutes, 60) }}h {{ $request->duration_minutes % 60 }}m
                            </div>
                        </td>
                        <td width="33%" style="vertical-align:top;">
                            <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                                {{ $request->depart_at ? 'Arrives' : 'Departs' }}
                            </div>
                            <div style="font-size:14px; font-weight:600; color:#0d0f14; margin-top:2px;">
                                {{ $eta?->format('j M, g:i A') ?? 'not set' }}
                            </div>
                        </td>
                    </tr>
                </table>

                @if ($request->route_source === 'straight-line')
                    <div style="font-size:12px; color:#a86b00; margin-top:10px; line-height:1.5;">
                        No routing service was reachable when this was raised, so the distance is the direct line
                        padded for roads rather than a real route. Treat the litres as a guide.
                    </div>
                @endif
            </td>
        </tr>
    </table>

    @if ($request->decision_note)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:0 0 16px; background:#f7f9fb; border-radius:10px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                        Note from the approver
                    </div>
                    <div style="font-size:13px; color:#4b5262; margin-top:4px; line-height:1.6; white-space:pre-wrap;">{{ $request->decision_note }}</div>
                </td>
            </tr>
        </table>
    @endif

    {{-- The signature block. Who decided, in what capacity, and when — the
         three things anybody querying this later actually asks for. --}}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e7ec;">
        <tr>
            <td style="padding:14px 0 0;">
                <div style="font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#79808e;">
                    {{ $approved ? 'Approved by' : 'Declined by' }}
                </div>
                <div style="font-size:14px; font-weight:600; color:#0d0f14; margin-top:3px;">
                    {{ $request->approvedBy?->name ?? 'Unknown' }}
                </div>
                <div style="font-size:12px; color:#79808e; margin-top:1px;">
                    {{ $request->approved_by_role }}@if ($request->decided_at) · {{ $request->decided_at->format('j M Y, g:i A') }}@endif
                </div>
            </td>
        </tr>
    </table>

    <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
        Replying to this email does nothing. Query it with {{ $request->approvedBy?->name ?? 'the approver' }},
        quoting {{ $request->reference }}.
    </p>
@endsection
