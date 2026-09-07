<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AuditLogger;
use App\Services\GeoGuard;
use App\Services\Mailer;
use App\Services\PunchGuard;
use App\Services\RoutePlanner;
use App\Services\Settings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

/**
 * Administrable settings: company branding, SMTP, security policy and payroll
 * defaults.
 *
 * Each group has its own validation rules — a settings screen that accepts
 * anything is how a system ends up with a port of "five eight seven".
 */
class SettingsController extends Controller
{
    private const GROUPS = ['company', 'smtp', 'security', 'payroll', 'logistics', 'operations', 'timekeeping', 'maps', 'department_access'];

    public function __construct(
        private readonly Settings $settings,
        private readonly Mailer $mailer,
        private readonly AuditLogger $audit,
        private readonly GeoGuard $geoGuard,
    ) {}

    public function show(string $group): JsonResponse
    {
        abort_unless(in_array($group, self::GROUPS, true), 404);

        return response()->json(['data' => $this->withDefaults($group, $this->settings->forDisplay($group))]);
    }

    /**
     * Fills in a group's shipped defaults where nothing has been saved yet, so
     * the form shows the values actually in force rather than empty boxes.
     */
    private function withDefaults(string $group, array $values): array
    {
        $defaults = match ($group) {
            // Base rate for a personally-owned vehicle's mileage payout — not
            // one of RoutePlanner's own figures, but it lives in the same
            // "what a trip costs" settings group rather than a new tab.
            'logistics' => RoutePlanner::DEFAULTS + ['ratePerKm' => 12.0],
            'timekeeping' => PunchGuard::DEFAULTS,
            // Blank is the shipped state: address lookup falls back to
            // OpenStreetMap when no Google key is configured.
            'maps' => ['google_api_key' => ''],
            // Off, and the bypass list the feature ships with — see
            // DepartmentAccessGuard for why both are what they are.
            'department_access' => [
                'enabled' => false,
                'bypass_roles' => ['process-officer', 'process-manager', 'executive'],
            ],
            // Shipped as the 10th/25th pattern most Philippine employers use.
            // Installs from before this setting existed still get a real
            // value here rather than an empty box.
            'payroll' => [
                'first_half_pay_day' => 25,
                'second_half_pay_day' => 10,
            ],
            'security' => [
                'min_password_length' => 4,
                // Two years — long enough to cover a typical annual audit
                // cycle plus the one before it, short enough that the table
                // does not grow forever unexamined. Purged rows are gone for
                // good; there is no un-delete, so this is deliberately a
                // conservative default rather than an aggressive one.
                'audit_retention_days' => 730,
            ],
            // The guardrails the whole ERP obeys. Defaults are the safe
            // reading of each: refuse what cannot be undone, allow what only
            // saves typing.
            'operations' => [
                'auto_post_inventory' => true,
                'allow_negative_stock' => false,
                'enforce_credit_limits' => true,
                'batch_expiry_tracking' => true,
                'require_two_factor_for_approvers' => false,
                'lock_posted_periods' => true,
                'default_vat_rate' => 12,
                'date_format' => 'dmy',
                'base_currency' => 'PHP',
            ],
            default => [],
        };

        return $values + $defaults;
    }

    public function update(Request $request, string $group): JsonResponse
    {
        abort_unless(in_array($group, self::GROUPS, true), 404);

        $validated = $request->validate($this->rules($group));
        $types = $this->types($group);

        // A masked secret means "leave it alone" — the client never receives
        // the real value, so it cannot send it back.
        foreach ($types as $key => $type) {
            if ($type === 'secret' && ($validated[$key] ?? null) === '********') {
                unset($validated[$key]);
            }
        }

        // Turning geo-fencing on is now a real restriction (see GeoGuard) —
        // refuse it if the rules as they stand would shut out the very
        // connection making this request, the same self-lockout guard
        // GeoRuleController already applies to individual rules.
        if ($group === 'security' && ($validated['geo_fencing_enabled'] ?? false) === true) {
            if (! $this->geoGuard->wouldAllow($request->ip())) {
                return response()->json([
                    'message' => 'Turning this on would block your own connection under the current rules, so it was not changed. Add an allow rule for your own network first.',
                ], 422);
            }
        }

        $this->settings->setMany($group, $validated, $types);
        $this->audit->log("updated {$group} settings", 'Setting', null, $group, 'admin');

        return response()->json(['data' => $this->settings->forDisplay($group)]);
    }

