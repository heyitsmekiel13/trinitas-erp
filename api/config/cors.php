<?php

/**
 * Cross-origin access for the React front end.
 *
 * In development Vite serves on :5173 while the API serves on :8000, so the
 * browser treats them as different origins. In production both are served
 * from the same domain and this configuration stops mattering — the allowed
 * origins come from FRONTEND_URL so nothing has to be edited at deploy time.
 */
$frontend = array_filter(array_map('trim', explode(',', (string) env('FRONTEND_URL', ''))));

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => $frontend ?: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
    ],

    /**
     * Any localhost port, in local development only.
     *
     * Vite moves to a random high port whenever 5173 is already taken — a
     * second checkout, a preview build, a dev server left running from
     * yesterday. The fixed list above then rejects the browser's request, and
     * because a blocked response looks identical to a dead server, the symptom
     * is "I cannot log in" with nothing in the console to explain it.
     *
     * Gated on the local environment, and never applied when FRONTEND_URL is
     * set, so a deployed API keeps its explicit allow-list.
     */
    'allowed_origins_patterns' => (! $frontend && env('APP_ENV') === 'local')
        ? ['#^http://(localhost|127\.0\.0\.1)(:\d+)?$#']
        : [],

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => 3600,

    // Token auth via the Authorization header does not need cookies, but
    // Sanctum's SPA mode does, and this keeps both options open.
    'supports_credentials' => true,
];
