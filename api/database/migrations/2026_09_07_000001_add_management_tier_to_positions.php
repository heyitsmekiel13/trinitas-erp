<?php

use App\Models\Position;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The second axis of role-based access, alongside a person's functional
 * role (Sales Manager, HR Officer, ...): how much they can do and see
 * *within* whatever that function grants them.
 *
 * Backfilled from the same `level`/`is_managerial` columns the seeded
 * positions already carried — `level` turned out to already line up with
 * the three tiers almost exactly, so this makes that alignment an explicit,
 * named column instead of a number nobody could read the meaning of later.
 * The one place `level` and `is_managerial` disagreed (a level-2 position
 * not actually flagged managerial) is treated as rank-and-file, matching
 * what this app already does elsewhere for that same case.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('positions', function (Blueprint $table) {
            $table->enum('management_tier', ['rank_and_file', 'supervisory', 'top_management'])
                ->default('rank_and_file')
                ->after('is_managerial');
        });

        Position::query()->get(['id', 'level', 'is_managerial'])->each(function (Position $position) {
            $tier = match (true) {
                $position->level >= 3 => 'top_management',
                $position->level === 2 && $position->is_managerial => 'supervisory',
                default => 'rank_and_file',
            };

            $position->update(['management_tier' => $tier]);
        });
    }

    public function down(): void
    {
        Schema::table('positions', function (Blueprint $table) {
            $table->dropColumn('management_tier');
        });
    }
};
