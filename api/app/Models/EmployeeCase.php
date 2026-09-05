<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeCase extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'reported_on' => 'date',
            'hearing_on' => 'date',
        ];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function handler(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'handled_by');
    }
}
