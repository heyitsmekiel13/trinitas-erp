<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Warehouse5sAudit extends Model
{
    protected $table = 'warehouse_5s_audits';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['audited_on' => 'date'];
    }

    /** Out of 25 — five pillars scored 1-5 each. */
    public function getTotalScoreAttribute(): int
    {
        return (int) $this->sort_score + (int) $this->set_score + (int) $this->shine_score
            + (int) $this->standardize_score + (int) $this->sustain_score;
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function auditor(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'audited_by');
    }
}
