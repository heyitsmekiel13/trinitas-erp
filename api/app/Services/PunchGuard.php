<?php

namespace App\Services;

use App\Models\AttendanceRecord;
use App\Models\Employee;
use App\Models\PunchEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Buddy-punch controls.
 *
 * Every employee signs in with the same default password, so the account proves
 * nothing about who pressed the button. Four layers narrow that, and it is
 * worth being clear about how much each one actually buys:
 *
 *  - A PIN, asked for at the punch rather than at sign-in. This is the real
 *    control. It does not make sharing impossible; it makes it a deliberate act
 *    between two people rather than something that happens because everybody
 *    already knows the one password.
 *  - Device recording. A shared terminal keeps one identifier, so one phone
 *    clocking in six people becomes visible. Trivially cleared by anyone who
 *    knows how — this is detection, not prevention.
 *  - Site fencing, reusing the Geo-IP areas. Stops the punch from a bed at
 *    home. City-level accurate at best.
 *  - Rapid-sequence detection. Six people punching from one device inside a
 *    minute is the classic signature and is worth surfacing even when every
 *    other check passed.
 *
 * Nothing here defeats two people who agree to share a PIN and stand at the
 * same terminal. It removes the casual case and leaves evidence for the rest.
 */
class PunchGuard
{
    /** Settings group holding the switches below. */
    public const SETTINGS_GROUP = 'timekeeping';

    public const DEFAULTS = [
        'require_punch_pin' => true,
        'restrict_punch_to_areas' => false,
        'flag_shared_devices' => true,
        // Distinct employees from one device in a day before it is suspicious.
        'shared_device_threshold' => 3,
        // Punches from one device inside this window count as a burst.
        'burst_window_seconds' => 120,
        'pin_length' => 4,
    ];

    public function __construct(
        private readonly Settings $settings,
        private readonly GeoGuard $geo,
        private readonly AuditLogger $audit,
    ) {}

    /** @return array<string, mixed> */
    public function config(): array
    {
        $stored = $this->settings->group(self::SETTINGS_GROUP);

        return array_merge(self::DEFAULTS, array_filter(
            $stored,
            fn ($value) => $value !== null && $value !== '',
        ));
    }

    /* ============================== The PIN ============================= */

    public function pinRequired(): bool
    {
        return (bool) $this->config()['require_punch_pin'];
    }

    public function hasPin(Employee $employee): bool
    {
        return filled($employee->punch_pin);
    }

    /**
     * Sets or changes an employee's PIN.
     *
     * Refuses the obvious ones. A PIN of 1234 protects nothing, and their own
     * employee number is the first thing a colleague would try.
     *
     * @throws ValidationException
     */
    public function setPin(Employee $employee, string $pin, ?string $currentPin = null): void
    {
        // Floored at four regardless of what the setting says. A misconfigured
        // length of zero would otherwise make `^\d{0}$` match the empty string
        // and hand everybody a PIN of nothing.
        $length = max(4, (int) $this->config()['pin_length']);

        if ($pin === '' || ! preg_match('/^\d{'.$length.'}$/', $pin)) {
            throw ValidationException::withMessages([
                'pin' => "Your PIN must be exactly {$length} digits.",
            ]);
        }

        // Changing an existing PIN requires the old one — otherwise anybody who
        // borrowed the shared password could lock the owner out of their own
        // timesheet.
        if ($this->hasPin($employee)) {
            if ($currentPin === null || ! Hash::check($currentPin, $employee->punch_pin)) {
                throw ValidationException::withMessages([
                    'currentPin' => 'That is not your current PIN.',
                ]);
            }
        }

        foreach ($this->weakPins($employee, $length) as $weak) {
            if ($pin === $weak) {
                throw ValidationException::withMessages([
                    'pin' => 'Pick something less guessable — not a run of digits, a repeat, or part of your employee number.',
                ]);
            }
        }

        $employee->forceFill([
            'punch_pin' => Hash::make($pin),
            'punch_pin_set_at' => now(),
        ])->save();

        $this->audit->log('set their punch PIN', 'Employee', $employee->id, $employee->full_name, 'hr');
    }

    /** @throws ValidationException */
    public function verifyPin(Employee $employee, ?string $pin): void
    {
        if (! $this->pinRequired()) {
            return;
        }

        if (! $this->hasPin($employee)) {
            throw ValidationException::withMessages([
                'pin' => 'Set your punch PIN before clocking in.',
            ]);
        }

        if (! $pin || ! Hash::check($pin, $employee->punch_pin)) {
            $this->audit->log(
                'failed a punch PIN check',
                'Employee',
                $employee->id,
                $employee->full_name,
                'hr',
            );

            throw ValidationException::withMessages([
                'pin' => 'That PIN is not correct.',
            ]);
        }
    }

