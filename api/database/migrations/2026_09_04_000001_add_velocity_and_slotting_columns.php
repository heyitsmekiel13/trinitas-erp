<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The columns real ABC-driven slotting needs.
 *
 * `items.abc_class_computed_at` is what turns `abc_class` from "whatever
 * somebody typed" into a fact with a timestamp — the recompute stamps it, a
 * manual override leaves it stale, and the UI can finally tell the two apart.
 *
 * `warehouse_bins.preferred_class` is a one-time setup choice, not derived:
 * somebody who knows the floor tags a zone as where the fast movers live.
 * Nullable, because most bins will never be tagged and that is fine — a
 * putaway suggestion for an untagged item just has less to go on.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->timestamp('abc_class_computed_at')->nullable()->after('abc_class');
        });

        Schema::table('warehouse_bins', function (Blueprint $table) {
            $table->enum('preferred_class', ['A', 'B', 'C'])->nullable()->after('aisle');
        });
    }

    public function down(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->dropColumn('abc_class_computed_at');
        });

        Schema::table('warehouse_bins', function (Blueprint $table) {
            $table->dropColumn('preferred_class');
        });
    }
};
