<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Finance & Accounting — the single book of record.
 *
 * Every other module ultimately posts here. Journal entries are header/line
 * with a database-level guarantee that lines exist; the balanced-debits-equals
 * -credits rule is enforced by the posting service, which is the only code
 * permitted to set a journal's status to Posted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table) {
            $table->id();
            $table->string('code', 16)->unique();
            $table->string('name', 190);
            $table->enum('type', ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']);
            $table->string('subtype', 64)->nullable();
            $table->enum('normal_balance', ['Debit', 'Credit']);
            $table->foreignId('parent_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->unsignedTinyInteger('level')->default(0);
            $table->boolean('is_postable')->default(true);
            $table->decimal('balance', 16, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index('type');
        });

        Schema::create('journal_entries', function (Blueprint $table) {
            $table->id();
            $table->string('journal_no', 32)->unique();
            $table->date('entry_date');
            $table->string('memo', 255)->nullable();
            $table->enum('source', ['Sales', 'Purchases', 'Payroll', 'Cash', 'Adjusting', 'Depreciation', 'Manual'])
                ->default('Manual');
            $table->string('reference_type', 64)->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->decimal('total_debit', 16, 2)->default(0);
            $table->decimal('total_credit', 16, 2)->default(0);
            $table->foreignId('prepared_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('posted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('posted_at')->nullable();
            $table->enum('status', ['Draft', 'For Approval', 'Posted', 'Reversed'])->default('Draft');
            $table->timestamps();

            $table->index(['status', 'entry_date']);
            $table->index(['reference_type', 'reference_id']);
        });

        Schema::create('journal_lines', function (Blueprint $table) {
            $table->id();
            $table->foreignId('journal_entry_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->restrictOnDelete();
            $table->string('description', 255)->nullable();
            $table->decimal('debit', 16, 2)->default(0);
            $table->decimal('credit', 16, 2)->default(0);
            $table->foreignId('hr_department_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->index('account_id');
        });

        Schema::create('ar_invoices', function (Blueprint $table) {
            $table->id();
            $table->string('invoice_no', 32)->unique();
            $table->foreignId('customer_id')->constrained()->restrictOnDelete();
            $table->foreignId('sales_order_id')->nullable()->constrained()->nullOnDelete();
            $table->date('invoice_date');
            $table->date('due_date');
            $table->decimal('amount', 14, 2)->default(0);
            $table->decimal('paid', 14, 2)->default(0);
            $table->decimal('balance', 14, 2)->default(0);
            $table->unsignedSmallInteger('days_overdue')->default(0);
            $table->enum('ageing_bucket', ['Current', '1-30', '31-60', '61-90', '90+'])->default('Current');
            $table->foreignId('collector_id')->nullable()->constrained('employees')->nullOnDelete();
            $table->enum('status', ['Draft', 'Posted', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'])->default('Draft');
            $table->timestamps();

            $table->index(['status', 'due_date']);
            $table->index('ageing_bucket');
        });

        Schema::create('ap_bills', function (Blueprint $table) {
            $table->id();
            $table->string('bill_no', 48)->unique();
            $table->foreignId('supplier_id')->constrained()->restrictOnDelete();
            $table->foreignId('supplier_invoice_id')->nullable()->constrained()->nullOnDelete();
            $table->date('bill_date');
            $table->date('due_date');
            $table->decimal('amount', 14, 2)->default(0);
            $table->decimal('paid', 14, 2)->default(0);
            $table->decimal('balance', 14, 2)->default(0);
            $table->smallInteger('days_to_due')->default(0);
            $table->enum('ageing_bucket', ['Current', '1-30', '31-60', '61-90', '90+'])->default('Current');
            $table->enum('status', ['Draft', 'Approved', 'Scheduled', 'Partially Paid', 'Paid', 'Overdue'])->default('Draft');
            $table->timestamps();

            $table->index(['status', 'due_date']);
        });

        Schema::create('bank_accounts', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150);
            $table->string('bank', 120);
            $table->string('account_no', 48);
            $table->enum('type', ['Operating', 'Payroll', 'Savings', 'Time Deposit'])->default('Operating');
            $table->string('currency', 8)->default('PHP');
            $table->decimal('balance', 16, 2)->default(0);
            $table->unsignedInteger('unreconciled_count')->default(0);
            $table->date('last_reconciled_at')->nullable();
            $table->foreignId('gl_account_id')->nullable()->constrained('accounts')->nullOnDelete();
            $table->enum('status', ['Active', 'Dormant', 'Closed'])->default('Active');
            $table->timestamps();
        });

        Schema::create('bank_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bank_account_id')->constrained()->cascadeOnDelete();
            $table->date('transaction_date');
            $table->string('description', 255)->nullable();
            $table->string('reference', 64)->nullable();
            $table->decimal('debit', 16, 2)->default(0);
            $table->decimal('credit', 16, 2)->default(0);
            $table->decimal('running_balance', 16, 2)->default(0);
            $table->boolean('is_reconciled')->default(false);
            $table->foreignId('journal_entry_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->index(['bank_account_id', 'transaction_date']);
        });

        Schema::create('expenses', function (Blueprint $table) {
            $table->id();
            $table->string('expense_no', 32)->unique();
            $table->foreignId('employee_id')->constrained()->restrictOnDelete();
            $table->foreignId('hr_department_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('category', ['Travel', 'Meals', 'Fuel', 'Supplies', 'Representation', 'Utilities', 'Repairs', 'Communication'])
                ->default('Supplies');
            $table->date('expense_date');
            $table->decimal('amount', 12, 2);
            $table->enum('fund_type', ['Petty Cash', 'Reimbursement', 'Corporate Card', 'Cash Advance'])->default('Reimbursement');
            $table->string('receipt_path', 255)->nullable();
            $table->enum('status', ['Draft', 'Submitted', 'For Approval', 'Approved', 'Liquidated', 'Rejected'])->default('Draft');
            $table->timestamps();
        });

        Schema::create('fixed_assets', function (Blueprint $table) {
            $table->id();
            $table->string('code', 32)->unique();
            $table->string('name', 190);
            $table->string('asset_class', 120)->nullable();
            $table->foreignId('asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->date('acquired_on');
            $table->decimal('cost', 14, 2);
            $table->decimal('accumulated_depreciation', 14, 2)->default(0);
            $table->decimal('net_book_value', 14, 2)->default(0);
            $table->enum('method', ['Straight Line', 'Declining Balance'])->default('Straight Line');
            $table->unsignedTinyInteger('useful_life_years')->default(5);
            $table->decimal('monthly_depreciation', 12, 2)->default(0);
            $table->date('disposed_on')->nullable();
            $table->enum('status', ['In Service', 'Fully Depreciated', 'Disposed', 'Impaired'])->default('In Service');
            $table->timestamps();
        });

        Schema::create('tax_filings', function (Blueprint $table) {
            $table->id();
            $table->string('form', 24);
            $table->string('description', 190);
            $table->string('period', 48);
            $table->date('due_date');
            $table->decimal('tax_base', 16, 2)->default(0);
            $table->decimal('tax_due', 14, 2)->default(0);
            $table->date('filed_on')->nullable();
            $table->string('confirmation_no', 64)->nullable();
            $table->enum('status', ['Not Started', 'In Preparation', 'For Review', 'Filed', 'Paid', 'Overdue'])->default('Not Started');
            $table->timestamps();

            $table->unique(['form', 'period']);
            $table->index(['status', 'due_date']);
        });

        Schema::create('budget_lines', function (Blueprint $table) {
            $table->id();
            $table->unsignedSmallInteger('year');
            $table->foreignId('hr_department_id')->constrained()->cascadeOnDelete();
            $table->foreignId('account_id')->constrained()->restrictOnDelete();
            $table->decimal('annual_budget', 14, 2)->default(0);
            $table->decimal('ytd_budget', 14, 2)->default(0);
            $table->decimal('ytd_actual', 14, 2)->default(0);
            $table->decimal('committed', 14, 2)->default(0);
            $table->timestamps();

            $table->unique(['year', 'hr_department_id', 'account_id'], 'budget_year_dept_account_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('budget_lines');
        Schema::dropIfExists('tax_filings');
        Schema::dropIfExists('fixed_assets');
        Schema::dropIfExists('expenses');
        Schema::dropIfExists('bank_transactions');
        Schema::dropIfExists('bank_accounts');
        Schema::dropIfExists('ap_bills');
        Schema::dropIfExists('ar_invoices');
        Schema::dropIfExists('journal_lines');
        Schema::dropIfExists('journal_entries');
        Schema::dropIfExists('accounts');
    }
};
