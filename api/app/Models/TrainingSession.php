<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** One run of a training course: when it happened and who was in the room. */
class TrainingSession extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'scheduled_on' => 'date',
            'ends_on' => 'date',
            'completed_at' => 'datetime',
        ];
    }

    public function course(): BelongsTo
    {
        return $this->belongsTo(TrainingCourse::class, 'training_course_id');
    }

    public function attendees(): HasMany
    {
        return $this->hasMany(TrainingAttendee::class);
    }

    public function records(): HasMany
    {
        return $this->hasMany(TrainingRecord::class);
    }

    /** What to call this run — its own title, else the course it teaches. */
    public function displayTitle(): string
    {
        return $this->title ?: ($this->course->name ?? 'Training session');
    }
}
