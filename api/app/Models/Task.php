<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * The atom of the work system.
 *
 * Status is not a column here. It lives on the section the task sits in, so
 * the board, the list view and every report read the same fact — the class of
 * bug where a card is "Done" on a board and "In progress" in a report cannot
 * be written.
 */
class Task extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'due_date' => 'date',
            'original_due_date' => 'date',
            'completed_at' => 'datetime',
            'estimate_hours' => 'decimal:2',
            'logged_hours' => 'decimal:2',
            'custom_fields' => 'array',
        ];
    }

    /* ------------------------------ Relations ------------------------------ */

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function section(): BelongsTo
    {
        return $this->belongsTo(ProjectSection::class, 'section_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(static::class, 'parent_id');
    }

    public function subtasks(): HasMany
    {
        return $this->hasMany(static::class, 'parent_id')->orderBy('position');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_id');
    }

    /** Who ticked it — not always the person it was assigned to. */
    public function completedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'completed_by');
    }

    public function labels(): BelongsToMany
    {
        return $this->belongsToMany(Label::class);
    }

    public function watchers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'task_watchers')->withTimestamps();
    }

    public function comments(): HasMany
    {
        return $this->hasMany(TaskComment::class)->orderBy('created_at');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(TaskAttachment::class)->orderBy('id');
    }

    public function activity(): HasMany
    {
        return $this->hasMany(TaskActivity::class)->orderByDesc('occurred_at');
    }

    /** Tasks this one waits on. */
    public function dependencies(): HasMany
    {
        return $this->hasMany(TaskDependency::class);
    }

    /** Tasks waiting on this one. */
    public function dependents(): HasMany
    {
        return $this->hasMany(TaskDependency::class, 'depends_on_id');
    }

    public function notices(): HasMany
    {
        return $this->hasMany(TaskNotice::class);
    }

    /* ------------------------------- Derived ------------------------------- */

    public function isDone(): bool
    {
        return $this->completed_at !== null;
    }

    /**
     * Working days past due. Negative is time remaining, null is no deadline.
     *
     * Measured against completion when the task is finished and against today
     * when it is not, so "three days late" stays three days late for ever
     * rather than growing after the fact.
     *
     * Working days, not calendar days, and this was a real defect rather than
     * a refinement: due dates were derived by counting working days forward
     * while lateness was counted in calendar days, so work due on a Friday and
     * delivered on the Monday reported three days late when one working day
     * had passed. Weekends and public holidays now drop out of both halves of
     * the same measure.
     *
     * Leave is subtracted too. A deadline should not quietly consume somebody's
     * approved annual leave, and a task that sat across a week off is not a
     * week late.
     */
    public function daysLate(): ?int
    {
        if (! $this->due_date) {
            return null;
        }

        $calendar = app(\App\Services\WorkingCalendar::class);
        $against = $this->completed_at?->copy()->startOfDay() ?? now()->startOfDay();

        $days = $calendar->workingDaysBetween($this->due_date, $against);

        if ($days <= 0) {
            return $days;
        }

        /*
         * Leave and blocked time come off. Both are days the assignee could
         * not have delivered on — one because they were not at work, the other
         * because the task was waiting on somebody else — and holding a person
         * to a date they did not control is how a register stops being taken
         * seriously.
         *
         * Only ever reduces lateness, never creates it.
         */
        $excused = $calendar->leaveDaysBetween($this->assignee, $this->due_date, $against)
            + (int) $this->blocked_days;

        return max(0, $days - $excused);
    }

    /**
     * Elapsed calendar days, for the places that genuinely mean wall-clock.
     *
     * Ageing a support queue or asking "how long has this been sitting there"
     * is a question about real time, not about working time.
     */
    public function calendarDaysLate(): ?int
    {
        if (! $this->due_date) {
            return null;
        }

        $against = $this->completed_at?->copy()->startOfDay() ?? now()->startOfDay();

        return (int) $this->due_date->copy()->startOfDay()->diffInDays($against, false);
    }

    /** Whether something it depends on is still open. */
    public function isBlocked(): bool
    {
        return $this->dependencies()
            ->where('type', 'blocks')
            ->whereHas('dependsOn', fn ($q) => $q->whereNull('completed_at'))
            ->exists();
    }

    /**
     * Working days from raised to finished — the cycle time.
     *
     * Null while the task is open. This is the measure that says whether the
     * process is getting faster, which is the question a process office exists
     * to answer and could not previously ask.
     */
    public function cycleDays(): ?int
    {
        if (! $this->completed_at || ! $this->created_at) {
            return null;
        }

        return app(\App\Services\WorkingCalendar::class)
            ->workingDaysBetween($this->created_at, $this->completed_at);
    }

    /* -------------------------------- Scopes ------------------------------- */

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('completed_at');
    }

    public function scopeOverdue(Builder $query): Builder
    {
        return $query->whereNull('completed_at')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '<', now()->toDateString());
    }

    /** Open, dated, and inside the window — the "coming up" list. */
    public function scopeDueWithin(Builder $query, int $days): Builder
    {
        return $query->whereNull('completed_at')
            ->whereNotNull('due_date')
            ->whereDate('due_date', '>=', now()->toDateString())
            ->whereDate('due_date', '<=', now()->addDays($days)->toDateString());
    }
}
