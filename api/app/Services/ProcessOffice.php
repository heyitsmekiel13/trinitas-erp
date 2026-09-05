<?php

namespace App\Services;

use App\Models\User;

/**
 * Who belongs to the Process & Performance office.
 *
 * The whole point of the compliance layer is that the people being measured
 * cannot see the measurement. That asymmetry is worth stating plainly: a
 * finding an assignee can read is a finding they will contest before it is
 * recorded, and a scorecard somebody can watch is a scorecard they will
 * manage rather than a record of what happened.
 *
 * So membership is decided in exactly one place. Every compliance route asks
 * this class, the middleware asks this class, and the payload that decides
 * whether the React app renders the menu asks this class — three consumers,
 * one answer, no drift.
 *
 * Three ways in, in order of how deliberate they are:
 *
 *   1. The `process-officer` or `process-manager` role. The intended route:
 *      IT grants it, and Users & Roles shows who has it.
 *   2. The person's HR department. Convenience, because the office already
 *      exists in the org chart and re-entering it as a role is a second copy
 *      of the same fact — with the usual consequence when they disagree.
 *   3. Super administrator, who bypasses every permission in the system and
 *      would find another way in regardless.
 */
class ProcessOffice
{
    /**
     * HR department codes that mean the office.
     *
     * Two spellings are live in the masterfile — "PERFORMANCE AND PROCESS"
     * and "PROCESS AND PERFORMANCE DEPARTMENT" — and matching only one would
     * silently lock out half the office. Matched loosely for the same reason.
     */
    private const DEPARTMENT_HINTS = ['PROCESS AND PERFORMANCE', 'PERFORMANCE AND PROCESS'];

    public const ROLES = ['process-officer', 'process-manager'];

    public function includes(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        if ($user->is_super_admin) {
            return true;
        }

        foreach (self::ROLES as $role) {
            if ($user->hasRole($role)) {
                return true;
            }
        }

        return $this->inDepartment($user);
    }

    /**
     * Whether the person's 201 file puts them in the office.
     *
     * Normalised on both sides — the masterfile carries codes with and
     * without the word "DEPARTMENT", and an exact match would turn a typo in
     * an import into a silent loss of access.
     */
    private function inDepartment(User $user): bool
    {
        $code = $user->employee?->hrDepartment?->code;

        if (! $code) {
            return false;
        }

        $normalised = strtoupper(preg_replace('/[^A-Z ]/i', '', $code) ?? '');

        foreach (self::DEPARTMENT_HINTS as $hint) {
            if (str_contains($normalised, $hint)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Everyone in the office.
     *
     * Used to route an escalation: when a deadline has been missed long
     * enough that chasing the assignee has demonstrably not worked, the
     * notice goes here instead.
     */
    public function members()
    {
        return User::query()
            ->where('status', 'Active')
            ->with('employee.hrDepartment')
            ->get()
            ->filter(fn (User $u) => ! $u->is_super_admin && $this->includes($u))
            ->values();
    }
}
