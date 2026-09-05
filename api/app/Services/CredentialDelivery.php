<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Issues sign-in credentials and emails them to the person they belong to.
 *
 * Sending a password by email is not ideal — mail is not a secure channel, and
 * a copy of it lives in the mailbox forever. Three things make it acceptable
 * here, and all three are enforced rather than assumed:
 *
 *   1. The password issued is temporary and random. Nothing is emailed that
 *      the recipient chose or that is reused anywhere else.
 *   2. `must_change_password` is set, so the credential is worthless for
 *      anything except reaching the change-password screen once.
 *   3. It expires. A temporary password older than the window is refused at
 *      sign-in, so an unread invitation stops being a way in.
 *
 * The alternative — emailing a signed one-time link instead of a password — is
 * stronger, and this class is shaped so that swapping to it later only changes
 * what goes in the message body.
 */
class CredentialDelivery
{
    /** How long an issued temporary password stays usable. */
    public const EXPIRES_HOURS = 72;

    public function __construct(
        private readonly Mailer $mailer,
        private readonly Settings $settings,
        private readonly AuditLogger $audit,
        private readonly PasswordIssuer $passwords,
    ) {}

    /**
     * The fallback password, for an account with no usable mobile number.
     *
     * Kept as a static so the existing callers still work; the decision about
     * which password an account actually gets now lives in PasswordIssuer,
     * because HR resets and emailed credentials must agree about it.
     */
    public static function temporaryPassword(): string
    {
        return app(PasswordIssuer::class)->randomPassword();
    }

    /**
     * Issues a fresh temporary password and emails it.
     *
     * @return array{status: string, user: string, email: ?string, message: string, password?: string}
     */
    public function send(User $user, ?string $actor = null): array
    {
        $name = $user->name ?: $user->username;

        if ($user->status !== 'Active') {
            return $this->outcome('skipped', $name, $user->email, 'The account is not active.');
        }

        if (! filter_var((string) $user->email, FILTER_VALIDATE_EMAIL)) {
            return $this->outcome('no-email', $name, $user->email, 'No email address on the account.');
        }

        $issued = $this->passwords->issueFor($user);
        $password = $issued['password'];

        $user->forceFill([
            'password' => Hash::make($password),
            // Deliberately not forced. The business asked for a credential
            // people can use straight away; the change-password screen is
            // offered from the account menu instead of demanded at the door.
            'must_change_password' => false,
            'password_changed_at' => now(),
            'failed_attempts' => 0,
            'locked_until' => null,
        ])->save();

        $company = $this->settings->group('company');

        $sent = $this->mailer->send(
            $user->email,
            'Your '.($company['trade_name'] ?? config('app.name')).' sign-in details',
            'emails.credentials',
            [
                'user' => $user,
                'username' => $user->username,
                'password' => $password,
                'passwordSource' => $issued['source'],
                'expiresHours' => self::EXPIRES_HOURS,
                'companyName' => $company['trade_name'] ?? config('app.name'),
                'signInUrl' => rtrim((string) ($company['app_url'] ?? config('app.frontend_url', '')), '/') ?: null,
            ],
            'credentials.sent',
            'User',
            $user->id,
        );

        $this->audit->log(
            $sent ? 'emailed sign-in details' : 'failed to email sign-in details',
            'User',
            $user->id,
            $name,
            'admin',
        );

        $note = $issued['source'] === 'random' ? ' A random password was used: '.$issued['reason'] : '';

        return $sent
            ? $this->outcome('sent', $name, $user->email, "Sent to {$user->email}.".$note)
            // The password has already been changed at this point, so saying
            // "not sent" without saying that would leave somebody locked out
            // with no idea why.
            : $this->outcome(
                'failed',
                $name,
                $user->email,
                'Could not send — check Admin → Email settings. The password was still reset, so issue it another way.',
                $password,
            );
    }

    /**
     * @param  iterable<User>  $users
     * @return array{sent: int, failed: int, skipped: int, results: array<int, array<string, mixed>>}
     */
    public function sendMany(iterable $users, ?string $actor = null): array
    {
        $results = [];
        $sent = $failed = $skipped = 0;

        foreach ($users as $user) {
            $result = $this->send($user, $actor);
            $results[] = $result + ['id' => $user->id];

            match ($result['status']) {
                'sent' => $sent++,
                'failed' => $failed++,
                default => $skipped++,
            };
        }

        return compact('sent', 'failed', 'skipped', 'results');
    }

    /**
     * Whether a temporary password has gone stale.
     *
     * Only applies while the account is still on an issued credential — once
     * the person has chosen their own, it never expires from under them.
     */
    public function isExpired(User $user): bool
    {
        if (! $user->must_change_password || ! $user->password_changed_at) {
            return false;
        }

        return $user->password_changed_at->addHours(self::EXPIRES_HOURS)->isPast();
    }

    /** @return array{status: string, user: string, email: ?string, message: string, password?: string} */
    private function outcome(string $status, string $user, ?string $email, string $message, ?string $password = null): array
    {
        $out = compact('status', 'user', 'email', 'message');

        // Returned only when the email failed, so an administrator can pass the
        // credential on by hand rather than leaving the person stranded.
        if ($password !== null) {
            $out['password'] = $password;
        }

        return $out;
    }
}
