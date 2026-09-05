<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Blocks an account that is still on its issued password.
 *
 * Every employee imported from the masterfile starts with the same shared
 * password, so until it is changed the account can reach nothing except the
 * handful of routes needed to change it. Enforcing this server-side matters:
 * hiding the rest of the app in the client would stop nobody who can open a
 * terminal.
 */
class EnsurePasswordChanged
{
    /** Routes reachable while a password change is outstanding. */
    private const ALLOWED = [
        'api/v1/auth/me',
        'api/v1/auth/logout',
        'api/v1/account/password',
        'api/v1/branding',
        'api/v1/health',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && $user->must_change_password && ! $this->isAllowed($request)) {
            return response()->json([
                'message' => 'Choose a new password before continuing.',
                'must_change_password' => true,
            ], 423);
        }

        return $next($request);
    }

    private function isAllowed(Request $request): bool
    {
        foreach (self::ALLOWED as $path) {
            if ($request->is($path)) {
                return true;
            }
        }

        return false;
    }
}
