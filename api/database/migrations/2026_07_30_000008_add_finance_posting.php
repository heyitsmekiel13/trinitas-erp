<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What Finance needs before it can post anything.
 *
 * The central addition is that money changing hands becomes a document. A
 * `paid` column somebody edits cannot answer when, from which bank, against
 * which invoice, or who recorded it — and those are the questions an audit
 * actually asks. Receipts and payments carry allocations, because one cheque
 * routinely settles several invoices and splitting it is the whole job.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('journal_entries', function (Blueprint $table) {
            // A reversal is a new entry that points at what it undoes. The
            // original is never edited — that is the point of a ledger.
            $table->foreignId('reverses_id')->nullable()->after('posted_at')
                ->constrained('journal_entries')->nullOnDelete();
        });

        Schema::create('ar_receipts', function (Blueprint $table) {
            $table->id();
            $table->string('receipt_no', 32)->unique();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->foreignId('bank_account_id')->nullable()->constrained()->nullOnDelete();
            $table->date('receipt_date');
            $table->decimal('amount', 14, 2)->default(0);
            // What is still sitting unapplied against the customer's account.
            $table->decimal('unapplied', 14, 2)->default(0);
            $table->enum('method', ['Cash', 'Cheque', 'Bank Transfer', 'Online', 'Card'])->default('Bank Transfer');
            $table->string('reference', 64)->nullable();
            $table->foreignId('received_by')->nullable()->constrained('employees')->nullOnDelete();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('status', ['Draft', 'Posted', 'Cancelled'])->default('Draft');
            $table->timestamps();

            $table->index(['customer_id', 'receipt_date']);
        });

        Schema::create('ar_receipt_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ar_receipt_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ar_invoice_id')->constrained()->restrictOnDelete();
            $table->decimal('amount', 14, 2);
            $table->timestamps();

            $table->index('ar_invoice_id');
        });

        Schema::create('ap_payments', function (Blueprint $table) {
            $table->id();
            $table->string('payment_no', 32)->unique();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignId('bank_account_id')->nullable()->constrained()->nullOnDelete();
            $table->date('payment_date');
            $table->decimal('amount', 14, 2)->default(0);
            $table->decimal('unapplied', 14, 2)->default(0);
            $table->enum('method', ['Cash', 'Cheque', 'Bank Transfer', 'Online'])->default('Bank Transfer');
            $table->string('reference', 64)->nullable();
            $table->foreignId('journal_entry_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('status', ['Draft', 'Posted', 'Cancelled'])->default('Draft');
            $table->timestamps();

            $table->index(['supplier_id', 'payment_date']);
        });

        Schema::create('ap_payment_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ap_payment_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ap_bill_id')->constrained()->restrictOnDelete();
            $table->decimal('amount', 14, 2);
            $table->timestamps();

            $table->index('ap_bill_id');
        });

        Schema::table('ar_invoices', function (Blueprint $table) {
            $table->string('memo', 255)->nullable()->after('due_date');
            // VAT is split out so the Output VAT account can be posted to and
            // the BIR return has something to be built from.
            $table->decimal('vat_amount', 14, 2)->default(0)->after('amount');
        });

        Schema::table('ap_bills', function (Blueprint $table) {
            $table->string('memo', 255)->nullable()->after('due_date');
            $table->decimal('vat_amount', 14, 2)->default(0)->after('amount');
            // Which expense or asset account the bill lands in.
            $table->foreignId('account_id')->nullable()->after('supplier_invoice_id')
                ->constrained('accounts')->nullOnDelete();
        });

        Schema::table('expenses', function (Blueprint $table) {
            $table->string('description', 255)->nullable()->after('category');
            $table->foreignId('account_id')->nullable()->after('hr_department_id')
                ->constrained('accounts')->nullOnDelete();
            $table->foreignId('journal_entry_id')->nullable()->after('receipt_path')
                ->constrained()->nullOnDelete();
        });

        Schema::table('fixed_assets', function (Blueprint $table) {
            $table->decimal('salvage_value', 14, 2)->default(0)->after('cost');
            // How far depreciation has actually been run, so a second run in
            // the same month cannot double-charge.
            $table->date('depreciated_to')->nullable()->after('monthly_depreciation');
        });

        Schema::table('tax_filings', function (Blueprint $table) {
            $table->foreignId('journal_entry_id')->nullable()->after('confirmation_no')
                ->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('tax_filings', fn (Blueprint $t) => $t->dropConstrainedForeignId('journal_entry_id'));

        Schema::table('fixed_assets', function (Blueprint $table) {
            $table->dropColumn(['salvage_value', 'depreciated_to']);
        });

        Schema::table('expenses', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
            $table->dropConstrainedForeignId('journal_entry_id');
            $table->dropColumn('description');
        });

        Schema::table('ap_bills', function (Blueprint $table) {
            $table->dropConstrainedForeignId('account_id');
            $table->dropColumn(['memo', 'vat_amount']);
        });

        Schema::table('ar_invoices', fn (Blueprint $t) => $t->dropColumn(['memo', 'vat_amount']));

        Schema::dropIfExists('ap_payment_allocations');
        Schema::dropIfExists('ap_payments');
        Schema::dropIfExists('ar_receipt_allocations');
        Schema::dropIfExists('ar_receipts');

        Schema::table('journal_entries', fn (Blueprint $t) => $t->dropConstrainedForeignId('reverses_id'));
    }
};
