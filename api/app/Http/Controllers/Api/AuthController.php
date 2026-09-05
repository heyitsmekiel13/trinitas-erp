<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\WarmDashboardCaches;
use App\Models\AuthCode;
use App\Models\LoginAttempt;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\CredentialDelivery;
use App\Services\GeoGuard;
use App\Services\LoginWindowGuard;
use App\Services\Mailer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Sign-in, the emailed auth code, and session teardown.
 *
 * The response shapes match the React auth store one-for-one:
 *   { status: 'ok', user, token }
 *   { status: 'code-required', challengeId }
 *   { status: 'error', message }
 */
class AuthController extends Controller
{
    /** Consecutive failures before the account is temporarily locked. */
    private const MAX_ATTEMPTS = 5;

    private const LOCKOUT_MINUTES = 15;

    private const CODE_TTL_MINUTES = 10;

    private const CODE_MAX_ATTEMPTS = 5;

    public function __construct(
        private readonly GeoGuard $geoGuard,
        private readonly LoginWindowGuard $loginWindow,
        private readonly Mailer $mailer,
        private readonly AuditLogger $audit,
        private readonly CredentialDelivery $credentials,
    ) {}

    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'username' => ['required', 'string', 'max:120'],
            'password' => ['required', 'string'],
        ]);

        // Geography is checked before credentials so a blocked country never
        // gets to probe which usernames exist.
        if (! $this->geoGuard->allows($request->ip())) {
            $this->record($request, $credentials['username'], null, false, 'Blocked by Geo-IP policy');

            return $this->error('Access from your location is not permitted. Contact your administrator.', 403);
        }

        $user = User::query()
            ->where('username', $credentials['username'])
            ->orWhere('email', $credentials['username'])
            ->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            if ($user) {
                $user->increment('failed_attempts');
                if ($user->failed_attempts >= self::MAX_ATTEMPTS) {
                    $user->update(['locked_until' => now()->addMinutes(self::LOCKOUT_MINUTES)]);
                }
            }
            $this->record($request, $credentials['username'], $user?->id, false, 'Invalid credentials');

            // Deliberately identical whether the username exists or not.
            return $this->error('That username and password combination was not recognised.');
        }

        if ($user->isLocked()) {
            $this->record($request, $credentials['username'], $user->id, false, 'Account locked');

            return $this->error(
                "Too many failed attempts. Try again after {$user->locked_until->diffForHumans()}.",
                423,
            );
        }

        if ($user->status !== 'Active') {
            $this->record($request, $credentials['username'], $user->id, false, "Account {$user->status}");

            return $this->error('This account is not active. Contact your administrator.', 403);
        }

        // Off by default, and exempt for anybody who is not clocking in
        // against a fixed schedule in the first place — see LoginWindowGuard
        // for exactly who and why.
        if (! $this->loginWindow->allows($user)) {
            $window = $this->loginWindow->windowFor($user);
            $this->record($request, $credentials['username'], $user->id, false, 'Outside sign-in hours');

            return $this->error(
                $window
                    ? "Sign-in is only available during your shift ({$window['shiftName']}, {$window['start']->format('g:i A')}–{$window['end']->format('g:i A')}). Contact your administrator if this is wrong."
                    : 'Sign-in is not available right now. Contact your administrator.',
                403,
            );
        }

        // An emailed temporary password stops working on its own. Without this
        // an unread invitation sitting in a mailbox is a way in indefinitely.
        if ($this->credentials->isExpired($user)) {
            $this->record($request, $credentials['username'], $user->id, false, 'Temporary password expired');

            return $this->error(
                'That temporary password has expired. Use "Forgot password?" to set a new one, or ask your administrator to send fresh details.',
                403,
            );
        }

        $user->update(['failed_attempts' => 0, 'locked_until' => null]);

        if ($user->requires_auth_code) {
            return response()->json($this->issueCode($request, $user));
        }

        return response()->json($this->grantSession($request, $user));
    }

    public function verifyCode(Request $request): JsonResponse
    {
        $input = $request->validate([
            'challenge_id' => ['required', 'string'],
            'code' => ['required', 'string', 'size:6'],
        ]);

        $challenge = AuthCode::where('challenge_id', $input['challenge_id'])->first();

        if (! $challenge || $challenge->consumed_at || $challenge->expires_at->isPast()) {
            return $this->error('That code has expired. Sign in again to get a new one.');
        }

        if ($challenge->attempts >= self::CODE_MAX_ATTEMPTS) {
            return $this->error('Too many incorrect codes. Sign in again to get a new one.');
        }

        if (! Hash::check($input['code'], $challenge->code_hash)) {
            $challenge->increment('attempts');

            return $this->error('That code is not correct.');
        }

        $challenge->update(['consumed_at' => now()]);
        $user = $challenge->user;

        return response()->json($this->grantSession($request, $user));
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $request->user()->toAuthPayload()]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()?->currentAccessToken()?->delete();
        $this->audit->log('signed out', 'User', $request->user()?->id, $request->user()?->name, 'auth');

        return response()->json(['status' => 'ok']);
    }

    /**
     * The browser's own location, volunteered once after a successful
     * sign-in — the `login_attempts` row already exists (see `record()`),
     * this only fills in what the IP address alone cannot say. Attributed
     * to whichever of *this* user's own recent successful attempts has no
     * location yet, never to another account: the request is authenticated
     * with the token this same sign-in just issued, so there is no way to
     * backdate a location onto somebody else's row.
     */
    public function reportLocation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'latitude' => 'required|numeric|between:-90,90',
            'longitude' => 'required|numeric|between:-180,180',
            'accuracy' => 'nullable|numeric|min:0|max:100000',
        ]);

        $attempt = LoginAttempt::where('user_id', $request->user()->id)
            ->where('succeeded', true)
            ->whereNull('latitude')
            ->where('attempted_at', '>=', now()->subMinutes(15))
            ->orderByDesc('attempted_at')
            ->first();

        if (! $attempt) {
            return response()->json(['status' => 'ok']);
        }

        $attempt->update([
            'latitude' => $data['latitude'],
            'longitude' => $data['longitude'],
            'location_accuracy_m' => isset($data['accuracy']) ? (int) round($data['accuracy']) : null,
        ]);

        return response()->json(['status' => 'ok']);
    }

    /* -------------------------------------------------------------------- */

    /** Emails a fresh six-digit code and returns the challenge handle. */
    private function issueCode(Request $request, User $user): array
    {
        // Any code still outstanding for this user is void once a new one is
        // issued, so an intercepted older code cannot be replayed.
        AuthCode::where('user_id', $user->id)->whereNull('consumed_at')->update(['consumed_at' => now()]);

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $challengeId = Str::uuid()->toString();

        AuthCode::create([
            'user_id' => $user->id,
            'challenge_id' => $challengeId,
            'code_hash' => Hash::make($code),
            'ip_address' => $request->ip(),
            'expires_at' => now()->addMinutes(self::CODE_TTL_MINUTES),
        ]);

        $this->mailer->send(
            to: $user->email,
            subject: 'Your Trinitas ERP sign-in code',
            view: 'emails.auth-code',
            data: ['user' => $user, 'code' => $code, 'minutes' => self::CODE_TTL_MINUTES],
            event: 'auth.code',
        );

        // Key names match what the React auth store reads.
        return ['requires_code' => true, 'challenge_id' => $challengeId];
    }

    private function grantSession(Request $request, User $user): array
    {
        $user->update([
            'last_login_at' => now(),
            'last_login_ip' => $request->ip(),
            'failed_attempts' => 0,
        ]);

        $this->record($request, $user->username ?? $user->email, $user->id, true, null);
        $this->audit->log('signed in', 'User', $user->id, $user->name, 'auth');

        // Warms every module dashboard's cache after this response is on its
        // way to the browser — by the time the user clicks into Sales, HR or
        // any other dashboard, it is very likely already sitting in cache
        // rather than being computed while they wait.
        dispatch(new WarmDashboardCaches())->afterResponse();

        return [
            'status' => 'ok',
            'user' => $user->toAuthPayload(),
            'token' => $user->createToken('erp-session')->plainTextToken,
        ];
    }

    /**
     * Records the attempt in both places it belongs: `login_attempts` for the
     * brute-force/geo pattern-matching it was built for, and the unified
     * audit trail so a failed sign-in shows up alongside everything else
     * that happened to the account instead of only being visible in a
     * separate table nothing else reads from. Only called for failures —
     * `grantSession()` logs the success case itself.
     */
    private function record(Request $request, string $username, ?int $userId, bool $succeeded, ?string $reason): void
    {
        LoginAttempt::create([
            'username' => $username,
            'user_id' => $userId,
            'ip_address' => $request->ip(),
            'country_code' => $this->geoGuard->countryFor($request->ip()),
            'user_agent' => Str::limit((string) $request->userAgent(), 250, ''),
            'succeeded' => $succeeded,
            'failure_reason' => $reason,
            'attempted_at' => now(),
        ]);

        if (! $succeeded) {
            $this->audit->log('sign-in failed', 'User', $userId, $reason ? "{$username} — {$reason}" : $username, 'auth', outcome: 'failure');
        }
    }

    private function error(string $message, int $code = 401): JsonResponse
    {
        return response()->json(['status' => 'error', 'message' => $message], $code);
    }
}
