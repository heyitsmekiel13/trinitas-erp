<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GeoRule;
use App\Services\AuditLogger;
use App\Services\GeoGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * Geo-IP allow and block rules.
 *
 * The dangerous operation here is locking yourself out, so two guards exist:
 * the caller's own address is offered as a one-click allow rule, and a rule
 * that would block the current connection is refused.
 */
class GeoRuleController extends Controller
{
    public function __construct(
        private readonly GeoGuard $geoGuard,
        private readonly AuditLogger $audit,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => GeoRule::latest('id')->get()]);
    }

    /** What the caller's connection looks like, for the "allow me" button. */
    public function current(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->geoGuard->describe($request->ip())]);
    }

    public function store(Request $request): JsonResponse
    {
        $input = $request->validate([
            'kind' => ['required', Rule::in(['country', 'ip', 'cidr', 'area'])],
            'value' => ['required', 'string', 'max:64'],
            'label' => ['nullable', 'string', 'max:150'],
            'effect' => ['required', Rule::in(['allow', 'block'])],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Area rules only. Required together — half a coordinate fences
            // nothing.
            'latitude' => ['required_if:kind,area', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['required_if:kind,area', 'nullable', 'numeric', 'between:-180,180'],
            'radius_km' => ['nullable', 'integer', 'min:1', 'max:2000'],
            'city' => ['nullable', 'string', 'max:120'],
            'region' => ['nullable', 'string', 'max:120'],
        ]);

        if ($message = $this->validateValue($input['kind'], $input['value'])) {
            return response()->json(['message' => $message], 422);
        }

        $input['value'] = strtoupper($input['kind']) === 'COUNTRY'
            ? strtoupper($input['value'])
            : $input['value'];

        if (GeoRule::where('kind', $input['kind'])->where('value', $input['value'])->exists()) {
            return response()->json(['message' => 'That rule already exists.'], 422);
        }

        $rule = GeoRule::create($input + ['created_by' => $request->user()?->id, 'is_active' => true]);
        Cache::forget('erp.geo_rules');

        // Refuse anything that would shut the door on the person holding it.
        if (! $this->geoGuard->allows($request->ip())) {
            $rule->delete();
            Cache::forget('erp.geo_rules');

            return response()->json([
                'message' => 'That rule would block your own connection, so it was not saved.',
            ], 422);
        }

        $this->audit->log("added a Geo-IP {$input['effect']} rule", 'GeoRule', $rule->id, $rule->value, 'admin');

        return response()->json(['data' => $rule], 201);
    }

    public function update(Request $request, GeoRule $geoRule): JsonResponse
    {
        $input = $request->validate([
            'is_active' => ['sometimes', 'boolean'],
            'label' => ['sometimes', 'nullable', 'string', 'max:150'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            // Widening or tightening a fence is the common edit, so it does
            // not require deleting and re-adding the rule.
            'radius_km' => ['sometimes', 'integer', 'min:1', 'max:2000'],
            'latitude' => ['sometimes', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'numeric', 'between:-180,180'],
        ]);

        $original = $geoRule->getOriginal();
        $geoRule->update($input);
        Cache::forget('erp.geo_rules');

        if (! $this->geoGuard->allows($request->ip())) {
            $geoRule->update($original);
            Cache::forget('erp.geo_rules');

            return response()->json([
                'message' => 'That change would block your own connection, so it was reverted.',
            ], 422);
        }

        $this->audit->logModel('updated a Geo-IP rule', $geoRule, 'admin', $original);

        return response()->json(['data' => $geoRule->fresh()]);
    }

    public function destroy(Request $request, GeoRule $geoRule): JsonResponse
    {
        $value = $geoRule->value;
        $snapshot = $geoRule->toArray();
        $geoRule->delete();
        Cache::forget('erp.geo_rules');

        if (! $this->geoGuard->allows($request->ip())) {
            GeoRule::create($snapshot);
            Cache::forget('erp.geo_rules');

            return response()->json([
                'message' => 'Removing that rule would block your own connection, so it was kept.',
            ], 422);
        }

        $this->audit->log('removed a Geo-IP rule', 'GeoRule', null, $value, 'admin');

        return response()->json(['data' => ['deleted' => true]]);
    }

    /**
     * Philippine places an administrator is likely to fence to.
     *
     * Offered so nobody has to go and look up a latitude by hand — the common
     * case is "our office city", and typing coordinates from memory is how a
     * fence ends up in the sea.
     *
     * @return array<int, array<string, mixed>>
     */
    public function presets(): JsonResponse
    {
        return response()->json(['data' => self::PH_LOCATIONS]);
    }

    /** name, region, latitude, longitude, a sensible starting radius. */
    private const PH_LOCATIONS = [
        ['name' => 'Davao City', 'region' => 'Davao Region', 'latitude' => 7.1907, 'longitude' => 125.4553, 'radiusKm' => 30],
        ['name' => 'Tagum City', 'region' => 'Davao Region', 'latitude' => 7.4478, 'longitude' => 125.8078, 'radiusKm' => 20],
        ['name' => 'Panabo City', 'region' => 'Davao Region', 'latitude' => 7.3081, 'longitude' => 125.6839, 'radiusKm' => 20],
        ['name' => 'Digos City', 'region' => 'Davao Region', 'latitude' => 6.7496, 'longitude' => 125.3572, 'radiusKm' => 20],
        ['name' => 'General Santos', 'region' => 'Soccsksargen', 'latitude' => 6.1164, 'longitude' => 125.1716, 'radiusKm' => 25],
        ['name' => 'Cagayan de Oro', 'region' => 'Northern Mindanao', 'latitude' => 8.4542, 'longitude' => 124.6319, 'radiusKm' => 25],
        ['name' => 'Zamboanga City', 'region' => 'Zamboanga Peninsula', 'latitude' => 6.9214, 'longitude' => 122.0790, 'radiusKm' => 25],
        ['name' => 'Butuan City', 'region' => 'Caraga', 'latitude' => 8.9475, 'longitude' => 125.5406, 'radiusKm' => 20],
        ['name' => 'Cebu City', 'region' => 'Central Visayas', 'latitude' => 10.3157, 'longitude' => 123.8854, 'radiusKm' => 30],
        ['name' => 'Iloilo City', 'region' => 'Western Visayas', 'latitude' => 10.7202, 'longitude' => 122.5621, 'radiusKm' => 25],
        ['name' => 'Bacolod City', 'region' => 'Western Visayas', 'latitude' => 10.6407, 'longitude' => 122.9689, 'radiusKm' => 25],
        ['name' => 'Tacloban City', 'region' => 'Eastern Visayas', 'latitude' => 11.2444, 'longitude' => 125.0048, 'radiusKm' => 20],
        ['name' => 'Metro Manila', 'region' => 'National Capital Region', 'latitude' => 14.5995, 'longitude' => 120.9842, 'radiusKm' => 45],
        ['name' => 'Quezon City', 'region' => 'National Capital Region', 'latitude' => 14.6760, 'longitude' => 121.0437, 'radiusKm' => 25],
        ['name' => 'Baguio City', 'region' => 'Cordillera', 'latitude' => 16.4023, 'longitude' => 120.5960, 'radiusKm' => 20],
        ['name' => 'Angeles City', 'region' => 'Central Luzon', 'latitude' => 15.1450, 'longitude' => 120.5887, 'radiusKm' => 25],
        ['name' => 'Batangas City', 'region' => 'Calabarzon', 'latitude' => 13.7565, 'longitude' => 121.0583, 'radiusKm' => 25],
        ['name' => 'Naga City', 'region' => 'Bicol Region', 'latitude' => 13.6218, 'longitude' => 123.1948, 'radiusKm' => 20],
        ['name' => 'Puerto Princesa', 'region' => 'Mimaropa', 'latitude' => 9.7392, 'longitude' => 118.7353, 'radiusKm' => 25],
        ['name' => 'Laoag City', 'region' => 'Ilocos Region', 'latitude' => 18.1978, 'longitude' => 120.5936, 'radiusKm' => 20],
    ];

    private function validateValue(string $kind, string $value): ?string
    {
        return match ($kind) {
            'country' => preg_match('/^[A-Za-z]{2}$/', $value)
                ? null
                : 'A country must be a two-letter code, for example PH.',
            'ip' => filter_var($value, FILTER_VALIDATE_IP)
                ? null
                : 'That is not a valid IP address.',
            'cidr' => $this->isCidr($value)
                ? null
                : 'A range must look like 203.0.113.0/24.',
            // An area is identified by its name; the fence itself is the
            // coordinate pair and radius validated above.
            'area' => trim($value) !== ''
                ? null
                : 'Give the area a name, for example Davao City.',
            default => 'Unknown rule type.',
        };
    }

    private function isCidr(string $value): bool
    {
        if (! str_contains($value, '/')) {
            return false;
        }

        [$ip, $bits] = explode('/', $value, 2);

        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false
            && is_numeric($bits) && (int) $bits >= 0 && (int) $bits <= 32;
    }
}
