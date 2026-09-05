<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales & Marketing.
 *
 * Orders and quotations carry header/line structure — a header total that is
 * not the sum of its lines is the classic ERP data bug, so lines are the
 * source of truth and the header totals are maintained by the posting service.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leads', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('company', 190);
            $table->string('contact_person', 120)->nullable();
            $table->enum('source', ['Referral', 'Trade Show', 'Cold Call', 'Website', 'Existing Customer', 'Partner'])
                ->default('Website');
            $table->enum('stage', ['Qualification', 'Needs Analysis', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'])
                ->default('Qualification');
            $table->decimal('value', 14, 2)->default(0);
            $table->unsignedTinyInteger('probability')->default(0);
            $table->foreignId('owner_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->date('expected_close')->nullable();
            $table->string('next_step', 190)->nullable();
            $table->timestamps();

            $table->index('stage');
        });

        Schema::create('quotations', function (Blueprint $table) {
            $table->id();
            $table->string('quote_no', 32)->unique();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->date('quote_date');
            $table->date('valid_until')->nullable();
            $table->decimal('subtotal', 14, 2)->default(0);
            $table->decimal('discount', 14, 2)->default(0);
            $table->decimal('tax', 14, 2)->default(0);
            $table->decimal('total', 14, 2)->default(0);
            $table->decimal('margin_pct', 6, 2)->default(0);
            $table->foreignId('owner_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Draft', 'Submitted', 'Approved', 'Rejected', 'Expired', 'Won'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('quotation_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('quotation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('discount_pct', 6, 2)->default(0);
            $table->decimal('line_total', 14, 2);
            $table->timestamps();
        });

        Schema::create('sales_orders', function (Blueprint $table) {
            $table->id();
            $table->string('order_no', 32)->unique();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->foreignId('quotation_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('warehouse_id')->constrained()->restrictOnDelete();
            $table->foreignId('sales_rep_id')->nullable()->constrained('employees')->nullOnDelete();

            $table->date('order_date');
            $table->date('promised_date')->nullable();
            $table->decimal('subtotal', 14, 2)->default(0);
            $table->decimal('discount', 14, 2)->default(0);
            $table->decimal('tax', 14, 2)->default(0);
            $table->decimal('total', 14, 2)->default(0);
            $table->decimal('cost_total', 14, 2)->default(0);
            $table->decimal('margin_pct', 6, 2)->default(0);
            $table->unsignedTinyInteger('fulfilled_pct')->default(0);

            $table->enum('status', ['Draft', 'Confirmed', 'Partial', 'Delivered', 'Cancelled', 'On Hold'])->default('Draft');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'order_date']);
            $table->index('customer_id');
        });

        Schema::create('sales_order_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sales_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->constrained()->restrictOnDelete();
            $table->decimal('quantity', 14, 2);
            $table->decimal('quantity_delivered', 14, 2)->default(0);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->decimal('discount_pct', 6, 2)->default(0);
            $table->decimal('line_total', 14, 2);
            $table->timestamps();

            $table->index('item_id');
        });

        Schema::create('deliveries', function (Blueprint $table) {
            $table->id();
            $table->string('delivery_no', 32)->unique();
            $table->foreignId('sales_order_id')->constrained()->restrictOnDelete();
            $table->foreignId('vehicle_asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->foreignId('driver_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->dateTime('scheduled_at')->nullable();
            $table->dateTime('delivered_at')->nullable();
            $table->unsignedInteger('pallets')->default(0);
            $table->boolean('pod_received')->default(false);
            $table->enum('status', ['Scheduled', 'In Transit', 'Delivered', 'Partial', 'Cancelled'])->default('Scheduled');
            $table->timestamps();
        });

        Schema::create('sales_returns', function (Blueprint $table) {
            $table->id();
            $table->string('rma_no', 32)->unique();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->foreignId('sales_order_id')->nullable()->constrained()->nullOnDelete();
            $table->date('return_date');
            $table->enum('reason', ['Damaged in transit', 'Wrong item shipped', 'Near expiry', 'Quality complaint', 'Over-delivery', 'Order cancelled'])
                ->default('Quality complaint');
            $table->decimal('quantity', 14, 2)->default(0);
            $table->decimal('amount', 14, 2)->default(0);
            $table->enum('disposition', ['Restock', 'Scrap', 'Return to Supplier', 'Pending inspection'])->default('Pending inspection');
            $table->enum('status', ['Submitted', 'Approved', 'Completed', 'Rejected'])->default('Submitted');
            $table->timestamps();
        });

        Schema::create('price_list_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('item_id')->constrained()->cascadeOnDelete();
            $table->enum('tier', ['Standard', 'Wholesale', 'Key Account', 'Distributor'])->default('Standard');
            $table->decimal('list_price', 12, 2);
            $table->decimal('discount_pct', 6, 2)->default(0);
            $table->decimal('net_price', 12, 2);
            $table->decimal('margin_pct', 6, 2)->default(0);
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->enum('status', ['Active', 'Scheduled', 'Expired'])->default('Active');
            $table->timestamps();

            $table->unique(['item_id', 'tier', 'effective_from'], 'price_item_tier_from_unique');
        });

        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->string('name', 190);
            $table->enum('channel', ['Trade Promo', 'Digital Ads', 'Email', 'Field Activation', 'Print', 'Loyalty'])
                ->default('Trade Promo');
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->decimal('budget', 14, 2)->default(0);
            $table->decimal('spend', 14, 2)->default(0);
            $table->unsignedInteger('leads_generated')->default(0);
            $table->unsignedInteger('conversions')->default(0);
            $table->decimal('attributed_revenue', 14, 2)->default(0);
            $table->foreignId('owner_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Planned', 'Active', 'Completed', 'On Hold'])->default('Planned');
            $table->timestamps();
        });

        Schema::create('sales_targets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->string('territory', 120)->nullable();
            $table->unsignedSmallInteger('year');
            $table->unsignedTinyInteger('period')->default(0);   // 0 = full year
            $table->decimal('quota', 14, 2)->default(0);
            $table->decimal('actual', 14, 2)->default(0);
            $table->unsignedInteger('deals')->default(0);
            $table->decimal('commission_rate', 6, 2)->default(0);
            $table->decimal('commission', 14, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'year', 'period']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sales_targets');
        Schema::dropIfExists('campaigns');
        Schema::dropIfExists('price_list_entries');
        Schema::dropIfExists('sales_returns');
        Schema::dropIfExists('deliveries');
        Schema::dropIfExists('sales_order_lines');
        Schema::dropIfExists('sales_orders');
        Schema::dropIfExists('quotation_lines');
        Schema::dropIfExists('quotations');
        Schema::dropIfExists('leads');
    }
};
