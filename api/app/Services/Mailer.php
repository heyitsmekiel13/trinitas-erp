<?php

namespace App\Services;

use App\Models\EmailLog;
use App\Models\Task;
use App\Models\User;
use Illuminate\Mail\Mailer as LaravelMailer;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\View;
use Symfony\Component\Mailer\Transport\Dsn;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransportFactory;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Mime\Part\DataPart;
use Symfony\Component\Mime\Part\File;

/**
 * Outbound email, configured from the database rather than .env.
 *
 * Every send is written to `email_log` first and updated with the outcome, so
 * "did the approver actually get the notification?" is answerable from the
 * Admin screen rather than from server logs.
 *
 * A failure never propagates: an SMTP outage must not roll back an approval or
 * block a payroll release.
 */
class Mailer
{
    /** Total tries before a message is declared undeliverable. */
    private const MAX_ATTEMPTS = 4;

    /** Wait between tries, so a mail server that is down is not hammered. */
    private const RETRY_BACKOFF_MINUTES = 5;

    /** Pixel size the logo is cached at. Twice the 38px slot, for retina. */
    private const LOGO_PX = 96;

    /**
     * Templates a retry must never rebuild.
     *
     * Each one carries a single-use secret that is deliberately not stored: a
     * temporary password is only ever held hashed, and a reset code is retired
     * the moment it is issued. A replay could therefore only send a message
     * with the secret missing or — worse, if it were stored — revive a
     * credential the system had already put beyond use.
     *
     * These fail loudly instead, with an instruction, because the fix is a
     * human pressing "send again" and issuing a fresh one.
     */
    private const NEVER_REPLAY = [
        'emails.credentials' => 'Re-issue it from Admin → Users & Roles → Send sign-in details. The temporary password in the original was never stored, so it cannot be sent again.',
        /* The offer letter and the referral slip are generated for the message
           and never written to disk, so a retry would resend the covering note
           with the attachments silently missing — which is worse than not
           resending it, because it looks like it worked. */
        'emails.job-offer' => 'Send the offer again from Recruitment. The offer letter and referral slip are built when the message is sent, so a replay would arrive without them.',
        'emails.welcome-aboard' => 'Reset their sign-in from Admin → Users & Roles → Send sign-in details instead. The temporary password in the original was never stored, so it cannot be sent again.',
        'emails.password-reset' => 'Ask the person to request a new reset. The code in the original was single-use and has already been retired.',
        'emails.auth-code' => 'Ask the person to sign in again to get a fresh code. The original code was single-use.',
    ];

    public function __construct(private readonly Settings $settings) {}

