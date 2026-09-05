<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Streams a file off the `public` disk directly, instead of relying on the
 * `storage:link` symlink Laravel normally serves it through.
 *
 * That symlink is a one-time `php artisan storage:link` command — nothing
 * to run again once it exists, but nothing an install without shell access
 * (some shared hosting) can ever create either, which would otherwise turn
 * every employee photo and the company logo into a permanent broken image.
 * Reading the file straight out of storage and streaming it back needs no
 * symlink and no CLI at all, at the cost of one extra PHP request per file
 * instead of the web server serving it directly — a fair trade for working
 * everywhere.
 *
 * Left unauthenticated on purpose, matching exactly what a symlinked file
 * would have been: these are the same photos and logos already shown
 * throughout the UI, and the company logo has to be visible before anyone
 * has signed in at all (the sign-in screen itself).
 */
class PublicFileController extends Controller
{
    public function show(string $path): StreamedResponse
    {
        // The path arrives as a route segment, so it is attacker-controlled —
        // reject anything trying to climb out of the public disk's own root.
        abort_if(Str::contains($path, ['..', "\0"]), 404);
        abort_unless(Storage::disk('public')->exists($path), 404);

        return Storage::disk('public')->response($path);
    }
}
