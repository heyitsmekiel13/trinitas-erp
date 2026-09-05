<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory.
 *
 * Stock is held per warehouse / bin / batch rather than as a single number on
 * the item, because a distributor needs to know *where* and *which batch* —
 * expiry drives write-offs, and bins drive picking.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('warehouses', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 150);
            $table->enum('type', ['Distribution Center', 'Branch Warehouse', 'Transit Hub'])->default('Branch Warehouse');
            $table->string('city', 80)->nullable();
            $table->enum('region', ['NCR', 'Luzon', 'Visayas', 'Mindanao'])->default('Mindanao');
            $table->unsignedInteger('capacity_pallets')->default(0);
            $table->unsignedInteger('used_pallets')->default(0);
            $table->foreignId('manager_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('warehouse_bins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('warehouse_id')->constrained()->cascadeOnDelete();
            $table->string('code', 32);
            $table->string('zone', 16)->nullable();
            $table->string('aisle', 16)->nullable();
            $table->unsignedInteger('capacity')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['warehouse_id', 'code']);
        });

        Schema::create('items', function (Blueprint $table) {
            $table->id();
            $table->string('sku', 48)->unique();
            $table->string('name', 190);
            $table->string('category', 80)->nullable();
            $table->string('brand', 80)->nullable();
            $table->string('uom', 16)->default('CASE');
            $table->string('pack_size', 32)->nullable();
            $table->string('barcode', 32)->nullable()->index();

            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->decimal('sell_price', 12, 2)->default(0);

            $table->unsignedInteger('reorder_point')->default(0);
            $table->unsignedInteger('reorder_qty')->default(0);
            $table->unsignedSmallInteger('lead_time_days')->default(7);
            $table->unsignedSmallInteger('shelf_life_days')->nullable();
            $table->enum('abc_class', ['A', 'B', 'C'])->default('C');

            $table->foreignId('primary_supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['category', 'is_active']);
        });

        Schema::create('stock_balances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_bin_id')->nullable()->constrained()->nullOnDelete();
            $table->string('batch', 48)->nullable();
            $table->date('expiry_date')->nullable();

            $table->decimal('on_hand', 14, 2)->default(0);
            $table->decimal('allocated', 14, 2)->default(0);
            // Stored rather than computed so it can be indexed for reorder scans.
            $table->decimal('available', 14, 2)->default(0);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->timestamps();

            $table->unique(['item_id', 'warehouse_id', 'batch'], 'stock_item_wh_batch_unique');
            $table->index(['warehouse_id', 'expiry_date']);
        });

        /** Immutable log of every quantity change — the audit trail for stock. */
        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->foreignId('warehouse_id')->constrained()->cascadeOnDelete();
            $table->enum('direction', ['in', 'out']);
            $table->enum('reason', ['Receipt', 'Issue', 'Transfer In', 'Transfer Out', 'Adjustment', 'Return', 'Write-off']);
            $table->decimal('quantity', 14, 2);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->string('reference_type', 64)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->foreignId('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('moved_at');
            $table->timestamps();

            $table->index(['reference_type', 'reference_id']);
            $table->index(['item_id', 'moved_at']);
        });

        Schema::create('inbound_shipments', function (Blueprint $table) {
            $table->id();
            $table->string('asn_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $table->string('reference', 48)->nullable();       // the PO number
            $table->dateTime('arrival_at')->nullable();
            $table->string('dock', 32)->nullable();
            $table->unsignedInteger('pallets')->default(0);
            $table->unsignedInteger('lines_total')->default(0);
            $table->unsignedInteger('lines_putaway')->default(0);
            $table->enum('status', ['Expected', 'Receiving', 'In Inspection', 'Putaway', 'Completed'])->default('Expected');
            $table->timestamps();
        });

        Schema::create('pick_lists', function (Blueprint $table) {
            $table->id();
            $table->string('pick_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('sales_order_no', 32)->nullable();
            $table->string('wave', 32)->nullable();
            $table->foreignId('picker_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->dateTime('cutoff_at')->nullable();
            $table->unsignedInteger('lines')->default(0);
            $table->unsignedInteger('lines_picked')->default(0);
            $table->enum('status', ['Released', 'Picking', 'Packed', 'Staged', 'Dispatched', 'On Hold'])->default('Released');
            $table->timestamps();
        });

        Schema::create('stock_transfers', function (Blueprint $table) {
            $table->id();
            $table->string('transfer_no', 32)->unique();
            $table->foreignId('from_warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->foreignId('to_warehouse_id')->constrained('warehouses')->restrictOnDelete();
            $table->date('transfer_date');
            $table->date('eta')->nullable();
            $table->unsignedInteger('lines')->default(0);
            $table->decimal('quantity', 14, 2)->default(0);
            $table->decimal('value', 14, 2)->default(0);
            $table->enum('status', ['Draft', 'Approved', 'In Transit', 'Received', 'Cancelled'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('cycle_counts', function (Blueprint $table) {
            $table->id();
            $table->string('count_no', 32)->unique();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->string('zone', 32)->nullable();
            $table->date('count_date');
            $table->foreignId('counted_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->unsignedInteger('skus_counted')->default(0);
            $table->unsignedInteger('variances')->default(0);
            $table->decimal('accuracy', 6, 2)->default(0);
            $table->decimal('value_variance', 14, 2)->default(0);
            $table->enum('status', ['Scheduled', 'In Progress', 'For Approval', 'Posted'])->default('Scheduled');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cycle_counts');
        Schema::dropIfExists('stock_transfers');
        Schema::dropIfExists('pick_lists');
        Schema::dropIfExists('inbound_shipments');
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('stock_balances');
        Schema::dropIfExists('items');
        Schema::dropIfExists('warehouse_bins');
        Schema::dropIfExists('warehouses');
    }
};
