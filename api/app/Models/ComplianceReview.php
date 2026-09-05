<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ComplianceReview extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'follow_up_on' => 'date',
            'reviewed_at' => 'datetime',
            'disclosed_at' => 'datetime',
            'subject_responded_at' => 'datetime',
            'office_replied_at' => 'datetime',
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

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    public function discloser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'disclosed_by');
    }

    /** The disciplinary case this became, where it went that far. */
    public function escalatedCase(): BelongsTo
    {
        return $this->belongsTo(EmployeeCase::class, 'escalated_case_id');
    }

    /** Whether the subject has been told this exists. */
    public function isDisclosed(): bool
    {
        return $this->disclosed_at !== null;
    }
}
