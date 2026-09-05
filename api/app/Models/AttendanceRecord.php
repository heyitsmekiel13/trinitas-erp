<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendanceRecord extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'work_date' => 'date',
            // Full timestamps, because a night shift ends on the next day and
            // a clock time cannot say which.
            'clock_in_at' => 'datetime',
            'break_out_at' => 'datetime',
            'break_in_at' => 'datetime',
            'clock_out_at' => 'datetime',
            'ot_clock_in_at' => 'datetime',
            'ot_clock_out_at' => 'datetime',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }
}
