<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // This is a JSON API with no browser-facing login page of its own —
        // the framework default (redirect an unauthenticated request to a
        // route named `login`) throws `RouteNotFoundException` here, since
        // no such route exists. That turned an ordinary "your session
        // expired" into an opaque 500 for any request whose Accept header
        // didn't already mark it as wanting JSON (a bare `curl`, an <img>
        // tag, a fetch missing the header) — never a redirect. Null keeps
        // Sanctum's own 401 JSON response as the only outcome.
        $middleware->redirectGuestsTo(fn () => null);

        // Applies to every authenticated API route; the middleware itself
        // whitelists the few endpoints needed to actually change a password.
        $middleware->api(append: [
            App\Http\Middleware\EnsurePasswordChanged::class,
        ]);

        // Applied to the administration routes only — see routes/api.php.
        $middleware->alias([
            'super-admin' => App\Http\Middleware\EnsureSuperAdmin::class,
            // Guards the compliance layer. See EnsureProcessOffice for why it
            // answers 404 rather than 403.
            'process-office' => App\Http\Middleware\EnsureProcessOffice::class,
            // Restricts each business department's routes to the people
            // allowed to see it. Off by default — see DepartmentAccessGuard.
            'department-access' => App\Http\Middleware\EnsureDepartmentAccess::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*'),
        );
    })->create();
