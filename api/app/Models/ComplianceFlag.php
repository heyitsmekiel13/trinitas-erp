<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An automatic observation by the Process & Performance office.
 *
 * Never loaded on a route the subject can reach. See ProcessOffice.
 */
class ComplianceFlag extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'detail' => 'array',
            'observed_on' => 'date',
            'acknowledged_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** The person the observation is about. */
    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_id');
    }
}
