<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\HrEvents;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HrEventsController extends Controller
{
    public function __construct(private readonly HrEvents $events) {}

    public function upcoming(Request $request): JsonResponse
    {
        $days = (int) $request->query('days', 30);
        $days = max(1, min($days, 365));

        return response()->json(['data' => $this->events->upcoming($days)]);
    }

    /** Active announcements for the signed-in employee's audience (or company-wide, if not linked to one). */
    public function myAnnouncements(Request $request): JsonResponse
    {
        $employee = $request->user()?->employee;

        $rows = $this->events->activeAnnouncements($employee)->map(fn ($a) => [
            'id' => $a->id,
            'title' => $a->title,
            'body' => $a->body,
            'pinned' => $a->pinned,
            'publishedAt' => optional($a->published_at)->toIso8601String(),
            'expiresAt' => optional($a->expires_at)->toIso8601String(),
        ]);

        return response()->json(['data' => $rows->values()]);
    }
}
