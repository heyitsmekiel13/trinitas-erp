<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts administration to super administrators.
 *
 * Everything behind this middleware changes how the system itself behaves
 * rather than what it records: user accounts and roles, approval thresholds,
 * the audit trail, Geo-IP fencing, backups and restores, and the settings that
 * every other module obeys.
 *
 * Enforced here rather than by hiding the menu, because a hidden menu stops
 * nobody who can open a terminal — the endpoints were reachable by any signed-in
 * employee before this existed.
 */
class EnsureSuperAdmin
{
    public function __construct(private readonly AuditLogger $audit) {}

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user || ! $user->is_super_admin) {
            $this->audit->log(
                'denied — not a system administrator',
                module: 'admin',
                entityLabel: $request->path(),
                outcome: 'denied',
            );

            return response()->json([
                'message' => 'Administration is restricted to system administrators.',
            ], 403);
        }

        return $next($request);
    }
}
