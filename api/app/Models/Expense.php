<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Expense extends Model
{
    protected $guarded = [];

    /** Which expense account each category lands in by default. */
    public const CATEGORY_ACCOUNTS = [
        'Travel' => '5250',
        'Meals' => '5280',
        'Fuel' => '5250',
        'Supplies' => '5240',
        'Representation' => '5280',
        'Utilities' => '5240',
        'Repairs' => '5260',
        'Communication' => '5240',
    ];

    protected function casts(): array
    {
        return ['expense_date' => 'date'];
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function hrDepartment(): BelongsTo
    {
        return $this->belongsTo(HrDepartment::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class);
    }
}
