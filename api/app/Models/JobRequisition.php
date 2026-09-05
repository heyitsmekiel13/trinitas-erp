<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class JobRequisition extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'needed_by' => 'date',
        ];
    }

    public function position(): BelongsTo
    {
        return $this->belongsTo(Position::class);
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    public function branchUnit(): BelongsTo
    {
        return $this->belongsTo(BranchUnit::class);
    }

    /** The manager who raised the request. */
    public function requester(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'requested_by');
    }

    public function applicants(): HasMany
    {
        return $this->hasMany(Applicant::class);
    }

    /** Seats still to fill. Never negative, however the counters were edited. */
    public function openings(): int
    {
        return max(0, (int) $this->headcount - (int) $this->filled);
    }

    /** Who put it away, for the archive listing. */
    public function archivedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'archived_by');
    }
}
