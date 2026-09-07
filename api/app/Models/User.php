<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    // Writes come through validated form requests, so mass assignment is open.
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_super_admin' => 'boolean',
            'last_seen_at' => 'datetime',
            'requires_auth_code' => 'boolean',
            'must_change_password' => 'boolean',
            'password_changed_at' => 'datetime',
            'locked_until' => 'datetime',
            'last_login_at' => 'datetime',
            'deactivate_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // Reactivating an account is not a schedule change — it is calling
        // the schedule off. Without this, setting status back to Active while
        // an old `deactivate_at` is still on the row would leave the account
        // working today and silently deactivated again the next time the
        // scheduled command runs, which reads as the reactivation failing.
        static::saving(function (self $user) {
            if ($user->isDirty('status') && $user->status === 'Active') {
                $user->deactivate_at = null;
            }
        });
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }

    /* -------------------------------------------------------------------- */
    /* Authorisation                                                        */
    /* -------------------------------------------------------------------- */

    /**
     * A super admin bypasses the permission table entirely — otherwise a
     * misconfigured role could lock every administrator out of the system.
     */
    public function hasPermission(string $code): bool
    {
        if ($this->is_super_admin) {
            return true;
        }

        return $this->roles()
            ->whereHas('permissions', fn ($query) => $query->where('code', $code))
            ->exists();
    }

    public function hasRole(string $code): bool
    {
        return $this->is_super_admin || $this->roles()->where('code', $code)->exists();
    }

    /**
     * Whether this account may act on a record belonging to `$owner`.
     *
     * Two independent ways in, either is enough: the functional permission
     * (a named role granting `$permissionCode`, e.g. an HR Officer's
     * `hr.edit`) works regardless of who the record belongs to, since that
     * role's whole job is that module. Failing that, this account's own
     * management tier can still grant it — a Top Management position with
     * no HR role at all can still act on HR's records, and a Supervisory
     * position can act on their own branch's, because deciding a person's
     * own team's leave or requisition is that position's job whether or not
     * it happens to carry the matching department's functional role.
     *
     * Rank-and-file gets nothing from this method — their only access to
     * someone else's record is the functional permission above; acting on
     * their *own* record while it is still theirs to change is a separate,
     * narrower rule each resource's own guard applies itself.
     */
    public function canActOnRecordOf(?Employee $owner, string $permissionCode): bool
    {
        if ($this->hasPermission($permissionCode)) {
            return true;
        }

        $actor = $this->employee;
        if (! $actor || ! $owner) {
            return false;
        }

        return match ($actor->position?->management_tier) {
            Position::TIER_TOP_MANAGEMENT => true,
            Position::TIER_SUPERVISORY => $actor->branch_unit_id !== null
                && $actor->branch_unit_id === $owner->branch_unit_id,
            default => false,
        };
    }

    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until->isFuture();
    }

    /** The shape the React auth store expects. */
    public function toAuthPayload(): array
    {
        // hrDepartment as well as branchUnit: the Process & Performance flag
        // below is decided partly from the person's department. `position`
        // is loaded for `isManagerial`, which decides whether this account
        // lands on Command Center or its own Self Service page.
        $this->loadMissing(['roles.permissions', 'employee.branchUnit', 'employee.hrDepartment', 'employee.position']);

        return [
            'id' => (string) $this->id,
            'name' => $this->name,
            'username' => $this->username,
            'email' => $this->email,
            'role' => $this->is_super_admin
                ? 'System Administrator'
                : ($this->roles->first()->name ?? 'No role assigned'),
            'branch' => $this->employee?->branchUnit?->code ?? 'Head Office',
            'employeeNo' => $this->employee?->employee_no,
            // Whether the person's own position is flagged managerial in
            // Org & Positions. Only meaningful for an account mapped to an
            // employee at all — `employeeNo` is what the client checks
            // first, since a system/IT account with no employee record is
            // never subject to this either way.
            'isManagerial' => (bool) ($this->employee?->position?->is_managerial ?? false),
            // The role-based access tier: rank_and_file, supervisory or
            // top_management — see `Position::TIERS`. Null for an account
            // with no employee record, the same cases `isManagerial` above
            // is meaningless for.
            'managementTier' => $this->employee?->position?->management_tier,
            // The department the person belongs to, so a form charged to a
            // department can fill it in rather than ask.
            'departmentId' => $this->employee?->hr_department_id,
            'department' => $this->employee?->hrDepartment?->name,
            // The client uses this to force the change screen; the API enforces
            // it independently via the EnsurePasswordChanged middleware.
            'mustChangePassword' => (bool) $this->must_change_password,
            'permissions' => $this->is_super_admin
                ? ['*']
                : $this->roles->flatMap->permissions->pluck('code')->unique()->values()->all(),
            /*
             * Whether this account belongs to the Process & Performance office.
             *
             * The client uses it to decide whether the compliance screens exist
             * in the menu at all. It is not the control — every compliance
             * route is behind the `process-office` middleware, which answers
             * 404 to anybody else. This only stops the app offering a person a
             * page that would refuse them.
             */
            'processOffice' => app(\App\Services\ProcessOffice::class)->includes($this),
            /*
             * Which business departments this account may see — a courtesy
             * for the sidebar to filter itself with, exactly like the flag
             * above. Not the control: `department-access` middleware is
             * what actually refuses a route, and answers the same whether
             * or not the client bothered to hide the menu item first.
             * `'all'` when the feature is off, so the sidebar never has to
             * know the feature exists to render correctly either way.
             */
            'allowedDepartments' => app(\App\Services\DepartmentAccessGuard::class)->enabled()
                ? app(\App\Services\DepartmentAccessGuard::class)->allowedDepartments($this)
                : 'all',
        ];
    }
}