    /**
     * @param  array<string, mixed>  $data
     * @param  list<array{filename: string, bytes: string, mime?: string}>  $attachments
     *                                                                                    Files to send with the message, in memory. Deliberately bytes rather
     *                                                                                    than paths: the documents that use this — an offer letter, a referral
     *                                                                                    slip — are generated for one message and have no business being
     *                                                                                    written to disk first, where they would then be somebody's job to
     *                                                                                    clean up and somebody else's to keep private.
     */
    public function send(
        string $to,
        string $subject,
        string $view,
        array $data = [],
        ?string $event = null,
        ?string $referenceType = null,
        ?int $referenceId = null,
        array $attachments = [],
    ): bool {
        $log = EmailLog::create([
            'to_address' => $to,
            'subject' => $subject,
            'template' => $view,
            'event' => $event,
            'reference_type' => $referenceType,
            'reference_id' => $referenceId,
            'status' => 'Queued',
        ]);

        try {
            $config = $this->settings->group('smtp');

            if (! ($config['enabled'] ?? false)) {
                $log->update(['status' => 'Failed', 'error' => 'SMTP is not enabled in Admin → Email settings.']);

                return false;
            }

            $mailer = $this->buildMailer($config);

            // Branding is merged in here rather than passed by each caller.
            // Three of them were already sending `companyName` and none was
            // sending the logo, which is exactly how the letterhead ends up
            // right on some emails and wrong on others.
            // The image part is built before the view renders, because the
            // template needs the content id Symfony assigns to it.
            $logo = $this->logoPart();

            $data += $this->branding($logo?->getContentId());

            $html = View::exists($view)
                ? View::make($view, $data)->render()
                : nl2br(e((string) ($data['body'] ?? $subject)));

            $mailer->html($html, function ($message) use ($to, $subject, $config, $logo, $attachments) {
                $message->to($to)
                    ->subject($subject)
                    ->from($config['from_address'], $config['from_name'] ?? 'Trinitas ERP');

                if (filled($config['reply_to'] ?? null)) {
                    $message->replyTo($config['reply_to']);
                }

                /*
                 * The logo travels with the message rather than being fetched
                 * from this server.
                 *
                 * A linked image cannot work here. Gmail does not load an
                 * `img src` from the recipient's browser — it fetches through
                 * its own proxy, server-side, so the address has to be
                 * reachable from the public internet. Pointed at APP_URL it
                 * resolved to Google's own localhost and drew a broken icon.
                 * Embedding sidesteps the question entirely: it works from a
                 * laptop, from staging, and from production, with no APP_URL
                 * to get wrong.
                 */
                if ($logo) {
                    $message->getSymfonyMessage()->addPart($logo);
                }

                foreach ($attachments as $file) {
                    $message->attachData(
                        $file['bytes'],
                        $file['filename'],
                        ['mime' => $file['mime'] ?? 'application/octet-stream'],
                    );
                }
            });

            $log->update(['status' => 'Sent', 'sent_at' => now(), 'attempts' => $log->attempts + 1, 'last_attempt_at' => now()]);

            return true;
        } catch (\Throwable $e) {
            return $this->recordFailure($log, $e, $to, $subject);
        }
    }

    /**
     * Decides whether a failed send is worth coming back to.
     *
     * The distinction is the whole point. A rejected address will be rejected
     * every time, and retrying it is noise; a name that would not resolve for
     * two seconds is a different thing entirely, and the message it lost was a
     * person's sign-in details. Failures were previously treated as one class,
     * so the second case looked exactly like the first and nothing ever tried
     * again.
     */
    private function recordFailure(EmailLog $log, \Throwable $e, string $to, string $subject): bool
    {
        $retryable = $this->looksTransient($e);
        $attempts = $log->attempts + 1;

        Log::error('Email send failed.', [
            'to' => $to,
            'subject' => $subject,
            'attempt' => $attempts,
            'retryable' => $retryable,
            'error' => $e->getMessage(),
        ]);

        $log->update([
            // `Retrying` keeps it out of the Failed list until the sweep has
            // actually given up — an administrator seeing Failed rows that are
            // fine stops reading the screen at all.
            'status' => $retryable && $attempts < self::MAX_ATTEMPTS ? 'Retrying' : 'Failed',
            'retryable' => $retryable,
            'attempts' => $attempts,
            'last_attempt_at' => now(),
            'error' => $this->explain($e),
        ]);

        return false;
    }

