<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Log in as" — a superadmin seeing the application exactly as one specific
 * user sees it, to answer "what is this person actually looking at" without
 * guessing from a support description.
 *
 * The mechanic is deliberately simple rather than a parallel session type:
 * mint the target a real Sanctum token, same as a normal sign-in, and let
 * the client hold on to the admin's own token to swap back to. Everything
 * that already checks "is this account allowed to do X" keeps working
 * unmodified, because the impersonated session is not a special case to any
 * of that code — it is just signed in as that user, on a token that says so.
 */
class ImpersonationController extends Controller
{
    public function __construct(private readonly AuditLogger $audit) {}

    /** Real accounts a superadmin can look through — not the Users & Roles preview. */
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => User::with('employee.hrDepartment')
                ->where('is_super_admin', false)
                ->orderBy('name')
                ->get()
                ->map(fn (User $u) => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'username' => $u->username,
                    'email' => $u->email,
                    'department' => $u->employee?->hrDepartment?->name,
                    'status' => $u->status,
                ]),
        ]);
    }

    /**
     * Mints a token for the target user.
     *
     * Refused for another super administrator — impersonation exists to see
     * what an ordinary account experiences, not to act with a second admin's
     * authority, and letting one admin quietly drive another's account is a
     * privilege-escalation path with no legitimate use here.
     *
     * The token expires on its own in 4 hours, unlike an ordinary sign-in
     * (see AuthController::grantSession) — a session nobody deliberately
     * extended should not still be open a week later just because nobody
     * clicked "return to admin".
     */
    public function start(Request $request, User $user): JsonResponse
    {
        if ($user->is_super_admin) {
            return response()->json(['message' => 'A super administrator cannot be impersonated.'], 422);
        }

        $admin = $request->user();

        $token = $user->createToken(
            'impersonation',
            ["impersonated-by:{$admin->id}"],
            now()->addHours(4),
        )->plainTextToken;

        $this->audit->log(
            "began impersonating {$user->name}",
            'User',
            $user->id,
            $user->name,
            'admin',
            ['adminId' => $admin->id, 'adminName' => $admin->name],
        );

        return response()->json(['data' => [
            'token' => $token,
            'user' => $user->toAuthPayload(),
            'expiresAt' => now()->addHours(4)->toIso8601String(),
        ]]);
    }

    /**
     * Ends the impersonated session from the inside — called while still
     * signed in as the impersonated user, on the impersonation token itself.
     * Revokes only that one token; the admin's own session was never touched
     * and needs nothing restored server-side, only re-selected client-side.
     */
    public function stop(Request $request): JsonResponse
    {
        $token = $request->user()?->currentAccessToken();

        if (! $token || $token->name !== 'impersonation') {
            return response()->json(['message' => 'This session is not an impersonation.'], 422);
        }

        $prefix = 'impersonated-by:';
        $adminId = collect($token->abilities)
            ->map(fn ($a) => str_starts_with($a, $prefix) ? (int) substr($a, strlen($prefix)) : null)
            ->filter(fn ($id) => $id !== null)
            ->first();

        $this->audit->log(
            'ended an impersonated session',
            'User',
            $request->user()->id,
            $request->user()->name,
            'admin',
            ['adminId' => $adminId],
        );

        $token->delete();

        return response()->json(['data' => ['ended' => true]]);
    }
}
