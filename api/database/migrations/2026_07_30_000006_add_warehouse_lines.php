<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gives transfers and cycle counts something to move and something to correct.
 *
 * Both were header-only: a transfer knew it moved "4 lines, 220 units, worth
 * ₱X" without recording which items, and a count knew it found "3 variances"
 * without recording what they were. Neither can touch stock in that state —
 * you cannot decrement a balance you cannot name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_transfer_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('stock_transfer_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            // Value is captured at dispatch so a later revaluation of the item
            // does not rewrite what this transfer was worth at the time.
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->decimal('line_total', 14, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('cycle_count_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cycle_count_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            // What the system thought was there when the count sheet was drawn.
            $table->decimal('system_quantity', 14, 2)->default(0);
            // What the counter actually found.
            $table->decimal('counted_quantity', 14, 2)->default(0);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->string('note', 190)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cycle_count_lines');
        Schema::dropIfExists('stock_transfer_lines');
    }
};
