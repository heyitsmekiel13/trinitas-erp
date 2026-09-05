<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The genuine article: an employee spent their own money (or drove their own
 * car) on the company's business, and wants it back. The existing `expenses`
 * table is a cash-advance liquidation workflow — settling money already
 * advanced under a fund type — which is a different shape of document from
 * "pay me back for what I already spent." This is that document.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reimbursement_claims', function (Blueprint $table) {
            $table->id();
            $table->string('claim_no', 32)->unique();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->enum('category', ['Mileage', 'Travel', 'Meals', 'Supplies', 'Other'])->default('Other');
            $table->date('claim_date');
            $table->decimal('amount', 12, 2);
            $table->string('description', 255)->nullable();
            $table->string('receipt_path')->nullable();

            // Filled in when a claim is raised from a personally-owned
            // vehicle's trip — the cross-link is what lets the claim show its
            // working (route, rate) rather than just a number somebody typed.
            $table->foreignId('fuel_request_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('distance_km', 8, 2)->nullable();
            $table->decimal('rate_per_km', 8, 2)->nullable();

            $table->enum('status', ['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'])->default('Draft');
            $table->foreignId('approved_by_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->string('payment_reference', 120)->nullable();

            $table->timestamps();

            $table->index(['employee_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reimbursement_claims');
    }
};
