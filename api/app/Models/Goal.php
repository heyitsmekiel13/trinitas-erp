<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Goal extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'due_on' => 'date',
            'target_value' => 'decimal:2',
            'current_value' => 'decimal:2',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    public function projects(): BelongsToMany
    {
        return $this->belongsToMany(Project::class, 'goal_project');
    }

    /**
     * How far along, as a percentage.
     *
     * Three sources, in order of how much they should be trusted: a number
     * somebody set by hand, the measurable target, and failing both, the
     * progress of the projects underneath it. The last is a proxy — finishing
     * the work is not the same as achieving the outcome — which is why it is
     * the fallback rather than the rule.
     */
    public function progress(): int
    {
        if ($this->progress_override !== null) {
            return (int) $this->progress_override;
        }

        if ($this->target_value !== null && (float) $this->target_value > 0) {
            return (int) min(100, round(((float) $this->current_value / (float) $this->target_value) * 100));
        }

        $projects = $this->projects;

        if ($projects->isEmpty()) {
            return 0;
        }

        $done = $projects->sum(fn ($p) => $p->tasks()->whereNotNull('completed_at')->count());
        $total = $projects->sum(fn ($p) => $p->tasks()->count());

        return $total > 0 ? (int) round(($done / $total) * 100) : 0;
    }
}
