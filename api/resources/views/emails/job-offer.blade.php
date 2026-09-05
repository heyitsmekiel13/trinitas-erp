@extends('emails.layout', ['subject' => $subject])

@section('content')
    <p style="margin:0 0 6px; font-size:16px; font-weight:600;">Congratulations, {{ $firstName }}</p>
    <p style="margin:0 0 18px; font-size:13px; line-height:1.6; color:#4b5262;">
        We are pleased to inform you that you have been selected for the
        <strong style="color:#0d0f14;">{{ $position }}</strong> position at {{ $companyName }}.
    </p>

    {{-- The attachments, named. Somebody who opens this on a phone sees two
         file chips at the bottom and no idea which is which; saying it here is
         the difference between the referral slip being brought to the clinic
         and being missed. --}}
    <p style="margin:0 0 6px; font-size:13px; line-height:1.6; color:#4b5262;">
        Attached to this email are the following documents:
    </p>
    <ul style="margin:0 0 18px; padding-left:20px; font-size:13px; line-height:1.7; color:#4b5262;">
        <li>Your Employment Offer Letter</li>
        <li>Your Referral Slip</li>
    </ul>

    {{-- The terms, boxed. This is the part somebody screenshots and shows to
         their family, and the part they will quote back on their first day, so
         it is set apart from the prose rather than buried in it. --}}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8f9fb; border:1px solid #e4e7ec; border-radius:12px;">
        <tr>
            <td style="padding:16px 18px;">
                <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Position</div>
                <div style="font-size:17px; font-weight:700; color:#0d0f14; margin-top:3px;">{{ $position }}</div>
                @if ($department || $branch)
                    <div style="font-size:12px; color:#4b5262; margin-top:2px;">
                        {{ collect([$department, $branch])->filter()->implode(' · ') }}
                    </div>
                @endif
            </td>
        </tr>

        @if ($salary || $dailyRate)
            <tr>
                <td style="padding:0 18px 14px;">
                    <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Compensation</div>
                    @if ($dailyRate)
                        <div style="font-size:15px; font-weight:700; color:#0d0f14; margin-top:3px;">{{ $dailyRate }} basic daily rate</div>
                        @if ($deMinimis)
                            <div style="font-size:13px; color:#4b5262; margin-top:1px;">plus {{ $deMinimis }} daily de minimis</div>
                        @endif
                    @endif
                    @if ($salary)
                        <div style="font-size:{{ $dailyRate ? 13 : 17 }}px; font-weight:{{ $dailyRate ? 400 : 700 }}; color:{{ $dailyRate ? '#4b5262' : '#0d0f14' }}; margin-top:2px;">
                            {{ $salary }} a month
                        </div>
                    @endif
                    <div style="font-size:11px; color:#79808e; margin-top:3px;">
                        The full terms are in the attached offer letter.
                    </div>
                </td>
            </tr>
        @endif

        @if ($startDate)
            <tr>
                <td style="padding:0 18px 16px;">
                    <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Start date</div>
                    <div style="font-size:15px; font-weight:600; color:#0d0f14; margin-top:3px;">{{ $startDate }}</div>
                </td>
            </tr>
        @endif
    </table>

    {{-- The clinic instruction, in the words a candidate needs on the day. --}}
    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        Please present the referral slip to the staff on arrival and inform them that you are there for your
        pre-employment requirements. Kindly note that there is a fee for this examination, which you will need to
        settle during your visit.
    </p>

    <p style="margin:12px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        The complete list of pre-employment requirements is in the attached offer letter. Please prepare and
        complete all of them, and submit them on the day of your New Hire Orientation.
    </p>

    @if ($orientationDate)
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="margin:18px 0 0; background:#fff7f8; border:1px solid #f3d3d7; border-radius:12px;">
            <tr>
                <td style="padding:14px 18px;">
                    <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#9d1024;">New Hire Orientation</div>
                    <div style="font-size:14px; font-weight:700; color:#0d0f14; margin-top:4px;">{{ $orientationDate }}</div>
                    @if ($orientationTime)
                        <div style="font-size:13px; color:#4b5262; margin-top:1px;">{{ $orientationTime }}</div>
                    @endif
                    @if ($orientationVenue)
                        <div style="font-size:13px; color:#4b5262; margin-top:4px;">{{ $orientationVenue }}</div>
                    @endif
                </td>
            </tr>
        </table>
    @endif

    {{-- Replying is the whole point of the message, so the two answers are the
         most prominent thing after the terms. The links carry the reference
         and the email as a pair, which is the same credential the status page
         asks for — no account, and no token that works on its own. --}}
    @if ($acceptUrl)
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0;">
            <tr>
                <td style="background:linear-gradient(135deg,#ff5c68 0%,#e11d34 48%,#9d1024 100%); border-radius:10px;">
                    <a href="{{ $acceptUrl }}"
                       style="display:inline-block; padding:11px 22px; color:#ffffff; font-size:14px;
                              font-weight:600; text-decoration:none;">Accept the offer</a>
                </td>
                <td style="padding-left:10px;">
                    <a href="{{ $declineUrl }}"
                       style="display:inline-block; padding:11px 18px; color:#4b5262; font-size:14px;
                              font-weight:600; text-decoration:none; border:1px solid #e4e7ec; border-radius:10px;">Decline</a>
                </td>
            </tr>
        </table>
    @endif

    @if ($expiresOn)
        <p style="margin:16px 0 0; font-size:12px; line-height:1.6; color:#9d1024;">
            Please let us know by <strong>{{ $expiresOn }}</strong>.
        </p>
    @endif

    <p style="margin:18px 0 0; font-size:13px; line-height:1.6; color:#4b5262;">
        We look forward to officially welcoming you to the team. If you have any questions, simply reply to this
        email — a question is not a decline.
    </p>

    <p style="margin:14px 0 0; font-size:12px; line-height:1.6; color:#79808e;">
        Your reference is <strong style="color:#4b5262;">{{ $reference }}</strong>.
    </p>

    {{-- The confidentiality notice a recruitment email carries. Small, at the
         bottom, and not competing with the offer itself. --}}
    <p style="margin:20px 0 0; padding-top:14px; border-top:1px solid #e4e7ec;
              font-size:10px; line-height:1.6; color:#9aa0aa;">
        This email may contain confidential or privileged information and is intended only for the named
        recipient. Any unauthorised use, disclosure, distribution or copying is prohibited. If you have received
        it in error, please tell us and delete it.
    </p>
@endsection