    /**
     * Whether the failure was the network rather than the message.
     *
     * Matched on the message because Symfony collapses connection problems
     * into one TransportException — the cause is only in the text. Deliberately
     * conservative: anything not recognised is treated as permanent, so a
     * genuinely bad message is never retried forever.
     */
    private function looksTransient(\Throwable $e): bool
    {
        $needles = [
            'getaddrinfo',              // DNS did not resolve
            'no such host',
            'connection could not be established',
            'connection refused',
            'connection timed out',
            'connection reset',
            'stream_socket_client',
            'temporarily unavailable',
            'network is unreachable',
            'ssl operation failed',
            'timed out',
            '421',                      // service not available, closing channel
            '450', '451', '452',        // mailbox busy / local error / no space
        ];

        $message = strtolower($e->getMessage());

        foreach ($needles as $needle) {
            if (str_contains($message, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The failure, in words an administrator can act on.
     *
     * The raw text is kept on the end because it is what a developer needs,
     * but a screen that only says `php_network_getaddresses: getaddrinfo for
     * smtp.gmail.com failed` tells the person reading it nothing about whether
     * they should change a setting or simply wait.
     */
    private function explain(\Throwable $e): string
    {
        $message = strtolower($e->getMessage());

        $plain = match (true) {
            str_contains($message, 'getaddrinfo'), str_contains($message, 'no such host') => 'Could not look up the mail server. This is usually the network or DNS rather than a wrong setting — it will be retried automatically.',
            str_contains($message, 'connection refused'), str_contains($message, 'connection could not be established') => 'Could not reach the mail server. Check the host and port, or the connection — it will be retried automatically.',
            str_contains($message, 'authentication'), str_contains($message, '535') => 'The mail server rejected the username or password. For Gmail this must be an app password, not the account password.',
            str_contains($message, 'timed out') => 'The mail server did not answer in time. It will be retried automatically.',
            str_contains($message, '550'), str_contains($message, '553') => 'The mail server rejected the recipient address.',
            default => 'The email could not be sent.',
        };

        return $plain.' ['.$e->getMessage().']';
    }

    /**
     * Re-sends everything still waiting.
     *
     * Called by `mail:retry` on a schedule. Only touches rows the failure
     * handler marked retryable, oldest first, and backs off between attempts
     * so a mail server that is down does not get hammered by a cron.
     *
     * The message body is not stored, so a retry re-renders it from the
     * template and the data that produced it. That is why `template` and the
     * reference columns matter — a log row without them cannot be replayed,
     * and is left alone rather than sent as an empty message.
     *
     * @return array{retried: int, sent: int, gaveUp: int}
     */
    public function retryFailed(int $limit = 50): array
    {
        $due = EmailLog::query()
            ->where('status', 'Retrying')
            ->where('retryable', true)
            ->where('attempts', '<', self::MAX_ATTEMPTS)
            ->where(function ($q) {
                $q->whereNull('last_attempt_at')
                    ->orWhere('last_attempt_at', '<', now()->subMinutes(self::RETRY_BACKOFF_MINUTES));
            })
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $sent = 0;
        $gaveUp = 0;

        foreach ($due as $row) {
            // Without a template there is nothing to re-render, and sending a
            // blank message is worse than leaving the row alone.
            if (! $row->template) {
                $row->update(['status' => 'Failed', 'error' => 'Cannot be resent: the original message was not built from a template.']);
                $gaveUp++;

                continue;
            }

            // Anything carrying a secret we no longer hold. Failing it with an
            // instruction is honest; sending it with a blank password field is
            // not, and would waste the recipient's time as well as ours.
            if (isset(self::NEVER_REPLAY[$row->template])) {
                $row->update([
                    'status' => 'Failed',
                    'retryable' => false,
                    'error' => 'Not resent automatically. '.self::NEVER_REPLAY[$row->template],
                ]);
                $gaveUp++;

                continue;
            }

            $ok = $this->send(
                to: $row->to_address,
                subject: $row->subject,
                view: $row->template,
                data: $this->replayData($row),
                event: $row->event,
                referenceType: $row->reference_type,
                referenceId: $row->reference_id,
            );

            // `send` writes a new row; the old one is closed out either way so
            // the queue cannot grow without bound.
            $row->update([
                'status' => $ok ? 'Sent' : ($row->attempts + 1 >= self::MAX_ATTEMPTS ? 'Failed' : 'Retrying'),
                'attempts' => $row->attempts + 1,
                'last_attempt_at' => now(),
                'sent_at' => $ok ? now() : null,
            ]);

            $ok ? $sent++ : ($row->attempts + 1 >= self::MAX_ATTEMPTS ? $gaveUp++ : null);
        }

        return ['retried' => $due->count(), 'sent' => $sent, 'gaveUp' => $gaveUp];
    }

    /**
     * Rebuilds the variables a template needs for a replay.
     *
     * Only the templates whose data can be reconstructed from the reference
     * columns are replayable. A password reset deliberately is not: its code
     * was single-use and re-sending the old one would either be useless or,
     * worse, revive a credential the original failure retired.
     *
     * @return array<string, mixed>
     */
    private function replayData(EmailLog $row): array
    {
        if ($row->reference_type === 'Task' && $row->reference_id) {
            $task = Task::with('project', 'assignee')->find($row->reference_id);

            if ($task) {
                return [
                    'user' => User::where('email', $row->to_address)->first(),
                    'task' => $task,
                    'project' => $task->project,
                    'kind' => str_replace('task.', '', (string) $row->event) ?: 'due',
                    'headline' => $row->subject,
                    'lead' => $task->title,
                    'streak' => $row->attempts + 1,
                    'taskUrl' => rtrim((string) config('app.url'), '/').'/tasks?task='.$task->id,
                ];
            }
        }

        // Falls back to a plain body, which the Mailer renders when the view
        // needs variables it has not been given.
        return ['body' => $row->subject, 'sentAt' => now()->toDayDateTimeString()];
    }

    /** Used by the "Send test email" button in Admin → Email settings. */
    public function test(string $to): array
    {
        $sent = $this->send(
            to: $to,
            subject: 'Trinitas ERP — test email',
            view: 'emails.test',
            data: ['sentAt' => now()->toDayDateTimeString()],
            event: 'smtp.test',
        );

        $log = EmailLog::where('event', 'smtp.test')->latest('id')->first();

        return ['sent' => $sent, 'error' => $log?->error];
    }

    /** Builds a mailer from the stored SMTP settings, bypassing config/mail. */
    private function buildMailer(array $config): LaravelMailer
    {
        $transport = $this->buildTransport($config);

        // `app('events')` rather than `event()`: the helper called with no
        // arguments dispatches an event instead of returning the dispatcher,
        // which threw before a single message was ever attempted.
        return new LaravelMailer('erp', view(), $transport, app('events'));
    }

    private function buildTransport(array $config): TransportInterface
    {
        if (app()->runningUnitTests()) {
            return new ArrayTransport;
        }

        $scheme = ($config['encryption'] ?? 'tls') === 'ssl' ? 'smtps' : 'smtp';

        $dsn = new Dsn(
            scheme: $scheme,
            host: (string) ($config['host'] ?? 'localhost'),
            user: $config['username'] ?? null,
            password: $this->settings->secret('smtp', 'password'),
            port: (int) ($config['port'] ?? 587),
        );

        return (new EsmtpTransportFactory)->create($dsn);
    }

    /**
     * The letterhead every template draws.
     *
     * `companyLogo` is an absolute URL because an email is read outside the
     * application: a relative path resolves against the mail client, not this
     * server, and lands nowhere. It is built from the `public` disk, which in
     * turn is built from APP_URL — so the logo only reaches an inbox once
     * APP_URL is the address the outside world uses, not http://localhost.
     *
     * `companyInitial` is the fallback the layout draws when no logo has been
     * uploaded. It was a hard-coded "T" before, which was wrong for every
     * company that is not called Trinitas — including this one, trading as
     * Premium Kitchen Equipment.
     *
     * @return array<string, mixed>
     */
    private function branding(?string $logoCid = null): array
    {
        $company = $this->settings->group('company');

        $name = $company['trade_name'] ?: ($company['legal_name'] ?: config('app.name'));
        $path = $company['logo_path'] ?? null;

        return [
            'companyName' => $name,
            // A content id, not a URL — see logoPart() for why.
            'companyLogo' => $logoCid ? 'cid:'.$logoCid : null,
            'companyInitial' => mb_strtoupper(mb_substr(trim((string) $name), 0, 1)) ?: 'T',
        ];
    }

    /**
     * The letterhead as an inline message part, or null when there is none.
     *
     * Built here rather than inside the send callback because the template has
     * to reference it by content id, and the HTML is rendered first. The id is
     * read back off the part instead of being chosen — Symfony generates its
     * own (`<hash@symfony>`), and an earlier attempt that assumed a fixed name
     * produced HTML pointing at a content id no part actually carried, which
     * looks exactly like the broken image it was meant to fix.
     */
    private function logoPart(): ?DataPart
    {
        $path = $this->embeddableLogo();

        if (! $path) {
            return null;
        }

        try {
            $part = new DataPart(new File($path), 'logo');

            // Inline, so a mail client renders it in place instead of listing
            // it as an attachment on the message.
            $part->asInline();

            return $part;
        } catch (\Throwable $e) {
            Log::warning('Could not attach the company logo to an email.', ['path' => $path, 'error' => $e->getMessage()]);

            return null;
        }
    }

    /**
     * The letterhead image, cached at a size worth attaching.
     *
     * The uploaded logo is whatever the company had to hand — the one on file
     * is a 1254x1254 PNG of 684KB, displayed in a 38 pixel box. Attaching that
     * to every reminder would put most of a megabyte on the wire per email and
     * sit in the recipient's mailbox for ever.
     *
     * So it is resized once and kept. The cache key includes the source file's
     * modification time, so replacing the logo in Admin regenerates it without
     * anybody having to know this cache exists.
     *
     * Returns null when there is nothing usable, and the layout falls back to
     * the company initial.
     */
    private function embeddableLogo(): ?string
    {
        $path = $this->settings->get('company', 'logo_path');

        if (! $path) {
            return null;
        }

        $source = storage_path('app/public/'.$path);

        if (! is_file($source)) {
            return null;
        }

        // An SVG cannot be resized by GD and is poorly supported in mail
        // clients anyway; sent as-is it is simply small, so pass it through.
        if (str_ends_with(strtolower($source), '.svg')) {
            return $source;
        }

        $cache = storage_path('app/mail-logo-'.substr(md5($path.filemtime($source)), 0, 12).'.png');

        if (is_file($cache)) {
            return $cache;
        }

        $resized = $this->resizeToPng($source, self::LOGO_PX);

        if (! $resized) {
            // Better to attach the original than to draw a broken icon.
            return $source;
        }

        // Clear older versions so a logo changed a dozen times does not leave
        // a dozen copies behind.
        foreach (glob(storage_path('app/mail-logo-*.png')) ?: [] as $stale) {
            if ($stale !== $cache) {
                @unlink($stale);
            }
        }

        file_put_contents($cache, $resized);

        return $cache;
    }

    /**
     * Square, transparent-safe PNG at the given size.
     *
     * Fitted rather than cropped — a wordmark cropped to a square loses the
     * word. The transparency handling matters because most logos are PNGs
     * with an alpha channel, and without it they arrive on a black square.
     */
    private function resizeToPng(string $source, int $size): ?string
    {
        if (! extension_loaded('gd')) {
            return null;
        }

        $info = @getimagesize($source);

        if (! $info) {
            return null;
        }

        $image = match ($info[2]) {
            IMAGETYPE_PNG => @imagecreatefrompng($source),
            IMAGETYPE_JPEG => @imagecreatefromjpeg($source),
            IMAGETYPE_GIF => @imagecreatefromgif($source),
            IMAGETYPE_WEBP => @imagecreatefromwebp($source),
            default => null,
        };

        if (! $image) {
            return null;
        }

        [$width, $height] = $info;
        $scale = min($size / max($width, 1), $size / max($height, 1));
        $targetW = max(1, (int) round($width * $scale));
        $targetH = max(1, (int) round($height * $scale));

        $canvas = imagecreatetruecolor($targetW, $targetH);
        imagealphablending($canvas, false);
        imagesavealpha($canvas, true);
        imagefill($canvas, 0, 0, imagecolorallocatealpha($canvas, 0, 0, 0, 127));

        imagecopyresampled($canvas, $image, 0, 0, 0, 0, $targetW, $targetH, $width, $height);

        ob_start();
        imagepng($canvas, null, 9);
        $bytes = ob_get_clean();

        imagedestroy($canvas);
        imagedestroy($image);

        return $bytes ?: null;
    }
}
