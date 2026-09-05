<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Trading partners: who we sell to and who we buy from.
 *
 * Both carry a credit/terms profile because both sides of the ledger need
 * ageing, and a status that gates transacting — an account on hold cannot
 * have a new order confirmed against it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 190);
            $table->enum('channel', ['Supermarket', 'Convenience', 'Wholesale', 'HoReCa', 'E-commerce', 'Industrial'])
                ->default('Wholesale');

            $table->string('contact_person', 120)->nullable();
            $table->string('email', 150)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('address', 255)->nullable();
            $table->string('city', 80)->nullable();
            $table->enum('region', ['NCR', 'Luzon', 'Visayas', 'Mindanao'])->default('Mindanao');
            $table->string('tin', 32)->nullable();

            $table->enum('terms', ['COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'])->default('Net 30');
            $table->decimal('credit_limit', 14, 2)->default(0);
            // Denormalised running balance, maintained by the AR posting service.
            $table->decimal('balance', 14, 2)->default(0);
            $table->decimal('ytd_sales', 14, 2)->default(0);
            $table->date('last_order_at')->nullable();

            $table->foreignId('sales_rep_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->decimal('rating', 3, 1)->default(0);
            $table->enum('status', ['Active', 'On Hold', 'Inactive'])->default('Active');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'channel']);
            $table->index('region');
        });

        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 190);
            $table->string('category', 80)->nullable();

            $table->string('contact_person', 120)->nullable();
            $table->string('email', 150)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('address', 255)->nullable();
            $table->string('city', 80)->nullable();
            $table->string('tin', 32)->nullable();

            $table->enum('terms', ['COD', 'Net 15', 'Net 30', 'Net 45', 'Net 60'])->default('Net 30');
            $table->decimal('ytd_spend', 14, 2)->default(0);

            // Scorecard inputs, recomputed nightly from receipts and invoices.
            $table->decimal('on_time_rate', 5, 2)->default(0);
            $table->decimal('quality_rate', 5, 2)->default(0);
            $table->decimal('price_index', 6, 2)->default(100);
            $table->unsignedTinyInteger('scorecard')->default(0);

            $table->date('accredited_until')->nullable();
            $table->enum('status', ['Active', 'Probationary', 'Blacklisted'])->default('Active');
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'category']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('suppliers');
        Schema::dropIfExists('customers');
    }
};
