<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuthCode;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CredentialDelivery;
use App\Services\Mailer;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Getting people their credentials, and getting them back in when they lose them.
 *
 * Two audiences, and the difference matters:
 *
 *   - An administrator sending sign-in details out. Authenticated, audited, and
 *     free to say exactly what happened to each account.
 *   - A person who has forgotten their password. Unauthenticated, so the
 *     response must never reveal whether a username exists — the reply is the
 *     same either way, and only the mailbox tells the truth.
 */
class CredentialController extends Controller
{
    private const RESET_TTL_MINUTES = 15;

    private const RESET_MAX_ATTEMPTS = 5;

    public function __construct(
        private readonly CredentialDelivery $credentials,
        private readonly Mailer $mailer,
        private readonly Settings $settings,
        private readonly AuditLogger $audit,
    ) {}

    /* ====================================================================== */
    /* Administrator: issue and send */
    /* ====================================================================== */

    /** Sends one person their sign-in details. */
    public function send(Request $request, User $user): JsonResponse
    {
        $result = $this->credentials->send($user, $request->user()?->name);

        return response()->json(['data' => $result + ['id' => $user->id]]);
    }

    /**
     * Sends several at once.
     *
     * Accepts explicit ids, or `scope: with-email` to reach everyone who can
     * actually be reached. The super-admin bootstrap account is never included
     * by scope — resetting the only account that can fix a broken install, from
     * a bulk button, is how somebody locks themselves out of their own system.
     */
    public function sendMany(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['array'],
            'ids.*' => ['integer', 'exists:users,id'],
            'scope' => ['nullable', 'in:with-email,never-signed-in'],
        ]);

        $query = User::query()->where('status', 'Active');

        if (! empty($data['ids'])) {
            $query->whereIn('id', $data['ids']);
        } elseif (($data['scope'] ?? null) === 'never-signed-in') {
            $query->whereNull('last_login_at')->where('is_super_admin', false);
            self::reachable($query);
        } elseif (($data['scope'] ?? null) === 'with-email') {
            $query->where('is_super_admin', false);
            self::reachable($query);
        } else {
            return response()->json([
                'message' => 'Choose the accounts to send to, or a scope.',
                'errors' => ['ids' => ['Nothing was selected.']],
            ], 422);
        }

        $users = $query->orderBy('name')->get();

        if ($users->isEmpty()) {
            return response()->json(['data' => ['sent' => 0, 'failed' => 0, 'skipped' => 0, 'results' => []]]);
        }

        $summary = $this->credentials->sendMany($users, $request->user()?->name);

        $this->audit->log(
            "emailed sign-in details to {$summary['sent']} of {$users->count()} accounts",
            'User',
            null,
            null,
            'admin',
        );

        return response()->json(['data' => $summary]);
    }

    /**
     * An account that can actually be emailed.
     *
     * One definition, used by both the count and the send. When they drifted
     * apart — the count excluding blank addresses and the send not — the button
     * promised one number and attempted a different set.
     */
    private static function reachable($query)
    {
        return $query->whereNotNull('email')->where('email', '!=', '');
    }

    /** Who a bulk send would actually reach, so the button can say so. */
    public function reach(): JsonResponse
    {
        $active = User::where('status', 'Active')->where('is_super_admin', false);

        return response()->json([
            'data' => [
                'active' => (clone $active)->count(),
                'withEmail' => self::reachable((clone $active))->count(),
                'withoutEmail' => (clone $active)->where(fn ($q) => $q->whereNull('email')->orWhere('email', ''))->count(),
                'neverSignedIn' => self::reachable((clone $active)->whereNull('last_login_at'))->count(),
                'mustChange' => (clone $active)->where('must_change_password', true)->count(),
            ],
        ]);
    }

    /* ====================================================================== */
    /* Anyone: forgotten password */
    /* ====================================================================== */

    /**
     * Starts a reset.
     *
     * Always answers the same way. Whether the account exists, has an email, or
     * is locked is not something an unauthenticated caller gets to learn — that
     * is a username oracle, and it is worth more to an attacker than the reset
     * itself.
     */
    public function forgot(Request $request): JsonResponse
    {
        $data = $request->validate(['username' => ['required', 'string', 'max:190']]);

        $reply = response()->json([
            'data' => [
                'sent' => true,
                'message' => 'If that account exists and has an email address, a reset code is on its way.',
                'ttlMinutes' => self::RESET_TTL_MINUTES,
            ],
        ]);

        $user = User::query()
            ->where('username', $data['username'])
            ->orWhere('email', $data['username'])
            ->first();

        if (! $user || $user->status !== 'Active' || ! filter_var((string) $user->email, FILTER_VALIDATE_EMAIL)) {
            return $reply;
        }

        // One live code per account: issuing a second invalidates the first, so
        // a resent email is always the one that works.
        AuthCode::where('user_id', $user->id)
            ->whereNull('consumed_at')
            ->update(['consumed_at' => now()]);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $challengeId = (string) Str::uuid();

        AuthCode::create([
            'user_id' => $user->id,
            'challenge_id' => $challengeId,
            'code_hash' => Hash::make($code),
            'attempts' => 0,
            'ip_address' => $request->ip(),
            'expires_at' => now()->addMinutes(self::RESET_TTL_MINUTES),
        ]);

        $company = $this->settings->group('company');

        $this->mailer->send(
            $user->email,
            'Reset your password',
            'emails.password-reset',
            [
                'user' => $user,
                'code' => $code,
                'minutes' => self::RESET_TTL_MINUTES,
                'companyName' => $company['trade_name'] ?? config('app.name'),
            ],
            'password.reset-requested',
            'User',
            $user->id,
        );

        $this->audit->log('requested a password reset', 'User', $user->id, $user->name, 'auth');

        return $reply;
    }

    /**
     * Checks a code without spending it.
     *
     * Splits "is this code even right" from "choose a password" into two
     * separate steps, so the reset screen can reveal the password fields
     * only once the code is confirmed — asking for a new password before
     * saying whether the code was valid makes someone fill in a form twice
     * for one mistake. A wrong guess here still counts against the code's
     * attempt limit, same as a wrong guess on the final submit would.
     */
    public function verifyResetCode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:190'],
            'code' => ['required', 'string', 'size:6'],
        ]);

        $result = $this->matchResetCode($data['username'], $data['code']);

        if ($result instanceof JsonResponse) {
            return $result;
        }

        return response()->json(['data' => ['valid' => true]]);
    }

    /**
     * Finishes a reset.
     *
     * The code is matched against the account rather than a challenge id alone,
     * so a code issued for one person cannot be replayed against another. Re-
     * checks the code rather than trusting `verifyResetCode` was called first —
     * the code is what actually authorises this, not the client's say-so that
     * it saw a green checkmark earlier.
     */
    public function reset(Request $request): JsonResponse
    {
        $data = $request->validate([
            'username' => ['required', 'string', 'max:190'],
            'code' => ['required', 'string', 'size:6'],
            // No upper bound — a longer password is never worse, and
            // capping it teaches people to pick a shorter, weaker one. The
            // floor itself is configurable in Settings → Security.
            'password' => ['required', 'string', 'min:'.$this->settings->get('security', 'min_password_length', 4), 'confirmed'],
        ]);

        $result = $this->matchResetCode($data['username'], $data['code']);

        if ($result instanceof JsonResponse) {
            return $result;
        }

        $entry = $result;
        $user = $entry->user;

        $entry->update(['consumed_at' => now()]);

        $user->forceFill([
            'password' => Hash::make($data['password']),
            // They chose it themselves, so there is nothing to force.
            'must_change_password' => false,
            'password_changed_at' => now(),
            'failed_attempts' => 0,
            'locked_until' => null,
        ])->save();

        // Every existing session dies with the old password — a reset is what
        // somebody does when they think an account is compromised.
        $user->tokens()->delete();

        $this->audit->log('reset their password', 'User', $user->id, $user->name, 'auth');

        return response()->json([
            'data' => ['reset' => true, 'message' => 'Password changed. Sign in with the new one.'],
        ]);
    }

    /**
     * The lookup both `verifyResetCode` and `reset` need: the live, unexpired
     * code for the account the username resolves to, matched against what
     * was typed. Returns the matching row, or the exact error response the
     * caller should hand straight back — a wrong code and an unknown account
     * read identically on purpose (see this controller's own docblock).
     */
    private function matchResetCode(string $username, string $code): AuthCode|JsonResponse
    {
        $user = User::query()
            ->where('username', $username)
            ->orWhere('email', $username)
            ->first();

        $invalid = response()->json([
            'message' => 'That code is not valid or has expired.',
            'errors' => ['code' => ['That code is not valid or has expired.']],
        ], 422);

        if (! $user) {
            return $invalid;
        }

        $entry = AuthCode::where('user_id', $user->id)
            ->whereNull('consumed_at')
            ->where('expires_at', '>', now())
            ->latest('id')
            ->first();

        if (! $entry) {
            return $invalid;
        }

        if ($entry->attempts >= self::RESET_MAX_ATTEMPTS) {
            $entry->update(['consumed_at' => now()]);

            return response()->json([
                'message' => 'Too many attempts on that code. Ask for a new one.',
                'errors' => ['code' => ['Too many attempts on that code. Ask for a new one.']],
            ], 429);
        }

        if (! Hash::check($code, $entry->code_hash)) {
            $entry->increment('attempts');

            return $invalid;
        }

        return $entry;
    }
}
