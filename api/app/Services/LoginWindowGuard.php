<?php

namespace App\Services;

use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * Whether the clock, not the map, says somebody may sign in right now.
 *
 * `GeoGuard` decides *where* a sign-in may come from; this decides *when* —
 * a separate concern with separate inputs, so it stays a separate class
 * rather than a second responsibility bolted onto the first.
 *
 * Off by default. A restriction like this can lock out a whole workforce at
 * once if it is ever wrong, so `Admin → System Settings → Security` has to
 * turn it on deliberately — it is never the default an install starts with.
 *
 * Three things exempt a sign-in from the window entirely, checked before
 * anything about a shift: the account being a super administrator, holding a
 * role that runs people rather than clocks in against a schedule
 * (supervisor, executive, anything ending `-manager`), or simply having no
 * shift assigned — the same reasoning `TimeClock::recompute()` already
 * applies to late/undertime: nothing to be restricted against is not a
 * restriction, it is a gap in the data.
 */
class LoginWindowGuard
{
    public function __construct(private readonly Settings $settings) {}

    public function enabled(): bool
    {
        return (bool) $this->settings->get('security', 'login_hours_enabled', false);
    }

    public function allows(User $user, ?CarbonImmutable $now = null): bool
    {
        if (! $this->enabled() || $this->isExempt($user)) {
            return true;
        }

        $window = $this->windowFor($user);

        if (! $window) {
            return true;
        }

        $now ??= CarbonImmutable::now();

        return $now->gte($window['start']) && $now->lte($window['end']);
    }

    /** The window a rejected sign-in was measured against, for the error message. */
    public function windowFor(User $user): ?array
    {
        $employee = $user->employee;
        $shift = $employee?->shift;

        if (! $shift) {
            return null;
        }

        $day = CarbonImmutable::now()->toDateString();
        $grace = (int) $shift->grace_minutes;

        $start = CarbonImmutable::parse($day.' '.$shift->starts_at)->subMinutes($grace);
        $end = CarbonImmutable::parse($day.' '.$shift->ends_at)->addMinutes($grace);

        if ($shift->is_night_shift && $end->lte($start)) {
            $end = $end->addDay();
        }

        // A night shift's window can start yesterday from "now"'s point of
        // view — if we are before today's start but the shift wrapped past
        // midnight, the window that actually covers this moment is
        // yesterday's, not today's.
        if ($shift->is_night_shift && CarbonImmutable::now()->lt($start)) {
            $start = $start->subDay();
            $end = $end->subDay();
        }

        return [
            'start' => $start,
            'end' => $end,
            'shiftName' => $shift->name,
        ];
    }

    private function isExempt(User $user): bool
    {
        if ($user->is_super_admin) {
            return true;
        }

        return $user->roles()->get()->pluck('code')->contains(
            fn (string $code) => $code === 'supervisor' || $code === 'executive' || str_ends_with($code, '-manager'),
        );
    }
}
