<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Geocoder;
use App\Services\PlaceSearch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Address to coordinate.
 *
 * Shared rather than owned by Sales: customers, suppliers and delivery points
 * all get written down the same way, and all of them feed the same route
 * planner.
 *
 * Throttled because the paid provider behind it bills per call and a form that
 * looked up on every keystroke would be expensive as well as rude to
 * OpenStreetMap.
 */
class GeocodeController extends Controller
{
    /**
     * Type-ahead place search, returning candidates rather than one answer.
     *
     * The single-result lookup below is kept for saving an address on a
     * record, where there is a written address and one right answer. This is
     * for the other case — somebody half-remembers a place name and needs to
     * recognise it in a list.
     */
    public function search(Request $request, PlaceSearch $places): JsonResponse
    {
        $data = $request->validate([
            'q' => 'required|string|max:160',
            'limit' => 'nullable|integer|between:1,10',
        ]);

        return response()->json([
            'data' => $places->search($data['q'], (int) ($data['limit'] ?? 8)),
        ]);
    }

    public function __invoke(Request $request, Geocoder $geocoder): JsonResponse
    {
        $data = $request->validate([
            'street' => 'nullable|string|max:255',
            'barangay' => 'nullable|string|max:120',
            'city' => 'nullable|string|max:80',
            'province' => 'nullable|string|max:120',
            'postalCode' => 'nullable|string|max:16',
            // A pasted Google Maps link or coordinate pair takes precedence:
            // somebody who went to the trouble of finding the exact pin should
            // not have it second-guessed by a lookup.
            'pasted' => 'nullable|string|max:500',
        ]);

        if (! empty($data['pasted'])) {
            $pinned = $geocoder->parsePasted($data['pasted']);

            return $pinned
                ? response()->json(['data' => $pinned])
                : response()->json([
                    'message' => 'That does not look like a Google Maps link or a coordinate pair.',
                ], 422);
        }

        $found = $geocoder->locate($data);

        if (! $found) {
            return response()->json([
                'message' => 'Could not find that address. Check the city spelling, or paste a Google Maps link instead.',
            ], 422);
        }

        return response()->json(['data' => $found]);
    }
}
