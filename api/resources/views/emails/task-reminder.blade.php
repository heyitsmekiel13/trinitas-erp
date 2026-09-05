@extends('emails.layout', ['subject' => $headline])

@php
    // Tone follows the kind, so the colour says how late it is before the
    // words do. Escalations borrow the overdue red on purpose.
    $tone = match ($kind) {
        'ahead' => ['#eda100', '#fff8e8', 'Coming up'],
        'due' => ['#e11d34', '#fff1f2', 'Due today'],
        'overdue' => ['#c2142b', '#fff1f2', 'Overdue'],
        'escalation' => ['#9d1024', '#fff1f2', 'Escalation'],
        'mentioned' => ['#2a78d6', '#eef5fd', 'Mentioned'],
        default => ['#1baf7a', '#edfaf4', 'Assigned'],
    };
@endphp

@section('content')
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
            <td style="background:{{ $tone[1] }}; border-radius:999px; padding:5px 12px;">
                <span style="font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:{{ $tone[0] }};">
                    {{ $tone[2] }}
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
                    {{ $task->reference }}
                </div>
                <div style="font-size:15px; font-weight:600; color:#0d0f14; margin-top:4px;">{{ $task->title }}</div>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                    <tr>
                        <td width="50%" style="padding-bottom:10px;">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Project</div>
                            <div style="font-size:13px; color:#0d0f14; margin-top:2px;">{{ $project?->name ?? '—' }}</div>
                        </td>
                        <td width="50%" style="padding-bottom:10px;">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Due</div>
                            <div style="font-size:13px; font-weight:600; color:{{ $tone[0] }}; margin-top:2px;">
                                {{ $task->due_date?->format('j M Y') ?? 'No date set' }}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td width="50%">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Priority</div>
                            <div style="font-size:13px; color:#0d0f14; margin-top:2px;">{{ $task->priority }}</div>
                        </td>
                        <td width="50%">
                            <div style="font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:#79808e;">Assigned to</div>
                            <div style="font-size:13px; color:#0d0f14; margin-top:2px;">{{ $task->assignee?->name ?? 'Nobody' }}</div>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    @if ($taskUrl && \Illuminate\Support\Str::startsWith($taskUrl, ['http://', 'https://']))
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;">
            <tr>
                <td style="background:linear-gradient(135deg,#ff5c68 0%,#e11d34 48%,#9d1024 100%); border-radius:10px;">
                    <a href="{{ $taskUrl }}"
                       style="display:inline-block; padding:11px 22px; font-size:13px; font-weight:600; color:#ffffff; text-decoration:none;">
                        Open the task
                    </a>
                </td>
            </tr>
        </table>
    @endif

    {{-- Says plainly that this repeats, and why it will stop. A reminder that
         does not explain itself gets filtered after the second one. --}}
    @if (in_array($kind, ['ahead', 'due', 'overdue', 'escalation'], true))
        <p style="margin:20px 0 0; font-size:11px; line-height:1.6; color:#79808e;">
            @if ($streak > 1)
                This is reminder {{ $streak }} for this task.
            @endif
            Reminders continue until the task is marked complete.
        </p>
    @endif
@endsection
