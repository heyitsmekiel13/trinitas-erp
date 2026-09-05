<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DepartmentAccessRule extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'allowed_departments' => 'array',
            'sees_all' => 'boolean',
        ];
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }
}
