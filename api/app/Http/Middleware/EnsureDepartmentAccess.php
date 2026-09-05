<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use App\Services\DepartmentAccessGuard;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts a business department's routes to the people allowed to see it.
 *
 * Applied once, across the whole authenticated route group, rather than
 * route by route — every route already follows a `{department}/...` URL
 * convention (`hr/...`, `sales/...`, `warehouse/...`), so the first path
 * segment is the department, and only the eight in
 * `DepartmentAccessGuard::DEPARTMENTS` are ever restricted. Everything
 * else — `me`, `chat`, `tasks`, `support`, `admin`, `settings` and the rest —
 * is universal and passes straight through, checked against nothing.
 *
 * Skipped entirely while the feature is off (`department_access.enabled`),
 * which is its shipped state — see `DepartmentAccessGuard`'s own docblock
 * for why.
 *
 * The 404 mirrors `EnsureProcessOffice` for the same reason: a 403 would
 * confirm the route exists, which is exactly what a department boundary is
 * meant not to disclose to somebody outside it.
 */
class EnsureDepartmentAccess
{
    public function __construct(
        private readonly DepartmentAccessGuard $guard,
        private readonly AuditLogger $audit,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->guard->enabled()) {
            return $next($request);
        }

        // A request to `/api/v1/hr/employees` reports its path() as
        // `api/v1/hr/employees` — three segments in before the department.
        // Read from Laravel's own routing rather than trust that number:
        // `segment(3)` is 1-indexed and already skips exactly `api/v1/`.
        $department = $request->segment(3);

        if (! $department || ! in_array($department, DepartmentAccessGuard::DEPARTMENTS, true)) {
            return $next($request);
        }

        $user = $request->user();

        if (! $user || ! $this->guard->canAccess($user, $department)) {
            $this->audit->log(
                "denied — outside {$department} department",
                module: $department,
                entityLabel: $request->path(),
                outcome: 'denied',
            );

            return response()->json(['message' => 'Not found.'], 404);
        }

        return $next($request);
    }
}
