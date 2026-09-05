<?php

namespace App\Services;

use App\Models\User;

/**
 * Which of the ERP's business departments a signed-in person may reach.
 *
 * Generalises `ProcessOffice`'s own shape — one class every consumer asks,
 * so the middleware, the sidebar payload, and the admin screen can never
 * drift into disagreeing about who sees what. Where `ProcessOffice` decides
 * one fixed yes/no, this decides a *set* of departments, sourced from data
 * (`department_access_rules`) rather than a hardcoded map, because which
 * org-chart department corresponds to which nav department — and which
 * roles see everything regardless — is a business decision that changes
 * independently of this code.
 *
 * Off by default (`department_access.enabled`), and a department with no
 * configured rule sees nothing beyond the universal tools — both are
 * deliberate: this can lock a whole workforce out of tools they use today
 * the moment it is switched on, so nothing is restricted until an
 * administrator has actually set the mapping and turned it on.
 */
class DepartmentAccessGuard
{
    /**
     * The only path segments this ever restricts. Every other route —
     * `me`, `chat`, `tasks`, `support`, `admin`, `settings`, `notifications`,
     * `account`, `geo` — is universal and never reaches this class at all.
     * `after-sales` has no live backend routes yet (the module is preview
     * data only), so there is nothing to gate for it today; it is kept here
     * so a rule can already be configured ahead of that module going live.
     */
    public const DEPARTMENTS = ['sales', 'procurement', 'warehouse', 'maintenance', 'finance', 'hr', 'process', 'after-sales'];

    public function __construct(private readonly Settings $settings) {}

    public function enabled(): bool
    {
        return (bool) $this->settings->get('department_access', 'enabled', false);
    }

    /** @return list<string> Role codes that see every department. */
    public function bypassRoles(): array
    {
        $roles = $this->settings->get('department_access', 'bypass_roles');

        return is_array($roles) ? $roles : ['process-officer', 'process-manager', 'executive'];
    }

    /**
     * @return list<string>|'all'
     */
    public function allowedDepartments(User $user): array|string
    {
        if ($user->is_super_admin) {
            return 'all';
        }

        foreach ($this->bypassRoles() as $role) {
            if ($user->hasRole($role)) {
                return 'all';
            }
        }

        $rule = $user->employee?->hrDepartment?->accessRule;

        if (! $rule) {
            return [];
        }

        if ($rule->sees_all) {
            return 'all';
        }

        return $rule->allowed_departments ?? [];
    }

    public function canAccess(User $user, string $department): bool
    {
        $allowed = $this->allowedDepartments($user);

        return $allowed === 'all' || in_array($department, $allowed, true);
    }
}
