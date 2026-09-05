<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Procurement.
 *
 * The chain is requisition → RFQ → purchase order → goods receipt → supplier
 * invoice. Each document references the one before it so three-way matching
 * (PO vs receipt vs invoice) is a join, not a manual reconciliation.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->id();
            $table->string('requisition_no', 32)->unique();
            $table->string('title', 190);
            $table->foreignId('requested_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('hr_department_id')->nullable()->constrained()->nullOnDelete();
            $table->date('requested_at');
            $table->date('needed_by')->nullable();
            $table->unsignedInteger('lines')->default(0);
            $table->decimal('amount', 14, 2)->default(0);
            $table->decimal('budget_remaining', 14, 2)->default(0);
            $table->enum('status', ['Draft', 'Submitted', 'For Approval', 'Approved', 'Rejected', 'Converted'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('rfqs', function (Blueprint $table) {
            $table->id();
            $table->string('rfq_no', 32)->unique();
            $table->string('title', 190);
            $table->foreignId('buyer_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->date('issued_at');
            $table->date('closes_at')->nullable();
            $table->unsignedTinyInteger('suppliers_invited')->default(0);
            $table->unsignedTinyInteger('responses_received')->default(0);
            $table->decimal('estimated_value', 14, 2)->default(0);
            $table->decimal('best_bid', 14, 2)->default(0);
            $table->decimal('savings', 14, 2)->default(0);
            $table->foreignId('awarded_supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->enum('status', ['Open', 'Under Evaluation', 'Awarded', 'Cancelled'])->default('Open');
            $table->timestamps();
        });

        /** One supplier's response to an RFQ — the bid comparison grid. */
        Schema::create('rfq_bids', function (Blueprint $table) {
            $table->id();
            $table->foreignId('rfq_id')->constrained()->cascadeOnDelete();
            $table->foreignId('supplier_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 14, 2)->default(0);
            $table->unsignedSmallInteger('lead_time_days')->default(0);
            $table->string('payment_terms', 32)->nullable();
            $table->unsignedTinyInteger('technical_score')->default(0);
            $table->boolean('is_awarded')->default(false);
            $table->timestamps();

            $table->unique(['rfq_id', 'supplier_id']);
        });

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->string('po_no', 32)->unique();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignId('purchase_requisition_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('rfq_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('warehouse_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('buyer_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->date('order_date');
            $table->date('expected_at')->nullable();
            $table->decimal('subtotal', 14, 2)->default(0);
            $table->decimal('tax', 14, 2)->default(0);
            $table->decimal('total', 14, 2)->default(0);
            $table->unsignedTinyInteger('received_pct')->default(0);
            $table->enum('status', ['Draft', 'For Approval', 'Approved', 'Partial', 'Completed', 'Cancelled'])->default('Draft');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'order_date']);
        });

        Schema::create('purchase_order_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            $table->decimal('quantity_received', 14, 2)->default(0);
            $table->decimal('unit_cost', 12, 2);
            $table->decimal('line_total', 14, 2);
            $table->timestamps();
        });

        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('grn_no', 32)->unique();
            $table->foreignId('purchase_order_id')->constrained()->restrictOnDelete();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->date('received_at');
            $table->unsignedInteger('lines')->default(0);
            $table->decimal('quantity_received', 14, 2)->default(0);
            $table->decimal('quantity_rejected', 14, 2)->default(0);
            $table->foreignId('received_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->text('inspection_notes')->nullable();
            $table->enum('status', ['Draft', 'For Approval', 'Posted', 'Rejected'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('supplier_invoices', function (Blueprint $table) {
            $table->id();
            $table->string('invoice_no', 48)->unique();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignId('purchase_order_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('goods_receipt_id')->nullable()->constrained()->nullOnDelete();
            $table->date('invoice_date');
            $table->date('due_date');
            $table->decimal('amount', 14, 2)->default(0);
            // Result of matching PO quantity/price against the receipt.
            $table->enum('match_status', ['Matched', '2-way only', 'Price variance', 'Qty variance', 'Unmatched'])
                ->default('Unmatched');
            $table->enum('status', ['Draft', 'For Approval', 'Approved', 'Paid', 'Overdue', 'Rejected'])->default('Draft');
            $table->timestamps();

            $table->index(['status', 'due_date']);
        });

        Schema::create('supplier_contracts', function (Blueprint $table) {
            $table->id();
            $table->string('contract_no', 32)->unique();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->string('title', 190);
            $table->enum('type', ['Supply Agreement', 'Service Contract', 'Framework Agreement', 'Lease'])
                ->default('Supply Agreement');
            $table->date('start_date');
            $table->date('end_date');
            $table->decimal('value', 14, 2)->default(0);
            $table->boolean('auto_renew')->default(false);
            $table->unsignedSmallInteger('notice_days')->default(30);
            $table->foreignId('owner_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Draft', 'Active', 'Expiring', 'Expired', 'Terminated'])->default('Draft');
            $table->timestamps();

            $table->index(['status', 'end_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('supplier_contracts');
        Schema::dropIfExists('supplier_invoices');
        Schema::dropIfExists('goods_receipts');
        Schema::dropIfExists('purchase_order_lines');
        Schema::dropIfExists('purchase_orders');
        Schema::dropIfExists('rfq_bids');
        Schema::dropIfExists('rfqs');
        Schema::dropIfExists('purchase_requisitions');
    }
};
