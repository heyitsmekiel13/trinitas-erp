<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Joins the warehouse to the documents that cause its work.
 *
 * Outbound and inbound both referenced their source document by a copied
 * string — `sales_order_no`, `reference`. A typo there silently orphans a pick
 * list from the order it is fulfilling, and nothing can be rolled up: you
 * cannot ask "how much of this order is picked" of a varchar. These are the
 * real foreign keys, with the old strings kept so existing rows still read.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('pick_lists', function (Blueprint $table) {
            $table->foreignId('sales_order_id')->nullable()->after('warehouse_id')
                ->constrained()->nullOnDelete();
            $table->dateTime('packed_at')->nullable()->after('cutoff_at');
            $table->dateTime('dispatched_at')->nullable()->after('packed_at');

            $table->index('sales_order_id');
        });

        Schema::table('inbound_shipments', function (Blueprint $table) {
            $table->foreignId('purchase_order_id')->nullable()->after('supplier_id')
                ->constrained()->nullOnDelete();

            $table->index('purchase_order_id');
        });
    }

    public function down(): void
    {
        Schema::table('inbound_shipments', function (Blueprint $table) {
            $table->dropConstrainedForeignId('purchase_order_id');
        });

        Schema::table('pick_lists', function (Blueprint $table) {
            $table->dropConstrainedForeignId('sales_order_id');
            $table->dropColumn(['packed_at', 'dispatched_at']);
        });
    }
};
