<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Gives the procurement chain something to carry.
 *
 * Requisitions and goods receipts were header-only — a line *count* and a
 * total. That is enough to display, and useless for everything else: a
 * requisition with no items cannot become a purchase order, and a receipt with
 * no items cannot tell you which of the twelve things you ordered actually
 * turned up. `purchase_order_lines.quantity_received` has been sitting unused
 * since day one for exactly this reason.
 *
 * With lines on both ends, receiving becomes an update to the order it came
 * from, and three-way matching becomes a join rather than a meeting.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_requisition_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_requisition_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            // What the requester expects it to cost, before anyone has quoted.
            $table->decimal('estimated_cost', 12, 2)->default(0);
            $table->decimal('line_total', 14, 2)->default(0);
            $table->timestamps();
        });

        Schema::create('goods_receipt_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('goods_receipt_id')->constrained()->cascadeOnDelete();
            // The order line being satisfied. Nullable so a receipt can still
            // be recorded if the PO line was removed after the fact.
            $table->foreignId('purchase_order_line_id')->nullable()
                ->constrained('purchase_order_lines')->nullOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity_received', 14, 2)->default(0);
            $table->decimal('quantity_rejected', 14, 2)->default(0);
            $table->string('reject_reason', 190)->nullable();
            $table->timestamps();
        });

        Schema::table('rfqs', function (Blueprint $table) {
            $table->foreignId('purchase_requisition_id')->nullable()->after('rfq_no')
                ->constrained()->nullOnDelete();
        });

        Schema::table('purchase_requisitions', function (Blueprint $table) {
            // Justification is what an approver actually reads.
            $table->text('justification')->nullable()->after('needed_by');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_requisitions', fn (Blueprint $t) => $t->dropColumn('justification'));
        Schema::table('rfqs', fn (Blueprint $t) => $t->dropConstrainedForeignId('purchase_requisition_id'));
        Schema::dropIfExists('goods_receipt_lines');
        Schema::dropIfExists('purchase_requisition_lines');
    }
};
