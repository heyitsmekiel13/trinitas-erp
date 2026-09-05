<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One press of the clock.
 *
 * `attendance_records` holds the day; this holds how the day was built. When
 * somebody asks "did she actually clock herself in?", the answer lives here —
 * the device, the address, and whether anything about it looked wrong at the
 * time.
 */
class PunchEvent extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'punched_at' => 'datetime',
            'is_flagged' => 'boolean',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function attendanceRecord(): BelongsTo
    {
        return $this->belongsTo(AttendanceRecord::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by');
    }
}
