<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskTimeEntry extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['started_at' => 'datetime', 'stopped_at' => 'datetime', 'manual' => 'boolean'];
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** A timer still counting. */
    public function isRunning(): bool
    {
        return $this->stopped_at === null;
    }

    /** Minutes so far, including a timer that has not been stopped. */
    public function elapsedMinutes(): int
    {
        return $this->isRunning()
            ? (int) $this->started_at->diffInMinutes(now())
            : (int) $this->minutes;
    }
}
