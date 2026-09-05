<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TrainingCourse extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_mandatory' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    /** Every time this course has been run. */
    public function sessions(): HasMany
    {
        return $this->hasMany(TrainingSession::class);
    }

    /** Every certificate this course has issued. */
    public function records(): HasMany
    {
        return $this->hasMany(TrainingRecord::class);
    }
}
