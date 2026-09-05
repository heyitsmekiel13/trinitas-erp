<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Project extends Model
{
    use SoftDeletes;

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'start_date' => 'date',
            'due_date' => 'date',
            'completed_on' => 'date',
            'archived_at' => 'datetime',
            'custom_field_defs' => 'array',
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

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'project_members')->withPivot('role')->withTimestamps();
    }

    public function memberRows(): HasMany
    {
        return $this->hasMany(ProjectMember::class);
    }

    public function sections(): HasMany
    {
        return $this->hasMany(ProjectSection::class)->orderBy('position');
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function labels(): HasMany
    {
        return $this->hasMany(Label::class);
    }

    /** Top-level tasks only — subtasks belong to their parent, not the board. */
    public function rootTasks(): HasMany
    {
        return $this->hasMany(Task::class)->whereNull('parent_id');
    }

    /**
     * Every project a person is allowed to read.
     *
     * The single source of truth for "can this person see it" — pulled out of
     * `ProjectController::visible()` so search and the cross-project task view
     * scope against the same rule instead of a second copy that quietly drifts
     * from the first. `$isOffice` is passed in rather than resolved here
     * because deciding office membership is `ProcessOffice`'s job, not the
     * model's.
     */
    public static function visibleTo(User $user, bool $isOffice = false): Builder
    {
        $query = static::query();

        if ($isOffice) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where('visibility', 'Company')
                ->orWhere('owner_id', $user->id)
                ->orWhereHas('members', fn ($m) => $m->whereKey($user->id));

            if ($user->employee?->hr_department_id) {
                $q->orWhere(function (Builder $d) use ($user) {
                    $d->where('visibility', 'Department')
                        ->where('hr_department_id', $user->employee->hr_department_id);
                });
            }
        });
    }
}
