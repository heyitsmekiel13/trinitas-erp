<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OffboardingCase extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'last_working_day' => 'date',
            'exit_interview_completed' => 'boolean',
            'closed_at' => 'datetime',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function initiatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'initiated_by');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(OffboardingTask::class);
    }
}
