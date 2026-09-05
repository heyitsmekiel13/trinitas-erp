<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A rule that produces a task on a schedule.
 *
 * Not a task itself — see the migration for why the two must stay apart.
 */
class TaskRecurrence extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'starts_on' => 'date',
            'ends_on' => 'date',
            'next_run_on' => 'date',
            'last_run_on' => 'date',
            'is_active' => 'boolean',
            'estimate_hours' => 'decimal:2',
        ];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(ProjectSection::class, 'section_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    /** Every task this rule has produced. */
    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class, 'recurrence_id');
    }

    /** Whether it should still be producing anything. */
    public function isLive(): bool
    {
        return $this->is_active && (! $this->ends_on || $this->ends_on->gte(now()->startOfDay()));
    }

    /** Plain English, for a list somebody has to scan. */
    public function describe(): string
    {
        $days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        return match ($this->frequency) {
            'Daily' => 'Every working day',
            'Weekly' => 'Every '.($days[$this->weekday] ?? 'Monday'),
            'Fortnightly' => 'Every other '.($days[$this->weekday] ?? 'Monday'),
            'Monthly' => $this->day_of_month === 0
                ? 'On the last working day of the month'
                : 'On day '.$this->day_of_month.' of each month',
            'Quarterly' => 'At the start of each quarter',
            'Yearly' => 'Once a year',
            default => $this->frequency,
        };
    }
}
