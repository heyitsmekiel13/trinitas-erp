<?php

namespace App\Http\Middleware;

use App\Services\AuditLogger;
use App\Services\ProcessOffice;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Restricts the compliance layer to the Process & Performance office.
 *
 * Everything behind this middleware is an assessment of somebody's work:
 * the observation register, the scorecards, the evaluations. The people being
 * assessed use the same project management tool from the same sign-in, and
 * must not be able to read any of it — a finding an assignee can see is a
 * finding they will contest before it is written, and a scorecard somebody
 * can watch is a scorecard they will manage rather than a record.
 *
 * Enforced here, not by hiding the menu. The React app also hides it, but
 * that is a courtesy to the user, not the control: without this middleware
 * the register would be one fetch away for anybody with an account.
 *
 * The 404 is deliberate. A 403 confirms the route exists and that somebody is
 * being evaluated behind it, which is exactly the thing this is meant not to
 * disclose.
 */
class EnsureProcessOffice
{
    public function __construct(
        private readonly ProcessOffice $office,
        private readonly AuditLogger $audit,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->office->includes($request->user())) {
            // Logged even though the response itself stays a 404 — the
            // compliance office wants to know somebody reached for this,
            // not just that the response hid it from them.
            $this->audit->log(
                'denied — outside Process & Performance office',
                module: 'process',
                entityLabel: $request->path(),
                outcome: 'denied',
            );

            return response()->json(['message' => 'Not found.'], 404);
        }

        return $next($request);
    }
}
