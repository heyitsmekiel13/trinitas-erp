{{-- Base layout for every transactional email. Inline styles only: mail
     clients strip <style> blocks and ignore external CSS. --}}
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $subject ?? config('app.name') }}</title>
</head>
<body style="margin:0; padding:0; background:#f5f6f8; font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif; color:#0d0f14;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8; padding:24px 12px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="max-width:560px; background:#ffffff; border-radius:14px; overflow:hidden; border:1px solid #e4e7ec;">

                    {{-- Brand bar. The gradient is the ERP's signature red. --}}
                    <tr>
                        <td style="background:linear-gradient(135deg,#ff5c68 0%,#e11d34 48%,#9d1024 100%); padding:20px 24px;">
                            <table role="presentation" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td style="padding-right:14px;">
                                        {{-- The real logo when one is set, and a lettermark when one is not.

                                             The image is referenced by absolute URL: a mail client cannot resolve a
                                             path against this server, so the src has to be the address the outside
                                             world uses. `alt` carries the company name for the clients that block
                                             remote images by default — which is most of them on first open.

                                             28px inside a 38px tile. The mark is a lockup — a symbol stacked over
                                             "TRINITAS FOOD CORPORATION" — so it carries its own internal margin
                                             already. At 34px it had two pixels of tile left on each side, which
                                             read as the logo bursting its container and crowding the wordmark
                                             beside it. Five pixels all round lets the tile read as a frame.

                                             No `height` attribute: a lockup is not square, and a fixed height
                                             squashes it in the clients that honour the attribute over the style.
                                             Width leads, `max-height` catches anything unusually tall. --}}
                                        @if (!empty($companyLogo))
                                            {{-- A one-cell table rather than a div: `valign` on a table cell is the
                                                 only vertical centring every mail client agrees on. The div it
                                                 replaces relied on line-height, which sits an inline image on the
                                                 text baseline — that left the mark four pixels high in its tile,
                                                 close enough to centred to look like a mistake rather than a
                                                 choice. --}}
                                            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                                                   style="width:38px; height:38px; border-radius:10px; background:#ffffff;">
                                                <tr>
                                                    <td align="center" valign="middle"
                                                        style="width:38px; height:38px; text-align:center; line-height:0;">
                                                        <img src="{{ $companyLogo }}" alt="{{ $companyName ?? 'Company' }}" width="28"
                                                             style="max-width:28px; max-height:28px; height:auto;
                                                                    border:0; outline:none; text-decoration:none; display:block;
                                                                    margin:0 auto;">
                                                    </td>
                                                </tr>
                                            </table>
                                        @else
                                            <div style="width:38px; height:38px; border-radius:10px; background:rgba(255,255,255,0.18);
                                                        color:#ffffff; font-size:17px; font-weight:700; text-align:center;
                                                        line-height:38px;">{{ $companyInitial ?? 'T' }}</div>
                                        @endif
                                    </td>
                                    <td>
                                        <div style="color:#ffffff; font-size:15px; font-weight:700; letter-spacing:-0.01em;">{{ $companyName ?? 'Trinitas ERP' }}</div>
                                        <div style="color:rgba(255,255,255,0.75); font-size:10px; letter-spacing:0.18em; margin-top:3px;">ERP SUITE</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:28px 24px;">
                            @yield('content')
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:16px 24px; background:#f8f9fb; border-top:1px solid #e4e7ec;">
                            <p style="margin:0; font-size:11px; line-height:1.6; color:#79808e;">
                                This message was sent automatically by {{ $companyName ?? 'Trinitas ERP' }}. Please do not reply.
                                If you were not expecting it, tell your system administrator.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