    /* ============================= The place ============================ */

    /**
     * Refuses a punch from outside the sites the company operates from.
     *
     * Off by default: a fence that turns out to be wrong stops the whole
     * workforce clocking in, which is a worse Monday than a few dubious
     * punches.
     *
     * @throws ValidationException
     */
    public function verifyLocation(?string $ip): void
    {
        if (! $this->config()['restrict_punch_to_areas']) {
            return;
        }

        if (! $ip || ! $this->geo->allows($ip)) {
            throw ValidationException::withMessages([
                'location' => 'You can only clock in from a company site.',
            ]);
        }
    }

    /* ============================ The record ============================ */

    /**
     * Writes the press down and says whether it looked wrong.
     *
     * Recording happens either way — a flagged punch is still a punch, and
     * refusing it would hand every employee a way to be marked absent by a
     * colleague sharing their device.
     *
     * @return array{event: PunchEvent, flagged: bool, reason: ?string}
     */
    public function record(
        Employee $employee,
        AttendanceRecord $record,
        string $action,
        ?string $deviceId,
        ?string $ip,
        ?string $userAgent,
    ): array {
        $reason = $this->suspicion($employee, $deviceId, $ip);

        $event = PunchEvent::create([
            'employee_id' => $employee->id,
            'attendance_record_id' => $record->id,
            'action' => $action,
            'punched_at' => now(),
            'device_id' => $deviceId,
            'ip_address' => $ip,
            'user_agent' => $userAgent ? substr($userAgent, 0, 255) : null,
            'is_flagged' => $reason !== null,
            'flag_reason' => $reason,
            'recorded_by' => auth()->id(),
        ]);

        if ($reason) {
            $this->audit->log(
                'recorded a suspicious punch',
                'PunchEvent',
                $event->id,
                $employee->full_name.' — '.$reason,
                'hr',
            );
        }

        return ['event' => $event, 'flagged' => $reason !== null, 'reason' => $reason];
    }

    /**
     * Why this punch looks like somebody else's.
     *
     * Returns the reason, or null when nothing stands out.
     */
    private function suspicion(Employee $employee, ?string $deviceId, ?string $ip): ?string
    {
        $config = $this->config();

        if (! $config['flag_shared_devices'] || ! $deviceId) {
            return null;
        }

        $since = CarbonImmutable::now()->startOfDay();

        $others = PunchEvent::query()
            ->where('device_id', $deviceId)
            ->where('punched_at', '>=', $since)
            ->whereNot('employee_id', $employee->id)
            ->distinct()
            ->pluck('employee_id');

        // A burst is the strongest signal: several people, one device, moments
        // apart. Checked first because it is the one worth naming precisely.
        $burstWindow = CarbonImmutable::now()->subSeconds((int) $config['burst_window_seconds']);

        $burst = PunchEvent::query()
            ->where('device_id', $deviceId)
            ->where('punched_at', '>=', $burstWindow)
            ->whereNot('employee_id', $employee->id)
            ->distinct()
            ->count('employee_id');

        if ($burst >= 2) {
            return sprintf(
                '%d other employees punched from this device within %d seconds.',
                $burst,
                (int) $config['burst_window_seconds'],
            );
        }

        $threshold = (int) $config['shared_device_threshold'];

        if ($others->count() + 1 > $threshold) {
            return sprintf(
                'This device has been used by %d employees today (limit %d).',
                $others->count() + 1,
                $threshold,
            );
        }

        return null;
    }

    /* ---------------------------------------------------------------------- */

    /** @return array<int, string> */
    private function weakPins(Employee $employee, int $length): array
    {
        $weak = [];

        // Runs and repeats: 1234, 0000, 1111…
        $ascending = substr('0123456789', 0, $length);
        $weak[] = $ascending;
        $weak[] = strrev($ascending);
        $weak[] = substr('1234567890', 0, $length);

        for ($digit = 0; $digit <= 9; $digit++) {
            $weak[] = str_repeat((string) $digit, $length);
        }

        // Anything a colleague could read off their ID badge.
        $digits = preg_replace('/\D+/', '', (string) $employee->employee_no);
        if (strlen((string) $digits) >= $length) {
            $weak[] = substr((string) $digits, -$length);
            $weak[] = substr((string) $digits, 0, $length);
        }

        if ($employee->birth_date) {
            $birth = CarbonImmutable::parse($employee->birth_date);
            $weak[] = $birth->format('md');
            $weak[] = $birth->format('dm');
            $weak[] = $birth->format('Y');
        }

        return array_values(array_unique(array_filter($weak, fn ($p) => strlen((string) $p) === $length)));
    }
}
