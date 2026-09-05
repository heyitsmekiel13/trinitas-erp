<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The fields the paper Fuel Purchase Order Form already has.
 *
 * The trip ticket was built around the question the paper form cannot answer —
 * is this much fuel reasonable for this trip — and in doing so it left out
 * most of what the paper form is actually *for*. The printed sheet is handed
 * to a service station and comes back with an invoice number on it. That means
 * it needs the things the station and the custodian read: who to bill, which
 * pre-printed pad number this is, what product to pump, and in what unit.
 *
 * So these are not decoration. Without `supplier` the form does not say who it
 * is addressed to; without `form_no` a signed copy cannot be matched to the
 * pad it was torn from; without `charge_invoice_no` the loop from
 * authorisation to invoice never closes, which is the reconciliation the
 * Finance keeper of this form exists to do.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            /* The pre-printed serial on the pad — 1537 in the corner, written
               by hand. Kept as text because it is a pad number, not a counter
               this system owns. */
            $table->string('form_no', 24)->nullable()->after('reference');
            /* The company's own control number for the form, which the paper
               form leaves blank for Finance to fill. */
            $table->string('fpof_control_no', 32)->nullable()->after('form_no');
            $table->string('business_unit', 120)->nullable()->after('fpof_control_no');
            /* TO — the service station the order is addressed to. */
            $table->string('supplier', 190)->nullable()->after('business_unit');

            /* CO / PO / R&C, exactly as the three boxes are printed. */
            $table->enum('vehicle_ownership', ['CO', 'PO', 'R&C'])->default('CO')->after('vehicle_id');
            $table->string('po_category', 120)->nullable()->after('vehicle_ownership');

            /* The product tick-list. Several can be ticked on one form — a
               delivery run that also collects a drum of engine oil is one
               order, not two — so this is a list rather than a column. */
            $table->json('products')->nullable()->after('po_category');
            $table->string('product_other', 190)->nullable()->after('products');
            /* Litres for fuel, pieces for a lubricant. The quantity itself is
               the approved litres already on the row. */
            $table->string('unit', 24)->default('Litres')->after('product_other');

            /* Written on by the custodian once the station has billed it.
               This is the only field on the form that is filled in after the
               trip rather than before it. */
            $table->string('charge_invoice_no', 64)->nullable()->after('fuel_log_id');
        });
    }

    public function down(): void
    {
        Schema::table('fuel_requests', function (Blueprint $table) {
            $table->dropColumn([
                'form_no',
                'fpof_control_no',
                'business_unit',
                'supplier',
                'vehicle_ownership',
                'po_category',
                'products',
                'product_other',
                'unit',
                'charge_invoice_no',
            ]);
        });
    }
};
