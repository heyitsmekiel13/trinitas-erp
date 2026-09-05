<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PurchaseRequisition extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'requested_at' => 'date',
            'needed_by' => 'date',
        ];
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'requested_by');
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    /**
     * Named `items` rather than `lines` on purpose: the table already has a
     * `lines` column holding the count, and an attribute always shadows a
     * relation of the same name — `$model->lines` would silently hand back an
     * integer where a collection was expected.
     */
    public function items(): HasMany
    {
        return $this->hasMany(PurchaseRequisitionLine::class);
    }
}