    /** Stores the company logo and records its path in settings. */
    public function uploadLogo(Request $request): JsonResponse
    {
        $request->validate([
            'logo' => ['required', 'image', 'mimes:png,jpg,jpeg,svg,webp', 'max:2048'],
        ]);

        $path = $request->file('logo')->store('branding', 'public');

        // Replace rather than accumulate — old logos are dead weight.
        $previous = $this->settings->get('company', 'logo_path');
        if ($previous && $previous !== $path) {
            Storage::disk('public')->delete($previous);
        }

        $this->settings->set('company', 'logo_path', $path);
        $this->audit->log('updated company logo', 'Setting', null, 'company.logo_path', 'admin');

        return response()->json(['data' => ['path' => $path, 'url' => route('public-files.show', ['path' => $path])]]);
    }

    public function testEmail(Request $request): JsonResponse
    {
        $input = $request->validate(['to' => ['required', 'email']]);

        $result = $this->mailer->test($input['to']);
        $this->audit->log('sent a test email', 'Setting', null, $input['to'], 'admin');

        return response()->json(['data' => $result], $result['sent'] ? 200 : 422);
    }

    /** Used by the setup wizard to retire the install password. */
    public function changeOwnPassword(Request $request): JsonResponse
    {
        $input = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:'.$this->settings->get('security', 'min_password_length', 4), 'confirmed'],
        ]);

        $user = $request->user();

        if (! Hash::check($input['current_password'], $user->password)) {
            return response()->json(['message' => 'Your current password is not correct.'], 422);
        }

        $user->update([
            'password' => $input['password'],
            'must_change_password' => false,
            'password_changed_at' => now(),
        ]);
        // Every other session is invalidated — a password change should sign
        // out anyone who was using the old one.
        $user->tokens()->where('id', '!=', $user->currentAccessToken()->id)->delete();

        $this->audit->log('changed their password', 'User', $user->id, $user->name, 'admin');

        return response()->json(['data' => ['changed' => true]]);
    }

    /* -------------------------------------------------------------------- */

    private function rules(string $group): array
    {
        return match ($group) {
            'company' => [
                'legal_name' => ['required', 'string', 'max:190'],
                'trade_name' => ['nullable', 'string', 'max:190'],
                'address' => ['nullable', 'string', 'max:255'],
                'tin' => ['nullable', 'string', 'max:32'],
                'phone' => ['nullable', 'string', 'max:40'],
                'email' => ['nullable', 'email', 'max:150'],
                'currency' => ['required', 'string', 'size:3'],
                'fiscal_year_start' => ['required', 'integer', 'between:1,12'],
                /* Who signs an offer letter, and as what. Company identity
                   rather than a per-offer field: it is the same name on every
                   letter, and retyping it per candidate is how one goes out
                   signed by somebody who left. */
                'signatory_name' => ['nullable', 'string', 'max:120'],
                'signatory_title' => ['nullable', 'string', 'max:120'],
            ],
            'smtp' => [
                'enabled' => ['required', 'boolean'],
                'host' => ['required_if:enabled,true', 'nullable', 'string', 'max:190'],
                'port' => ['required_if:enabled,true', 'nullable', 'integer', 'between:1,65535'],
                'encryption' => ['required_if:enabled,true', 'nullable', Rule::in(['tls', 'ssl', 'none'])],
                'username' => ['nullable', 'string', 'max:190'],
                'password' => ['nullable', 'string', 'max:190'],
                'from_address' => ['required_if:enabled,true', 'nullable', 'email', 'max:150'],
                'from_name' => ['nullable', 'string', 'max:120'],
                'reply_to' => ['nullable', 'email', 'max:150'],
            ],
            // Address lookup. Leaving the key blank is a supported choice, not
            // an incomplete setup: without one the free OpenStreetMap geocoder
            // is used instead.
            'maps' => [
                'google_api_key' => ['nullable', 'string', 'max:190'],
            ],
            'security' => [
                'session_timeout_minutes' => ['required', 'integer', 'between:5,480'],
                'require_auth_code' => ['required', 'boolean'],
                'max_failed_attempts' => ['required', 'integer', 'between:3,20'],
                'lockout_minutes' => ['required', 'integer', 'between:1,1440'],
                'geo_fencing_enabled' => ['required', 'boolean'],
                // Off by default — see LoginWindowGuard. Supervisors,
                // executives and anyone in a `-manager` role are exempt
                // regardless; this only ever restricts rank-and-file staff
                // to their own shift window.
                'login_hours_enabled' => ['sometimes', 'boolean'],
                // Floor of 4 rather than letting an admin type "1" and lock
                // the whole company out of anything resembling a real
                // credential; 64 is Laravel's own upper comfort zone for a
                // bcrypt-hashed value.
                'min_password_length' => ['sometimes', 'integer', 'between:4,64'],
                // No upper bound worth enforcing — a company keeping audit
                // history for a decade is a policy choice, not a mistake.
                // 90-day floor because anything shorter is not really a
                // retention policy.
                'audit_retention_days' => ['sometimes', 'integer', 'min:90'],
            ],
            'department_access' => [
                'enabled' => ['sometimes', 'boolean'],
                'bypass_roles' => ['sometimes', 'array'],
                'bypass_roles.*' => ['string', 'max:64'],
            ],
            'payroll' => [
                'statutory_schedule' => ['required', Rule::in(['first', 'second', 'split'])],
                'working_days_factor' => ['required', 'integer', 'between:200,366'],
                'hours_per_day' => ['required', 'integer', 'between:1,24'],
                // The calendar day each cut-off is actually paid on — the
                // 1st–15th cut-off pays out the same month, the 16th–end
                // cut-off the following one. `generatePeriods()` reads these
                // instead of guessing a pay date from a lag after the cut-off.
                'first_half_pay_day' => ['required', 'integer', 'between:1,31'],
                'second_half_pay_day' => ['required', 'integer', 'between:1,31'],
            ],
            // Delivery estimates are only as good as these. They are settings
            // rather than constants so they can be calibrated against real
            // trip sheets instead of staying at whatever was guessed on day one.
            'timekeeping' => [
                'require_punch_pin' => ['sometimes', 'boolean'],
                'restrict_punch_to_areas' => ['sometimes', 'boolean'],
                'flag_shared_devices' => ['sometimes', 'boolean'],
                'shared_device_threshold' => ['sometimes', 'integer', 'min:1', 'max:50'],
                'burst_window_seconds' => ['sometimes', 'integer', 'min:10', 'max:3600'],
                'pin_length' => ['sometimes', 'integer', 'min:4', 'max:8'],
            ],
            'operations' => [
                'auto_post_inventory' => ['sometimes', 'boolean'],
                'allow_negative_stock' => ['sometimes', 'boolean'],
                'enforce_credit_limits' => ['sometimes', 'boolean'],
                'batch_expiry_tracking' => ['sometimes', 'boolean'],
                'require_two_factor_for_approvers' => ['sometimes', 'boolean'],
                'lock_posted_periods' => ['sometimes', 'boolean'],
                'default_vat_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
                'date_format' => ['sometimes', 'in:dmy,mdy,iso'],
                'base_currency' => ['sometimes', 'string', 'max:8'],
            ],
            'logistics' => [
                'roadFactor' => ['required', 'numeric', 'between:1,3'],
                'averageSpeedKph' => ['required', 'numeric', 'between:5,120'],
                'handlingMinutes' => ['required', 'integer', 'between:0,480'],
                'fuelPricePerLitre' => ['required', 'numeric', 'between:0,1000'],
                'defaultKmPerLitre' => ['required', 'numeric', 'between:0.5,100'],
                'ratePerKm' => ['required', 'numeric', 'between:0,100'],
            ],
            default => [],
        };
    }

    private function types(string $group): array
    {
        return match ($group) {
            'company' => ['fiscal_year_start' => 'integer'],
            'smtp' => ['enabled' => 'boolean', 'port' => 'integer', 'password' => 'secret'],
            'maps' => ['google_api_key' => 'secret'],
            'security' => [
                'session_timeout_minutes' => 'integer', 'require_auth_code' => 'boolean',
                'max_failed_attempts' => 'integer', 'lockout_minutes' => 'integer',
                'geo_fencing_enabled' => 'boolean', 'login_hours_enabled' => 'boolean',
                'min_password_length' => 'integer', 'audit_retention_days' => 'integer',
            ],
            'department_access' => ['enabled' => 'boolean', 'bypass_roles' => 'json'],
            'payroll' => [
                'working_days_factor' => 'integer', 'hours_per_day' => 'integer',
                'first_half_pay_day' => 'integer', 'second_half_pay_day' => 'integer',
            ],
            'logistics' => ['handlingMinutes' => 'integer'],
            'timekeeping' => [
                'require_punch_pin' => 'boolean',
                'restrict_punch_to_areas' => 'boolean',
                'flag_shared_devices' => 'boolean',
                'shared_device_threshold' => 'integer',
                'burst_window_seconds' => 'integer',
                'pin_length' => 'integer',
            ],
            'operations' => [
                'auto_post_inventory' => 'boolean',
                'allow_negative_stock' => 'boolean',
                'enforce_credit_limits' => 'boolean',
                'batch_expiry_tracking' => 'boolean',
                'require_two_factor_for_approvers' => 'boolean',
                'lock_posted_periods' => 'boolean',
                'default_vat_rate' => 'integer',
            ],
            default => [],
        };
    }
}
