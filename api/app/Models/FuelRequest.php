<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FuelRequest extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'depart_at' => 'datetime',
            'decided_at' => 'datetime',
            'round_trip' => 'boolean',
            'products' => 'array',
            'distance_km' => 'decimal:2',
            'km_per_litre' => 'decimal:2',
            'suggested_litres' => 'decimal:2',
            'approved_litres' => 'decimal:2',
            'fuel_price' => 'decimal:2',
            'estimated_cost' => 'decimal:2',
            'mileage_rate' => 'decimal:2',
            'mileage_amount' => 'decimal:2',
        ];
    }

    /**
     * The product tick-list on the printed order form.
     *
     * Verbatim from the pad, including the punctuation, because the service
     * station reads this off the paper and "Diesel MAX" and "Diesel - MAX" are
     * the same fuel to a person and two different strings to a report.
     */
    public const PRODUCTS = [
        'Diesel - MAX',
        'Diesel - TURBO',
        'Advance - XTRA',
        'XCS - EURO 4',
        'Lubricant',
        'Engine Oil',
        'Coolant',
    ];

    /** The three ownership boxes, as printed. */
    public const OWNERSHIP = ['CO', 'PO', 'R&C'];

    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /** The legs of the trip, in the order they're driven. */
    public function legs(): HasMany
    {
        return $this->hasMany(FuelRequestLeg::class)->orderBy('sequence');
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'driver_id');
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_id');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_id');
    }

    public function fuelLog(): BelongsTo
    {
        return $this->belongsTo(FuelLog::class);
    }

    /**
     * When the truck should arrive, if it leaves when it said it would.
     *
     * Derived rather than stored: an ETA is only ever the departure plus the
     * routed duration, and storing it means two columns that can disagree the
     * moment somebody moves the departure time.
     */
    public function getEtaAttribute(): ?\Illuminate\Support\Carbon
    {
        return $this->depart_at?->copy()->addMinutes((int) $this->duration_minutes);
    }

    /**
     * Who may decide on a fuel request.
     *
     * A superadmin-maintained list (`fuel_approvers`), not a guess about role
     * names: a row names either a specific person or a whole role, and is
     * only ever active or not. `is_super_admin` is a permanent bypass — an
     * administrator locked out of Admin → Fuel Approvers must still be able
     * to fix that, which they cannot do if they cannot approve anything.
     */
    public static function canApprove(?User $user): bool
    {
        if (! $user) {
            return false;
        }

        if ($user->is_super_admin) {
            return true;
        }

        $roleIds = $user->roles()->pluck('roles.id');

        return FuelApprover::query()
            ->where('active', true)
            ->where(function ($query) use ($user, $roleIds) {
                $query->where('user_id', $user->id)
                    ->orWhereIn('role_id', $roleIds);
            })
            ->exists();
    }

    /** The role or the reason a decision was made under, for the signature block. */
    public static function approverRole(User $user): string
    {
        if ($user->is_super_admin) {
            return 'System Administrator';
        }

        $roleIds = $user->roles()->pluck('roles.id');

        $approver = FuelApprover::query()
            ->where('active', true)
            ->where(function ($query) use ($user, $roleIds) {
                $query->where('user_id', $user->id)
                    ->orWhereIn('role_id', $roleIds);
            })
            ->with('role')
            ->first();

        return $approver?->role?->name ?? 'Fuel Approver';
    }
}
