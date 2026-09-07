<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Position extends Model
{
    /** The management tiers a position can carry, from least to most authority. */
    public const TIER_RANK_AND_FILE = 'rank_and_file';

    public const TIER_SUPERVISORY = 'supervisory';

    public const TIER_TOP_MANAGEMENT = 'top_management';

    public const TIERS = [self::TIER_RANK_AND_FILE, self::TIER_SUPERVISORY, self::TIER_TOP_MANAGEMENT];

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_managerial' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }
}
